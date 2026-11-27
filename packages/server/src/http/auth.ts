import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import type { Request, RequestHandler, Response } from 'express';
import { loginSchema, registerSchema, verifyEmailSchema } from '@task-board/shared';
import { db, env } from '../db';
import { emailVerifications, users } from '../db/schema';
import { HttpError } from './errors';
import { clearSessionCookie, requireUserId, setSessionCookie, toUserDto, COOKIE_NAME, verifySessionToken } from './session';
import { disconnectUser } from '../ws/emit';
import { baseUrl, sendMailSafely } from '../mail/mailer';
import { verifyEmailMessage } from '../mail/templates';

export const authRouter = Router();

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESEND_INTERVAL_MS = 60 * 1000;

/** Создаёт одноразовый токен (в БД — только хэш) и отправляет письмо со ссылкой. */
async function sendVerification(req: Request, user: typeof users.$inferSelect): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  await db.insert(emailVerifications).values({
    userId: user.id,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
  });
  const link = `${baseUrl(req)}/verify-email?token=${token}`;
  await sendMailSafely({ to: user.email, ...verifyEmailMessage(user.name, link) });
}

/** Код ошибки PostgreSQL ищем по всей цепочке cause (Drizzle заворачивает ошибки драйвера). */
function pgErrorCode(err: unknown): string | undefined {
  let cur: unknown = err;
  while (typeof cur === 'object' && cur !== null) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === '23505';
}

const register: RequestHandler = async (req, res: Response) => {
  const input = registerSchema.parse(req.body);
  const email = input.email.toLowerCase().trim();
  const passwordHash = await bcrypt.hash(input.password, 10);
  const name = input.name?.trim() || email.split('@')[0];

  try {
    const [user] = await db.insert(users).values({ email, passwordHash, name }).returning();
    await setSessionCookie(res, user.id, user.tokenVersion);
    // Письмо подтверждения — в фоне, регистрацию не задерживаем.
    // При скрытом подтверждении письма не отправляем (код сохранён для включения флагом).
    if (env.REQUIRE_EMAIL_VERIFICATION) {
      void sendVerification(req, user).catch((err) => console.error('[mail] подтверждение:', err));
    }
    res.status(201).json({ user: toUserDto(user), emailVerificationRequired: env.REQUIRE_EMAIL_VERIFICATION });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new HttpError(409, 'EMAIL_TAKEN', 'Этот email уже зарегистрирован');
    }
    throw err;
  }
};

const login: RequestHandler = async (req, res: Response) => {
  const input = loginSchema.parse(req.body);
  const [user] = await db.select().from(users).where(eq(users.email, input.email.toLowerCase().trim()));
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw new HttpError(401, 'BAD_CREDENTIALS', 'Неверный email или пароль');
  }
  await setSessionCookie(res, user.id, user.tokenVersion);
  res.json({ user: toUserDto(user), emailVerificationRequired: env.REQUIRE_EMAIL_VERIFICATION });
};

const logout: RequestHandler = async (req, res) => {
  const token = (req.cookies as Record<string, string | undefined>)?.[COOKIE_NAME];
  const session = token ? await verifySessionToken(token) : null;
  clearSessionCookie(res);
  // Сокет аутентифицирован в handshake: без разрыва он продолжит работать от прежнего
  // пользователя после входа под другим аккаунтом (смена ролей не применилась бы).
  if (session) disconnectUser(session.userId);
  res.json({ ok: true });
};

/** «Выйти на всех устройствах» (FR-33): инкремент версии + новый токен текущей сессии. */
const logoutAll: RequestHandler = async (req, res) => {
  const userId = await requireUserId(req);
  const [user] = await db
    .update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, userId))
    .returning();
  await setSessionCookie(res, user.id, user.tokenVersion);
  // После ответа (cookie уже обновлена) рвём все сокеты: текущий переподключится
  // с новым токеном, остальные — со старым и получат 401.
  res.on('finish', () => disconnectUser(userId));
  res.json({ ok: true });
};

const me: RequestHandler = async (req, res) => {
  const userId = await requireUserId(req);
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Требуется вход');
  }
  res.json({ user: toUserDto(user), emailVerificationRequired: env.REQUIRE_EMAIL_VERIFICATION });
};

/** Подтверждение email по токену из письма (FR-31). Идемпотентно: повторное открытие ссылки — успех. */
const verifyEmail: RequestHandler = async (req, res) => {
  const { token } = verifyEmailSchema.parse(req.body);
  const [row] = await db
    .select()
    .from(emailVerifications)
    .where(eq(emailVerifications.tokenHash, sha256(token)))
    .limit(1);
  if (!row) {
    throw new HttpError(400, 'VERIFICATION_INVALID', 'Ссылка недействительна или истекла');
  }
  const [user] = await db.select().from(users).where(eq(users.id, row.userId));
  if (!user) {
    throw new HttpError(400, 'VERIFICATION_INVALID', 'Ссылка недействительна или истекла');
  }
  // Уже подтверждён (в т.ч. двойным запросом из StrictMode/превью почтового клиента)
  if (user.emailVerifiedAt) {
    res.json({ ok: true, alreadyVerified: true });
    return;
  }
  if (row.usedAt || row.expiresAt < new Date()) {
    throw new HttpError(400, 'VERIFICATION_INVALID', 'Ссылка недействительна или истекла');
  }
  await db.transaction(async (tx) => {
    await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, row.userId));
    await tx.update(emailVerifications).set({ usedAt: new Date() }).where(eq(emailVerifications.id, row.id));
  });
  res.json({ ok: true });
};

/** Повторная отправка письма: не чаще 1 раза в минуту (FR-38). */
const resendVerification: RequestHandler = async (req, res) => {
  const userId = await requireUserId(req);
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Требуется вход');
  }
  if (!env.REQUIRE_EMAIL_VERIFICATION || user.emailVerifiedAt) {
    res.json({ ok: true, alreadyVerified: true });
    return;
  }
  const [last] = await db
    .select()
    .from(emailVerifications)
    .where(eq(emailVerifications.userId, userId))
    .orderBy(desc(emailVerifications.createdAt))
    .limit(1);
  if (last && Date.now() - last.createdAt.getTime() < RESEND_INTERVAL_MS) {
    throw new HttpError(429, 'RATE_LIMITED', 'Письмо уже отправлено — подождите минуту');
  }
  await sendVerification(req, user);
  res.json({ ok: true });
};

authRouter.post('/register', register);
authRouter.post('/login', login);
authRouter.post('/logout', logout);
authRouter.post('/logout-all', logoutAll);
authRouter.get('/me', me);
authRouter.post('/verify-email', verifyEmail);
authRouter.post('/resend-verification', resendVerification);

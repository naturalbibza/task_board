import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import type { RequestHandler, Response } from 'express';
import { loginSchema, registerSchema } from '@task-board/shared';
import { db } from '../db';
import { users } from '../db/schema';
import { HttpError } from './errors';
import { clearSessionCookie, requireUserId, setSessionCookie, toUserDto, COOKIE_NAME, verifySessionToken } from './session';
import { disconnectUser } from '../ws/emit';

export const authRouter = Router();

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
    res.status(201).json({ user: toUserDto(user) });
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
  res.json({ user: toUserDto(user) });
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
  res.json({ user: toUserDto(user) });
};

authRouter.post('/register', register);
authRouter.post('/login', login);
authRouter.post('/logout', logout);
authRouter.post('/logout-all', logoutAll);
authRouter.get('/me', me);

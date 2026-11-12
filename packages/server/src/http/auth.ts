import { Router } from 'express';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import type { RequestHandler, Response } from 'express';
import { loginSchema, registerSchema } from '@task-board/shared';
import { db } from '../db';
import { users } from '../db/schema';
import { HttpError } from './errors';
import {
  COOKIE_NAME,
  clearSessionCookie,
  setSessionCookie,
  toUserDto,
  verifySessionToken,
} from './session';

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
    await setSessionCookie(res, user.id);
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
  await setSessionCookie(res, user.id);
  res.json({ user: toUserDto(user) });
};

const logout: RequestHandler = (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
};

const me: RequestHandler = async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  const userId = token ? await verifySessionToken(token) : null;
  if (!userId) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Требуется вход');
  }
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Требуется вход');
  }
  res.json({ user: toUserDto(user) });
};

authRouter.post('/register', register);
authRouter.post('/login', login);
authRouter.post('/logout', logout);
authRouter.get('/me', me);

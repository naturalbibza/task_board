import { SignJWT, jwtVerify } from 'jose';
import type { CookieOptions, RequestHandler, Response } from 'express';
import { eq } from 'drizzle-orm';
import type { UserDto } from '@task-board/shared';
import type { User } from '../db/schema';
import { db, env } from '../db';
import { users } from '../db/schema';
import { HttpError } from './errors';

export const COOKIE_NAME = 'token';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 дней, FR-2

export type SessionPayload = {
  userId: string;
  version: number;
};

export function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    // Secure только когда прод обслуживается по HTTPS (ORIGIN задаётся после домена)
    secure: env.ORIGIN?.startsWith('https://') ?? false,
    maxAge: MAX_AGE_MS,
    path: '/',
  };
}

const secretKey = () => new TextEncoder().encode(env.JWT_SECRET);

export async function createSessionToken(userId: string, version: number): Promise<string> {
  return new SignJWT({ sub: userId, ver: version })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secretKey());
}

/** Возвращает сессию из валидного токена или null. Старые токены без `ver` — версия 0. */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.sub !== 'string') return null;
    return {
      userId: payload.sub,
      version: typeof payload.ver === 'number' ? payload.ver : 0,
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(res: Response, userId: string, version: number): Promise<void> {
  res.cookie(COOKIE_NAME, await createSessionToken(userId, version), cookieOptions());
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/**
 * userId из cookie или HttpError 401 — для всех роутов, требующих входа.
 * Сверяет версию токена с users.tokenVersion: смена пароля и «выйти везде»
 * инвалидируют все остальные сессии (FR-30, FR-33).
 */
export async function requireUserId(
  req: RequestHandler extends never ? never : { cookies: unknown },
): Promise<string> {
  const token = (req.cookies as Record<string, string | undefined>)?.[COOKIE_NAME];
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Требуется вход');
  }
  const [user] = await db
    .select({ tokenVersion: users.tokenVersion })
    .from(users)
    .where(eq(users.id, session.userId));
  if (!user || user.tokenVersion !== session.version) {
    throw new HttpError(401, 'SESSION_INVALID', 'Сессия устарела — войдите заново');
  }
  return session.userId;
}

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    // При скрытом подтверждении (REQUIRE_EMAIL_VERIFICATION=0) считаем аккаунт подтверждённым:
    // UI не показывает баннеры, ограничения FR-32 не применяются. В БД emailVerifiedAt не трогаем.
    emailVerified: !env.REQUIRE_EMAIL_VERIFICATION || user.emailVerifiedAt !== null,
  };
}

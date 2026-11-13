import { SignJWT, jwtVerify } from 'jose';
import type { CookieOptions, RequestHandler, Response } from 'express';
import type { UserDto } from '@task-board/shared';
import type { User } from '../db/schema';
import { HttpError } from './errors';
import { env } from '../db';

export const COOKIE_NAME = 'token';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 дней, FR-2

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

export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secretKey());
}

/** Возвращает userId из валидного токена или null. */
export async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function setSessionCookie(res: Response, userId: string): Promise<void> {
  res.cookie(COOKIE_NAME, await createSessionToken(userId), cookieOptions());
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/** userId из cookie или HttpError 401 — для всех роутов, требующих входа. */
export async function requireUserId(req: RequestHandler extends never ? never : { cookies: unknown }): Promise<string> {
  const token = (req.cookies as Record<string, string | undefined>)?.[COOKIE_NAME];
  const userId = token ? await verifySessionToken(token) : null;
  if (!userId) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Требуется вход');
  }
  return userId;
}

export function toUserDto(user: User): UserDto {
  return { id: user.id, email: user.email, name: user.name };
}

// Личный кабинет (v2, фаза 13): профиль, контакты, смена пароля.
import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import type { RequestHandler } from 'express';
import { changePasswordSchema, updateProfileSchema, type UserProfileDto } from '@task-board/shared';
import { db } from '../db';
import { users } from '../db/schema';
import { HttpError } from './errors';
import { requireUserId, setSessionCookie } from './session';

export const usersRouter = Router();

type UserRow = typeof users.$inferSelect;

export function profileDto(user: UserRow): UserProfileDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    description: user.description,
    phone: user.phone,
    messengers: user.messengers ?? [],
    createdAt: user.createdAt.toISOString(),
  };
}

const getMe: RequestHandler = async (req, res) => {
  const userId = await requireUserId(req);
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Требуется вход');
  }
  res.json({ user: profileDto(user) });
};

const updateMe: RequestHandler = async (req, res) => {
  const userId = await requireUserId(req);
  const input = updateProfileSchema.parse(req.body);

  const patch: Partial<typeof users.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.phone !== undefined) patch.phone = input.phone?.trim() || null;
  if (input.messengers !== undefined) {
    patch.messengers = input.messengers.map((m) => ({ type: m.type, value: m.value.trim() }));
  }

  const [user] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
  res.json({ user: profileDto(user) });
};

/** Смена пароля (FR-30): проверка текущего, инкремент версии, новый токен текущей сессии. */
const changePassword: RequestHandler = async (req, res) => {
  const userId = await requireUserId(req);
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new HttpError(400, 'BAD_PASSWORD', 'Текущий пароль неверен');
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const [updated] = await db
    .update(users)
    .set({ passwordHash, tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, userId))
    .returning();

  // Прочие сессии инвалидированы, текущая продолжает работать
  await setSessionCookie(res, updated.id, updated.tokenVersion);
  res.json({ ok: true });
};

usersRouter.get('/me', getMe);
usersRouter.patch('/me', updateMe);
usersRouter.post('/me/password', changePassword);

// Шаринг (US-10–12, FR-15–17): инвайты (ссылка и email) и вступление.
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { RequestHandler, Request } from 'express';
import { BOARD_ROLE_LABELS, createInviteSchema, type InviteDto } from '@task-board/shared';
import { db } from '../db';
import { boardMembers, boards, invites, users } from '../db/schema';
import { HttpError } from './errors';
import { requireUserId } from './session';
import { boardAccess, requireAction } from './boards';
import { baseUrl, sendMailSafely } from '../mail/mailer';
import { inviteMessage } from '../mail/templates';

export const joinRouter = Router();

const INVITE_TTL_DAYS = 7;
const INVITE_RATE_LIMIT = 20; // FR-38: не более 20 приглашений в час на пользователя

type InviteRow = typeof invites.$inferSelect;

function inviteDto(invite: InviteRow): InviteDto {
  return {
    id: invite.id,
    token: invite.token,
    expiresAt: invite.expiresAt.toISOString(),
    revoked: invite.revokedAt !== null,
    role: invite.role === 'ADMIN' ? 'ADMIN' : invite.role === 'VIEWER' ? 'VIEWER' : 'EDITOR',
    email: invite.email,
  };
}

function appBase(req: Request): string {
  return baseUrl(req);
}

// --- Инвайты (монтируются в boardsRouter: /boards/:id/invites) ---

export const listInvites: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const access = await boardAccess(userId, req.params.id);
  requireAction(access, 'invite');
  const rows = await db.select().from(invites).where(eq(invites.boardId, req.params.id));
  res.json({ invites: rows.map(inviteDto) });
};

export const createInvite: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const access = await boardAccess(userId, req.params.id);
  requireAction(access, 'invite');
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(invites)
    .where(and(eq(invites.createdBy, userId), gt(invites.createdAt, new Date(Date.now() - 60 * 60 * 1000))));
  if (count >= INVITE_RATE_LIMIT) {
    throw new HttpError(429, 'RATE_LIMITED', 'Слишком много приглашений — попробуйте через час');
  }
  const { role, email } = createInviteSchema.parse(req.body ?? {});
  const inviteRole = role ?? 'EDITOR';
  const inviteEmail = email ? email.toLowerCase().trim() : null;
  const token = randomBytes(32).toString('base64url'); // ≥ 32 символа (FR-16)
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const [invite] = await db
    .insert(invites)
    .values({ boardId: req.params.id, token, expiresAt, createdBy: userId, role: inviteRole, email: inviteEmail })
    .returning();

  // Приглашение по адресу (FR-26): письмо уходит в фоне, ошибка не ломает ответ
  if (inviteEmail) {
    const [inviter] = await db.select().from(users).where(eq(users.id, userId));
    await sendMailSafely({
      to: inviteEmail,
      ...inviteMessage({
        boardTitle: access.title,
        inviterName: inviter?.name ?? 'Участник',
        roleLabel: BOARD_ROLE_LABELS[inviteRole],
        link: `${appBase(req)}/join/${token}`,
      }),
    });
  }

  res.status(201).json({ invite: inviteDto(invite) });
};

// --- Отзыв (монтируется в invitesRouter: /invites/:id) ---

const revokeInvite: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const [invite] = await db.select().from(invites).where(eq(invites.id, req.params.id));
  if (!invite) {
    throw new HttpError(404, 'INVITE_NOT_FOUND', 'Приглашение не найдено');
  }
  const access = await boardAccess(userId, invite.boardId);
  requireAction(access, 'invite');
  const [updated] = await db
    .update(invites)
    .set({ revokedAt: new Date() })
    .where(eq(invites.id, invite.id))
    .returning();
  res.json({ invite: inviteDto(updated) });
};

export const invitesRouter = Router();
invitesRouter.patch('/:id', revokeInvite);

// --- Вступление по ссылке (FR-15, FR-26) ---

const joinByToken: RequestHandler<{ token: string }> = async (req, res) => {
  const token = req.params.token;
  const [invite] = await db.select().from(invites).where(eq(invites.token, token));
  if (!invite || invite.revokedAt || invite.expiresAt < new Date()) {
    throw new HttpError(403, 'INVITE_INVALID', 'Ссылка недействительна или истекла');
  }
  const [board] = await db.select().from(boards).where(eq(boards.id, invite.boardId));
  if (!board) {
    throw new HttpError(404, 'BOARD_NOT_FOUND', 'Доска не найдена');
  }

  // Неавторизованный: 401 — клиент перенаправит на логин и вернётся (FR-15)
  let userId: string;
  try {
    userId = await requireUserId(req);
  } catch {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Войдите, чтобы присоединиться к доске' } });
    return;
  }

  // Приглашение на конкретный адрес: другой пользователь вступить не может
  if (invite.email) {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new HttpError(403, 'INVITE_EMAIL_MISMATCH', 'Это приглашение отправлено на другой адрес');
    }
  }

  // Уже участник — просто успех (не создаём дубликат и не меняем роль)
  const [existing] = await db
    .select()
    .from(boardMembers)
    .where(and(eq(boardMembers.boardId, invite.boardId), eq(boardMembers.userId, userId)));
  if (!existing) {
    await db.insert(boardMembers).values({
      boardId: invite.boardId,
      userId,
      role: invite.role === 'MEMBER' ? 'EDITOR' : invite.role,
      inviteId: invite.id,
    });
  }
  res.json({ boardId: invite.boardId, boardTitle: board.title });
};

joinRouter.get('/:token', joinByToken);

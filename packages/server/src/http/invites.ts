// Шаринг (US-10–12, FR-15–17): инвайты и вступление по ссылке.
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import { db } from '../db';
import { boardMembers, boards, invites } from '../db/schema';
import { HttpError } from './errors';
import { requireUserId } from './session';
import { boardAccess } from './boards';

export const joinRouter = Router();

const INVITE_TTL_DAYS = 7;

type InviteRow = typeof invites.$inferSelect;

function inviteDto(invite: InviteRow): { id: string; token: string; expiresAt: string; revoked: boolean } {
  return {
    id: invite.id,
    token: invite.token,
    expiresAt: invite.expiresAt.toISOString(),
    revoked: invite.revokedAt !== null,
  };
}

/** Владелец доски или 403. */
async function requireOwner(userId: string, boardId: string): Promise<void> {
  const access = await boardAccess(userId, boardId);
  if (access.role !== 'OWNER') {
    throw new HttpError(403, 'FORBIDDEN', 'Управлять приглашениями может только владелец');
  }
}

// --- Инвайты (монтируются в boardsRouter: /boards/:id/invites) ---

export const listInvites: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  await requireOwner(userId, req.params.id);
  const rows = await db.select().from(invites).where(eq(invites.boardId, req.params.id));
  res.json({ invites: rows.map(inviteDto) });
};

export const createInvite: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  await requireOwner(userId, req.params.id);
  const token = randomBytes(32).toString('base64url'); // ≥ 32 символа (FR-16)
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const [invite] = await db
    .insert(invites)
    .values({ boardId: req.params.id, token, expiresAt, createdBy: userId })
    .returning();
  res.status(201).json({ invite: inviteDto(invite) });
};

// --- Отзыв (монтируется в invitesRouter: /invites/:id) ---

const revokeInvite: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const [invite] = await db.select().from(invites).where(eq(invites.id, req.params.id));
  if (!invite) {
    throw new HttpError(404, 'INVITE_NOT_FOUND', 'Приглашение не найдено');
  }
  await requireOwner(userId, invite.boardId);
  const [updated] = await db
    .update(invites)
    .set({ revokedAt: new Date() })
    .where(eq(invites.id, invite.id))
    .returning();
  res.json({ invite: inviteDto(updated) });
};

export const invitesRouter = Router();
invitesRouter.patch('/:id', revokeInvite);

// --- Вступление по ссылке (FR-15) ---

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

  // Уже участник — просто успех (не создаём дубликат)
  const [existing] = await db
    .select()
    .from(boardMembers)
    .where(and(eq(boardMembers.boardId, invite.boardId), eq(boardMembers.userId, userId)));
  if (!existing) {
    await db.insert(boardMembers).values({ boardId: invite.boardId, userId, role: 'MEMBER' });
  }
  res.json({ boardId: invite.boardId, boardTitle: board.title });
};

joinRouter.get('/:token', joinByToken);

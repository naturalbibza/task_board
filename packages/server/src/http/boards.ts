import { Router } from 'express';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import {
  can,
  createBoardSchema,
  renameBoardSchema,
  updateMemberSchema,
  type BoardAction,
  type BoardDto,
  type BoardRole,
  type BoardSnapshot,
  type CardDto,
  type ColumnDto,
  type MemberDto,
} from '@task-board/shared';
import { db } from '../db';
import { boardMembers, boards, cards, columns, users } from '../db/schema';
import { HttpError } from './errors';
import { requireUserId } from './session';
import { emitToBoard } from '../ws/emit';

export const boardsRouter = Router();

type Access = { boardId: string; title: string; role: BoardRole };
type DbRole = typeof boardMembers.$inferSelect['role'];

/** В БД enum хранит legacy-значение MEMBER (v1) — наружу отдаём только 4 роли (v2). */
export function normalizeRole(role: DbRole): BoardRole {
  return role === 'MEMBER' ? 'EDITOR' : role;
}

/** Проверка права по матрице FR-23; бросает 403, который превращается в ошибку API/WS. */
export function requirePermission(role: BoardRole, action: BoardAction): void {
  if (!can(role, action)) {
    throw new HttpError(403, 'FORBIDDEN', 'Недостаточно прав для этого действия');
  }
}

/** Доступ к доске: участник или владелец; иначе 404 (не раскрываем существование). */
export async function boardAccess(userId: string, boardId: string): Promise<Access> {
  const [row] = await db
    .select({ boardId: boards.id, title: boards.title, role: boardMembers.role })
    .from(boards)
    .innerJoin(boardMembers, and(eq(boardMembers.boardId, boards.id), eq(boardMembers.userId, userId)))
    .where(eq(boards.id, boardId));
  if (!row) {
    throw new HttpError(404, 'BOARD_NOT_FOUND', 'Доска не найдена или нет доступа');
  }
  return { boardId: row.boardId, title: row.title, role: normalizeRole(row.role) };
}

/** Доступ через колонку (для карточек и колонок по их id). */
export async function columnAccess(userId: string, columnId: string): Promise<Access & { columnId: string }> {
  const [column] = await db.select().from(columns).where(eq(columns.id, columnId));
  if (!column) {
    throw new HttpError(404, 'COLUMN_NOT_FOUND', 'Колонка не найдена');
  }
  const access = await boardAccess(userId, column.boardId);
  return { ...access, columnId: column.id };
}

/** Доступ через карточку. */
export async function cardAccess(userId: string, cardId: string): Promise<Access & { columnId: string }> {
  const [card] = await db.select().from(cards).where(eq(cards.id, cardId));
  if (!card) {
    throw new HttpError(404, 'CARD_NOT_FOUND', 'Карточка не найдена');
  }
  const access = await columnAccess(userId, card.columnId);
  return access;
}

export function boardDto(
  board: { id: string; title: string; createdAt: Date; updatedAt: Date },
  role: BoardRole,
): BoardDto {
  return {
    id: board.id,
    title: board.title,
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
    role,
  };
}

export function columnDto(column: { id: string; boardId: string; title: string; position: number }): ColumnDto {
  return { id: column.id, boardId: column.boardId, title: column.title, position: column.position };
}

export function cardDto(card: typeof cards.$inferSelect): CardDto {
  return {
    id: card.id,
    columnId: card.columnId,
    title: card.title,
    description: card.description,
    position: card.position,
    authorId: card.authorId,
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
  };
}

function memberDto(user: typeof users.$inferSelect, role: DbRole): MemberDto {
  return { id: user.id, name: user.name, email: user.email, role: normalizeRole(role) };
}

/** Полный снапшот доски (FR-9: тот же формат у WS board:state). */
export async function snapshot(boardId: string, role: BoardRole): Promise<BoardSnapshot> {
  const [board] = await db.select().from(boards).where(eq(boards.id, boardId));
  if (!board) {
    throw new HttpError(404, 'BOARD_NOT_FOUND', 'Доска не найдена');
  }
  const columnRows = await db
    .select()
    .from(columns)
    .where(eq(columns.boardId, boardId))
    .orderBy(asc(columns.position));
  const columnIds = columnRows.map((c) => c.id);
  const cardRows = columnIds.length
    ? await db
        .select()
        .from(cards)
        .where(inArray(cards.columnId, columnIds))
        .orderBy(asc(cards.position))
    : [];
  const memberRows = await db
    .select({ user: users, role: boardMembers.role })
    .from(boardMembers)
    .innerJoin(users, eq(users.id, boardMembers.userId))
    .where(eq(boardMembers.boardId, boardId))
    .orderBy(asc(boardMembers.joinedAt));

  return {
    board: boardDto(board, role),
    columns: columnRows.map(columnDto),
    cards: cardRows.map(cardDto),
    members: memberRows.map((m) => memberDto(m.user, m.role)),
  };
}

// --- Доски (FR-8: CRUD досок остаётся на REST) ---

const listBoards: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const rows = await db
    .select({ board: boards, role: boardMembers.role })
    .from(boardMembers)
    .innerJoin(boards, eq(boards.id, boardMembers.boardId))
    .where(eq(boardMembers.userId, userId))
    .orderBy(asc(boards.createdAt));
  res.json({ boards: rows.map((r) => boardDto(r.board, normalizeRole(r.role))) });
};

const createBoard: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const { title } = createBoardSchema.parse(req.body);
  const defaultColumns = ['To Do', 'In Progress', 'Done'];
  const board = await db.transaction(async (tx) => {
    const [created] = await tx.insert(boards).values({ title }).returning();
    await tx.insert(boardMembers).values({ boardId: created.id, userId, role: 'OWNER' });
    await tx.insert(columns).values(
      defaultColumns.map((columnTitle, i) => ({
        boardId: created.id,
        title: columnTitle,
        position: (i + 1) * 1024,
      })),
    );
    return created;
  });
  res.status(201).json({ board: boardDto(board, 'OWNER') });
};

const getBoard: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const access = await boardAccess(userId, req.params.id);
  res.json(await snapshot(access.boardId, access.role));
};

const renameBoard: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const access = await boardAccess(userId, req.params.id);
  requirePermission(access.role, 'renameBoard');
  const { title } = renameBoardSchema.parse(req.body);
  await db.update(boards).set({ title }).where(eq(boards.id, access.boardId));
  res.json(await snapshot(access.boardId, access.role));
};

const deleteBoard: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const access = await boardAccess(userId, req.params.id);
  requirePermission(access.role, 'deleteBoard');
  await db.delete(boards).where(eq(boards.id, access.boardId));
  res.json({ ok: true });
};

// --- Участники и роли (v2, FR-23–24) ---

const listMembers: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const access = await boardAccess(userId, req.params.id);
  const rows = await db
    .select({ user: users, role: boardMembers.role })
    .from(boardMembers)
    .innerJoin(users, eq(users.id, boardMembers.userId))
    .where(eq(boardMembers.boardId, access.boardId))
    .orderBy(asc(boardMembers.joinedAt));
  res.json({ members: rows.map((r) => memberDto(r.user, r.role)) });
};

const updateMember: RequestHandler<{ id: string; userId: string }> = async (req, res) => {
  const actorId = await requireUserId(req);
  const access = await boardAccess(actorId, req.params.id);
  requirePermission(access.role, 'manageMembers');
  const { role } = updateMemberSchema.parse(req.body);
  const targetId = req.params.userId;

  const [target] = await db
    .select()
    .from(boardMembers)
    .where(and(eq(boardMembers.boardId, access.boardId), eq(boardMembers.userId, targetId)));
  if (!target) {
    throw new HttpError(404, 'MEMBER_NOT_FOUND', 'Участник не найден');
  }
  if (target.role === 'OWNER') {
    throw new HttpError(403, 'FORBIDDEN', 'Роль владельца изменить нельзя');
  }
  // Назначать и снимать ADMIN может только владелец
  if (!can(access.role, 'assignAdmin') && (role === 'ADMIN' || target.role === 'ADMIN')) {
    throw new HttpError(403, 'FORBIDDEN', 'Назначать и снимать админов может только владелец');
  }

  const [updated] = await db
    .update(boardMembers)
    .set({ role })
    .where(and(eq(boardMembers.boardId, access.boardId), eq(boardMembers.userId, targetId)))
    .returning();
  const [user] = await db.select().from(users).where(eq(users.id, targetId));
  const member = memberDto(user, updated.role);
  emitToBoard(access.boardId, 'member:updated', { boardId: access.boardId, member });
  res.json({ member });
};

const removeMember: RequestHandler<{ id: string; userId: string }> = async (req, res) => {
  const actorId = await requireUserId(req);
  const access = await boardAccess(actorId, req.params.id);
  requirePermission(access.role, 'manageMembers');
  const targetId = req.params.userId;

  const [target] = await db
    .select()
    .from(boardMembers)
    .where(and(eq(boardMembers.boardId, access.boardId), eq(boardMembers.userId, targetId)));
  if (!target) {
    throw new HttpError(404, 'MEMBER_NOT_FOUND', 'Участник не найден');
  }
  if (target.role === 'OWNER') {
    throw new HttpError(403, 'FORBIDDEN', 'Владельца нельзя удалить из доски');
  }
  if (!can(access.role, 'assignAdmin') && target.role === 'ADMIN') {
    throw new HttpError(403, 'FORBIDDEN', 'Удалить админа может только владелец');
  }

  await db
    .delete(boardMembers)
    .where(and(eq(boardMembers.boardId, access.boardId), eq(boardMembers.userId, targetId)));
  emitToBoard(access.boardId, 'member:removed', { boardId: access.boardId, userId: targetId });
  res.json({ ok: true });
};

boardsRouter.get('/', listBoards);
boardsRouter.post('/', createBoard);
boardsRouter.get('/:id/members', listMembers);
boardsRouter.patch('/:id/members/:userId', updateMember);
boardsRouter.delete('/:id/members/:userId', removeMember);
boardsRouter.get('/:id', getBoard);
boardsRouter.patch('/:id', renameBoard);
boardsRouter.delete('/:id', deleteBoard);

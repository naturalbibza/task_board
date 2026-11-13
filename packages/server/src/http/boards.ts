import { Router } from 'express';
import { and, asc, eq, inArray, max } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import {
  createBoardSchema,
  createCardSchema,
  createColumnSchema,
  renameBoardSchema,
  updateCardSchema,
  type BoardDto,
  type BoardSnapshot,
  type CardDto,
  type ColumnDto,
  type UserDto,
} from '@task-board/shared';
import { db } from '../db';
import { boardMembers, boards, cards, columns, users } from '../db/schema';
import { HttpError } from './errors';
import { requireUserId, toUserDto } from './session';

export const boardsRouter = Router();
export const columnsRouter = Router();
export const cardsRouter = Router();

const STEP = 1024;

type Access = { boardId: string; title: string; role: 'OWNER' | 'MEMBER' };

/** Р”РѕСЃС‚СѓРї Рє РґРѕСЃРєРµ: СѓС‡Р°СЃС‚РЅРёРє РёР»Рё РІР»Р°РґРµР»РµС†; РёРЅР°С‡Рµ 404 (РЅРµ СЂР°СЃРєСЂС‹РІР°РµРј СЃСѓС‰РµСЃС‚РІРѕРІР°РЅРёРµ). */
async function boardAccess(userId: string, boardId: string): Promise<Access> {
  const [row] = await db
    .select({ boardId: boards.id, title: boards.title, role: boardMembers.role })
    .from(boards)
    .innerJoin(boardMembers, and(eq(boardMembers.boardId, boards.id), eq(boardMembers.userId, userId)))
    .where(eq(boards.id, boardId));
  if (!row) {
    throw new HttpError(404, 'BOARD_NOT_FOUND', 'Р”РѕСЃРєР° РЅРµ РЅР°Р№РґРµРЅР° РёР»Рё РЅРµС‚ РґРѕСЃС‚СѓРїР°');
  }
  return row;
}

/** Р”РѕСЃС‚СѓРї С‡РµСЂРµР· РєРѕР»РѕРЅРєСѓ (РґР»СЏ РєР°СЂС‚РѕС‡РµРє Рё РєРѕР»РѕРЅРѕРє РїРѕ РёС… id). */
async function columnAccess(userId: string, columnId: string): Promise<Access & { columnId: string }> {
  const [column] = await db.select().from(columns).where(eq(columns.id, columnId));
  if (!column) {
    throw new HttpError(404, 'COLUMN_NOT_FOUND', 'РљРѕР»РѕРЅРєР° РЅРµ РЅР°Р№РґРµРЅР°');
  }
  const access = await boardAccess(userId, column.boardId);
  return { ...access, columnId: column.id };
}

/** Р”РѕСЃС‚СѓРї С‡РµСЂРµР· РєР°СЂС‚РѕС‡РєСѓ. */
async function cardAccess(userId: string, cardId: string): Promise<Access & { columnId: string }> {
  const [card] = await db.select().from(cards).where(eq(cards.id, cardId));
  if (!card) {
    throw new HttpError(404, 'CARD_NOT_FOUND', 'РљР°СЂС‚РѕС‡РєР° РЅРµ РЅР°Р№РґРµРЅР°');
  }
  const access = await columnAccess(userId, card.columnId);
  return access;
}

function boardDto(board: { id: string; title: string; createdAt: Date; updatedAt: Date }, role: Access['role']): BoardDto {
  return {
    id: board.id,
    title: board.title,
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
    role,
  };
}

function columnDto(column: { id: string; boardId: string; title: string; position: number }): ColumnDto {
  return { id: column.id, boardId: column.boardId, title: column.title, position: column.position };
}

function cardDto(card: typeof cards.$inferSelect): CardDto {
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

/** РЎР»РµРґСѓСЋС‰Р°СЏ РїРѕР·РёС†РёСЏ РІ РєРѕРЅС†Рµ СЃРїРёСЃРєР° (FR-6: РІСЃС‚Р°РІРєР° РІ РєРѕРЅРµС† = last + STEP). */
async function nextColumnPosition(boardId: string): Promise<number> {
  const [row] = await db.select({ maxPos: max(columns.position) }).from(columns).where(eq(columns.boardId, boardId));
  return (row?.maxPos ?? 0) + STEP;
}

async function nextCardPosition(columnId: string): Promise<number> {
  const [row] = await db.select({ maxPos: max(cards.position) }).from(cards).where(eq(cards.columnId, columnId));
  return (row?.maxPos ?? 0) + STEP;
}

/** РџРѕР»РЅС‹Р№ СЃРЅР°РїС€РѕС‚ РґРѕСЃРєРё (FR-9: С‚РѕС‚ Р¶Рµ С„РѕСЂРјР°С‚ Р±СѓРґРµС‚ Сѓ WS board:state). */
export async function boardSnapshot(boardId: string, role: Access['role']): Promise<BoardSnapshot> {
  const [board] = await db.select().from(boards).where(eq(boards.id, boardId));
  if (!board) {
    throw new HttpError(404, 'BOARD_NOT_FOUND', 'Р”РѕСЃРєР° РЅРµ РЅР°Р№РґРµРЅР°');
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
    .select({ user: users })
    .from(boardMembers)
    .innerJoin(users, eq(users.id, boardMembers.userId))
    .where(eq(boardMembers.boardId, boardId))
    .orderBy(asc(boardMembers.joinedAt));

  const members: UserDto[] = memberRows.map((m) => toUserDto(m.user));
  return {
    board: boardDto(board, role),
    columns: columnRows.map(columnDto),
    cards: cardRows.map(cardDto),
    members,
  };
}

// --- Р”РѕСЃРєРё ---

const listBoards: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const rows = await db
    .select({ board: boards, role: boardMembers.role })
    .from(boardMembers)
    .innerJoin(boards, eq(boards.id, boardMembers.boardId))
    .where(eq(boardMembers.userId, userId))
    .orderBy(asc(boards.createdAt));
  res.json({ boards: rows.map((r) => boardDto(r.board, r.role)) });
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
        position: (i + 1) * STEP,
      })),
    );
    return created;
  });
  res.status(201).json({ board: boardDto(board, 'OWNER') });
};

const getBoard: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const access = await boardAccess(userId, req.params.id);
  res.json(await boardSnapshot(access.boardId, access.role));
};

const renameBoard: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const access = await boardAccess(userId, req.params.id);
  if (access.role !== 'OWNER') {
    throw new HttpError(403, 'FORBIDDEN', 'РџРµСЂРµРёРјРµРЅРѕРІС‹РІР°С‚СЊ РґРѕСЃРєСѓ РјРѕР¶РµС‚ С‚РѕР»СЊРєРѕ РІР»Р°РґРµР»РµС†');
  }
  const { title } = renameBoardSchema.parse(req.body);
  await db.update(boards).set({ title }).where(eq(boards.id, access.boardId));
  res.json(await boardSnapshot(access.boardId, access.role));
};

const deleteBoard: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const access = await boardAccess(userId, req.params.id);
  if (access.role !== 'OWNER') {
    throw new HttpError(403, 'FORBIDDEN', 'РЈРґР°Р»СЏС‚СЊ РґРѕСЃРєСѓ РјРѕР¶РµС‚ С‚РѕР»СЊРєРѕ РІР»Р°РґРµР»РµС†');
  }
  await db.delete(boards).where(eq(boards.id, access.boardId));
  res.json({ ok: true });
};

// --- РљРѕР»РѕРЅРєРё ---

const createColumn: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const access = await boardAccess(userId, req.params.id); // POST /boards/:id/columns
  const { title } = createColumnSchema.parse(req.body);
  const position = await nextColumnPosition(access.boardId);
  const [column] = await db.insert(columns).values({ boardId: access.boardId, title, position }).returning();
  res.status(201).json({ column: columnDto(column) });
};

const renameColumn: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const access = await columnAccess(userId, req.params.id); // PATCH /columns/:id
  const { title } = createColumnSchema.parse(req.body);
  const [updated] = await db
    .update(columns)
    .set({ title })
    .where(eq(columns.id, access.columnId))
    .returning();
  res.json({ column: columnDto(updated) });
};

const deleteColumn: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const access = await columnAccess(userId, req.params.id); // DELETE /columns/:id
  await db.delete(columns).where(eq(columns.id, access.columnId));
  res.json({ ok: true });
};

// --- РљР°СЂС‚РѕС‡РєРё ---

const createCard: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const access = await columnAccess(userId, req.params.id); // POST /columns/:id/cards
  const { title, description } = createCardSchema.parse(req.body);
  const position = await nextCardPosition(access.columnId);
  const [card] = await db
    .insert(cards)
    .values({ columnId: access.columnId, title, description: description ?? null, position, authorId: userId })
    .returning();
  res.status(201).json({ card: cardDto(card) });
};

const updateCard: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  await cardAccess(userId, req.params.id); // PATCH /cards/:id
  const { title, description } = updateCardSchema.parse(req.body);
  const [updated] = await db
    .update(cards)
    .set({
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
    })
    .where(eq(cards.id, req.params.id))
    .returning();
  res.json({ card: cardDto(updated) });
};

const deleteCard: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  await cardAccess(userId, req.params.id); // DELETE /cards/:id
  await db.delete(cards).where(eq(cards.id, req.params.id));
  res.json({ ok: true });
};

boardsRouter.get('/', listBoards);
boardsRouter.post('/', createBoard);
boardsRouter.get('/:id', getBoard);
boardsRouter.patch('/:id', renameBoard);
boardsRouter.delete('/:id', deleteBoard);
boardsRouter.post('/:id/columns', createColumn);

columnsRouter.patch('/:id', renameColumn);
columnsRouter.delete('/:id', deleteColumn);
columnsRouter.post('/:id/cards', createCard);

cardsRouter.patch('/:id', updateCard);
cardsRouter.delete('/:id', deleteCard);

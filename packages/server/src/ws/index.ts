// WS-слой: аутентификация по cookie в handshake, комнаты board:<id>, presence (FR-9, FR-14),
// все мутации контента (FR-8, фаза 8): intents → валидация → права → БД → broadcast в комнату.
import { and, eq } from 'drizzle-orm';
import type { Server as IOServer } from 'socket.io';
import {
  boardJoinSchema,
  boardLeaveSchema,
  boardRenameSchema,
  cardCreateSchema,
  cardDeleteSchema,
  cardEditingSchema,
  cardMoveSchema,
  cardUpdateSchema,
  columnCreateSchema,
  columnDeleteSchema,
  columnMoveSchema,
  columnRenameSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from '@task-board/shared';
import type { Socket } from 'socket.io';
import { db } from '../db';
import { boardMembers, boards, cards, columns as columnsTable, users } from '../db/schema';
import { boardAccess, boardDto, snapshot, cardAccess, cardDto, columnAccess, columnDto } from '../http/boards';
import { COOKIE_NAME, verifySessionToken } from '../http/session';
import { HttpError } from '../http/errors';
import { moveCard, moveColumn, nextCardPosition, nextColumnPosition } from '../services/positions';

type Io = IOServer<ClientToServerEvents, ServerToClientEvents>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents, SocketData>;

/** Разбор cookie-заголовка handshake (cookie-parser на WS не действует). */
function parseCookie(cookieHeader: string, name: string): string | undefined {
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

const roomOf = (boardId: string) => `board:${boardId}`;

function wsError(socket: Sock, code: string, message: string): void {
  socket.emit('ws:error', { code, message });
}

function wsErrorFrom(socket: Sock, e: unknown): void {
  if (e instanceof HttpError) {
    wsError(socket, e.code, e.message);
    return;
  }
  console.error('[ws] unhandled error:', e);
  wsError(socket, 'INTERNAL', 'Внутренняя ошибка');
}

/** Presence-рассылка: уникальные пользователи комнаты (FR-14). Никогда не бросает. */
async function broadcastPresence(io: Io, boardId: string): Promise<void> {
  try {
    const sockets = await io.in(roomOf(boardId)).fetchSockets();
    const byUser = new Map<string, { userId: string; name: string }>();
    for (const s of sockets as Iterable<Sock>) {
      const d = s.data as SocketData;
      if (d?.userId) byUser.set(d.userId, { userId: d.userId, name: d.name });
    }
    io.to(roomOf(boardId)).emit('presence:update', { boardId, users: [...byUser.values()] });
  } catch (e) {
    console.error('[ws] broadcastPresence error:', e);
  }
}

/**
 * Очередь мутаций на доску: Socket.IO НЕ сериализует async-обработчики,
 * а конкурентные транзакции позиций порождают дубли и потерянные обновления.
 * Все мутации одной доски исполняются строго последовательно.
 */
const boardQueues = new Map<string, Promise<unknown>>();

function enqueueBoard<T>(boardId: string, task: () => Promise<T>): Promise<T> {
  const prev = boardQueues.get(boardId) ?? Promise.resolve();
  const next = prev.then(task, task);
  boardQueues.set(
    boardId,
    next.catch(() => undefined),
  );
  return next;
}

/** Состояние редактирования карточек: boardId → (cardId → userId). */
const editingByBoard = new Map<string, Map<string, string>>();

function setEditing(io: Io, boardId: string, cardId: string, userId: string | null): void {
  let map = editingByBoard.get(boardId);
  if (!map) {
    map = new Map();
    editingByBoard.set(boardId, map);
  }
  if (userId) map.set(cardId, userId);
  else map.delete(cardId);
  io.to(roomOf(boardId)).emit('presence:editing', { cardId, userId });
}

export function registerSocketHandlers(io: Io): void {
  // Аутентификация в handshake: JWT из httpOnly-cookie (FR-9, NFR-5)
  io.use(async (socket, next) => {
    try {
      const token = parseCookie(socket.handshake.headers.cookie ?? '', COOKIE_NAME);
      const userId = token ? await verifySessionToken(token) : null;
      if (!userId) return next(new Error('UNAUTHORIZED'));
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) return next(new Error('UNAUTHORIZED'));
      const data = socket.data as SocketData;
      data.userId = user.id;
      data.name = user.name;
      data.rooms = new Set();
      next();
    } catch (e) {
      next(new Error(`AUTH_FAILED: ${String(e)}`));
    }
  });

  io.on('connection', (socket) => {
    const data = socket.data as SocketData;
    const editingCards = new Set<string>(); // карточки, редактируемые этим сокетом

    socket.on('board:join', async (raw) => {
      try {
        const parsed = boardJoinSchema.safeParse(raw);
        if (!parsed.success) {
          wsError(socket, 'VALIDATION', 'Некорректный board:join');
          return;
        }
        const { boardId } = parsed.data;
        const [membership] = await db
          .select()
          .from(boardMembers)
          .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, data.userId)));
        if (!membership) {
          wsError(socket, 'BOARD_NOT_FOUND', 'Доска не найдена или нет доступа');
          return;
        }
        await socket.join(roomOf(boardId));
        data.rooms.add(boardId);
        // Полный снапшот только этому сокету (FR-13)
        socket.emit('board:state', await snapshot(boardId, membership.role));
        // Текущее состояние редактирования (фаза 8)
        const editing = editingByBoard.get(boardId);
        if (editing) {
          for (const [cardId, userId] of editing) {
            socket.emit('presence:editing', { cardId, userId });
          }
        }
        await broadcastPresence(io, boardId);
      } catch (e) {
        wsErrorFrom(socket, e);
      }
    });

    socket.on('board:leave', async (raw) => {
      try {
        const parsed = boardLeaveSchema.safeParse(raw);
        if (!parsed.success) return;
        const { boardId } = parsed.data;
        socket.leave(roomOf(boardId));
        data.rooms.delete(boardId);
        await broadcastPresence(io, boardId);
      } catch (e) {
        wsErrorFrom(socket, e);
      }
    });

    // Liveness-пинг: ack только от живого соединения (клиентский watchdog)
    socket.on('ping', (ack) => {
      if (typeof ack === 'function') ack();
    });

    // --- Мутации контента (FR-8, фаза 8): строго через per-board очередь ---

    socket.on('column:create', async (raw) => {
      try {
        const parsed = columnCreateSchema.safeParse(raw);
        if (!parsed.success) {
          wsError(socket, 'VALIDATION', 'Некорректный column:create');
          return;
        }
        const { boardId, title } = parsed.data;
        await boardAccess(data.userId, boardId);
        await enqueueBoard(boardId, async () => {
          const position = await nextColumnPosition(boardId);
          const [column] = await db.insert(columnsTable).values({ boardId, title, position }).returning();
          io.to(roomOf(boardId)).emit('column:created', { column: columnDto(column) });
        });
      } catch (e) {
        wsErrorFrom(socket, e);
      }
    });

    socket.on('column:rename', async (raw) => {
      try {
        const parsed = columnRenameSchema.safeParse(raw);
        if (!parsed.success) {
          wsError(socket, 'VALIDATION', 'Некорректный column:rename');
          return;
        }
        const { id, title } = parsed.data;
        const access = await columnAccess(data.userId, id);
        await enqueueBoard(access.boardId, async () => {
          const [column] = await db
            .update(columnsTable)
            .set({ title })
            .where(eq(columnsTable.id, access.columnId))
            .returning();
          io.to(roomOf(access.boardId)).emit('column:updated', { column: columnDto(column) });
        });
      } catch (e) {
        wsErrorFrom(socket, e);
      }
    });

    socket.on('column:delete', async (raw) => {
      try {
        const parsed = columnDeleteSchema.safeParse(raw);
        if (!parsed.success) {
          wsError(socket, 'VALIDATION', 'Некорректный column:delete');
          return;
        }
        const { id } = parsed.data;
        const access = await columnAccess(data.userId, id);
        const columnId = access.columnId;
        await enqueueBoard(access.boardId, async () => {
          await db.delete(columnsTable).where(eq(columnsTable.id, columnId));
          io.to(roomOf(access.boardId)).emit('column:deleted', { columnId });
        });
      } catch (e) {
        wsErrorFrom(socket, e);
      }
    });

    socket.on('card:create', async (raw) => {
      try {
        const parsed = cardCreateSchema.safeParse(raw);
        if (!parsed.success) {
          wsError(socket, 'VALIDATION', 'Некорректный card:create');
          return;
        }
        const { columnId, title, description } = parsed.data;
        const access = await columnAccess(data.userId, columnId);
        await enqueueBoard(access.boardId, async () => {
          const position = await nextCardPosition(columnId);
          const [card] = await db
            .insert(cards)
            .values({ columnId, title, description: description ?? null, position, authorId: data.userId })
            .returning();
          io.to(roomOf(access.boardId)).emit('card:created', { card: cardDto(card) });
        });
      } catch (e) {
        wsErrorFrom(socket, e);
      }
    });

    socket.on('card:update', async (raw) => {
      try {
        const parsed = cardUpdateSchema.safeParse(raw);
        if (!parsed.success) {
          wsError(socket, 'VALIDATION', 'Некорректный card:update');
          return;
        }
        const { id, title, description } = parsed.data;
        const access = await cardAccess(data.userId, id);
        await enqueueBoard(access.boardId, async () => {
          const [card] = await db
            .update(cards)
            .set({
              ...(title !== undefined ? { title } : {}),
              ...(description !== undefined ? { description } : {}),
            })
            .where(eq(cards.id, id))
            .returning();
          io.to(roomOf(access.boardId)).emit('card:updated', { card: cardDto(card) });
        });
      } catch (e) {
        wsErrorFrom(socket, e);
      }
    });

    socket.on('card:delete', async (raw) => {
      try {
        const parsed = cardDeleteSchema.safeParse(raw);
        if (!parsed.success) {
          wsError(socket, 'VALIDATION', 'Некорректный card:delete');
          return;
        }
        const { id } = parsed.data;
        const access = await cardAccess(data.userId, id);
        await enqueueBoard(access.boardId, async () => {
          await db.delete(cards).where(eq(cards.id, id));
          io.to(roomOf(access.boardId)).emit('card:deleted', { cardId: id, columnId: access.columnId });
        });
      } catch (e) {
        wsErrorFrom(socket, e);
      }
    });

    socket.on('card:move', async (raw) => {
      const parsed = cardMoveSchema.safeParse(raw);
      if (!parsed.success) {
        wsError(socket, 'VALIDATION', 'Некорректный card:move');
        return;
      }
      const { id, toColumnId, beforeId, afterId } = parsed.data;
      try {
        const [col] = await db
          .select({ boardId: columnsTable.boardId })
          .from(columnsTable)
          .where(eq(columnsTable.id, toColumnId));
        if (!col) {
          wsError(socket, 'COLUMN_NOT_FOUND', 'Колонка не найдена');
          return;
        }
        await enqueueBoard(col.boardId, async () => {
          // Сервер авторитетен: транзакция в БД → broadcast delta в комнату (FR-11, FR-12)
          const moved = await moveCard(data.userId, id, toColumnId, beforeId ?? null, afterId ?? null);
          io.to(roomOf(moved.boardId)).emit('card:moved', { cards: moved.cards });
        });
      } catch (e) {
        wsErrorFrom(socket, e);
      }
    });

    socket.on('column:move', async (raw) => {
      const parsed = columnMoveSchema.safeParse(raw);
      if (!parsed.success) {
        wsError(socket, 'VALIDATION', 'Некорректный column:move');
        return;
      }
      const { id, beforeId, afterId } = parsed.data;
      try {
        const [col] = await db
          .select({ boardId: columnsTable.boardId })
          .from(columnsTable)
          .where(eq(columnsTable.id, id));
        if (!col) {
          wsError(socket, 'COLUMN_NOT_FOUND', 'Колонка не найдена');
          return;
        }
        await enqueueBoard(col.boardId, async () => {
          const moved = await moveColumn(data.userId, id, beforeId ?? null, afterId ?? null);
          io.to(roomOf(moved.boardId)).emit('column:moved', { columns: moved.columns });
        });
      } catch (e) {
        wsErrorFrom(socket, e);
      }
    });

    socket.on('board:rename', async (raw) => {
      try {
        const parsed = boardRenameSchema.safeParse(raw);
        if (!parsed.success) {
          wsError(socket, 'VALIDATION', 'Некорректный board:rename');
          return;
        }
        const { boardId, title } = parsed.data;
        const access = await boardAccess(data.userId, boardId);
        if (access.role !== 'OWNER') {
          wsError(socket, 'FORBIDDEN', 'Переименовывать доску может только владелец');
          return;
        }
        await enqueueBoard(boardId, async () => {
          const [board] = await db.update(boards).set({ title }).where(eq(boards.id, boardId)).returning();
          io.to(roomOf(boardId)).emit('board:updated', { board: boardDto(board, 'OWNER') });
        });
      } catch (e) {
        wsErrorFrom(socket, e);
      }
    });

    socket.on('card:editing-start', async (raw) => {
      const parsed = cardEditingSchema.safeParse(raw);
      if (!parsed.success) {
        wsError(socket, 'VALIDATION', 'Некорректный card:editing-start');
        return;
      }
      const { cardId } = parsed.data;
      try {
        const access = await cardAccess(data.userId, cardId);
        editingCards.add(cardId);
        setEditing(io, access.boardId, cardId, data.userId);
      } catch (e) {
        wsErrorFrom(socket, e);
      }
    });

    socket.on('card:editing-stop', async (raw) => {
      const parsed = cardEditingSchema.safeParse(raw);
      if (!parsed.success) {
        wsError(socket, 'VALIDATION', 'Некорректный card:editing-stop');
        return;
      }
      const { cardId } = parsed.data;
      try {
        const access = await cardAccess(data.userId, cardId);
        editingCards.delete(cardId);
        setEditing(io, access.boardId, cardId, null);
      } catch (e) {
        wsErrorFrom(socket, e);
      }
    });

    socket.on('disconnect', () => {
      // Presence во всех комнатах сокета обновится (FR-14) + снять бейджи редактирования
      for (const boardId of data.rooms) {
        for (const cardId of editingCards) {
          setEditing(io, boardId, cardId, null);
        }
        void broadcastPresence(io, boardId);
      }
      data.rooms.clear();
      editingCards.clear();
    });
  });
}

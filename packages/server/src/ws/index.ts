// WS-слой: аутентификация по cookie в handshake, комнаты board:<id>, presence (FR-9, FR-14).
import { and, eq } from 'drizzle-orm';
import type { Server as IOServer } from 'socket.io';
import {
  boardJoinSchema,
  boardLeaveSchema,
  cardMoveSchema,
  columnMoveSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from '@task-board/shared';
import type { Socket } from 'socket.io';
import { db } from '../db';
import { boardMembers, columns as columnsTable, users } from '../db/schema';
import { snapshot } from '../http/boards';
import { COOKIE_NAME, verifySessionToken } from '../http/session';
import { HttpError } from '../http/errors';
import { moveCard, moveColumn } from '../services/positions';

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
        // Полный снапшот только этому сокету (FR-13: присоединившийся получает актуальное состояние)
        socket.emit('board:state', await snapshot(boardId, membership.role));
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

    socket.on('disconnect', () => {
      // Presence во всех комнатах сокета обновится (FR-14)
      for (const boardId of data.rooms) {
        void broadcastPresence(io, boardId);
      }
      data.rooms.clear();
    });
  });
}

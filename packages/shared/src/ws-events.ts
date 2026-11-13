// WS-протокол доски (план §6) — единственный контракт клиента и сервера.
// Все payload'ы валидируются zod-схемами: intents — на сервере, события — типизированы.
import { z } from 'zod';
import type { BoardDto, BoardSnapshot, CardDto, ColumnDto, UserDto } from './api-types';

// --- Intents (client → server) ---

export const boardJoinSchema = z.object({ boardId: z.string().min(1) });
export const boardLeaveSchema = z.object({ boardId: z.string().min(1) });

export const columnCreateSchema = z.object({
  boardId: z.string().min(1),
  title: z.string().min(1).max(100),
});
export const columnRenameSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(100),
});
export const columnMoveSchema = z.object({
  id: z.string().min(1),
  beforeId: z.string().nullable().optional(),
  afterId: z.string().nullable().optional(),
});
export const columnDeleteSchema = z.object({ id: z.string().min(1) });

export const cardCreateSchema = z.object({
  columnId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
});
export const cardUpdateSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
});
export const cardMoveSchema = z.object({
  id: z.string().min(1),
  toColumnId: z.string().min(1),
  beforeId: z.string().nullable().optional(),
  afterId: z.string().nullable().optional(),
});
export const cardDeleteSchema = z.object({ id: z.string().min(1) });

export const boardRenameSchema = z.object({
  boardId: z.string().min(1),
  title: z.string().min(1).max(100),
});
export const cardEditingSchema = z.object({ cardId: z.string().min(1) });

// --- Общие типы ---

export type PresenceUser = { userId: string; name: string };
export type WsError = { code: string; message: string };

/** События сервер → клиент (delta-события, FR-12). */
export interface ServerToClientEvents {
  'board:state': (payload: BoardSnapshot) => void;
  'board:updated': (payload: { board: BoardDto }) => void;
  'column:created': (payload: { column: ColumnDto }) => void;
  'column:updated': (payload: { column: ColumnDto }) => void;
  'column:moved': (payload: { columns: ColumnDto[] }) => void;
  'column:deleted': (payload: { columnId: string }) => void;
  'card:created': (payload: { card: CardDto }) => void;
  'card:updated': (payload: { card: CardDto }) => void;
  'card:moved': (payload: { cards: CardDto[] }) => void;
  'card:deleted': (payload: { cardId: string; columnId: string }) => void;
  'presence:update': (payload: { boardId: string; users: PresenceUser[] }) => void;
  'presence:editing': (payload: { cardId: string; userId: string | null }) => void;
  'ws:error': (payload: WsError) => void;
}

/** Intents клиент → сервер (обрабатываются поэтапно: фазы 6–8). */
export interface ClientToServerEvents {
  'board:join': (payload: { boardId: string }) => void;
  'board:leave': (payload: { boardId: string }) => void;
  'column:create': (payload: { boardId: string; title: string }) => void;
  'column:rename': (payload: { id: string; title: string }) => void;
  'column:move': (payload: { id: string; beforeId?: string | null; afterId?: string | null }) => void;
  'column:delete': (payload: { id: string }) => void;
  'card:create': (payload: { columnId: string; title: string; description?: string }) => void;
  'card:update': (payload: { id: string; title?: string; description?: string | null }) => void;
  'card:move': (payload: { id: string; toColumnId: string; beforeId?: string | null; afterId?: string | null }) => void;
  'card:delete': (payload: { id: string }) => void;
  'board:rename': (payload: { boardId: string; title: string }) => void;
  'card:editing-start': (payload: { cardId: string }) => void;
  'card:editing-stop': (payload: { cardId: string }) => void;
  /** Проверка живости соединения (ack приходит только от живого сервера). */
  ping: (ack: () => void) => void;
}

// Пользовательский тип в сокетных данных (socket.data)
export interface SocketData {
  userId: string;
  name: string;
  rooms: Set<string>;
}

export type { UserDto };

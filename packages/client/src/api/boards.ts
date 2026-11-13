import type {
  BoardDto,
  BoardSnapshot,
  CardDto,
  ColumnDto,
  RegisterInput,
} from '@task-board/shared';
import { api } from './http';

export function listBoards(): Promise<{ boards: BoardDto[] }> {
  return api<{ boards: BoardDto[] }>('/boards');
}

export function createBoard(title: string): Promise<{ board: BoardDto }> {
  return api<{ board: BoardDto }>('/boards', { method: 'POST', body: JSON.stringify({ title }) });
}

export function getBoard(id: string): Promise<BoardSnapshot> {
  return api<BoardSnapshot>(`/boards/${id}`);
}

export function renameBoard(id: string, title: string): Promise<BoardSnapshot> {
  return api<BoardSnapshot>(`/boards/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) });
}

export function deleteBoard(id: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/boards/${id}`, { method: 'DELETE' });
}

export function createColumn(boardId: string, title: string): Promise<{ column: ColumnDto }> {
  return api<{ column: ColumnDto }>(`/boards/${boardId}/columns`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

export function renameColumn(id: string, title: string): Promise<{ column: ColumnDto }> {
  return api<{ column: ColumnDto }>(`/columns/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) });
}

export function deleteColumn(id: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/columns/${id}`, { method: 'DELETE' });
}

export function createCard(columnId: string, title: string): Promise<{ card: CardDto }> {
  return api<{ card: CardDto }>(`/columns/${columnId}/cards`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

export function updateCard(
  id: string,
  patch: { title?: string; description?: string | null },
): Promise<{ card: CardDto }> {
  return api<{ card: CardDto }>(`/cards/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteCard(id: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/cards/${id}`, { method: 'DELETE' });
}

export type { RegisterInput };

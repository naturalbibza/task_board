// REST: только auth, CRUD досок и шаринг (FR-8).
// Мутации контента (колонки/карточки) — только через WS (api/socket.ts).
import type { BoardDto, BoardSnapshot } from '@task-board/shared';
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

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

// --- Шаринг (фаза 9) ---

export type InviteDto = {
  id: string;
  token: string;
  expiresAt: string;
  revoked: boolean;
};

export function listInvites(boardId: string): Promise<{ invites: InviteDto[] }> {
  return api<{ invites: InviteDto[] }>(`/boards/${boardId}/invites`);
}

export function createInvite(boardId: string): Promise<{ invite: InviteDto }> {
  return api<{ invite: InviteDto }>(`/boards/${boardId}/invites`, { method: 'POST' });
}

export function revokeInvite(inviteId: string): Promise<{ invite: InviteDto }> {
  return api<{ invite: InviteDto }>(`/invites/${inviteId}`, { method: 'PATCH' });
}

export function joinByToken(token: string): Promise<{ boardId: string; boardTitle: string }> {
  return api<{ boardId: string; boardTitle: string }>(`/join/${token}`);
}

// REST: только auth, CRUD досок, участники и инвайты (FR-8).
// Контент доски (колонки/карточки) — только через WS (api/socket.ts).
import type { BoardDto, BoardRole, BoardSnapshot, InviteDto, MemberDto } from '@task-board/shared';
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

// --- Участники и роли (v2, фаза 12) ---

export function listMembers(boardId: string): Promise<{ members: MemberDto[] }> {
  return api<{ members: MemberDto[] }>(`/boards/${boardId}/members`);
}

export function updateMember(
  boardId: string,
  userId: string,
  role: Exclude<BoardRole, 'OWNER'>,
): Promise<{ member: MemberDto }> {
  return api<{ member: MemberDto }>(`/boards/${boardId}/members/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

export function removeMember(boardId: string, userId: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/boards/${boardId}/members/${userId}`, { method: 'DELETE' });
}

// --- Инвайты (фаза 9, роль — фаза 12) ---

export function listInvites(boardId: string): Promise<{ invites: InviteDto[] }> {
  return api<{ invites: InviteDto[] }>(`/boards/${boardId}/invites`);
}

export function createInvite(
  boardId: string,
  role: 'ADMIN' | 'EDITOR' | 'VIEWER' = 'EDITOR',
): Promise<{ invite: InviteDto }> {
  return api<{ invite: InviteDto }>(`/boards/${boardId}/invites`, {
    method: 'POST',
    body: JSON.stringify({ role }),
  });
}

export function revokeInvite(inviteId: string): Promise<{ invite: InviteDto }> {
  return api<{ invite: InviteDto }>(`/invites/${inviteId}`, { method: 'PATCH' });
}

export function joinByToken(token: string): Promise<{ boardId: string; boardTitle: string }> {
  return api<{ boardId: string; boardTitle: string }>(`/join/${token}`);
}

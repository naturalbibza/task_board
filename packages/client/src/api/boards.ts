// REST: только auth, CRUD досок, участники и инвайты (FR-8).
// Контент доски (колонки/карточки) — только через WS (api/socket.ts).
import type { BoardDto, BoardRole, BoardSnapshot, InviteDto, MemberDto } from '@task-board/shared';
import { api } from './http';

export function listBoards(archived = false): Promise<{ boards: BoardDto[] }> {
  return api<{ boards: BoardDto[] }>(archived ? '/boards?archived=1' : '/boards');
}

export function createBoard(title: string, templateId?: string): Promise<{ board: BoardDto }> {
  return api<{ board: BoardDto }>('/boards', {
    method: 'POST',
    body: JSON.stringify(templateId ? { title, templateId } : { title }),
  });
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

/** Архивирование (v2, FR-39): доска остаётся доступной только для просмотра. */
export function archiveBoard(id: string): Promise<BoardSnapshot> {
  return api<BoardSnapshot>(`/boards/${id}/archive`, { method: 'POST' });
}

export function restoreBoard(id: string): Promise<BoardSnapshot> {
  return api<BoardSnapshot>(`/boards/${id}/restore`, { method: 'POST' });
}

/** Избранное (FR-40): персональная отметка, хранится на сервере. */
export function setBoardFavorite(id: string, favorite: boolean): Promise<{ boardId: string; favorite: boolean }> {
  return api<{ boardId: string; favorite: boolean }>(`/boards/${id}/favorite`, {
    method: 'PATCH',
    body: JSON.stringify({ favorite }),
  });
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

export function removeMember(
  boardId: string,
  userId: string,
): Promise<{ ok: boolean; revokedInvites: number }> {
  return api<{ ok: boolean; revokedInvites: number }>(`/boards/${boardId}/members/${userId}`, {
    method: 'DELETE',
  });
}

// --- Инвайты (фаза 9, роль — фаза 12) ---

export function listInvites(boardId: string): Promise<{ invites: InviteDto[] }> {
  return api<{ invites: InviteDto[] }>(`/boards/${boardId}/invites`);
}

export function createInvite(
  boardId: string,
  role: 'ADMIN' | 'EDITOR' | 'VIEWER' = 'EDITOR',
  email?: string,
): Promise<{ invite: InviteDto; emailSent: boolean }> {
  return api<{ invite: InviteDto; emailSent: boolean }>(`/boards/${boardId}/invites`, {
    method: 'POST',
    body: JSON.stringify(email ? { role, email } : { role }),
  });
}

export function revokeInvite(inviteId: string): Promise<{ invite: InviteDto }> {
  return api<{ invite: InviteDto }>(`/invites/${inviteId}`, { method: 'PATCH' });
}

export function joinByToken(token: string): Promise<{ boardId: string; boardTitle: string }> {
  return api<{ boardId: string; boardTitle: string }>(`/join/${token}`);
}

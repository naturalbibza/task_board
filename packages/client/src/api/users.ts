import type { MessengerContact, UserProfileDto } from '@task-board/shared';
import { api } from './http';

export function getProfile(): Promise<{ user: UserProfileDto }> {
  return api<{ user: UserProfileDto }>('/users/me');
}

export type ProfilePatch = {
  name?: string;
  description?: string | null;
  phone?: string | null;
  messengers?: MessengerContact[];
};

export function updateProfile(patch: ProfilePatch): Promise<{ user: UserProfileDto }> {
  return api<{ user: UserProfileDto }>('/users/me', { method: 'PATCH', body: JSON.stringify(patch) });
}

export function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>('/users/me/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export function logoutAll(): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>('/auth/logout-all', { method: 'POST' });
}

import type { LoginInput, RegisterInput, UserDto } from '@task-board/shared';
import { api } from './http';

type AuthResponse = { user: UserDto };

export function register(input: RegisterInput): Promise<AuthResponse> {
  return api<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify(input) });
}

export function login(input: LoginInput): Promise<AuthResponse> {
  return api<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify(input) });
}

export function logout(): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>('/auth/logout', { method: 'POST' });
}

export function me(): Promise<AuthResponse> {
  return api<AuthResponse>('/auth/me');
}

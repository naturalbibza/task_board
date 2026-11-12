import type { ApiErrorBody } from '@task-board/shared';

/** Ошибка API с кодом от сервера — по ней формы показывают понятные сообщения. */
export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  const body = (await res.json().catch(() => null)) as (T & ApiErrorBody) | ApiErrorBody | null;
  if (!res.ok) {
    const err = body as ApiErrorBody | null;
    throw new ApiClientError(err?.error?.code ?? 'UNKNOWN', err?.error?.message ?? res.statusText);
  }
  return body as T;
}

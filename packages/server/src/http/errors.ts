import { ZodError } from 'zod';
import type { ApiErrorBody } from '@task-board/shared';
import type { NextFunction, Request, Response } from 'express';

/** Ошибка приложения: код, HTTP-статус и понятное пользователю сообщение. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Единый формат ошибок { error: { code, message } } — NFR-8. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } } satisfies ApiErrorBody);
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'VALIDATION', message: err.issues[0]?.message ?? 'Некорректные данные' } });
    return;
  }
  console.error('[server] unhandled error:', err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Внутренняя ошибка сервера' } });
}

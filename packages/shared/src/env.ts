import { z } from 'zod';

/**
 * Схема env-переменных сервера. Валидация при старте: отсутствующее/битое
 * значение валит процесс сразу, а не в середине работы.
 * DATABASE_URL и JWT_SECRET обязательны (нужны с фазы 1 — аккаунты).
 * Пустая строка считается «не задано» (переменные шаблона .env на проде).
 */
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

export const serverEnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  // 1 — внешняя БД (нужен DATABASE_URL), 0 — встроенный PostgreSQL.
  // Не задан — авто: external при наличии DATABASE_URL, иначе встроенная БД.
  USE_EXTERNAL_DB: z.string().regex(/^[01]$/, 'USE_EXTERNAL_DB — только 0 или 1').optional(),
  DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(32),
  COOKIE_DOMAIN: z.preprocess(emptyToUndefined, z.string().optional()),
  ORIGIN: z.preprocess(emptyToUndefined, z.url().optional()),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function loadServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  return serverEnvSchema.parse(source);
}

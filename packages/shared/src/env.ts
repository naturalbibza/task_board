import { z } from 'zod';

/**
 * Схема env-переменных сервера. Валидация при старте: отсутствующее/битое
 * значение валит процесс сразу, а не в середине работы.
 * Поля DATABASE_URL/JWT_SECRET обязательны с фазы 1 (аккаунты).
 */
export const serverEnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(32).optional(),
  COOKIE_DOMAIN: z.string().optional(),
  ORIGIN: z.string().url().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function loadServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  return serverEnvSchema.parse(source);
}

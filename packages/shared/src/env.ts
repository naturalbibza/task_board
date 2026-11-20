import { z } from 'zod';

/**
 * Схема env-переменных сервера. Валидация при старте: отсутствующее/битое
 * значение валит процесс сразу, а не в середине работы.
 * DATABASE_URL и JWT_SECRET обязательны (нужны с фазы 1 — аккаунты).
 * Пустая строка считается «не задано» (переменные шаблона .env на проде).
 */
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

export const serverEnvSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3001),
    // 1 — внешняя БД (нужен DATABASE_URL), 0 — встроенный PostgreSQL.
    // Не задан — авто: external при наличии DATABASE_URL, иначе встроенная БД.
    USE_EXTERNAL_DB: z.string().regex(/^[01]$/, 'USE_EXTERNAL_DB — только 0 или 1').optional(),
    DATABASE_URL: z.url(),
    JWT_SECRET: z.string().min(32),
    COOKIE_DOMAIN: z.preprocess(emptyToUndefined, z.string().optional()),
    ORIGIN: z.preprocess(emptyToUndefined, z.url().optional()),

    // --- Почта (v2, фаза 14) ---
    // console — письма в .localmail/ + лог (dev/офлайн), smtp — Яндекс SMTP на проде
    MAIL_MODE: z.preprocess(emptyToUndefined, z.enum(['console', 'smtp'])).default('console'),
    SMTP_HOST: z.preprocess(emptyToUndefined, z.string().optional()),
    SMTP_PORT: z.coerce.number().int().positive().default(465),
    SMTP_SECURE: z
      .preprocess((v) => (v === undefined || v === '' ? undefined : v === '1' || v === 'true'), z.boolean())
      .default(true),
    SMTP_USER: z.preprocess(emptyToUndefined, z.string().optional()),
    SMTP_PASS: z.preprocess(emptyToUndefined, z.string().optional()),
    MAIL_FROM: z.preprocess(emptyToUndefined, z.string().optional()),
    MAIL_FROM_NAME: z.preprocess(emptyToUndefined, z.string().optional()),
  })
  .superRefine((env, ctx) => {
    if (env.MAIL_MODE !== 'smtp') return;
    for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'] as const) {
      if (!env[key]) {
        ctx.addIssue({ code: 'custom', path: [key], message: `MAIL_MODE=smtp требует ${key}` });
      }
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function loadServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  return serverEnvSchema.parse(source);
}

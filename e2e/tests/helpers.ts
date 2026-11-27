import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';

/** Письма в dev/e2e пишутся в packages/server/.localmail (MAIL_MODE=console). */
const MAIL_DIR = path.resolve(process.cwd(), '../packages/server/.localmail');

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5174';

let verificationRequired: boolean | null = null;

/**
 * Включён ли режим подтверждения email (FR-52). В скрытом режиме письма не отправляются,
 * поэтому регистрация сразу завершает сценарий, а почтовые тесты пропускаются.
 */
export async function isEmailVerificationRequired(): Promise<boolean> {
  if (verificationRequired !== null) return verificationRequired;
  const res = await fetch(`${BASE_URL}/api/health`);
  if (!res.ok) throw new Error(`health ${res.status}`);
  const body = (await res.json()) as { emailVerificationRequired?: boolean };
  verificationRequired = body.emailVerificationRequired === true;
  return verificationRequired;
}

export const uniqueEmail = (tag: string): string =>
  `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@test.dev`;

/** Ждёт письмо подтверждения и достаёт токен из ссылки. */
export async function waitForVerificationToken(email: string, timeoutMs = 10_000): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(MAIL_DIR)) {
      const files = fs
        .readdirSync(MAIL_DIR)
        .filter((file) => file.includes(email))
        .sort()
        .reverse();
      for (const file of files) {
        const content = fs.readFileSync(path.join(MAIL_DIR, file), 'utf8');
        const match = content.match(/verify-email\?token=([\w-]+)/);
        if (match) return match[1];
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Письмо подтверждения для ${email} не найдено в ${MAIL_DIR}`);
}

/** Ждёт письмо-приглашение на доску и достаёт токен из ссылки /join/. */
export async function waitForInviteToken(email: string, timeoutMs = 10_000): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(MAIL_DIR)) {
      const files = fs
        .readdirSync(MAIL_DIR)
        .filter((file) => file.includes(email))
        .sort()
        .reverse();
      for (const file of files) {
        const content = fs.readFileSync(path.join(MAIL_DIR, file), 'utf8');
        const match = content.match(/\/join\/([\w-]+)/);
        if (match) return match[1];
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Письмо-приглашение для ${email} не найдено в ${MAIL_DIR}`);
}

/** Регистрирует пользователя, но НЕ подтверждает email (для проверки ограничений FR-32). */
export async function registerOnly(page: Page, email: string, name = 'E2E Тестер'): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Имя').fill(name);
  await page.getByLabel('Пароль (минимум 8 символов)').fill('password123');
  await page.getByLabel('Повторите пароль').fill('password123');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/boards$/);
}

/** Регистрирует и (если режим включён) подтверждает email по ссылке из письма. */
export async function registerAndVerify(page: Page, email: string, name = 'E2E Тестер'): Promise<void> {
  await registerOnly(page, email, name);
  if (!(await isEmailVerificationRequired())) return; // FR-52: скрытый режим
  const token = await waitForVerificationToken(email);
  await page.goto(`/verify-email?token=${token}`);
  await expect(page.getByText('Email подтверждён')).toBeVisible();
  await page.goto('/boards');
  await expect(page.getByRole('heading', { name: 'Мои доски' })).toBeVisible();
}

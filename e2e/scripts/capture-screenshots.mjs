// Скриншоты для README (светлая/тёмная тема). Запуск:
//   pnpm build && (cd packages/server && USE_EXTERNAL_DB=0 MAIL_MODE=console pnpm start)
//   cd e2e && node scripts/capture-screenshots.mjs
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3001';
const MAIL_DIR = path.resolve(process.cwd(), '../packages/server/.localmail');
const OUT_DIR = path.resolve(process.cwd(), '../docs/screenshots');
const email = `shots-${Date.now()}@test.dev`;

async function waitVerificationToken(timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(MAIL_DIR)) {
      for (const file of fs.readdirSync(MAIL_DIR).filter((name) => name.includes(email))) {
        const content = fs.readFileSync(path.join(MAIL_DIR, file), 'utf8');
        const match = content.match(/verify-email\?token=([\w-]+)/);
        if (match) return match[1];
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Письмо для ${email} не найдено`);
}

const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });

await page.goto(`${BASE}/register`);
await page.getByLabel('Email').fill(email);
await page.getByLabel('Имя').fill('Анна Разработчик');
await page.getByLabel('Пароль (минимум 8 символов)').fill('password123');
await page.getByLabel('Повторите пароль').fill('password123');
await page.getByRole('button', { name: 'Создать аккаунт' }).click();
await page.waitForURL(/\/boards$/);

const token = await waitVerificationToken();
await page.goto(`${BASE}/verify-email?token=${token}`);
await page.getByText('Email подтверждён').waitFor();
await page.goto(`${BASE}/boards`);

await page.getByLabel('Название новой доски').fill('Релиз v2');
await page.getByRole('button', { name: 'Создать доску' }).click();
await page.waitForURL(/\/boards\/[0-9a-f-]+$/);
await page.getByRole('heading', { name: 'To Do' }).waitFor();

const cards = [
  [0, 'Согласовать макет доски'],
  [0, 'Проверить роли участников'],
  [1, 'Подключить SMTP для писем'],
  [1, 'Настроить шаблоны колонок'],
  [2, 'Деплой на bibza.ru'],
];
for (const [columnIndex, title] of cards) {
  const column = page.locator('[data-column-id]').nth(columnIndex);
  const input = column.getByPlaceholder('+ карточка');
  await input.fill(title);
  await input.press('Enter');
  await page.getByText(title).waitFor();
}

fs.mkdirSync(OUT_DIR, { recursive: true });
// Даём тостам исчезнуть и снимаем фокус, чтобы на скриншоте не было артефактов
await page.evaluate(() => {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
});
await page.waitForTimeout(4300);
await page.screenshot({ path: path.join(OUT_DIR, 'v2-board-light.png') });

await page.getByRole('button', { name: 'Доски', exact: true }).click();
await page.getByRole('heading', { name: 'Релиз v2' }).waitFor();
await page.screenshot({ path: path.join(OUT_DIR, 'v2-boards-light.png') });

// Тёмная тема
await page.getByRole('button', { name: 'Тема оформления' }).click();
await page.getByRole('menuitem', { name: 'Тёмная' }).click();
await page.getByRole('heading', { name: 'Релиз v2' }).waitFor();
await page.screenshot({ path: path.join(OUT_DIR, 'v2-boards-dark.png') });

await page.getByRole('heading', { name: 'Релиз v2' }).click();
await page.getByRole('heading', { name: 'To Do' }).waitFor();
await page.screenshot({ path: path.join(OUT_DIR, 'v2-board-dark.png') });

await browser.close();
console.log(`Готово: ${OUT_DIR}`);

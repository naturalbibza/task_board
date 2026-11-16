// Скриншоты для README/ревью (не тест): node tools/screenshots.mjs
// Требует запущенный `pnpm dev`. Использует установленный Edge (channel: msedge).
import { chromium } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5174';
const OUT = '../docs/screenshots/v2';
const email = `shots-${Date.now()}@test.dev`;

const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({
  baseURL: BASE,
  viewport: { width: 1280, height: 800 },
  locale: 'ru-RU',
  colorScheme: 'light',
});
const page = await context.newPage();

const clean = async () => {
  await page.mouse.move(4, 4);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.waitForTimeout(250);
};

await page.goto('/register');
await page.getByLabel('Email').fill(email);
await page.getByLabel('Имя').fill('Анна Тестер');
await page.getByLabel('Пароль (минимум 8 символов)').fill('password123');
await page.getByLabel('Повторите пароль').fill('password123');
await page.screenshot({ path: `${OUT}/00-register-light.png` });
await page.getByRole('button', { name: 'Создать аккаунт' }).click();
await page.waitForURL(/\/boards$/);
await clean();
await page.screenshot({ path: `${OUT}/01-boards-empty-light.png` });

await page.getByLabel('Название новой доски').fill('Учебный проект');
await page.getByRole('button', { name: 'Создать доску' }).click();
await page.waitForURL(/\/boards\/[0-9a-f-]+$/);

const addCard = async (col, title) => {
  const column = page.locator('[data-column-id]').nth(col);
  const input = column.getByPlaceholder('+ карточка');
  await input.fill(title);
  await input.press('Enter');
  await page.waitForTimeout(120);
};

await addCard(0, 'Подготовить отчёт по практике');
await addCard(0, 'Проверить офлайн-синхронизацию');
await addCard(1, 'Написать спецификацию v2');
await addCard(1, 'Согласовать дизайн с командой');
await addCard(2, 'Спроектировать схему БД');

await clean();
await page.screenshot({ path: `${OUT}/02-board-light.png` });

await page.getByRole('button', { name: 'Тема оформления' }).click();
await page.getByRole('menuitem', { name: 'Тёмная' }).click();
await clean();
await page.screenshot({ path: `${OUT}/03-board-dark.png` });

await page.locator('[data-card-id]').first().click();
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/04-card-modal-dark.png` });
await page.getByRole('button', { name: 'Отмена' }).click();

await page.getByRole('button', { name: 'Участники' }).click();
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/05-access-dark.png` });
await page.getByRole('button', { name: 'Закрыть' }).click();

await page.goto('/boards');
await clean();
await page.screenshot({ path: `${OUT}/06-boards-list-dark.png` });

await browser.close();
console.log('screenshots saved to docs/screenshots/v2');

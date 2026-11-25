import { test, expect, type Page } from '@playwright/test';
import { registerAndVerify, uniqueEmail } from './helpers';

/**
 * Смена аккаунта в одном окне без перезагрузки.
 * Регресс: сокет аутентифицируется только в handshake, поэтому после входа под
 * другим аккаунтом он продолжал работать от имени прежнего (наблюдатель мог
 * редактировать). Теперь logout рвёт сокеты пользователя, и клиент переподключается
 * уже с новой cookie.
 */

async function register(page: Page, email: string, name: string): Promise<void> {
  await registerAndVerify(page, email, name);
}

test('после смены аккаунта права применяются без перезагрузки', async ({ browser, page }) => {
  test.setTimeout(120_000);
  const emailA = uniqueEmail('switch-a');
  const emailB = uniqueEmail('switch-b');

  // --- A: доска с карточкой + ссылка для наблюдателя ---
  await register(page, emailA, 'Владелец Переключатель');
  await page.getByLabel('Название новой доски').fill('Смена аккаунта');
  await page.getByRole('button', { name: 'Создать доску' }).click();
  await expect(page).toHaveURL(/\/boards\/[0-9a-f-]+$/);
  const boardId = page.url().split('/').pop()!;

  const column = page.locator('[data-column-id]').first();
  await column.getByPlaceholder('+ карточка').fill('Карточка для проверки');
  await column.getByPlaceholder('+ карточка').press('Enter');
  await expect(column.getByText('Карточка для проверки')).toBeVisible();

  const inviteRes = await page.request.post(`/api/boards/${boardId}/invites`, { data: { role: 'VIEWER' } });
  expect(inviteRes.ok()).toBeTruthy();
  const { invite } = (await inviteRes.json()) as { invite: { token: string } };

  // --- B: регистрация и вступление (отдельный контекст, чтобы не мешать) ---
  const ctxB = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5174' });
  const pageB = await ctxB.newPage();
  await register(pageB, emailB, 'Наблюдатель Переключатель');
  await pageB.goto(`/join/${invite.token}`);
  await pageB.getByRole('link', { name: 'Открыть доску' }).click();
  await expect(pageB.getByRole('heading', { name: 'To Do' })).toBeVisible();
  await ctxB.close();

  // --- то же окно: выйти из A и войти как B, без перезагрузки страницы ---
  await page.goto('/boards');
  await page.getByRole('button', { name: 'Меню пользователя' }).click();
  await page.getByRole('menuitem', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Email').fill(emailB);
  await page.getByLabel('Пароль', { exact: true }).fill('password123');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/boards$/);

  await page.getByText('Смена аккаунта').click();
  await expect(page.getByRole('heading', { name: 'To Do' })).toBeVisible();

  // Права наблюдателя применяются сразу: роль в шапке, редактирование скрыто
  await expect(page.getByText('наблюдатель')).toBeVisible();
  await expect(page.getByPlaceholder('+ карточка')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Добавить колонку' })).toHaveCount(0);
  await expect(page.getByText('Карточка для проверки')).toBeVisible();

  // В меню участников для наблюдателя нет ни ссылок, ни выбора ролей, ни ошибки 403
  await page.getByRole('button', { name: 'Участники' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Участники · 2')).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Ссылки-приглашения' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Создать ссылку' })).toHaveCount(0);
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});

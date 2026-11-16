import { test, expect, type Page } from '@playwright/test';

/**
 * Матрица ролей (FR-23): VIEWER только смотрит, EDITOR редактирует,
 * смена роли применяется на лету (member:updated по WS).
 */

let counter = 0;
const uniqueEmail = (tag: string) => `e2e-${tag}-${Date.now()}-${counter++}@test.dev`;

async function register(page: Page, tag: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Email').fill(uniqueEmail(tag));
  await page.getByLabel('Имя').fill(`E2E ${tag}`);
  await page.getByLabel('Пароль (минимум 8 символов)').fill('password123');
  await page.getByLabel('Повторите пароль').fill('password123');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/boards$/);
}

test('роли: VIEWER не редактирует, после смены на EDITOR — редактирует', async ({ browser, page }) => {
  test.setTimeout(90_000); // два контекста, регистрация, приглашение и два WS-обновления
  // --- A: владелец, доска с карточкой и VIEWER-ссылка ---
  await register(page, 'owner');
  await page.getByLabel('Название новой доски').fill('Роли E2E');
  await page.getByRole('button', { name: 'Создать доску' }).click();
  await expect(page).toHaveURL(/\/boards\/[0-9a-f-]+$/);
  const boardId = page.url().split('/').pop()!;

  const column = page.locator('[data-column-id]').first();
  const cardInput = column.getByPlaceholder('+ карточка');
  await cardInput.fill('Карточка для ролей');
  await cardInput.press('Enter');
  await expect(column.getByText('Карточка для ролей')).toBeVisible();

  await page.getByRole('button', { name: 'Участники' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Роль по ссылке').click();
  await page.getByRole('option', { name: 'наблюдатель' }).click();
  await dialog.getByRole('button', { name: 'Создать ссылку' }).click();
  const linkRow = dialog.locator('li', { hasText: '/join/' }).first();
  const linkText = await linkRow.innerText();
  const token = linkText.match(/\/join\/([\w-]+)/)?.[1];
  expect(token).toBeTruthy();
  await dialog.getByRole('button', { name: 'Закрыть' }).click();

  // --- B: отдельный контекст, вступает по ссылке ---
  const contextB = await browser.newContext({ baseURL: 'http://localhost:5174' });
  const pageB = await contextB.newPage();
  await register(pageB, 'viewer');
  await pageB.goto(`/join/${token}`);
  await pageB.getByRole('link', { name: 'Открыть доску' }).click();
  await expect(pageB.getByRole('heading', { name: 'To Do' })).toBeVisible();

  // VIEWER: интерфейс только для чтения
  await expect(pageB.getByText('наблюдатель')).toBeVisible();
  await expect(pageB.getByPlaceholder('+ карточка')).toHaveCount(0);
  await expect(pageB.getByRole('button', { name: 'Добавить колонку' })).toHaveCount(0);
  await expect(pageB.getByRole('button', { name: 'Поделиться' })).toHaveCount(0);
  await expect(pageB.getByRole('button', { name: 'Участники' })).toBeVisible();

  await pageB.locator('[data-card-id]').first().click();
  await expect(pageB.getByRole('dialog')).toBeVisible();
  await expect(pageB.getByLabel('Заголовок')).toBeDisabled();
  await expect(pageB.getByRole('button', { name: 'Сохранить' })).toHaveCount(0);
  await pageB.getByRole('button', { name: 'Закрыть' }).click();

  // --- A меняет роль B на EDITOR через API; B обновляется по WS ---
  const membersRes = await page.request.get(`/api/boards/${boardId}/members`);
  expect(membersRes.ok()).toBeTruthy();
  const { members } = (await membersRes.json()) as { members: { id: string; role: string }[] };
  const viewer = members.find((m) => m.role === 'VIEWER');
  expect(viewer).toBeTruthy();

  const patch = await page.request.patch(`/api/boards/${boardId}/members/${viewer!.id}`, {
    data: { role: 'EDITOR' },
  });
  expect(patch.ok()).toBeTruthy();

  // B получает право редактировать без перезагрузки
  await expect(pageB.getByPlaceholder('+ карточка').first()).toBeVisible({ timeout: 8000 });

  // И новое право работает на сервере: B создаёт карточку → видит A
  const inputB = pageB.locator('[data-column-id]').nth(1).getByPlaceholder('+ карточка');
  await inputB.fill('Карточка от редактора');
  await inputB.press('Enter');
  await expect(page.locator('[data-column-id]').nth(1).getByText('Карточка от редактора')).toBeVisible({
    timeout: 8000,
  });

  // --- A удаляет B из доски → B теряет доступ и уходит к списку досок ---
  const removed = await page.request.delete(`/api/boards/${boardId}/members/${viewer!.id}`);
  expect(removed.ok()).toBeTruthy();
  await expect(pageB).toHaveURL(/\/boards$/, { timeout: 8000 });

  await contextB.close();
});

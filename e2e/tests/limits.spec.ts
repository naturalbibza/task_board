import { test, expect, type Page } from '@playwright/test';
import { registerAndVerify, uniqueEmail } from './helpers';

/** Лимиты FR-38: приглашения — не более 20 в час на пользователя. */

async function createBoard(page: Page, title: string): Promise<string> {
  await page.getByLabel('Название новой доски').fill(title);
  await page.getByRole('button', { name: 'Создать доску' }).click();
  await expect(page).toHaveURL(/\/boards\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'To Do' })).toBeVisible();
  return page.url().split('/').pop()!;
}

test('лимит приглашений: 21-я ссылка за час отклоняется', async ({ page }) => {
  await registerAndVerify(page, uniqueEmail('limits'));
  const boardId = await createBoard(page, 'Лимит приглашений');

  for (let i = 0; i < 20; i += 1) {
    const res = await page.request.post(`/api/boards/${boardId}/invites`, { data: { role: 'EDITOR' } });
    expect(res.status(), `приглашение #${i + 1}`).toBe(201);
  }

  const limited = await page.request.post(`/api/boards/${boardId}/invites`, { data: { role: 'EDITOR' } });
  expect(limited.status()).toBe(429);
  const body = (await limited.json()) as { error: { code: string } };
  expect(body.error.code).toBe('RATE_LIMITED');
});

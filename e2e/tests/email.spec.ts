import { test, expect } from '@playwright/test';
import { registerAndVerify, registerOnly, uniqueEmail, waitForInviteToken, waitForVerificationToken } from './helpers';

/**
 * Фаза 14: подтверждение email (FR-31–32) и приглашения по email (FR-26).
 * Письма в dev/e2e — консольный транспорт: .localmail/*.eml.
 */

test('неподтверждённый email: ограничения и подтверждение по ссылке', async ({ page }) => {
  test.setTimeout(90_000);
  const email = uniqueEmail('verify');
  await registerOnly(page, email, 'Неподтверждённый');

  // Плашка и отсутствие формы создания доски
  await expect(
    page.getByText('создавать доски и приглашать участников можно только после подтверждения'),
  ).toBeVisible();
  await expect(page.getByLabel('Название новой доски')).toHaveCount(0);

  // Сервер тоже не даёт создать доску
  const denied = await page.request.post('/api/boards', { data: { title: 'Нельзя' } });
  expect(denied.status()).toBe(403);
  const body = (await denied.json()) as { error: { code: string } };
  expect(body.error.code).toBe('EMAIL_NOT_VERIFIED');

  // Переход по ссылке из письма (ждём письмо, чтобы токен точно был в БД)
  const token = await waitForVerificationToken(email);

  // Повторная отправка сразу после регистрации — лимит 1/мин
  await page.getByRole('button', { name: 'Отправить письмо' }).click();
  await expect(page.getByText('Письмо уже отправлено — подождите минуту')).toBeVisible();

  await page.goto(`/verify-email?token=${token}`);
  await expect(page.getByText('Email подтверждён')).toBeVisible();

  // Теперь доска создаётся
  await page.getByRole('link', { name: 'К доскам' }).click();
  await page.getByLabel('Название новой доски').fill('После подтверждения');
  await page.getByRole('button', { name: 'Создать доску' }).click();
  await expect(page).toHaveURL(/\/boards\/[0-9a-f-]+$/);
});

test('приглашение по email: вступить может только указанный адрес', async ({ browser, page }) => {
  test.setTimeout(120_000);
  const emailA = uniqueEmail('mail-a');
  await registerAndVerify(page, emailA, 'Владелец Почты');
  await page.getByLabel('Название новой доски').fill('Почтовое приглашение');
  await page.getByRole('button', { name: 'Создать доску' }).click();
  await expect(page).toHaveURL(/\/boards\/[0-9a-f-]+$/);

  // B — существует, но не подтверждён (вступать можно)
  const ctxB = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5174' });
  const pageB = await ctxB.newPage();
  const emailB = uniqueEmail('mail-b');
  await registerOnly(pageB, emailB, 'Приглашённый');

  // C — другой пользователь, попробует ту же ссылку
  const ctxC = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5174' });
  const pageC = await ctxC.newPage();
  await registerAndVerify(pageC, uniqueEmail('mail-c'), 'Чужой');

  // A приглашает B по email через диалог участников
  await page.getByRole('button', { name: 'Участники' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email для приглашения').fill(emailB);
  await dialog.getByRole('button', { name: 'Пригласить по email' }).click();
  await expect(dialog.getByText(emailB)).toBeVisible();

  // B открывает ссылку из письма
  const token = await waitForInviteToken(emailB);
  await pageB.goto(`/join/${token}`);
  await pageB.getByRole('link', { name: 'Открыть доску' }).click();
  await expect(pageB.getByRole('heading', { name: 'To Do' })).toBeVisible();

  // C по той же ссылке получает отказ
  await pageC.goto(`/join/${token}`);
  await expect(pageC.getByText('Не удалось присоединиться')).toBeVisible();
  await expect(pageC.getByText('Это приглашение отправлено на другой адрес')).toBeVisible();

  await ctxB.close();
  await ctxC.close();
});

test('ссылка-приглашение без email работает для любого приглашённого', async ({ browser, page }) => {
  test.setTimeout(90_000);
  await registerAndVerify(page, uniqueEmail('link-a'), 'Владелец Ссылки');
  await page.getByLabel('Название новой доски').fill('Ссылка без адреса');
  await page.getByRole('button', { name: 'Создать доску' }).click();
  await expect(page).toHaveURL(/\/boards\/[0-9a-f-]+$/);

  await page.getByRole('button', { name: 'Участники' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Создать ссылку' }).click();
  const linkText = await dialog.locator('li', { hasText: '/join/' }).first().innerText();
  const token = linkText.match(/\/join\/([\w-]+)/)?.[1];
  expect(token).toBeTruthy();

  const ctxB = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5174' });
  const pageB = await ctxB.newPage();
  await registerOnly(pageB, uniqueEmail('link-b'), 'Любой');
  await pageB.goto(`/join/${token}`);
  await pageB.getByRole('link', { name: 'Открыть доску' }).click();
  await expect(pageB.getByRole('heading', { name: 'To Do' })).toBeVisible();

  await ctxB.close();
});

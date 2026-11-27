import { test, expect, type Page } from '@playwright/test';
import { isEmailVerificationRequired, registerAndVerify, uniqueEmail } from './helpers';

/**
 * Фаза 13: профиль и контакты (FR-28–29), смена пароля и «выйти везде» (FR-30, FR-33).
 */

async function register(page: Page, email: string): Promise<void> {
  await registerAndVerify(page, email, 'E2E Профиль');
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/boards$/);
}

test.describe('профиль и сессии', () => {
  test('профиль сохраняется, смена пароля и «выйти везде» инвалидируют другие сессии', async ({ browser, page }) => {
    test.setTimeout(120_000);
    const email = uniqueEmail('prof');
    await register(page, email);

    // Вторая сессия того же аккаунта (старый пароль) — её потом инвалидируем
    const ctxB = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5174' });
    const pageB = await ctxB.newPage();
    await login(pageB, email, 'password123');

    // --- профиль ---
    await page.goto('/profile');
    await expect(page.getByLabel('Email')).toBeDisabled();
    // Статус email показывается только при включённом подтверждении (FR-52)
    if (await isEmailVerificationRequired()) {
      await expect(page.getByText('Email подтверждён')).toBeVisible();
    } else {
      await expect(page.getByText('Email подтверждён')).toHaveCount(0);
    }
    await page.getByLabel('Имя').fill('Анна Профиль');
    await page.getByLabel('О себе').fill('Тестирую профиль');
    await page.getByLabel('Телефон').fill('+7 900 000-00-00');
    await page.getByRole('button', { name: 'Добавить контакт' }).click();
    await page.getByLabel('Контакт', { exact: true }).fill('@anna');
    await page.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByText('Профиль сохранён')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Имя')).toHaveValue('Анна Профиль');
    await expect(page.getByLabel('Телефон')).toHaveValue('+7 900 000-00-00');
    await expect(page.getByLabel('Контакт', { exact: true })).toHaveValue('@anna');

    // --- смена пароля ---
    await page.getByLabel('Текущий пароль').fill('password123');
    await page.getByLabel('Новый пароль', { exact: true }).fill('password456');
    await page.getByLabel('Повторите новый пароль').fill('password456');
    await page.getByRole('button', { name: 'Изменить пароль' }).click();
    await expect(page.getByText('Пароль изменён')).toBeVisible();

    // Старая сессия больше не работает
    await pageB.goto('/profile');
    await expect(pageB).toHaveURL(/\/login$/);

    // Новый пароль работает
    const ctxC = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5174' });
    const pageC = await ctxC.newPage();
    await login(pageC, email, 'password456');

    // --- «выйти на всех устройствах» ---
    page.on('dialog', (dialog) => void dialog.accept());
    await page.goto('/profile');
    await page.getByRole('button', { name: 'Выйти на всех устройствах' }).click();
    await expect(page.getByText('Остальные сессии завершены')).toBeVisible();

    await pageC.goto('/profile');
    await expect(pageC).toHaveURL(/\/login$/);

    // Текущая сессия продолжает работать
    await page.goto('/profile');
    await expect(page.getByLabel('Имя')).toHaveValue('Анна Профиль');

    await ctxB.close();
    await ctxC.close();
  });

  test('контакты профиля видны участнику общей доски', async ({ browser, page }) => {
    test.setTimeout(120_000);
    const emailA = uniqueEmail('contact-a');
    await register(page, emailA);

    await page.getByLabel('Название новой доски').fill('Контакты E2E');
    await page.getByRole('button', { name: 'Создать доску' }).click();
    await expect(page).toHaveURL(/\/boards\/[0-9a-f-]+$/);
    const boardId = page.url().split('/').pop()!;

    // Контакты владельца
    await page.goto('/profile');
    await page.getByLabel('Телефон').fill('+7 911 111-11-11');
    await page.getByRole('button', { name: 'Добавить контакт' }).click();
    await page.getByLabel('Контакт', { exact: true }).fill('@owner_contact');
    await page.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByText('Профиль сохранён')).toBeVisible();

    // Приглашение и вступление второго участника
    const inviteRes = await page.request.post(`/api/boards/${boardId}/invites`, { data: { role: 'VIEWER' } });
    expect(inviteRes.ok()).toBeTruthy();
    const { invite } = (await inviteRes.json()) as { invite: { token: string } };

    const ctxB = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5174' });
    const pageB = await ctxB.newPage();
    await register(pageB, uniqueEmail('contact-b'));
    await pageB.goto(`/join/${invite.token}`);
    await pageB.getByRole('link', { name: 'Открыть доску' }).click();
    await expect(pageB.getByRole('heading', { name: 'To Do' })).toBeVisible();

    // B открывает участников и видит контакты владельца
    await pageB.getByRole('button', { name: 'Участники' }).click();
    const dialog = pageB.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /^Контакты / }).click();
    await expect(pageB.getByText('+7 911 111-11-11')).toBeVisible();
    await expect(pageB.getByText('@owner_contact')).toBeVisible();
    await expect(pageB.getByText('Telegram:')).toBeVisible();

    await ctxB.close();
  });
});

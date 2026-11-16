import { test, expect, type Page } from '@playwright/test';

/**
 * Дымовые сценарии v2 (фаза 11): защищают поведение при редизайне.
 * Запуск: поднять `pnpm dev`, затем `pnpm e2e`.
 */

let counter = 0;
const uniqueEmail = () => `e2e-${Date.now()}-${counter++}@test.dev`;

async function register(page: Page): Promise<string> {
  const email = uniqueEmail();
  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Имя').fill('E2E Тестер');
  await page.getByLabel('Пароль (минимум 8 символов)').fill('password123');
  await page.getByLabel('Повторите пароль').fill('password123');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/boards$/);
  return email;
}

async function createBoard(page: Page, title = 'E2E доска'): Promise<void> {
  await page.getByLabel('Название новой доски').fill(title);
  await page.getByRole('button', { name: 'Создать доску' }).click();
  await expect(page).toHaveURL(/\/boards\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'To Do' })).toBeVisible();
}

async function addCard(page: Page, columnIndex: number, title: string): Promise<void> {
  const column = page.locator('[data-column-id]').nth(columnIndex);
  const input = column.getByPlaceholder('+ карточка');
  await input.fill(title);
  await input.press('Enter');
  await expect(column.getByText(title)).toBeVisible();
}

test.describe('v2: дымовые сценарии', () => {
  test('регистрация и пустой список досок', async ({ page }) => {
    await register(page);
    await expect(page.getByRole('heading', { name: 'Мои доски' })).toBeVisible();
    await expect(page.getByText('Досок пока нет')).toBeVisible();
  });

  test('создание доски: три колонки по умолчанию', async ({ page }) => {
    await register(page);
    await createBoard(page);
    await expect(page.locator('[data-column-id]')).toHaveCount(3);
    await expect(page.getByRole('heading', { name: 'In Progress' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible();
  });

  test('карточка создаётся и сохраняется после перезагрузки', async ({ page }) => {
    await register(page);
    await createBoard(page);
    await addCard(page, 0, 'Проверить дизайн');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'To Do' })).toBeVisible();
    await expect(page.locator('[data-column-id]').nth(0).getByText('Проверить дизайн')).toBeVisible();
  });

  test('перетаскивание карточки в другую колонку сохраняется', async ({ page }) => {
    await register(page);
    await createBoard(page);
    await addCard(page, 0, 'Перетаскиваемая');

    const card = page.locator('[data-column-id]').nth(0).locator('[data-card-id]').first();
    const target = page.locator('[data-column-id]').nth(2);
    const from = await card.boundingBox();
    const to = await target.boundingBox();
    expect(from).not.toBeNull();
    expect(to).not.toBeNull();

    const startX = from!.x + from!.width / 2;
    const startY = from!.y + from!.height / 2;
    const endX = to!.x + to!.width / 2;
    const endY = to!.y + 80;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    for (let i = 1; i <= 12; i += 1) {
      await page.mouse.move(startX + ((endX - startX) * i) / 12, startY + ((endY - startY) * i) / 12);
      await page.waitForTimeout(20);
    }
    await page.mouse.up();

    await expect(target.getByText('Перетаскиваемая')).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-column-id]').nth(2).getByText('Перетаскиваемая')).toBeVisible();
  });

  test('редактирование карточки в модалке', async ({ page }) => {
    await register(page);
    await createBoard(page);
    await addCard(page, 0, 'Старое название');

    await page.locator('[data-card-id]').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const title = page.getByLabel('Заголовок');
    await title.fill('Новое название');
    await page.getByRole('button', { name: 'Сохранить' }).click();

    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.locator('[data-column-id]').nth(0).getByText('Новое название')).toBeVisible();
  });

  test('шаринг: создание invite-ссылки', async ({ page }) => {
    await register(page);
    await createBoard(page);

    await page.getByRole('button', { name: 'Поделиться' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Участники · 1')).toBeVisible();

    await dialog.getByRole('button', { name: 'Создать ссылку' }).click();
    await expect(dialog.getByText(/\/join\//)).toBeVisible();
  });

  test('переключение темы: светлая и тёмная', async ({ page }) => {
    await register(page);
    await page.getByRole('button', { name: 'Тема оформления' }).click();
    await page.getByRole('menuitem', { name: 'Тёмная' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    await page.getByRole('button', { name: 'Тема оформления' }).click();
    await page.getByRole('menuitem', { name: 'Светлая' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });
});

import { test, expect, type Page } from '@playwright/test';
import { registerAndVerify, uniqueEmail } from './helpers';

/**
 * Клавиатурные сценарии (FR-45): стрелки между карточками/колонками,
 * Enter открывает карточку и поле добавления, Esc закрывает модалку.
 */

async function createBoard(page: Page, title: string): Promise<void> {
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

test('клавиатура: стрелки, Enter/Esc, создание карточки', async ({ page }) => {
  await registerAndVerify(page, uniqueEmail('kbd'));
  await createBoard(page, 'Клавиатурная доска');
  await addCard(page, 0, 'Первая карточка');
  await addCard(page, 1, 'Вторая карточка');

  // Стрелка вправо: карточка соседней колонки получает фокус
  await page.locator('[data-card-id]', { hasText: 'Первая карточка' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-card-id]:focus')).toContainText('Вторая карточка');

  // Enter открывает модалку, Esc закрывает (FR-45)
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Заголовок')).toHaveValue('Вторая карточка');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  // Стрелка вниз по колонке не выходит за пределы списка
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-card-id]:focus')).toContainText('Вторая карточка');

  // Enter на колонке ведёт к полю «+ карточка»; создание — с клавиатуры
  const emptyColumn = page.locator('[data-column-id]').nth(2);
  await emptyColumn.focus();
  await page.keyboard.press('Enter');
  await expect(emptyColumn.getByPlaceholder('+ карточка')).toBeFocused();
  await page.keyboard.type('Сделано с клавиатуры');
  await page.keyboard.press('Enter');
  await expect(emptyColumn.getByText('Сделано с клавиатуры')).toBeVisible();
  await expect(page.getByText('Карточка добавлена').first()).toBeVisible();

  // Карточка доски в списке тоже открывается с клавиатуры (FR-47)
  await page.getByRole('button', { name: 'Доски' }).click();
  const boardCard = page.getByRole('button', { name: 'Открыть доску «Клавиатурная доска»' });
  await boardCard.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/boards\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'To Do' })).toBeVisible();
});

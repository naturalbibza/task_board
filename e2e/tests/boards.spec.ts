import { test, expect, type Page } from '@playwright/test';
import { registerAndVerify, uniqueEmail } from './helpers';

/**
 * Доски (фаза 15, FR-39–44): архив, избранное, поиск, сортировка, шаблоны колонок.
 * Запуск: поднять `pnpm dev`, затем `pnpm e2e`.
 */

async function register(page: Page): Promise<void> {
  await registerAndVerify(page, uniqueEmail('boards'));
}

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

/** Открыть меню «⋯» на карточке доски в списке. */
async function openBoardMenu(page: Page, title: string) {
  const card = page.locator('div').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).last();
  await card.getByRole('button', { name: `Действия с доской «${title}»` }).click();
  return card;
}

test.describe('v2: доски', () => {
  test('архив: доска скрывается из списка, доступна только для просмотра, восстанавливается', async ({ page }) => {
    page.on('dialog', (dialog) => void dialog.accept());
    await register(page);
    await createBoard(page, 'Архивная доска');

    await page.getByRole('button', { name: 'Доски' }).click();
    await expect(page).toHaveURL(/\/boards$/);

    await openBoardMenu(page, 'Архивная доска');
    await page.getByRole('menuitem', { name: 'В архив' }).click();
    await expect(page.getByRole('heading', { name: 'Архивная доска' })).toHaveCount(0);

    // Вкладка «Архив»: доска на месте
    await page.getByRole('tab', { name: 'Архив' }).click();
    await expect(page.getByRole('heading', { name: 'Архивная доска' })).toBeVisible();

    // Открывается только для просмотра
    await page.getByRole('heading', { name: 'Архивная доска' }).click();
    await expect(page).toHaveURL(/\/boards\/[0-9a-f-]+$/);
    await expect(page.getByText('Доска в архиве — доступен только просмотр')).toBeVisible();
    await expect(page.getByPlaceholder('+ карточка')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Добавить колонку' })).toHaveCount(0);

    // Восстановление владельцем
    await page.getByRole('button', { name: 'Восстановить' }).click();
    await expect(page.getByText('Доска в архиве — доступен только просмотр')).toHaveCount(0);
    await expect(page.getByPlaceholder('+ карточка').first()).toBeVisible();

    // Вкладка «Архив» пуста, доска вернулась в основной список
    await page.getByRole('button', { name: 'Доски' }).click();
    await expect(page.getByRole('heading', { name: 'Архивная доска' })).toBeVisible();
    await page.getByRole('tab', { name: 'Архив' }).click();
    await expect(page.getByText('Архив пуст')).toBeVisible();
  });

  test('избранное и поиск в списке досок', async ({ page }) => {
    await register(page);
    await createBoard(page, 'Альфа доска');
    await page.getByRole('button', { name: 'Доски' }).click();
    await createBoard(page, 'Бета доска');
    await page.getByRole('button', { name: 'Доски' }).click();

    // Поиск регистронезависимый (FR-41)
    await page.getByLabel('Поиск по названию доски').fill('АЛЬФА');
    await expect(page.getByRole('heading', { name: 'Альфа доска' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Бета доска' })).toHaveCount(0);
    await page.getByLabel('Поиск по названию доски').fill('');

    // Избранное (FR-40): отметка и вкладка
    await page.getByRole('button', { name: 'Добавить «Альфа доска» в избранное' }).click();
    await page.getByRole('tab', { name: 'Избранное' }).click();
    await expect(page.getByRole('heading', { name: 'Альфа доска' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Бета доска' })).toHaveCount(0);

    // Избранная — сверху в общем списке (FR-42)
    await page.getByRole('tab', { name: 'Все' }).click();
    const headings = page.getByRole('heading', { level: 2 });
    await expect(headings.first()).toHaveText('Альфа доска');

    // Сортировка по названию
    await page.getByRole('combobox', { name: 'Сортировка досок' }).click();
    await page.getByRole('option', { name: 'По названию' }).click();
    await expect(headings.first()).toHaveText('Альфа доска');
  });

  test('шаблоны досок: сохранить доску и создать доску из шаблона', async ({ page }) => {
    page.on('dialog', (dialog) => {
      if (dialog.type() === 'prompt') void dialog.accept('Мой шаблон доски');
      else void dialog.accept();
    });
    await register(page);
    await createBoard(page, 'Доска-образец');
    await addCard(page, 0, 'Задача из образца');

    // «Сохранить как шаблон…» в меню действий владельца (FR-51)
    await page.getByRole('button', { name: 'Действия с доской' }).click();
    await page.getByRole('menuitem', { name: 'Сохранить как шаблон…' }).click();
    await expect(page.getByText('Шаблон доски «Мой шаблон доски» сохранён')).toBeVisible();

    // Личный шаблон: новая доска с той же структурой
    await page.getByRole('button', { name: 'Доски' }).click();
    await page.getByRole('button', { name: 'Из шаблона доски' }).click();
    await page.getByRole('menuitem', { name: /Мой шаблон доски/ }).click();
    await expect(page).toHaveURL(/\/boards\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name: 'To Do' })).toBeVisible();
    await expect(page.getByText('Задача из образца')).toBeVisible();

    // Системный шаблон «Учёба»: колонки и карточки
    await page.getByRole('button', { name: 'Доски' }).click();
    await page.getByRole('button', { name: 'Из шаблона доски' }).click();
    await page.getByRole('menuitem', { name: /Учёба/ }).click();
    await expect(page.getByRole('heading', { name: 'Лекции' })).toBeVisible();
    await expect(page.getByText('Сдать работу')).toBeVisible();
  });

  test('шаблоны: сохранить колонку и создать колонку из шаблона', async ({ page }) => {
    page.on('dialog', (dialog) => {
      if (dialog.type() === 'prompt') void dialog.accept('Мой шаблон E2E');
      else void dialog.accept();
    });
    await register(page);
    await createBoard(page, 'Шаблоны E2E');
    await addCard(page, 0, 'Карточка из шаблона');

    // «Сохранить как шаблон» в меню колонки (FR-43)
    await page.locator('[data-column-id]').first().getByRole('button', { name: 'Действия с колонкой' }).click();
    await page.getByRole('menuitem', { name: 'Сохранить как шаблон' }).click();
    await expect(page.getByText('Шаблон «Мой шаблон E2E» сохранён')).toBeVisible();

    // Личный шаблон: новая колонка с карточками
    await page.getByRole('button', { name: 'Из шаблона…' }).click();
    await page.getByRole('menuitem', { name: /Мой шаблон E2E/ }).click();
    await expect(page.getByRole('heading', { name: 'Мой шаблон E2E' })).toBeVisible();
    const savedColumn = page.locator('[data-column-id]').filter({ hasText: 'Мой шаблон E2E' });
    await expect(savedColumn.getByText('Карточка из шаблона')).toBeVisible();

    // Системный шаблон «Баги»: колонка и 3 карточки одной транзакцией (FR-44)
    await page.getByRole('button', { name: 'Из шаблона…' }).click();
    await page.getByRole('menuitem', { name: /Баги/ }).click();
    const bugsColumn = page.locator('[data-column-id]').filter({ hasText: 'Баги' });
    await expect(bugsColumn.getByText('Воспроизвести проблему')).toBeVisible();
    await expect(bugsColumn.getByText('Проверить на проде')).toBeVisible();
  });
});

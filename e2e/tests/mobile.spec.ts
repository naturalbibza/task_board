import { test, expect, type Page } from '@playwright/test';
import { registerAndVerify, uniqueEmail } from './helpers';

/**
 * Мобильные размеры (FR-16.4): страница не разъезжается, колонки скроллятся
 * внутри доски, модалки помещаются в экран и прокручиваются.
 */

// Типичный телефон: 390×700 (близко к iPhone 12/13/14)
test.use({ viewport: { width: 390, height: 700 } });

async function createBoard(page: Page): Promise<void> {
  await page.getByLabel('Название новой доски').fill('Мобильная доска');
  await page.getByRole('button', { name: 'Создать доску' }).click();
  await expect(page).toHaveURL(/\/boards\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'To Do' })).toBeVisible();
}

test('мобильные размеры: колонки скроллятся, модалки помещаются в экран', async ({ page }) => {
  await registerAndVerify(page, uniqueEmail('mobile'));
  await createBoard(page);

  // Страница не шире экрана: горизонтальный скролл — только у ряда колонок
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);

  const column = page.locator('[data-column-id]').first();
  const input = column.getByPlaceholder('+ карточка');
  await input.fill('Мобильная карточка');
  await input.press('Enter');
  await expect(column.getByText('Мобильная карточка')).toBeVisible();

  // Модалка карточки целиком в экране
  await column.getByText('Мобильная карточка').click();
  const cardDialog = page.getByRole('dialog');
  await expect(cardDialog).toBeVisible();
  const cardBox = await cardDialog.boundingBox();
  expect(cardBox).not.toBeNull();
  expect(cardBox!.y).toBeGreaterThanOrEqual(0);
  expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(700 + 1);
  await page.keyboard.press('Escape');
  await expect(cardDialog).toBeHidden();

  // Модалка участников тоже помещается и закрывается кликом
  await page.getByRole('button', { name: 'Участники' }).click();
  const membersDialog = page.getByRole('dialog');
  await expect(membersDialog).toBeVisible();
  const membersBox = await membersDialog.boundingBox();
  expect(membersBox).not.toBeNull();
  expect(membersBox!.y).toBeGreaterThanOrEqual(0);
  expect(membersBox!.y + membersBox!.height).toBeLessThanOrEqual(700 + 1);
  await membersDialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(membersDialog).toBeHidden();
});

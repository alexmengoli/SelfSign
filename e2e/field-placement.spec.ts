import { expect, type Locator, type Page, test } from '@playwright/test';
import { validPdf } from './support/pdf-fixtures';
import { solidPng } from './support/png-fixtures';
import { mockSavedValues } from './support/saved-values';

async function openPdf(page: Page): Promise<void> {
  await page.locator('app-drop-zone input[type="file"]').setInputFiles({
    name: 'placement.pdf',
    mimeType: 'application/pdf',
    buffer: validPdf(2),
  });
  await expect(page.getByRole('toolbar', { name: 'Document' })).toBeVisible();
}

async function fitPage(page: Page): Promise<void> {
  await page.getByRole('toolbar', { name: 'Document' }).getByRole('button', { name: 'Fit page' }).click();
}

/** Drags a sidebar handle to a point with the mouse, the way a desktop user drops it. */
async function dragTo(page: Page, handle: Locator, target: { x: number; y: number }): Promise<void> {
  const source = await handle.boundingBox();
  if (!source) throw new Error('Missing drag handle');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + 20, source.y + 20, { steps: 4 });
  await page.mouse.move(target.x, target.y, { steps: 16 });
  await page.mouse.up();
}

async function dragToPage(page: Page, handle: Locator, pageIndex: number, yRatio = 1 / 3): Promise<void> {
  const box = await page.locator(`.page[data-page-index="${pageIndex}"]`).boundingBox();
  if (!box) throw new Error(`Missing page ${pageIndex}`);
  await dragTo(page, handle, { x: box.x + box.width / 2, y: box.y + box.height * yRatio });
}

test.describe('field library: placement onto a loaded PDF', () => {
  test('places Today\'s date in the saved format using the local date', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockSavedValues(page, []);
    await page.route('**/api/settings', (route) => (route.request().method() === 'GET'
      ? route.fulfill({ json: { dateFormat: 'yyyy-MM-dd' } })
      : route.continue()));
    await page.goto('/');
    await openPdf(page);

    const pad = (value: number) => String(value).padStart(2, '0');
    const now = new Date();
    const expected = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    await expect(page.locator('.date-value')).toHaveText(expected);
    await page.getByRole('button', { name: 'Place Today\'s date' }).click();
    await expect(page.locator('.element[data-page-index="0"] .element-text')).toHaveText(expected);
  });

  test('keeps placed text when the saved value is edited or deleted', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const savedText = 'RSSMRA80A01H501U';
    await mockSavedValues(page, [{ id: 'tax-code', kind: 'text', label: 'Tax code', text: savedText }]);
    await page.route('**/api/values/tax-code', (route) => {
      const method = route.request().method();
      if (method === 'PUT') return route.fulfill({ json: { id: 'tax-code', kind: 'text', label: 'Tax code', text: 'Changed value' } });
      if (method === 'DELETE') return route.fulfill({ status: 204 });
      return route.continue();
    });
    await page.goto('/');
    await openPdf(page);

    await page.getByRole('button', { name: 'Place Tax code' }).click();
    const placed = page.locator('.element .element-text');
    await expect(placed).toHaveText(savedText);

    await page.locator('.element').first().dblclick();
    const editor = page.getByRole('textbox', { name: 'Text' });
    await expect(editor).toBeFocused();
    await editor.fill('Edited on page');
    await page.keyboard.press('Escape');
    await expect(placed).toHaveText('Edited on page');
    await expect(page.locator('.saved-preview')).toHaveText(savedText);

    await page.getByRole('button', { name: 'Edit Tax code' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit value' });
    await edit.getByLabel('Value').fill('Changed value');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.saved-preview')).toHaveText('Changed value');
    await expect(placed).toHaveText('Edited on page');

    await page.getByRole('button', { name: 'Delete Tax code' }).click();
    await page.getByRole('dialog', { name: 'Delete "Tax code"?' }).getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('button', { name: 'Edit Tax code' })).toHaveCount(0);
    await expect(placed).toHaveText('Edited on page');
  });
});

test.describe('field library: mobile placement', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('tapping Place on a saved value or free Text places it and closes the Fields sheet', async ({ page }) => {
    await mockSavedValues(page, [{ id: 'tax-code', kind: 'text', label: 'Tax code', text: 'RSSMRA80A01H501U' }]);
    await page.goto('/');
    await openPdf(page);

    await page.getByRole('button', { name: 'Fields', exact: true }).tap();
    await page.getByRole('button', { name: 'Place Tax code' }).tap();
    await expect(page.getByRole('dialog', { name: 'Fields' })).toHaveCount(0);
    await expect(page.locator('.element .element-text')).toHaveText('RSSMRA80A01H501U');

    await page.getByRole('button', { name: 'Fields', exact: true }).tap();
    await page.getByRole('button', { name: 'Place Text', exact: true }).tap();
    await expect(page.getByRole('dialog', { name: 'Fields' })).toHaveCount(0);
    await expect(page.locator('.element')).toHaveCount(2);
    await expect(page.getByRole('textbox', { name: 'Text' })).toBeFocused();
  });
});

test.describe('field library: dragging items onto a loaded PDF', () => {
  test('drags Today\'s date from its Move handle onto a page', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockSavedValues(page, []);
    await page.route('**/api/settings', (route) => (route.request().method() === 'GET'
      ? route.fulfill({ json: { dateFormat: 'dd/MM/yyyy' } })
      : route.continue()));
    await page.goto('/');
    await openPdf(page);
    await fitPage(page);

    const pad = (value: number) => String(value).padStart(2, '0');
    const now = new Date();
    const expected = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    await dragToPage(page, page.getByRole('button', { name: 'Move Today\'s date' }), 0);
    await expect(page.locator('.element[data-page-index="0"] .element-text')).toHaveText(expected);
  });

  test('drags a saved text and a saved image from their Move handles onto a page', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockSavedValues(page, [
      { id: 'tax-code', kind: 'text', label: 'Tax code', text: 'RSSMRA80A01H501U' },
      { id: 'signature', kind: 'image', label: 'Signature', imageId: 'signature-image', mimeType: 'image/png' },
    ], solidPng(40, 20, [0, 0, 255]));
    await page.goto('/');
    await openPdf(page);
    await fitPage(page);

    await dragToPage(page, page.getByRole('button', { name: 'Move Tax code' }), 0);
    await expect(page.locator('.element[data-page-index="0"] .element-text')).toHaveText('RSSMRA80A01H501U');
    await dragToPage(page, page.getByRole('button', { name: 'Move Signature' }), 0, 0.7);
    await expect(page.locator('.element[data-page-index="0"] .element-image')).toHaveCount(1);
  });

  test('a saved value dropped outside every page places nothing', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockSavedValues(page, [{ id: 'tax-code', kind: 'text', label: 'Tax code', text: 'RSSMRA80A01H501U' }]);
    await page.goto('/');
    await openPdf(page);
    await fitPage(page);

    const sidebar = await page.locator('aside[aria-label="Fields"]').boundingBox();
    if (!sidebar) throw new Error('Missing sidebar');
    await dragTo(page, page.getByRole('button', { name: 'Move Tax code' }), { x: sidebar.x + sidebar.width / 2, y: sidebar.y + sidebar.height / 2 });
    await expect(page.locator('.drop-preview')).toHaveCount(0);
    await expect(page.locator('.element')).toHaveCount(0);
  });
});

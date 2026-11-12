import { expect, type Locator, type Page, test } from '@playwright/test';
import { buildPdf, corruptedPdf, encryptedPdf, pagesOf, truncatedPdf, validPdf } from './support/pdf-fixtures';
import { mockSavedValues } from './support/saved-values';

const DROP_ZONE = 'Drop a PDF here or click to browse';

function sameRelativePosition(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) < 0.005 && Math.abs(a.y - b.y) < 0.005;
}

function fileInput(page: Page): Locator {
  return page.locator('app-drop-zone input[type="file"]');
}

async function zoomFactor(page: Page): Promise<number> {
  return Number((await page.locator('.zoom-value').textContent())?.replace('%', '')) / 100;
}

/** Clicks zoom in or out and waits for the displayed percentage to change, avoiding stale disabled checks. */
async function zoomStep(page: Page, direction: 'in' | 'out'): Promise<void> {
  const value = page.locator('.zoom-value');
  const before = await value.textContent();
  await toolbar(page).getByRole('button', { name: direction === 'in' ? 'Zoom in' : 'Zoom out' }).click();
  await expect(value).not.toHaveText(before ?? '');
}

function toolbar(page: Page): Locator {
  return page.getByRole('toolbar', { name: 'Document' });
}

function pageBox(page: Page, index: number): Locator {
  return page.locator(`.page[data-page-index="${index}"]`);
}

async function openDocument(page: Page, bytes: Buffer = validPdf(), name = 'sample.pdf'): Promise<void> {
  await fileInput(page).setInputFiles({ name, mimeType: 'application/pdf', buffer: bytes });
  await expect(toolbar(page)).toBeVisible();
  await expect.poll(() => renderedCanvasCount(page)).toBeGreaterThan(0);
}

async function renderedCanvasCount(page: Page): Promise<number> {
  return page.locator('.page canvas').evaluateAll((canvases) => canvases.filter((canvas) => (canvas as HTMLCanvasElement).width > 0).length);
}

async function pageRect(page: Page, index: number): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await pageBox(page, index).boundingBox();
  if (!box) throw new Error(`Missing page ${index}`);
  return box;
}

async function fitPage(page: Page): Promise<void> {
  await toolbar(page).getByRole('button', { name: 'Fit page' }).click();
}

test.describe('pdf viewer: opening and validation', () => {
  test('shows the drop zone and rejects invalid files without hiding it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('main')).toHaveText(DROP_ZONE);

    await fileInput(page).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('plain text') });
    await expect(page.getByRole('alert')).toHaveText('This file is not a valid PDF.');
    await expect(page.getByRole('button', { name: DROP_ZONE })).toBeVisible();

    await fileInput(page).setInputFiles({ name: 'cut.pdf', mimeType: 'application/pdf', buffer: corruptedPdf() });
    await expect(page.getByRole('alert')).toHaveText('This file is not a valid PDF.');

    await fileInput(page).setInputFiles({ name: 'locked.pdf', mimeType: 'application/pdf', buffer: encryptedPdf() });
    await expect(page.getByRole('alert')).toHaveText('Password-protected PDFs are not supported.');
    await expect(page.getByRole('button', { name: DROP_ZONE })).toBeVisible();
  });

  test('rejects a truncated PDF and keeps the drop zone', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await fileInput(page).setInputFiles({ name: 'cut.pdf', mimeType: 'application/pdf', buffer: truncatedPdf() });
    await expect(page.getByRole('alert')).toHaveText('This file is not a valid PDF.');
    await expect(page.getByRole('button', { name: DROP_ZONE })).toBeVisible();
  });

  test('opens a dropped PDF, keeps one document open, and closes back to the drop zone', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await openDocument(page, validPdf(3), 'first.pdf');
    await expect(toolbar(page)).toContainText('first.pdf');
    await expect(page.locator('.page-indicator')).toContainText('/ 3');
    await expect(page.locator('.page')).toHaveCount(3);

    await page.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File(['%PDF-1.4'], 'second.pdf', { type: 'application/pdf' }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
    });
    await expect(toolbar(page)).toContainText('first.pdf');
    await expect(toolbar(page)).not.toContainText('second.pdf');

    await toolbar(page).getByRole('button', { name: 'Close document' }).click();
    await expect(page.getByRole('button', { name: DROP_ZONE })).toBeVisible();
  });

  test('opens a dropped file anywhere in the window', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const bytes = validPdf(2).toString('base64');
    await page.evaluate((encoded) => {
      const binary = atob(encoded);
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(binary, (char) => char.charCodeAt(0))], 'dropped.pdf', { type: 'application/pdf' }));
      window.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
    }, bytes);
    await expect(toolbar(page)).toContainText('dropped.pdf');
    await expect.poll(() => renderedCanvasCount(page)).toBeGreaterThan(0);
  });
});

test.describe('pdf viewer: navigation and rendering', () => {
  test('renders only nearby pages and keeps the page indicator in sync', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await openDocument(page, buildPdf(pagesOf(200)), 'long.pdf');
    await expect(page.locator('.page-indicator')).toContainText('/ 200');
    expect(await renderedCanvasCount(page)).toBeLessThanOrEqual(6);
    await expect(toolbar(page).getByRole('button', { name: 'Previous page' })).toBeDisabled();

    const input = page.getByRole('textbox', { name: 'Page number' });
    await input.fill('5');
    await input.press('Enter');
    await expect(input).toHaveValue('5');
    await expect.poll(() => page.locator('.scroller').evaluate((element) => element.scrollTop)).toBeGreaterThan(1000);
    expect(await renderedCanvasCount(page)).toBeLessThanOrEqual(6);

    await input.fill('0');
    await input.press('Enter');
    await expect(input).toHaveValue('5');
    await input.fill('abc');
    await input.press('Enter');
    await expect(input).toHaveValue('5');

    await toolbar(page).getByRole('button', { name: 'Next page' }).click();
    await expect(input).toHaveValue('6');
    await input.fill('200');
    await input.press('Enter');
    await expect(input).toHaveValue('200');
    await expect(toolbar(page).getByRole('button', { name: 'Next page' })).toBeDisabled();

    await page.locator('.scroller').evaluate((element) => { element.scrollTop = 0; });
    await expect(input).toHaveValue('1');
    await expect(toolbar(page).getByRole('button', { name: 'Previous page' })).toBeDisabled();
  });

  test('respects page rotation', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await openDocument(page, buildPdf([{ text: 'Upright', rotate: 90 }]), 'rotated.pdf');
    const box = await pageRect(page, 0);
    expect(box.width).toBeGreaterThan(box.height);
  });
});

test.describe('pdf viewer: zoom', () => {
  test('changes zoom with buttons within 25 to 400 percent and keeps placed elements in place', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await openDocument(page, validPdf(2), 'zoom.pdf');
    const zoomValue = page.locator('.zoom-value');
    const zoomOut = toolbar(page).getByRole('button', { name: 'Zoom out' });
    const zoomIn = toolbar(page).getByRole('button', { name: 'Zoom in' });
    await zoomStep(page, 'out');
    const first = Number((await zoomValue.textContent())?.replace('%', ''));
    expect(first).toBeGreaterThanOrEqual(25);
    await zoomStep(page, 'in');
    expect(Number((await zoomValue.textContent())?.replace('%', ''))).toBeGreaterThan(first);

    for (let step = 0; step < 12 && (await zoomValue.textContent()) !== '25%'; step++) await zoomStep(page, 'out');
    await expect(zoomValue).toHaveText('25%');
    await expect(zoomOut).toBeDisabled();
    await toolbar(page).getByRole('button', { name: 'Fit width' }).click();
    await expect(toolbar(page).getByRole('button', { name: 'Fit width' })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Place Today\'s date' }).click();
    const element = page.locator('.element').first();
    await expect(element).toBeVisible();
    const relative = () => page.evaluate(() => {
      const elementNode = document.querySelector<HTMLElement>('.element');
      const pageNode = document.querySelector(`.page[data-page-index="${elementNode?.dataset['pageIndex']}"]`);
      if (!pageNode || !elementNode) throw new Error('Missing page or element');
      const pageBounds = pageNode.getBoundingClientRect();
      const elementBounds = elementNode.getBoundingClientRect();
      return {
        x: (elementBounds.left - pageBounds.left) / pageBounds.width,
        y: (elementBounds.top - pageBounds.top) / pageBounds.height,
      };
    });
    const before = await relative();
    for (let step = 0; step < 4; step++) await zoomStep(page, 'out');
    await expect.poll(async () => sameRelativePosition(await relative(), before)).toBe(true);
    for (let step = 0; step < 12 && (await zoomValue.textContent()) !== '400%'; step++) await zoomStep(page, 'in');
    await expect(zoomValue).toHaveText('400%');
    await expect(zoomIn).toBeDisabled();
    await expect.poll(async () => sameRelativePosition(await relative(), before)).toBe(true);
  });

  test('zooms with Ctrl plus mouse wheel', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await openDocument(page, validPdf(2), 'wheel.pdf');
    await toolbar(page).getByRole('button', { name: 'Zoom out' }).click();
    const before = await page.locator('.zoom-value').textContent();
    const scroller = await page.locator('.scroller').boundingBox();
    if (!scroller) throw new Error('Missing scroller');
    await page.mouse.move(scroller.x + scroller.width / 2, scroller.y + scroller.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');
    await expect.poll(() => page.locator('.zoom-value').textContent()).not.toBe(before);
  });
});

test.describe('pdf viewer: placement and selection', () => {
  test('places a saved text value at the visible center and selects it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const label = 'Tax code';
    await mockSavedValues(page, [{ id: 'tax-code', kind: 'text', label, text: 'RSSMRA80A01H501U' }]);
    await page.goto('/');
    await openDocument(page, validPdf(2), 'place.pdf');
    await page.getByRole('button', { name: `Place ${label}` }).click();
    const element = page.locator('.element').first();
    await expect(element).toHaveAttribute('data-page-index', '0');
    await expect(element.locator('.element-text')).toHaveText('RSSMRA80A01H501U');
  });

  test('drag from the sidebar places free text on the page under the pointer and nothing outside pages', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await openDocument(page, validPdf(3), 'drag.pdf');
    await fitPage(page);
    const handle = page.getByRole('button', { name: 'Move Text' });
    const source = await handle.boundingBox();
    const target = await pageRect(page, 1);
    if (!source) throw new Error('Missing Move Text handle');

    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(source.x + 20, source.y + 20, { steps: 4 });
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 3, { steps: 16 });
    await expect(page.locator('.drop-preview')).toBeVisible();
    await page.mouse.up();
    await expect(page.locator('.element[data-page-index="1"]')).toHaveCount(1);
    await expect(page.locator('textarea[aria-label="Text"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.element')).toHaveCount(0);
  });
});

test.describe('pdf viewer: element editing', () => {
  test('applies font, size and color from the floating toolbar and duplicates with a 10 pt offset', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await openDocument(page, validPdf(2), 'style.pdf');
    await page.getByRole('button', { name: 'Place Today\'s date' }).click();
    const element = page.locator('.element').first();
    const toolbarBar = page.locator('app-element-toolbar');
    await expect(toolbarBar.getByRole('combobox', { name: 'Font' })).toHaveValue('Noto Sans');
    await expect(toolbarBar.getByRole('spinbutton', { name: 'Font size' })).toHaveValue('12');
    await expect(toolbarBar.getByLabel('Color')).toHaveValue('#000000');

    await toolbarBar.getByRole('combobox', { name: 'Font' }).selectOption('Caveat');
    await expect(element.locator('.element-text')).toHaveCSS('font-family', /Caveat/);
    await toolbarBar.getByRole('spinbutton', { name: 'Font size' }).fill('20');
    await toolbarBar.getByRole('spinbutton', { name: 'Font size' }).press('Enter');
    const zoom = await zoomFactor(page);
    await expect.poll(() => element.locator('.element-text').evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeCloseTo(20 * zoom, 1);
    await toolbarBar.getByLabel('Color').fill('#ff0000');
    await expect(element.locator('.element-text')).toHaveCSS('color', 'rgb(255, 0, 0)');

    const original = await element.boundingBox();
    await toolbarBar.getByRole('button', { name: 'Duplicate' }).click();
    await expect(page.locator('.element')).toHaveCount(2);
    const copy = await page.locator('.element').nth(1).boundingBox();
    if (!original || !copy) throw new Error('Missing element geometry');
    expect(copy.x - original.x).toBeCloseTo(10 * zoom, 0);
    expect(copy.y - original.y).toBeCloseTo(10 * zoom, 0);

    await toolbarBar.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.locator('.element')).toHaveCount(1);
  });

  test('double-click edits text with Enter for new lines and Escape to finish', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await openDocument(page, validPdf(1), 'edit.pdf');
    await page.getByRole('button', { name: 'Place Text' }).click();
    const editor = page.getByRole('textbox', { name: 'Text' });
    await expect(editor).toBeFocused();
    await editor.fill('First line');
    await editor.press('Enter');
    await editor.pressSequentially('Second line');
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    await expect(page.locator('.element .element-text')).toHaveText('First line\nSecond line');
    const zoom = await zoomFactor(page);
    const height = await page.locator('.element').first().evaluate((node) => node.getBoundingClientRect().height);
    expect(height).toBeCloseTo(2 * 12 * 1.25 * zoom, 0);

    await page.locator('.element').first().dblclick();
    await expect(page.getByRole('textbox', { name: 'Text' })).toBeFocused();
    await page.getByRole('textbox', { name: 'Text' }).fill('Edited');
    await page.keyboard.press('Escape');
    await expect(page.locator('.element .element-text')).toHaveText('Edited');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('.element .element-text')).toHaveText('First line\nSecond line');
  });

  test('removes a free text element left empty when editing ends', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await openDocument(page, validPdf(1), 'empty.pdf');
    await page.getByRole('button', { name: 'Place Text' }).click();
    await expect(page.getByRole('textbox', { name: 'Text' })).toBeFocused();
    await page.mouse.click(4, 4);
    await expect(page.locator('.element')).toHaveCount(0);
  });
});

test.describe('pdf viewer: history, shortcuts and closing', () => {
  test('keyboard shortcuts nudge, duplicate, delete and undo or redo edits', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await openDocument(page, validPdf(1), 'keys.pdf');
    await page.getByRole('button', { name: 'Place Today\'s date' }).click();
    const element = page.locator('.element').first();
    const start = await element.boundingBox();
    if (!start) throw new Error('Missing element');
    const zoom = Number((await page.locator('.zoom-value').textContent())?.replace('%', '')) / 100;

    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await element.boundingBox())?.x ?? 0).toBeCloseTo(start.x + zoom, 0);
    await page.keyboard.press('Shift+ArrowDown');
    await expect.poll(async () => (await element.boundingBox())?.y ?? 0).toBeCloseTo(start.y + 10 * zoom, 0);

    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await element.boundingBox())?.y ?? 0).toBeCloseTo(start.y, 0);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await element.boundingBox())?.x ?? 0).toBeCloseTo(start.x, 0);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(async () => (await element.boundingBox())?.x ?? 0).toBeCloseTo(start.x + zoom, 0);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(async () => (await element.boundingBox())?.y ?? 0).toBeCloseTo(start.y + 10 * zoom, 0);

    await page.keyboard.press('Control+d');
    await expect(page.locator('.element')).toHaveCount(2);
    await page.keyboard.press('Control+z');
    await expect(page.locator('.element')).toHaveCount(1);
    await page.keyboard.press('Control+y');
    await expect(page.locator('.element')).toHaveCount(2);

    await page.keyboard.press('Escape');
    await expect(page.locator('app-element-toolbar')).toHaveCount(0);
    await page.locator('.element').first().click();
    await page.keyboard.press('Delete');
    await expect(page.locator('.element')).toHaveCount(1);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('.element')).toHaveCount(2);
    await page.keyboard.press('Meta+z');
    await expect(page.locator('.element')).toHaveCount(1);
    await page.keyboard.press('Meta+Shift+z');
    await expect(page.locator('.element')).toHaveCount(2);
  });

  test('warns before reloading with placed elements', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await openDocument(page, validPdf(1), 'reload.pdf');
    const unprotected = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(unprotected).toBe(false);
    await page.getByRole('button', { name: 'Place Today\'s date' }).click();
    const prevented = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(true);
    const dialogs: string[] = [];
    page.once('dialog', (dialog) => {
      dialogs.push(dialog.type());
      void dialog.dismiss();
    });
    await page.evaluate(() => {
      window.location.href = '/?navigated=1';
    });
    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs).toEqual(['beforeunload']);
    await expect(toolbar(page)).toBeVisible();
  });

  test('asks before closing a document with placed elements', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await openDocument(page, validPdf(1), 'close.pdf');
    await page.getByRole('button', { name: 'Place Today\'s date' }).click();
    await toolbar(page).getByRole('button', { name: 'Close document' }).click();
    const confirm = page.getByRole('dialog', { name: 'Discard changes and close this document?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(toolbar(page)).toBeVisible();
    await toolbar(page).getByRole('button', { name: 'Close document' }).click();
    await page.getByRole('dialog', { name: 'Discard changes and close this document?' }).getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByRole('button', { name: DROP_ZONE })).toBeVisible();
  });

  test('closes without confirmation when nothing was placed', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await openDocument(page, validPdf(1), 'plain.pdf');
    await toolbar(page).getByRole('button', { name: 'Close document' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: DROP_ZONE })).toBeVisible();
  });
});

test.describe('pdf viewer: mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('tap-to-place centers an element in the visible page and touch drag moves it', async ({ page }) => {
    await page.goto('/');
    await openDocument(page, validPdf(2), 'mobile.pdf');
    await page.getByRole('button', { name: 'Fields', exact: true }).tap();
    await page.getByRole('button', { name: 'Place Today\'s date' }).tap();
    await expect(page.getByRole('dialog', { name: 'Fields' })).toHaveCount(0);
    const element = page.locator('.element').first();
    await expect(element).toBeVisible();
    const box = await element.boundingBox();
    const scroller = await page.locator('.scroller').boundingBox();
    if (!box || !scroller) throw new Error('Missing geometry');
    expect(box.x + box.width / 2).toBeGreaterThan(scroller.x);
    expect(box.x + box.width / 2).toBeLessThan(scroller.x + scroller.width);

    const cdp = await page.context().newCDPSession(page);
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    for (let step = 1; step <= 10; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x, y: from.y + step * 6 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    const moved = await element.boundingBox();
    expect(moved?.y ?? 0).toBeGreaterThan(box.y + 20);
  });

  test('keeps the document toolbar inside the 390 pixel viewport', async ({ page }) => {
    await page.goto('/');
    await openDocument(page, validPdf(2), 'narrow.pdf');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
  });
});

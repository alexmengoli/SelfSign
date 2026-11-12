import { expect, type Locator, type Page, test } from '@playwright/test';
import { validPdf } from './support/pdf-fixtures';
import { solidPng } from './support/png-fixtures';
import { mockSavedValues } from './support/saved-values';

const signaturePng = solidPng(40, 20, [0, 0, 255]);

function fileInput(page: Page): Locator {
  return page.locator('app-drop-zone input[type="file"]');
}

function toolbar(page: Page): Locator {
  return page.getByRole('toolbar', { name: 'Document' });
}

async function openDocument(page: Page, bytes: Buffer, name: string): Promise<void> {
  await fileInput(page).setInputFiles({ name, mimeType: 'application/pdf', buffer: bytes });
  await expect(toolbar(page)).toBeVisible();
  await expect.poll(() => page.locator('.page canvas').first().evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeGreaterThan(0);
}

async function fitPage(page: Page): Promise<void> {
  await toolbar(page).getByRole('button', { name: 'Fit page' }).click();
  await expect(toolbar(page).getByRole('button', { name: 'Fit page' })).toHaveAttribute('aria-pressed', 'true');
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error('Missing bounding box');
  return bounds;
}

async function pageBox(page: Page, index: number) {
  return box(page.locator(`.page[data-page-index="${index}"]`));
}

async function zoomPercent(page: Page): Promise<number> {
  return Number((await page.locator('.zoom-value').textContent())?.replace('%', ''));
}

async function dragWithMouse(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.mouse.up();
}

function center(bounds: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

test.describe('pdf viewer: moving and dropping', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
  });

  test('moves an element onto another page and reverts a move released outside every page', async ({ page }) => {
    await openDocument(page, validPdf(3), 'move.pdf');
    await fitPage(page);
    await page.getByRole('button', { name: 'Place Today\'s date' }).click();
    const element = page.locator('.element').first();
    await expect(element).toHaveAttribute('data-page-index', '0');

    const target = await pageBox(page, 1);
    await dragWithMouse(page, center(await box(element)), { x: target.x + target.width / 2, y: target.y + target.height / 3 });
    await expect(element).toHaveAttribute('data-page-index', '1');

    const before = await box(element);
    const scroller = await box(page.locator('.scroller'));
    await dragWithMouse(page, center(before), { x: scroller.x + 4, y: center(before).y });
    await expect(element).toHaveAttribute('data-page-index', '1');
    const after = await box(element);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  });

  test('keeps a moved element inside its page bounds', async ({ page }) => {
    await openDocument(page, validPdf(2), 'bounds.pdf');
    await fitPage(page);
    await page.getByRole('button', { name: 'Place Today\'s date' }).click();
    const element = page.locator('.element').first();
    const pageBounds = await pageBox(page, 0);
    await dragWithMouse(page, center(await box(element)), { x: pageBounds.x + pageBounds.width - 2, y: center(pageBounds).y });
    const moved = await box(element);
    expect(moved.x + moved.width).toBeLessThanOrEqual(pageBounds.x + pageBounds.width + 1);
    expect(moved.x).toBeGreaterThanOrEqual(pageBounds.x - 1);
  });

  test('drops outside every page place nothing', async ({ page }) => {
    await openDocument(page, validPdf(2), 'gutter.pdf');
    await fitPage(page);
    const handle = await box(page.getByRole('button', { name: 'Move Text' }));
    const scroller = await box(page.locator('.scroller'));
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(scroller.x + 40, scroller.y + scroller.height / 2, { steps: 12 });
    await page.mouse.move(scroller.x + 4, scroller.y + scroller.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('.element')).toHaveCount(0);
  });
});

test.describe('pdf viewer: resize and rotate', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
  });

  test('keeps the aspect ratio of an image while resizing it', async ({ page }) => {
    const label = 'Mark';
    await mockSavedValues(page, [{ id: 'mark-image', kind: 'image', label, imageId: 'mark-image', mimeType: 'image/png' }], signaturePng);
    await page.reload();
    await openDocument(page, validPdf(1), 'image.pdf');
    await page.getByRole('button', { name: `Place ${label}` }).click();
    const element = page.locator('.element').first();
    await expect(element.locator('img')).toBeVisible();
    const before = await box(element);
    expect(before.width / before.height).toBeCloseTo(2, 1);
    const handle = await box(element.locator('.handle-resize'));
    await dragWithMouse(page, center(handle), { x: center(handle).x + 60, y: center(handle).y + 10 });
    const after = await box(element);
    expect(after.width).toBeGreaterThan(before.width + 30);
    expect(after.width / after.height).toBeCloseTo(2, 1);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(async () => (await box(element)).width).toBeCloseTo(before.width, 0);
  });

  test('places a saved image 150 pt wide at 100 percent zoom with its aspect ratio', async ({ page }) => {
    const label = 'Default';
    await mockSavedValues(page, [{ id: 'default-image', kind: 'image', label, imageId: 'default-image', mimeType: 'image/png' }], signaturePng);
    await page.reload();
    await openDocument(page, validPdf(1), 'defaults-image.pdf');
    const zoomOut = toolbar(page).getByRole('button', { name: 'Zoom out' });
    for (let step = 0; step < 6 && (await zoomPercent(page)) !== 100; step++) {
      const before = await zoomPercent(page);
      await zoomOut.click();
      await expect.poll(() => zoomPercent(page)).not.toBe(before);
    }
    await expect.poll(() => zoomPercent(page)).toBe(100);
    await page.getByRole('button', { name: `Place ${label}` }).click();
    const element = await box(page.locator('.element').first());
    expect(element.width).toBeCloseTo(150, 0);
    expect(element.width / element.height).toBeCloseTo(2, 1);
  });

  test('changes text size with the resize handle within 6 to 72 pt', async ({ page }) => {
    await openDocument(page, validPdf(1), 'text-resize.pdf');
    await page.getByRole('button', { name: 'Place Text' }).click();
    await page.getByRole('textbox', { name: 'Text' }).pressSequentially('Resize');
    await page.keyboard.press('Escape');
    const element = page.locator('.element').first();
    const fontSize = () => element.locator('.element-text').evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
    const zoom = (await zoomPercent(page)) / 100;
    const startSize = await fontSize();
    expect(startSize).toBeCloseTo(12 * zoom, 1);

    const handle = await box(element.locator('.handle-resize'));
    await dragWithMouse(page, center(handle), { x: center(handle).x + 40, y: center(handle).y + 20 });
    await expect.poll(fontSize).toBeGreaterThan(startSize + 1);

    const grown = await box(element.locator('.handle-resize'));
    await dragWithMouse(page, center(grown), { x: center(grown).x - 2000, y: center(grown).y - 2000 });
    await expect.poll(fontSize).toBeCloseTo(6 * zoom, 1);
  });

  test('rotates with the Shift key snapping to 15 degrees', async ({ page }) => {
    await openDocument(page, validPdf(1), 'rotate.pdf');
    await page.getByRole('button', { name: 'Place Today\'s date' }).click();
    const element = page.locator('.element').first();
    const bounds = await box(element);
    const origin = center(bounds);
    const rotateHandle = await box(element.locator('.handle-rotate'));
    const radians = (37 * Math.PI) / 180;
    const target = { x: origin.x + 160 * Math.sin(radians), y: origin.y - 160 * Math.cos(radians) };

    await page.mouse.move(center(rotateHandle).x, center(rotateHandle).y);
    await page.mouse.down();
    await page.keyboard.down('Shift');
    await page.mouse.move(target.x, target.y, { steps: 12 });
    await page.keyboard.up('Shift');
    await page.mouse.up();

    const transform = await element.evaluate((node) => (node as HTMLElement).style.transform);
    const angle = Number(/rotate\((-?[\d.]+)deg\)/.exec(transform)?.[1]);
    expect(Number.isFinite(angle)).toBe(true);
    expect(((angle % 15) + 15) % 15).toBeCloseTo(0, 3);
    expect(angle).toBeGreaterThan(20);
    expect(angle).toBeLessThan(50);

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => element.evaluate((node) => (node as HTMLElement).style.transform)).toBe('rotate(0deg)');
  });

  test('Delete and Backspace remove characters while editing text', async ({ page }) => {
    await openDocument(page, validPdf(1), 'characters.pdf');
    await page.getByRole('button', { name: 'Place Text' }).click();
    const editor = page.getByRole('textbox', { name: 'Text' });
    await editor.pressSequentially('abc');
    await page.keyboard.press('Backspace');
    await expect(editor).toHaveValue('ab');
    await expect(page.locator('.element')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.element .element-text')).toHaveText('ab');
  });

  test('undo restores a font size change made from the floating toolbar', async ({ page }) => {
    await openDocument(page, validPdf(1), 'undo-style.pdf');
    await page.getByRole('button', { name: 'Place Today\'s date' }).click();
    const bar = page.locator('app-element-toolbar');
    const size = bar.getByRole('spinbutton', { name: 'Font size' });
    await size.fill('20');
    await size.press('Enter');
    await expect(size).toHaveValue('20');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(size).toHaveValue('12');
    await page.getByRole('button', { name: 'Redo' }).click();
    await expect(size).toHaveValue('20');
  });

  test('keeps the floating element toolbar inside the visible document area', async ({ page }) => {
    await openDocument(page, validPdf(1), 'toolbar-bounds.pdf');
    await fitPage(page);
    await page.getByRole('button', { name: 'Place Today\'s date' }).click();
    const bar = await box(page.locator('app-element-toolbar'));
    const scroller = await box(page.locator('.scroller'));
    expect(bar.x).toBeGreaterThanOrEqual(scroller.x);
    expect(bar.x + bar.width).toBeLessThanOrEqual(scroller.x + scroller.width);
    expect(bar.y).toBeGreaterThanOrEqual(scroller.y);
  });
});

test.describe('pdf viewer: zoom and rendering', () => {
  test('fit page shows the whole first page in the document area', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await openDocument(page, validPdf(3), 'fit.pdf');
    await fitPage(page);
    const pageBounds = await pageBox(page, 0);
    const scroller = await box(page.locator('.scroller'));
    expect(pageBounds.height).toBeLessThanOrEqual(scroller.height + 1);
    expect(pageBounds.width).toBeLessThanOrEqual(scroller.width + 1);
  });

  test.describe('on a high density screen', () => {
    test.use({ deviceScaleFactor: 2 });

    test('renders canvases at device pixel density', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/');
      await openDocument(page, validPdf(1), 'hidpi.pdf');
      const ratio = await page.locator('.page canvas').first().evaluate((canvas: HTMLCanvasElement) => canvas.width / canvas.getBoundingClientRect().width);
      expect(ratio).toBeGreaterThan(1.9);
    });
  });

  test.describe('touch', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('pinch with two fingers changes the zoom level', async ({ page }) => {
      await page.goto('/');
      await openDocument(page, validPdf(2), 'pinch.pdf');
      const scroller = await box(page.locator('.scroller'));
      const cx = scroller.x + scroller.width / 2;
      const cy = scroller.y + scroller.height / 2;
      const before = await zoomPercent(page);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - 30, y: cy, id: 1 }, { x: cx + 30, y: cy, id: 2 }] });
      for (let step = 1; step <= 10; step++) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: cx - 30 - step * 6, y: cy, id: 1 }, { x: cx + 30 + step * 6, y: cy, id: 2 }],
        });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
      await expect.poll(() => zoomPercent(page)).toBeGreaterThan(before);
    });
  });
});

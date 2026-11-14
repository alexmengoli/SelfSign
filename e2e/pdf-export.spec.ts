import { readFile } from 'node:fs/promises';
import { type Download, expect, type Locator, type Page, type Request, test } from '@playwright/test';
import { buildPdf, validPdf } from './support/pdf-fixtures';
import { readPdf } from './support/pdf-reader';
import { rgbaPng } from './support/png-fixtures';
import { mockSavedValues } from './support/saved-values';

const EXPORT_FAILED = 'Export failed. Your document was not changed.';
/** Left half opaque blue, right half fully transparent black: lost transparency would turn it black. */
const halfTransparentPng = rgbaPng(80, 40, (x) => (x < 40 ? [0, 0, 255, 255] : [0, 0, 0, 0]));

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface InkStats {
  box: [number, number, number, number] | null;
  count: number;
  color: [number, number, number];
}

interface Comparison {
  mean: number;
  before: InkStats;
  after: InkStats;
}

function toolbar(page: Page): Locator {
  return page.getByRole('toolbar', { name: 'Document' });
}

function exportButton(page: Page): Locator {
  return toolbar(page).getByRole('button', { name: /^Export/ });
}

async function openDocument(page: Page, bytes: Buffer, name: string): Promise<void> {
  await page.locator('app-drop-zone input[type="file"]').setInputFiles({ name, mimeType: 'application/pdf', buffer: bytes });
  await expect(toolbar(page)).toBeVisible();
  await expect.poll(() => page.locator('.page canvas').first().evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeGreaterThan(0);
}

async function fitPage(page: Page): Promise<void> {
  await toolbar(page).getByRole('button', { name: 'Fit page' }).click();
  await expect(toolbar(page).getByRole('button', { name: 'Fit page' })).toHaveAttribute('aria-pressed', 'true');
}

async function exportDownload(page: Page): Promise<Download> {
  const download = page.waitForEvent('download');
  await exportButton(page).click();
  return download;
}

async function downloadBytes(download: Download): Promise<Buffer> {
  return readFile(await download.path());
}

async function box(locator: Locator): Promise<Box> {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error('Missing bounding box');
  return bounds;
}

function pageLocator(page: Page, index: number): Locator {
  return page.locator(`.page[data-page-index="${index}"]`);
}

/** Waits until the page canvas shows the page text, so screenshots include rendered content. */
async function waitForPageRender(page: Page, index: number): Promise<void> {
  const canvas = pageLocator(page, index).locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => {
    if (!element.width) return false;
    const data = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data;
    for (let index = 0; index < data.length; index += 4) if (data[index]! < 128) return true;
    return false;
  })).toBe(true);
}

async function pageShot(page: Page, index: number): Promise<Buffer> {
  await waitForPageRender(page, index);
  return pageLocator(page, index).screenshot({ animations: 'disabled' });
}

/** Element bounds relative to its page, grown by a margin for antialiasing. */
async function regionOf(page: Page, element: Locator, pageIndex: number, margin = 6): Promise<Box> {
  const bounds = await box(element);
  const pageBounds = await box(pageLocator(page, pageIndex));
  return {
    x: Math.max(0, Math.floor(bounds.x - pageBounds.x - margin)),
    y: Math.max(0, Math.floor(bounds.y - pageBounds.y - margin)),
    width: Math.ceil(bounds.width + margin * 2),
    height: Math.ceil(bounds.height + margin * 2),
  };
}

async function compareShots(page: Page, before: Buffer, after: Buffer, region: Box): Promise<Comparison> {
  return page.evaluate(async ({ before, after, region }) => {
    const decode = async (base64: string) => {
      // fetch() of a data: URL is blocked by the app's connect-src CSP.
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height);
    };
    const [a, b] = await Promise.all([decode(before), decode(after)]);
    const right = Math.min(a.width, b.width, region.x + region.width);
    const bottom = Math.min(a.height, b.height, region.y + region.height);
    const stats = (image: ImageData) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, count = 0;
      const sum = [0, 0, 0];
      for (let y = region.y; y < bottom; y++) {
        for (let x = region.x; x < right; x++) {
          const k = (y * image.width + x) * 4;
          const [r, g, bl] = [image.data[k]!, image.data[k + 1]!, image.data[k + 2]!];
          if (765 - (r + g + bl) < 200) continue;
          count++;
          sum[0] += r;
          sum[1] += g;
          sum[2] += bl;
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
      }
      return {
        box: count ? [x0, y0, x1, y1] : null,
        count,
        color: sum.map((value) => (count ? value / count : 255)),
      };
    };
    let total = 0;
    let pixels = 0;
    for (let y = region.y; y < bottom; y++) {
      for (let x = region.x; x < right; x++) {
        const ka = (y * a.width + x) * 4;
        const kb = (y * b.width + x) * 4;
        for (let channel = 0; channel < 3; channel++) total += Math.abs(a.data[ka + channel]! - b.data[kb + channel]!);
        pixels++;
      }
    }
    return { mean: total / Math.max(1, pixels * 3), before: stats(a), after: stats(b) } as Comparison;
  }, { before: before.toString('base64'), after: after.toString('base64'), region });
}

function expectSameInk(comparison: Comparison, label: string): void {
  const { before, after } = comparison;
  expect(before.box, `${label}: nothing drawn on screen`).not.toBeNull();
  expect(after.box, `${label}: nothing drawn in the export`).not.toBeNull();
  for (let edge = 0; edge < 4; edge++) {
    expect(Math.abs(after.box![edge]! - before.box![edge]!), `${label}: ink edge ${edge}`).toBeLessThanOrEqual(3);
  }
  expect(after.count / before.count, `${label}: ink amount`).toBeGreaterThan(0.6);
  expect(after.count / before.count, `${label}: ink amount`).toBeLessThan(1.6);
  for (let channel = 0; channel < 3; channel++) {
    expect(Math.abs(after.color[channel]! - before.color[channel]!), `${label}: ink color`).toBeLessThanOrEqual(40);
  }
  expect(comparison.mean, `${label}: mean difference`).toBeLessThan(20);
}

async function deselect(page: Page): Promise<void> {
  await pageLocator(page, 0).scrollIntoViewIfNeeded();
  const pageBounds = await box(pageLocator(page, 0));
  await page.mouse.click(pageBounds.x + 8, pageBounds.y + 8);
  await expect(page.locator('.element.selected')).toHaveCount(0);
}

async function reopen(page: Page, bytes: Buffer, name: string): Promise<void> {
  await toolbar(page).getByRole('button', { name: 'Close document' }).click();
  const dialog = page.getByRole('dialog');
  if (await dialog.count()) await dialog.getByRole('button', { name: 'Discard' }).click();
  await openDocument(page, bytes, name);
}

async function nudge(page: Page, key: string, times: number): Promise<void> {
  for (let step = 0; step < times; step++) await page.keyboard.press(`Shift+${key}`);
}

test.describe('pdf export', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('enables Export only with placed fields, shows progress and exports once on double click', async ({ page }) => {
    await page.goto('/');
    let releaseLibrary: () => void = () => undefined;
    const libraryHeld = new Promise<void>((resolve) => (releaseLibrary = resolve));
    // Holds the pdf-lib chunk that is preloaded when the document opens, so the export stays in progress.
    await page.route('**/*.js', async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      if (body.includes('registerFontkit')) await libraryHeld;
      await route.fulfill({ response, body });
    });
    await openDocument(page, validPdf(1), 'Scan.PDF');
    const button = exportButton(page);
    await expect(button).toHaveText('Export');
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await button.hover();
    await expect(page.locator('.mat-mdc-tooltip')).toHaveText('Place at least one field to export');

    await page.getByRole('button', { name: 'Place Today\'s date' }).click();
    await expect(button).toBeEnabled();

    const downloads: Download[] = [];
    page.on('download', (download) => downloads.push(download));

    await button.dblclick();
    await expect(button).toHaveText('Exporting…');
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button.locator('mat-progress-spinner')).toBeVisible();
    await button.click({ force: true });
    releaseLibrary();

    await expect.poll(() => downloads.length).toBe(1);
    await expect(button).toHaveText('Export');
    await expect(button).toBeEnabled();
    await page.waitForTimeout(500);
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.suggestedFilename()).toBe('Scan-signed.pdf');
  });

  test('treats a successful export as saved until the next edit', async ({ page }) => {
    await page.goto('/');
    await openDocument(page, validPdf(1), 'saved-state.pdf');
    await page.getByRole('button', { name: 'Place Text' }).click();
    await page.getByRole('textbox', { name: 'Text' }).pressSequentially('Saved');
    await page.keyboard.press('Escape');

    await downloadBytes(await exportDownload(page));
    await toolbar(page).getByRole('button', { name: 'Close document' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Drop a PDF here or click to browse' })).toBeVisible();

    await openDocument(page, validPdf(1), 'edited-state.pdf');
    await page.getByRole('button', { name: 'Place Text' }).click();
    await page.getByRole('textbox', { name: 'Text' }).pressSequentially('Before export');
    await page.keyboard.press('Escape');
    await downloadBytes(await exportDownload(page));
    await page.locator('.element').dblclick();
    await page.getByRole('textbox', { name: 'Text' }).press('End');
    await page.getByRole('textbox', { name: 'Text' }).pressSequentially(' again');
    await page.keyboard.press('Escape');
    await toolbar(page).getByRole('button', { name: 'Close document' }).click();
    await expect(page.getByRole('dialog', { name: 'Discard changes and close this document?' })).toBeVisible();
  });

  test('flattens text and images exactly where they are shown, on normal and rotated cropped pages', async ({ page }) => {
    await mockSavedValues(page, [{ id: 'mark', kind: 'image', label: 'Mark', imageId: 'mark', mimeType: 'image/png' }], halfTransparentPng);
    const pending = new Set<Request>();
    const fontRequests: string[] = [];
    page.on('request', (request) => {
      pending.add(request);
      if (request.url().includes('/fonts/')) fontRequests.push(request.url());
    });
    page.on('requestfinished', (request) => pending.delete(request));
    page.on('requestfailed', (request) => pending.delete(request));
    await page.goto('/');
    const original = buildPdf([
      { text: 'Plain page' },
      { text: 'Turned page', rotate: 90, mediaBox: [20, 40, 632, 832], cropBox: [60, 100, 560, 760] },
    ]);
    await openDocument(page, original, 'layout.pdf');
    await fitPage(page);

    await page.getByRole('button', { name: 'Place Text' }).click();
    const editor = page.getByRole('textbox', { name: 'Text' });
    await editor.pressSequentially('Signed àèéìòù');
    await page.keyboard.press('Enter');
    await editor.pressSequentially('Second line 0123456789');
    await page.keyboard.press('Escape');
    await nudge(page, 'ArrowUp', 10);
    const bar = page.locator('app-element-toolbar');
    await bar.getByRole('combobox', { name: 'Font' }).selectOption('Noto Serif');

    await page.getByRole('button', { name: 'Place Mark' }).click();
    const image = page.locator('.element').filter({ has: page.locator('img') });
    await expect(image.locator('img')).toBeVisible();
    await nudge(page, 'ArrowDown', 10);

    await toolbar(page).getByRole('button', { name: 'Next page' }).click();
    await expect(toolbar(page).getByRole('textbox', { name: 'Page number' })).toHaveValue('2');
    await page.getByRole('button', { name: 'Place Today\'s date' }).click();
    const date = page.locator('.element[data-page-index="1"]');
    await expect(date).toBeVisible();
    await bar.getByRole('spinbutton', { name: 'Font size' }).fill('28');
    await bar.getByRole('spinbutton', { name: 'Font size' }).press('Enter');
    await bar.getByRole('combobox', { name: 'Font' }).selectOption('Caveat');
    await bar.getByLabel('Color').fill('#c00000');
    const dateBox = await box(date);
    const rotateHandle = await box(date.locator('.handle-rotate'));
    const origin = { x: dateBox.x + dateBox.width / 2, y: dateBox.y + dateBox.height / 2 };
    const radians = (30 * Math.PI) / 180;
    await page.mouse.move(rotateHandle.x + rotateHandle.width / 2, rotateHandle.y + rotateHandle.height / 2);
    await page.mouse.down();
    await page.keyboard.down('Shift');
    await page.mouse.move(origin.x + 160 * Math.sin(radians), origin.y - 160 * Math.cos(radians), { steps: 10 });
    await page.keyboard.up('Shift');
    await page.mouse.up();
    await expect(date).toHaveCSS('transform', /matrix/);
    const dateText = (await date.locator('.element-text').textContent())!;

    await deselect(page);
    const text = page.locator('.element[data-page-index="0"]').filter({ has: page.locator('.element-text') });
    const regions = {
      text: await regionOf(page, text, 0),
      image: await regionOf(page, image, 0),
      date: await regionOf(page, date, 1),
    };
    const imageBounds = await box(image);
    const pageBounds = await box(pageLocator(page, 0));
    const transparentPoint = {
      x: Math.round(imageBounds.x - pageBounds.x + imageBounds.width * 0.75),
      y: Math.round(imageBounds.y - pageBounds.y + imageBounds.height / 2),
    };
    const before = [await pageShot(page, 0), await pageShot(page, 1)];

    // The export code is preloaded when the document opens; wait until nothing is loading.
    await expect.poll(() => pending.size).toBe(0);
    const exportRequests: string[] = [];
    const recordExportRequest = (request: Request) => {
      if (/^https?:/.test(request.url())) exportRequests.push(`${request.method()} ${request.url()}`);
    };
    page.on('request', recordExportRequest);
    const download = await exportDownload(page);
    expect(download.suggestedFilename()).toBe('layout-signed.pdf');
    const exported = await downloadBytes(download);
    page.off('request', recordExportRequest);
    expect(exportRequests).toEqual([]);

    const summary = await readPdf(exported);
    expect(summary.pages[0]!.text).toContain('Signed àèéìòù');
    expect(summary.pages[0]!.text).toContain('Second line 0123456789');
    expect(summary.pages[1]!.text).toContain(dateText);
    const imageDictionaries = exported.toString('latin1').match(/<<[^<>]*\/Subtype \/Image[^<>]*>>/g) ?? [];
    const placedImage = imageDictionaries.find((dictionary) => dictionary.includes('/SMask'));
    expect(placedImage, 'image keeps its pixel size and alpha mask').toMatch(/\/Width 80\b/);
    expect(placedImage).toMatch(/\/Height 40\b/);

    await reopen(page, exported, 'layout-signed.pdf');
    await fitPage(page);
    await expect(page.locator('.element')).toHaveCount(0);
    const after = [await pageShot(page, 0), await pageShot(page, 1)];

    expectSameInk(await compareShots(page, before[0]!, after[0]!, regions.text), 'multi-line text');
    expectSameInk(await compareShots(page, before[0]!, after[0]!, regions.image), 'image');
    expectSameInk(await compareShots(page, before[1]!, after[1]!, regions.date), 'rotated colored text on rotated cropped page');
    const transparent = await compareShots(page, before[0]!, after[0]!, { ...transparentPoint, width: 3, height: 3 });
    expect(transparent.before.count, 'transparent image area shows the page on screen').toBe(0);
    expect(transparent.after.count, 'transparent image area keeps the page visible').toBe(0);
    const fontUrls = fontRequests.map((url) => new URL(url).pathname).sort();
    expect(fontUrls, 'preview and export share one download per font').toEqual([
      '/fonts/Caveat-Regular.ttf',
      '/fonts/NotoSans-Regular.ttf',
      '/fonts/NotoSerif-Regular.ttf',
    ]);
  });

  test('keeps pages, content, form fields, annotations, rotation and metadata', async ({ page }) => {
    await page.goto('/');
    const original = buildPdf(
      [{ text: 'Page 1' }, { text: 'Page 2', rotate: 270 }, { text: 'Page 3', width: 842, height: 595 }],
      { title: 'Service agreement', formField: 'customer', link: 'https://example.com/terms' },
    );
    await openDocument(page, original, 'contract.pdf');
    await page.getByRole('button', { name: 'Place Today\'s date' }).click();
    const download = await exportDownload(page);
    expect(download.suggestedFilename()).toBe('contract-signed.pdf');

    const before = await readPdf(original);
    const after = await readPdf(await downloadBytes(download));
    expect(after.pageCount).toBe(3);
    expect(after.title).toBe('Service agreement');
    expect(after.fields).toEqual(before.fields);
    expect(after.fields).toEqual(['customer']);
    after.pages.forEach((exportedPage, index) => {
      const originalPage = before.pages[index]!;
      expect(exportedPage.text).toContain(`Page ${index + 1}`);
      expect(exportedPage.rotate).toBe(originalPage.rotate);
      expect(exportedPage.view).toEqual(originalPage.view);
      expect(exportedPage.annotations).toEqual(originalPage.annotations);
    });
    expect([...after.pages[0]!.annotations].sort()).toEqual(['Link', 'Widget']);
  });

  test('reports a failed export without changing anything and exports again after editing', async ({ page }) => {
    // Fonts that could not be downloaded at startup make the export fail until they are available.
    await page.route('**/fonts/*.ttf', (route) => route.abort());
    await page.goto('/');
    await openDocument(page, validPdf(1), 'retry.pdf');
    await page.getByRole('button', { name: 'Place Text' }).click();
    await page.getByRole('textbox', { name: 'Text' }).pressSequentially('Keep me');
    await page.keyboard.press('Escape');
    const element = page.locator('.element');
    const before = await box(element);

    await exportButton(page).click();
    await expect(page.locator('mat-snack-bar-container')).toContainText(EXPORT_FAILED);
    await expect(element).toHaveCount(1);
    await expect(element.locator('.element-text')).toHaveText('Keep me');
    expect(await box(element)).toEqual(before);
    await expect(toolbar(page).getByRole('button', { name: 'Undo' })).toBeEnabled();
    await expect(exportButton(page)).toBeEnabled();

    await toolbar(page).getByRole('button', { name: 'Close document' }).click();
    await expect(page.getByRole('dialog', { name: 'Discard changes and close this document?' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Discard changes and close this document?' }).getByRole('button', { name: 'Cancel' }).click();

    await page.unroute('**/fonts/*.ttf');
    const first = await readPdf(await downloadBytes(await exportDownload(page)));
    expect(first.pages[0]!.text).toContain('Keep me');
    await expect(element).toHaveCount(1);

    await element.dblclick();
    const editor = page.getByRole('textbox', { name: 'Text' });
    await editor.press('End');
    await editor.pressSequentially(' again');
    await page.keyboard.press('Escape');
    const second = await readPdf(await downloadBytes(await exportDownload(page)));
    expect(second.pages[0]!.text).toContain('Keep me again');
  });
});

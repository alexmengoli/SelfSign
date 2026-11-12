import { expect, type Locator, type Page, test } from '@playwright/test';
import { buildPdf, pagesOf } from './support/pdf-fixtures';
import { solidPng } from './support/png-fixtures';
import { mockSavedValues } from './support/saved-values';

const DROP_ZONE = 'Drop a PDF here or click to browse';

function fileInput(page: Page): Locator {
  return page.locator('app-drop-zone input[type="file"]');
}

function toolbar(page: Page): Locator {
  return page.getByRole('toolbar', { name: 'Document' });
}

test.describe('pdf viewer: privacy', () => {
  test('sends no PDF bytes and no external requests while opening, navigating, placing, editing and closing', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const origin = new URL(baseURL ?? '').origin;
    const label = 'Privacy image';
    await mockSavedValues(page, [{ id: 'privacy-image', kind: 'image', label, imageId: 'privacy-image', mimeType: 'image/png' }], solidPng(20, 10, [255, 0, 0]));

    const requests: { url: string; method: string; body: Buffer | null }[] = [];
    page.on('request', (outgoing) => requests.push({ url: outgoing.url(), method: outgoing.method(), body: outgoing.postDataBuffer() }));
    await page.goto('/');
    const bytes = buildPdf(pagesOf(3, 'Confidential page'));
    await fileInput(page).setInputFiles({ name: 'private.pdf', mimeType: 'application/pdf', buffer: bytes });
    await expect(toolbar(page)).toBeVisible();
    await expect.poll(() => page.locator('.page canvas').first().evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeGreaterThan(0);

    await toolbar(page).getByRole('button', { name: 'Next page' }).click();
    await page.getByRole('button', { name: 'Place Today\'s date' }).click();
    await page.getByRole('button', { name: `Place ${label}` }).click();
    await page.getByRole('button', { name: 'Place Text' }).click();
    await page.getByRole('textbox', { name: 'Text' }).fill('Private text');
    await page.keyboard.press('Escape');
    await toolbar(page).getByRole('button', { name: 'Zoom in' }).click();
    await toolbar(page).getByRole('button', { name: 'Close document' }).click();
    await page.getByRole('dialog', { name: 'Discard changes and close this document?' }).getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByRole('button', { name: DROP_ZONE })).toBeVisible();

    const external = requests.filter((outgoing) => !outgoing.url.startsWith(origin) && !outgoing.url.startsWith('data:') && !outgoing.url.startsWith('blob:'));
    expect(external).toEqual([]);
    const fingerprint = bytes.subarray(0, 96);
    const pdfHeader = Buffer.from('%PDF-');
    for (const outgoing of requests) {
      const body = outgoing.body ?? Buffer.alloc(0);
      expect(body.includes(pdfHeader)).toBe(false);
      expect(body.includes(fingerprint)).toBe(false);
      if (outgoing.method !== 'GET') expect(outgoing.url).toMatch(/\/api\/(values|settings)/);
    }
  });
});

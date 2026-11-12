import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { validPdf } from './support/pdf-fixtures';

/** The worker file the e2e server serves, so the route below wraps exactly the bytes pdf.js would load. */
const WORKER_FILE = fileURLToPath(new URL('../apps/web/dist/browser/pdf.worker.min.mjs', import.meta.url));

function fileInput(page: Page): Locator {
  return page.locator('app-drop-zone input[type="file"]');
}

test.describe('pdf viewer: runtime compatibility', () => {
  test('opens a PDF when Uint8Array.prototype.toHex is missing in the worker', async ({ page }) => {
    // pdf.js fingerprints every document with Uint8Array.prototype.toHex, which Chromium ships from 140,
    // Firefox from 133, Safari from 18.2 and Node from 25. The worker has its own realm, so the route removes
    // the method there before pdf.js runs, as an older runtime would present it.
    const workerSource = readFileSync(WORKER_FILE, 'utf8');
    let workerRequests = 0;
    await page.route('**/pdf.worker.min.mjs', (route) => {
      workerRequests++;
      return route.fulfill({ contentType: 'text/javascript', body: `delete Uint8Array.prototype.toHex;\n${workerSource}` });
    });

    await page.goto('/');
    await fileInput(page).setInputFiles({ name: 'compat.pdf', mimeType: 'application/pdf', buffer: validPdf() });

    await expect(page.getByRole('toolbar', { name: 'Document' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(workerRequests).toBeGreaterThan(0);
  });
});

import type { Page } from '@playwright/test';

export interface SavedValueFixture {
  id: string;
  kind: 'text' | 'image';
  label: string;
  text?: string;
  imageId?: string;
  mimeType?: string;
}

/**
 * Serves saved values and image bytes from the browser, so viewer tests never share server data
 * with the field-library specs that reset every saved value.
 */
export async function mockSavedValues(page: Page, values: SavedValueFixture[], imageBytes?: Buffer): Promise<void> {
  await page.route('**/api/values', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ json: values });
    else await route.continue();
  });
  if (imageBytes) {
    await page.route('**/api/images/**', (route) => route.fulfill({ body: imageBytes, contentType: 'image/png' }));
  }
}

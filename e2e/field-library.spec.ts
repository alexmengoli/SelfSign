import { expect, test } from '@playwright/test';

const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/YioAAAAASUVORK5CYII=',
  'base64',
);

async function addTextValue(page: import('@playwright/test').Page, label: string, value: string): Promise<void> {
  await page.getByRole('button', { name: 'Add text' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add value' });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Label is required.')).toBeVisible();
  await expect(dialog.getByText('Value is required.')).toBeVisible();
  await dialog.getByLabel('Label').fill(label);
  await dialog.getByLabel('Value').fill(value);
  await dialog.getByRole('button', { name: 'Save' }).click();
  const row = page.locator('app-item-row', { has: page.getByRole('button', { name: `Edit ${label}` }) });
  await expect(row.locator('.saved-preview')).toHaveText(value);
  await expect(row.locator('.saved-preview')).not.toContainText(label);
  for (const action of ['Move', 'Place', 'Edit', 'Delete']) {
    const button = row.getByRole('button', { name: `${action} ${label}` });
    await expect(button).toHaveText('');
    await expect(button.locator('svg')).toBeAttached();
    const icon = await button.locator('svg').boundingBox();
    const box = await button.boundingBox();
    if (!icon || !box) throw new Error(`Missing ${action} icon geometry`);
    expect(icon.width).toBeCloseTo(18, 1);
    expect(icon.height).toBeCloseTo(18, 1);
    expect(icon.x + icon.width / 2).toBeCloseTo(box.x + box.width / 2, 0);
    expect(icon.y + icon.height / 2).toBeCloseTo(box.y + box.height / 2, 0);
  }
}

test.describe('field library', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ request }) => {
    const response = await request.get('/api/values');
    const values = await response.json() as { id: string }[];
    for (const value of values) await request.delete(`/api/values/${value.id}`);
    await request.put('/api/settings', { data: { dateFormat: 'dd/MM/yyyy' } });
  });

  test('manages text values, date settings, and persisted ordering', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    await expect(page.locator('section h3')).toHaveText(['Text', 'Images']);
    const layout = await page.evaluate(() => {
      const rect = (element: Element | null) => {
        if (!element) throw new Error('Missing element');
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
      };
      const rows = [...document.querySelectorAll('app-item-row')];
      const freeTextRow = rows.find((row) => row.querySelector('.item-text'));
      const dateRow = rows.find((row) => row.querySelector('.date-value'));
      if (!freeTextRow || !dateRow) throw new Error('Missing text rows');
      return {
        slotX: rows.map((row) => [...row.querySelectorAll(':scope > .slot')].map((slot) => rect(slot).x)),
        freeTextLabel: rect(freeTextRow.querySelector('.item-text')),
        dateValue: rect(dateRow.querySelector('.date-value')),
        dateRow: rect(dateRow),
        formatButton: rect(dateRow.querySelector('[aria-label="Change date format"]')),
      };
    });
    for (const slots of layout.slotX) expect(slots).toEqual(layout.slotX[0]);
    expect(layout.dateValue.x).toBeCloseTo(layout.freeTextLabel.x, 0);
    expect(layout.dateValue.y + layout.dateValue.height / 2).toBeCloseTo(layout.dateRow.y + layout.dateRow.height / 2, 0);
    expect(layout.formatButton.y + layout.formatButton.height / 2).toBeCloseTo(layout.dateRow.y + layout.dateRow.height / 2, 0);
    const iconSizes = await page.evaluate(() => [...document.querySelectorAll('app-item-row mat-icon svg')].map((svg) => {
      const box = svg.getBoundingClientRect();
      return [box.width, box.height];
    }));
    expect(iconSizes.length).toBeGreaterThan(0);
    for (const [width, height] of iconSizes) {
      expect(width).toBeCloseTo(18, 1);
      expect(height).toBeCloseTo(18, 1);
    }
    await expect(page.getByRole('button', { name: 'Change date format' }).locator('mat-icon')).toHaveAttribute('data-mat-icon-name', 'swap-format');
    await expect(page.getByRole('button', { name: 'Move Text' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Place Text' })).toBeDisabled();
    await page.locator('app-item-row', { has: page.locator('.item-text') }).locator('.placement-wrap').first().hover();
    await expect(page.locator('.mat-mdc-tooltip')).toHaveText('Open a PDF to place fields');

    const firstLabel = `Tax code ${Date.now()}`;
    const secondLabel = `Address ${Date.now()}`;
    await addTextValue(page, firstLabel, 'RSSMRA80A01H501U');
    await addTextValue(page, secondLabel, 'Main Street\nSuite 2');

    await page.getByRole('button', { name: `Edit ${firstLabel}` }).click();
    const edit = page.getByRole('dialog', { name: 'Edit value' });
    await edit.getByLabel('Label').fill(`${firstLabel} updated`);
    await edit.getByLabel('Value').fill('Updated text');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: `Edit ${firstLabel} updated` })).toBeVisible();

    const cycleDateFormat = page.getByRole('button', { name: 'Change date format' });
    const dateParts = await page.evaluate(() => {
      const today = new Date();
      return {
        day: String(today.getDate()).padStart(2, '0'),
        month: String(today.getMonth() + 1).padStart(2, '0'),
        year: String(today.getFullYear()).padStart(4, '0'),
      };
    });
    const previews = [
      `${dateParts.day}/${dateParts.month}/${dateParts.year}`,
      `${dateParts.month}/${dateParts.day}/${dateParts.year}`,
      `${dateParts.year}-${dateParts.month}-${dateParts.day}`,
      `${dateParts.day}.${dateParts.month}.${dateParts.year}`,
    ];
    await expect(page.locator('.date-value')).toHaveText(previews[0]!);
    await expect(page.getByText("Today's date", { exact: true })).toHaveCount(0);
    for (let index = 1; index <= 4; index++) {
      await cycleDateFormat.click();
      await expect(page.locator('.date-value')).toHaveText(previews[index % previews.length]!);
      const settings = await (await page.request.get('/api/settings')).json();
      expect(settings.dateFormat).toBe(['MM/dd/yyyy', 'yyyy-MM-dd', 'dd.MM.yyyy', 'dd/MM/yyyy'][index - 1]);
    }
    await page.reload();
    await expect(page.locator('.date-value')).toHaveText(previews[0]!);
    await expect(page.getByRole('button', { name: 'Change date format' })).toBeVisible();

    const rows = page.locator('[aria-label="Saved text values"] app-item-row');
    const before = await rows.locator('.saved-preview').allTextContents();
    const moving = page.getByRole('button', { name: `Move ${secondLabel}` });
    const sourceBox = await moving.boundingBox();
    const targetBox = await rows.first().boundingBox();
    if (!sourceBox || !targetBox) throw new Error('Missing reorder handles');
    const sourceX = sourceBox.x + sourceBox.width / 2;
    const sourceY = sourceBox.y + sourceBox.height / 2;
    await page.mouse.move(sourceX, sourceY);
    await page.mouse.down();
    await page.mouse.move(sourceX + 8, sourceY + 8, { steps: 2 });
    await page.mouse.move(sourceX + 8, targetBox.y + targetBox.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect.poll(async () => page.locator('[aria-label="Saved text values"] .saved-preview').allTextContents()).not.toEqual(before);
    const after = await page.locator('[aria-label="Saved text values"] .saved-preview').allTextContents();
    await page.reload();
    await expect.poll(async () => page.locator('[aria-label="Saved text values"] .saved-preview').allTextContents()).toEqual(after);

    await page.getByRole('button', { name: `Delete ${firstLabel} updated` }).click();
    const confirm = page.getByRole('dialog', { name: `Delete "${firstLabel} updated"?` });
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: `Edit ${firstLabel} updated` })).toBeVisible();
    await page.getByRole('button', { name: `Delete ${firstLabel} updated` }).click();
    await page.getByRole('dialog', { name: `Delete "${firstLabel} updated"?` }).getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('button', { name: `Edit ${firstLabel} updated` })).toHaveCount(0);
    await page.getByRole('button', { name: `Delete ${secondLabel}` }).click();
    await page.getByRole('dialog', { name: `Delete "${secondLabel}"?` }).getByRole('button', { name: 'Delete' }).click();
  });

  test('stores PNG image content and rejects bytes that only claim to be PNG', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const label = `Signature ${Date.now()}`;
    await page.getByRole('button', { name: 'Add image' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add value' });
    await dialog.getByLabel('Label').fill(label);
    await dialog.locator('input[type="file"]').setInputFiles({ name: 'signature.png', mimeType: 'image/png', buffer: transparentPng });
    await dialog.getByRole('button', { name: 'Save' }).click();

    const thumbnail = page.getByRole('img', { name: label });
    await expect(thumbnail).toBeVisible();
    const alignment = await page.evaluate((imageLabel) => {
      const rect = (element: Element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x, width: box.width, centerX: box.x + box.width / 2, centerY: box.y + box.height / 2 };
      };
      const rows = [...document.querySelectorAll('app-item-row')];
      const imageRow = rows.find((row) => row.querySelector(`img[alt="${imageLabel}"]`));
      const freeTextRow = rows.find((row) => row.querySelector('.item-text'));
      const thumbnail = imageRow?.querySelector('img.thumbnail');
      const freeTextLabel = freeTextRow?.querySelector('.item-text');
      if (!imageRow || !freeTextRow || !thumbnail || !freeTextLabel) throw new Error('Missing rows');
      const slots = (row: Element) => [...row.querySelectorAll(':scope > .slot')];
      const rowBox = imageRow.getBoundingClientRect();
      return {
        imageColumns: slots(imageRow).map((slot) => rect(slot)),
        textColumns: slots(freeTextRow).map((slot) => rect(slot)),
        thumbnailX: rect(thumbnail).x,
        textX: rect(freeTextLabel).x,
        rowCenterY: rowBox.y + rowBox.height / 2,
        controls: slots(imageRow).map((slot) => {
          const button = slot.querySelector('button');
          return button ? rect(button) : null;
        }),
      };
    }, label);
    expect(alignment.thumbnailX).toBeCloseTo(alignment.textX, 0);
    alignment.imageColumns.forEach((column, index) => {
      expect(column.x).toBeCloseTo(alignment.textColumns[index]!.x, 0);
      expect(column.width).toBeCloseTo(alignment.textColumns[index]!.width, 0);
      const control = alignment.controls[index];
      if (!control) return;
      expect(control.centerY).toBeCloseTo(alignment.rowCenterY, 0);
      expect(control.centerX).toBeCloseTo(column.centerX, 0);
    });
    await expect.poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
    const values = await page.request.get('/api/values');
    const saved = (await values.json()).find((value: { label: string }) => value.label === label);
    expect(saved).toMatchObject({ kind: 'image', mimeType: 'image/png' });
    const imageResponse = await page.request.get(`/api/images/${saved.imageId}`);
    expect(imageResponse.headers()['content-type']).toContain('image/png');
    expect(await imageResponse.body()).toEqual(transparentPng);

    await page.getByRole('button', { name: `Delete ${label}` }).click();
    await page.getByRole('dialog', { name: `Delete "${label}"?` }).getByRole('button', { name: 'Delete' }).click();

    await page.getByRole('button', { name: 'Add image' }).click();
    const invalidDialog = page.getByRole('dialog', { name: 'Add value' });
    await invalidDialog.getByLabel('Label').fill(`${label} invalid`);
    await invalidDialog.locator('input[type="file"]').setInputFiles({ name: 'renamed.png', mimeType: 'image/png', buffer: Buffer.from('not PNG') });
    await invalidDialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.mat-mdc-snack-bar-label.mdc-snackbar__label')).toHaveText('Only PNG and JPEG images are supported.');
    await invalidDialog.getByRole('button', { name: 'Cancel' }).click();
  });

  test('keeps management available in the mobile Fields sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Fields', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Fields' });
    await expect(sheet.locator('section h3')).toHaveText(['Text', 'Images']);
    const layout = await sheet.evaluate((element) => {
      const rect = (target: Element | null) => {
        if (!target) throw new Error('Missing element');
        const box = target.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
      };
      const rows = [...element.querySelectorAll('app-item-row')];
      const freeTextRow = rows.find((row) => row.querySelector('.item-text'));
      const dateRow = rows.find((row) => row.querySelector('.date-value'));
      if (!freeTextRow || !dateRow) throw new Error('Missing text rows');
      return {
        slotX: rows.map((row) => [...row.querySelectorAll(':scope > .slot')].map((slot) => rect(slot).x)),
        freeTextLabel: rect(freeTextRow.querySelector('.item-text')),
        dateValue: rect(dateRow.querySelector('.date-value')),
        dateRow: rect(dateRow),
        formatButton: rect(dateRow.querySelector('[aria-label="Change date format"]')),
        width: element.scrollWidth,
        clientWidth: element.clientWidth,
      };
    });
    for (const slots of layout.slotX) expect(slots).toEqual(layout.slotX[0]);
    expect(layout.dateValue.x).toBeCloseTo(layout.freeTextLabel.x, 0);
    expect(layout.dateValue.y + layout.dateValue.height / 2).toBeCloseTo(layout.dateRow.y + layout.dateRow.height / 2, 0);
    expect(layout.formatButton.y + layout.formatButton.height / 2).toBeCloseTo(layout.dateRow.y + layout.dateRow.height / 2, 0);
    expect(layout.width).toBeLessThanOrEqual(layout.clientWidth);
    const label = `Mobile value ${Date.now()}`;
    await addTextValue(page, label, 'Available in the sheet');
    await expect(sheet.getByRole('button', { name: `Edit ${label}` })).toBeVisible();
    await page.getByRole('button', { name: `Delete ${label}` }).click();
    await page.getByRole('dialog', { name: `Delete "${label}"?` }).getByRole('button', { name: 'Delete' }).click();
    await expect(sheet.getByRole('button', { name: `Edit ${label}` })).toHaveCount(0);
  });

  test('shows API errors, preserves failed input, and retries loading values', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    let failReads = true;
    let failSaves = true;
    await page.route('**/api/values', async (route) => {
      if (route.request().method() === 'GET' && failReads) {
        await route.abort();
      } else if (route.request().method() === 'POST' && failSaves) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary save failure.' }) });
      } else {
        await route.continue();
      }
    });
    await page.goto('/');

    await expect(page.getByRole('alert')).toHaveCount(2);
    await expect(page.getByRole('alert').first()).toContainText('Could not load saved values.');
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(2);
    await expect(page.locator('.date-value')).toBeVisible();
    const label = `Recoverable ${Date.now()}`;
    await page.getByRole('button', { name: 'Add text' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add value' });
    await dialog.getByLabel('Label').fill(label);
    await dialog.getByLabel('Value').fill('Keep this input');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.mat-mdc-snack-bar-label.mdc-snackbar__label')).toHaveText('Temporary save failure.');
    await expect(dialog.getByLabel('Label')).toHaveValue(label);
    await expect(dialog.getByLabel('Value')).toHaveValue('Keep this input');

    failReads = false;
    failSaves = false;
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Retry' }).first().click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add text' }).click();
    const recoveredDialog = page.getByRole('dialog', { name: 'Add value' });
    await recoveredDialog.getByLabel('Label').fill(label);
    await recoveredDialog.getByLabel('Value').fill('Keep this input');
    await recoveredDialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: `Edit ${label}` })).toBeVisible();
  });
});

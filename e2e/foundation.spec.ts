import { expect, type Page, test } from '@playwright/test';

function relativeLuminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map((value) => {
    const channel = Number(value) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrastRatio(foreground: string, background: string): number {
  const [light, dark] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

async function bodyBackground(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

async function isDark(page: Page): Promise<boolean> {
  return relativeLuminance(await bodyBackground(page)) < 0.2;
}

/** Foreground and effective background colors of visible text elements. */
async function textColors(page: Page): Promise<{ text: string; color: string; background: string }[]> {
  return page.evaluate(() => {
    const effectiveBackground = (element: Element | null): string => {
      for (let node = element; node; node = node.parentElement) {
        const color = getComputedStyle(node).backgroundColor;
        if (color && color !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(color)) {
          return color;
        }
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    return [...document.querySelectorAll('.name, h2, p, button')]
      .filter((element) => (element as HTMLElement).offsetParent !== null && element.textContent?.trim())
      .map((element) => ({
        text: element.textContent?.trim() ?? '',
        color: getComputedStyle(element).color,
        background: effectiveBackground(element),
      }));
  });
}

test.describe('foundation', () => {
  test('serves the app with a self-only CSP and nosniff', async ({ request }) => {
    const response = await request.get('/');
    const csp = response.headers()['content-security-policy'] ?? '';

    expect(response.ok()).toBe(true);
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toMatch(/https?:|unsafe-inline/);
  });

  test('loads without external requests or CSP violations', async ({ page, baseURL }) => {
    const requests: string[] = [];
    const errors: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto('/');
    await expect(page.getByRole('banner')).toContainText('SelfSign');
    await page.evaluate(() => document.fonts.ready);

    const origin = new URL(baseURL ?? '').origin;
    expect(requests.filter((url) => !url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:'))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('UI is in English', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle('SelfSign');
    expect(await page.locator('html').getAttribute('lang')).toBe('en');
    await expect(page.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
    for (const name of ['System', 'Light', 'Dark']) {
      await expect(page.getByRole('radio', { name })).toBeVisible();
    }
    await expect(page.getByRole('complementary', { name: 'Fields' })).toBeVisible();
    await expect(page.getByRole('main')).toHaveText('Open a PDF to get started.');
  });

  test('System theme follows the OS preference live', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await expect(page.getByRole('radio', { name: 'System' })).toBeChecked();
    expect(await isDark(page)).toBe(false);

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => isDark(page)).toBe(true);

    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => isDark(page)).toBe(false);
  });

  test('explicit theme overrides the OS and persists after reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');

    await page.getByRole('radio', { name: 'Dark' }).click();
    await expect.poll(() => isDark(page)).toBe(true);

    await page.reload();
    await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(await isDark(page)).toBe(true);

    await page.getByRole('radio', { name: 'Light' }).click();
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Light' })).toBeChecked();
    expect(await isDark(page)).toBe(false);
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`${colorScheme} theme text meets WCAG AA contrast`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      for (const width of [1440, 360]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto('/');
        await expect(page.getByRole('banner')).toBeVisible();

        const colors = await textColors(page);
        expect(colors.length).toBeGreaterThan(0);
        for (const { text, color, background } of colors) {
          expect(contrastRatio(color, background), `"${text}" ${color} on ${background}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }

  test('desktop layout shows the sidebar on the left', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    const sidebar = page.getByRole('complementary', { name: 'Fields' });
    const main = page.getByRole('main');
    await expect(sidebar).toBeVisible();
    const sidebarBox = await sidebar.boundingBox();
    const mainBox = await main.boundingBox();
    expect(sidebarBox?.x).toBe(0);
    expect((mainBox?.x ?? 0) >= (sidebarBox?.width ?? 0)).toBe(true);
    expect((mainBox?.x ?? 0) + (mainBox?.width ?? 0)).toBeCloseTo(1440, 0);
    await expect(page.getByRole('button', { name: 'Fields' })).toHaveCount(0);
  });

  test('mobile layout uses a bottom sheet without horizontal page scroll', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/');

    await expect(page.getByRole('complementary', { name: 'Fields' })).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);

    await page.getByRole('button', { name: 'Fields' }).click();
    const sheet = page.getByRole('dialog', { name: 'Fields' });
    await expect(sheet).toBeVisible();
    await expect
      .poll(async () => {
        const box = await sheet.boundingBox();
        return Math.round((box?.y ?? 0) + (box?.height ?? 0));
      })
      .toBe(740);

    await page.setViewportSize({ width: 1024, height: 740 });
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole('complementary', { name: 'Fields' })).toBeVisible();
  });

  test('bundled fonts render accented Latin characters without fallback', async ({ page }) => {
    await page.goto('/');

    const missing = await page.evaluate(async () => {
      const families = ['Noto Sans', 'Noto Serif', 'Caveat'];
      const characters = [...'àèéìòùÀÈÉÌÒÙ'];
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('No canvas context');

      const draw = (font: string, character: string): string => {
        context.clearRect(0, 0, 64, 64);
        context.font = font;
        context.fillText(character, 8, 48);
        return Array.from(context.getImageData(0, 0, 64, 64).data).join(',');
      };

      const result: string[] = [];
      for (const family of families) {
        const loaded = await document.fonts.load(`32px "${family}"`, characters.join(''));
        if (loaded.length === 0) {
          result.push(`${family}: not loaded`);
          continue;
        }
        for (const character of characters) {
          // A glyph missing from the font would fall back to serif vs monospace and render differently.
          if (draw(`32px "${family}", serif`, character) !== draw(`32px "${family}", monospace`, character)) {
            result.push(`${family}: ${character}`);
          }
        }
      }
      return result;
    });

    expect(missing).toEqual([]);
  });
});

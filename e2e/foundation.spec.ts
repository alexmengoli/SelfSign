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

async function expectCenteredThemeIcons(page: Page): Promise<void> {
  const geometry = await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio').evaluateAll((buttons) =>
    buttons.map((button) => {
      const svg = button.querySelector('svg');
      const segment = button.closest('mat-button-toggle');
      if (!svg || !segment) throw new Error('Missing theme icon or segment');
      const buttonBox = button.getBoundingClientRect();
      const iconBox = svg.getBoundingClientRect();
      return {
        name: button.getAttribute('aria-label'),
        buttonHeight: buttonBox.height,
        buttonWidth: buttonBox.width,
        segmentWidth: segment.getBoundingClientRect().width,
        iconWidth: iconBox.width,
        iconHeight: iconBox.height,
        verticalOffset: Math.abs(iconBox.y + iconBox.height / 2 - buttonBox.y - buttonBox.height / 2),
      };
    }),
  );
  expect(geometry).toHaveLength(3);
  for (const icon of geometry) {
    expect(icon.buttonHeight, `${icon.name} button height`).toBe(36);
    expect(icon.buttonWidth, `${icon.name} button width`).toBe(40);
    expect(icon.segmentWidth, `${icon.name} segment width`).toBe(40);
    expect(icon.iconWidth, `${icon.name} icon width`).toBe(18);
    expect(icon.iconHeight, `${icon.name} icon height`).toBe(18);
    expect(icon.verticalOffset, `${icon.name} vertical offset`).toBeLessThanOrEqual(1);
  }
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
    for (const viewport of [{ width: 1440, height: 900 }, { width: 360, height: 740 }]) {
      test(`${colorScheme} theme icons stay centered at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme });
        await page.goto('/');
        await expectCenteredThemeIcons(page);

        for (const name of ['System', 'Light', 'Dark']) {
          const option = page.getByRole('radio', { name, exact: true });
          await option.hover();
          await expectCenteredThemeIcons(page);
          await option.click();
          await expect(option).toBeChecked();
          await expectCenteredThemeIcons(page);
        }

        await page.getByRole('radio', { name: 'System', exact: true }).click();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Shift+Tab');
        for (const name of ['System', 'Light', 'Dark']) {
          const option = page.getByRole('radio', { name, exact: true });
          await expect(option).toBeFocused();
          await expect(option).toBeChecked();
          await expectCenteredThemeIcons(page);
          await page.keyboard.press('ArrowRight');
        }
      });
    }

    test(`${colorScheme} theme selector uses accessible pill segments`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto('/');

      const group = page.getByRole('radiogroup', { name: 'Theme' });
      await expect(group).toHaveCSS('border-radius', '999px');
      for (const name of ['System', 'Light', 'Dark']) {
        const option = page.getByRole('radio', { name, exact: true });
        await option.hover();
        await expect(page.locator('.mat-mdc-tooltip').filter({ hasText: name })).toBeVisible();
        await option.click();
        await expect(option).toBeChecked();
        await expect(group.locator('[aria-checked="true"]')).toHaveCount(1);
        const segment = option.locator('..');
        await expect(segment).toHaveCSS('border-radius', '999px');
        await expect(segment).toHaveCSS('border-left-width', '0px');
        await expect(segment).toHaveCSS('border-right-width', '0px');
        const selectedBackground = await segment.evaluate((element) => getComputedStyle(element).backgroundColor);
        expect(selectedBackground).not.toBe(await group.evaluate((element) => getComputedStyle(element).backgroundColor));
      }

      await page.getByRole('radio', { name: 'System', exact: true }).click();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      const system = page.getByRole('radio', { name: 'System', exact: true });
      await expect(system).toBeFocused();
      await expect(system).toHaveCSS('outline-style', 'solid');
      await expect(system).toHaveCSS('outline-width', '2px');
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('radio', { name: 'Light', exact: true })).toBeChecked();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
      await page.keyboard.press('ArrowRight');
      await expect(system).toBeChecked();
    });

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

  for (const width of [768, 1024, 1440]) {
    test(`desktop layout floats the sidebar on the right at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');

      const sidebar = page.getByRole('complementary', { name: 'Fields' });
      await expect(sidebar).toBeVisible();
      const sidebarBox = await sidebar.boundingBox();
      const mainBox = await page.getByRole('main').boundingBox();
      const headerBox = await page.getByRole('banner').boundingBox();
      if (!sidebarBox || !mainBox || !headerBox) throw new Error('Missing layout region');
      expect(sidebarBox.x - (mainBox.x + mainBox.width)).toBe(12);
      expect(width - (sidebarBox.x + sidebarBox.width)).toBe(12);
      expect(sidebarBox.y - (headerBox.y + headerBox.height)).toBe(12);
      expect(900 - (sidebarBox.y + sidebarBox.height)).toBe(12);
      expect(sidebarBox.width).toBe(320);
      expect(mainBox.width).toBeGreaterThan(0);
      const surface = await sidebar.evaluate((element) => {
        const style = getComputedStyle(element);
        return { radius: style.borderRadius, shadow: style.boxShadow, border: style.borderLeftWidth };
      });
      expect(surface.radius).toBe('16px');
      expect(surface.shadow).not.toBe('none');
      expect(surface.border).toBe('0px');
      await expect(page.getByRole('button', { name: 'Fields' })).toHaveCount(0);

      await sidebar.evaluate((element) => {
        const content = document.createElement('button');
        content.textContent = 'Last test field';
        content.style.marginTop = '1600px';
        element.append(content);
      });
      const lastField = sidebar.getByRole('button', { name: 'Last test field' });
      await lastField.focus();
      await expect(lastField).toBeInViewport();
      expect(await sidebar.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    });
  }

  for (const width of [360, 767]) {
    test(`mobile layout uses a rounded bottom sheet without horizontal page scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 740 });
      await page.goto('/');

      await expect(page.getByRole('complementary', { name: 'Fields' })).toHaveCount(0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBe(0);

      const fields = page.getByRole('button', { name: 'Fields' });
      await expect(fields).toHaveCSS('border-radius', '999px');
      await fields.click();
      const sheet = page.getByRole('dialog', { name: 'Fields' });
      await expect(sheet).toBeVisible();
      await expect(sheet).toHaveCSS('border-top-left-radius', '16px');
      await expect(sheet).toHaveCSS('border-top-right-radius', '16px');
      await expect(sheet).toHaveCSS('border-bottom-left-radius', '0px');
      await expect
        .poll(async () => {
          const box = await sheet.boundingBox();
          return Math.round((box?.y ?? 0) + (box?.height ?? 0));
        })
        .toBe(740);

      await page.keyboard.press('Escape');
      await expect(sheet).toHaveCount(0);
      await expect(fields).toBeFocused();
      await fields.click();
      await expect(sheet).toBeVisible();
      await page.setViewportSize({ width: 1024, height: 740 });
      await expect(sheet).toHaveCount(0);
      await expect(page.getByRole('complementary', { name: 'Fields' })).toBeVisible();
    });
  }

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

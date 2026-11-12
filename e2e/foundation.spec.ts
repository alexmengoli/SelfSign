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

async function expectLogotype(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const image = page.getByRole('banner').getByRole('img', { name: 'SelfSign', exact: true });
  await expect(image).toHaveCount(1);
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', `branding/selfsign-logotype-${theme}.svg`);
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(561);
  const imageBox = await image.boundingBox();
  const symbolBox = await page.locator('.brand-symbol').boundingBox();
  const toggleBox = await page.getByRole('radiogroup', { name: 'Theme' }).boundingBox();
  if (!imageBox || !symbolBox || !toggleBox) throw new Error('Missing header brand or theme control');
  expect(imageBox.width).toBe(100);
  expect(imageBox.height).toBe(35);
  expect(symbolBox.width).toBe(32);
  expect(symbolBox.height).toBe(32);
  expect(imageBox.x - symbolBox.x - symbolBox.width).toBe(8);
  expect(Math.abs(imageBox.y + imageBox.height / 2 - symbolBox.y - symbolBox.height / 2)).toBeLessThanOrEqual(1);
  expect(imageBox.x + imageBox.width).toBeLessThanOrEqual(toggleBox.x);
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

async function sampleFieldsMotion(page: Page, action: 'open' | 'close') {
  return page.evaluate(async (operation) => {
    const trigger = document.querySelector<HTMLButtonElement>(operation === 'open'
      ? 'app-root > .fields-fab' : '.fields-fab-close');
    if (!trigger) throw new Error('Missing motion trigger');
    const frames: { gap: number | null; x: number; y: number; visibleCount: number }[] = [];
    trigger.click();
    for (let frameIndex = 0; frameIndex < 120; frameIndex++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const buttons = [...document.querySelectorAll<HTMLButtonElement>('.fields-fab')].filter((button) =>
        getComputedStyle(button).visibility === 'visible' && button.getClientRects().length > 0);
      const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Fields"]');
      const button = buttons[0];
      if (!button) throw new Error('FAB disappeared during sheet motion');
      const box = button.getBoundingClientRect();
      frames.push({
        gap: dialog ? dialog.getBoundingClientRect().top - box.bottom : null,
        x: box.x,
        y: box.y,
        visibleCount: buttons.length,
      });
      if (operation === 'close' && !dialog) return frames;
      if (operation === 'open' && dialog && frames.length >= 2 &&
          !dialog.getAnimations().some((animation) => animation.playState === 'running')) return frames;
    }
    throw new Error('Sheet motion did not settle');
  }, action);
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
  for (const width of [360, 1440]) {
    test(`logotype follows effective theme without duplicated branding at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: 'light' });
      await page.goto('/');
      await expectLogotype(page, 'light');
      await expect(page.getByRole('banner')).toHaveText('');

      await page.getByRole('radio', { name: 'Dark', exact: true }).click();
      await expectLogotype(page, 'dark');
      await page.reload();
      await expectLogotype(page, 'dark');
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.getByRole('radio', { name: 'Light', exact: true }).click();
      await expectLogotype(page, 'light');
      await page.reload();
      await expectLogotype(page, 'light');

      await page.getByRole('radio', { name: 'System', exact: true }).click();
      await expectLogotype(page, 'dark');
      await page.emulateMedia({ colorScheme: 'light' });
      await expectLogotype(page, 'light');
      await page.emulateMedia({ colorScheme: 'dark' });
      await expectLogotype(page, 'dark');
    });
  }

  test('serves complete local branding and favicon assets', async ({ page, request }) => {
    const assets = [
      ['favicon.svg', 'image/svg+xml'],
      ['favicon.ico', 'image/'],
      ['favicon-16x16.png', 'image/png'],
      ['favicon-32x32.png', 'image/png'],
      ['apple-touch-icon.png', 'image/png'],
      ['branding/selfsign-logo.svg', 'image/svg+xml'],
      ['branding/selfsign-logotype-light.svg', 'image/svg+xml'],
      ['branding/selfsign-logotype-dark.svg', 'image/svg+xml'],
    ];
    for (const [asset, contentType] of assets) {
      const response = await request.get(`/${asset}`);
      expect(response.ok(), asset).toBe(true);
      expect(response.headers()['content-type'], asset).toContain(contentType);
    }
    const ico = await (await request.get('/favicon.ico')).body();
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(3);
    expect([0, 1, 2].map((index) => ico[6 + index * 16])).toEqual([16, 32, 48]);

    await page.goto('/');
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('sizes', 'any');
    await expect(page.locator('link[rel="icon"][type="image/x-icon"]')).toHaveAttribute('href', 'favicon.ico');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('sizes', '180x180');
    const images = await page.evaluate(async () => {
      const sources = ['favicon.svg', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png',
        'branding/selfsign-logo.svg', 'branding/selfsign-logotype-light.svg', 'branding/selfsign-logotype-dark.svg'];
      return Promise.all(sources.map(async (source) => {
        const image = new Image();
        image.src = source;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('No image canvas context');
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const colors = new Set<string>();
        for (let offset = 0; offset < pixels.length; offset += 4) {
          if (pixels[offset + 3] !== 0) colors.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]}`);
        }
        return { source, width: canvas.width, height: canvas.height, colors: colors.size };
      }));
    });
    expect(images.map(({ width, height }) => [width, height])).toEqual([
      [300, 300], [16, 16], [32, 32], [180, 180], [300, 300], [561, 195], [561, 195],
    ]);
    for (const image of images) expect(image.colors, image.source).toBeGreaterThan(0);
    for (const image of images.slice(0, 5)) expect(image.colors, image.source).toBeGreaterThan(1);
  });

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
    await expect(page.getByRole('banner').getByRole('img', { name: 'SelfSign' })).toBeVisible();
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
    await expect(page.getByRole('main')).toHaveText('Drop a PDF here or click to browse');
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
        await page.getByRole('main').hover();
        await page.getByRole('radio', { name: 'System', exact: true }).focus();
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
      await expect(fields).toHaveCount(1);
      await expect(page.getByRole('banner').getByRole('button', { name: 'Fields' })).toHaveCount(0);
      await expect(fields).toHaveCSS('border-radius', '50%');
      const fabBox = await fields.boundingBox();
      if (!fabBox) throw new Error('Missing Fields FAB');
      expect(fabBox.width).toBe(56);
      expect(fabBox.height).toBe(56);
      expect(width - fabBox.x - fabBox.width).toBe(16);
      expect(740 - fabBox.y - fabBox.height).toBe(16);
      await expect(fields).toHaveText('');
      await expect(fields.locator('mat-icon svg path')).toBeAttached();
      await fields.hover();
      await expect(page.locator('.mat-mdc-tooltip').filter({ hasText: 'Fields' })).toBeVisible();
      await fields.click();
      const sheet = page.getByRole('dialog', { name: 'Fields' });
      await expect(sheet).toBeVisible();
      const close = page.getByRole('button', { name: 'Close Fields', exact: true });
      await expect(close).toBeVisible();
      await expect(close).toHaveAttribute('aria-expanded', 'true');
      await expect(close).toHaveAttribute('aria-controls', await sheet.getAttribute('id') ?? '');
      await page.locator('app-root > .fields-fab').dispatchEvent('click');
      await expect(sheet).toHaveCount(1);
      const openGeometry = await sheet.evaluate((element) => {
        const button = element.querySelector('button[aria-label="Close Fields"]');
        if (!button) throw new Error('Missing close FAB');
        const buttonBox = button.getBoundingClientRect();
        return { gap: element.getBoundingClientRect().top - buttonBox.bottom, x: buttonBox.x };
      });
      expect(openGeometry.gap).toBeCloseTo(16, 0);
      expect(openGeometry.x).toBe(fabBox.x);
      await close.hover();
      await expect(page.locator('.mat-mdc-tooltip').filter({ hasText: 'Close Fields' })).toBeVisible();
      await close.click();
      await expect(sheet).toHaveCount(0);
      await expect(fields).toBeFocused();
      await fields.press('Enter');
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
      await expect(fields).toBeVisible();
      await expect(fields).toBeFocused();
      await fields.press('Enter');
      await expect(sheet).toBeVisible();
      await page.locator('.cdk-overlay-backdrop').click({ position: { x: 1, y: 1 } });
      await expect(sheet).toHaveCount(0);
      await expect(fields).toBeFocused();
      await fields.press('Enter');
      await expect(sheet).toBeVisible();
      await page.setViewportSize({ width: 768, height: 740 });
      await expect(sheet).toHaveCount(0);
      await expect(fields).toHaveCount(0);
      await expect(page.getByRole('complementary', { name: 'Fields' })).toBeVisible();
    });
  }

  for (const colorScheme of ['light', 'dark'] as const) {
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      test(`${colorScheme} Fields FAB tracks motion, resizing and focus with ${reducedMotion}`, async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 740 });
        await page.emulateMedia({ colorScheme, reducedMotion });
        await page.goto('/');
        const opening = await sampleFieldsMotion(page, 'open');
        for (const frame of opening) {
          expect(frame.visibleCount).toBe(1);
          expect(frame.gap).toBeCloseTo(16, 0);
          expect(frame.x).toBe(288);
        }
        if (reducedMotion === 'no-preference') {
          expect(Math.max(...opening.map((frame) => frame.y)) - Math.min(...opening.map((frame) => frame.y))).toBeGreaterThan(0);
        }

        const sheet = page.getByRole('dialog', { name: 'Fields' });
        const close = page.getByRole('button', { name: 'Close Fields', exact: true });
        await expect(close).toBeVisible();
        expect(await close.evaluate((button) => {
          const box = button.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return hit === button || (hit !== null && button.contains(hit));
        })).toBe(true);
        await close.focus();
        await page.keyboard.press('Tab');
        await expect.poll(() => sheet.evaluate((element) => element.contains(document.activeElement))).toBe(true);
        await page.keyboard.press('Shift+Tab');
        await expect(close).toBeFocused();

        const content = page.locator('.fields-sheet-content');
        await content.evaluate((element) => {
          const field = document.createElement('button');
          field.textContent = 'Last mobile test field';
          field.style.marginTop = '1200px';
          element.append(field);
        });
        await page.setViewportSize({ width: 360, height: 520 });
        const lastField = content.getByRole('button', { name: 'Last mobile test field' });
        await lastField.focus();
        await expect(lastField).toBeInViewport();
        expect(await content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        const tallGeometry = await sheet.evaluate((element) => {
          const button = element.querySelector('.fields-fab-close');
          const header = document.querySelector('header');
          if (!button || !header) throw new Error('Missing tall-sheet geometry');
          const box = button.getBoundingClientRect();
          return {
            gap: element.getBoundingClientRect().top - box.bottom,
            top: box.top,
            headerBottom: header.getBoundingClientRect().bottom,
            right: box.right,
            viewportHeight: innerHeight,
            sheetBottom: element.getBoundingClientRect().bottom,
          };
        });
        expect(tallGeometry.gap).toBeCloseTo(16, 0);
        expect(tallGeometry.top).toBeGreaterThan(tallGeometry.headerBottom);
        expect(tallGeometry.right).toBe(344);
        expect(tallGeometry.sheetBottom).toBe(tallGeometry.viewportHeight);

        await lastField.evaluate((element) => element.remove());
        await page.setViewportSize({ width: 360, height: 740 });
        const closing = await sampleFieldsMotion(page, 'close');
        for (const frame of closing) {
          expect(frame.visibleCount).toBe(1);
          if (frame.gap !== null) expect(frame.gap).toBeCloseTo(16, 0);
          expect(frame.x).toBe(288);
        }
        await expect(sheet).toHaveCount(0);
        const fields = page.getByRole('button', { name: 'Fields', exact: true });
        await expect(fields).toBeFocused();
        await expect(fields).toHaveAttribute('aria-expanded', 'false');
        await fields.press('Enter');
        await expect(close).toBeVisible();
        await close.press('Space');
        await expect(sheet).toHaveCount(0);
        await expect(fields).toBeFocused();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      });
    }
  }

  test('bundled fonts render accented Latin characters without fallback', async ({ page }) => {
    await page.goto('/');
    // The fonts are registered from script after startup, not declared in CSS.
    await page.waitForFunction(() => ['Noto Sans', 'Noto Serif', 'Caveat'].every((family) =>
      [...document.fonts].some((face) => face.family.replaceAll('"', '') === family && face.status === 'loaded')));

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

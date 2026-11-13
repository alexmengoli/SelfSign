import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { type Browser, type BrowserContext, expect, type Page, type Request, test } from '@playwright/test';
import { buildPdf, pagesOf } from './support/pdf-fixtures';
import { IsolatedServer } from './support/isolated-server';
import { solidPng } from './support/png-fixtures';

const PASSWORD = 'e2e shared password';
const DROP_ZONE = 'Drop a PDF here or click to browse';

function unlockScreen(page: Page) {
  return page.getByRole('region', { name: 'Unlock SelfSign' });
}

async function unlock(page: Page, password = PASSWORD): Promise<void> {
  await expect(unlockScreen(page)).toBeVisible();
  await page.getByLabel('Password').fill(password);
  await page.getByLabel('Password').press('Enter');
}

async function expectWorkspace(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: DROP_ZONE })).toBeVisible();
  await expect(unlockScreen(page)).toHaveCount(0);
}

async function seedValues(server: IsolatedServer): Promise<{ imageId: string }> {
  const send = await server.session(PASSWORD);
  await send('/api/values', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: 'Tax code', text: 'RSSMRA80A01H501U' }),
  });
  const form = new FormData();
  form.set('label', 'Signature');
  form.set('file', new Blob([new Uint8Array(solidPng(40, 20, [0, 0, 255]))], { type: 'image/png' }), 'signature.png');
  const image = await send('/api/values/image', { method: 'POST', body: form });
  expect(image.status).toBe(201);
  return image.json() as Promise<{ imageId: string }>;
}

async function newPage(browser: Browser, storageState?: Awaited<ReturnType<BrowserContext['storageState']>>): Promise<Page> {
  const context = await browser.newContext({ storageState });
  return context.newPage();
}

test.describe('authentication', () => {
  let server: IsolatedServer;

  test.beforeEach(async () => {
    server = await IsolatedServer.create();
  });

  test.afterEach(async () => {
    await server.dispose();
  });

  test('keeps the workspace open without Lock when no password is configured', async ({ page }) => {
    await server.start();
    expect((await fetch(`${server.url}/api/values`)).status).toBe(200);
    await page.goto(server.url);
    await expectWorkspace(page);
    await expect(page.getByRole('button', { name: 'Lock', exact: true })).toHaveCount(0);
  });

  test('gates startup, rejects a wrong password and unlocks protected data and images with a cookie', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await server.start(PASSWORD);
    const { imageId } = await seedValues(server);
    for (const url of ['/api/values', '/api/settings', `/api/images/${imageId}`]) {
      const response = await fetch(`${server.url}${url}`);
      expect(response.status, url).toBe(401);
      expect(await response.text()).not.toContain('RSSMRA');
    }
    expect(await (await fetch(`${server.url}/api/health`)).json()).toEqual({ status: 'ok' });

    const requests: Request[] = [];
    page.on('request', (request) => requests.push(request));
    let releaseStatus!: () => void;
    const statusHeld = new Promise<void>((resolve) => (releaseStatus = resolve));
    await page.route('**/api/auth/status', async (route) => {
      await statusHeld;
      await route.continue();
    });
    await page.goto(server.url);
    await expect(page.locator('app-root header')).toBeVisible();
    await expect(page.getByRole('button', { name: DROP_ZONE })).toHaveCount(0);
    await expect(unlockScreen(page)).toHaveCount(0);
    releaseStatus();

    await expect(unlockScreen(page)).toBeVisible();
    await expect(page.getByLabel('Password')).toBeFocused();
    await expect(page.getByRole('button', { name: 'Lock', exact: true })).toHaveCount(0);
    expect(requests.filter((request) => /\/api\/(values|settings|images)/.test(request.url()))).toEqual([]);

    await unlock(page, 'not the password');
    await expect(page.getByRole('alert')).toHaveText('Incorrect password');
    await expect(page.getByRole('button', { name: DROP_ZONE })).toHaveCount(0);

    const afterLogin = requests.length;
    await unlock(page);
    await expectWorkspace(page);
    await expect(page.getByText('RSSMRA80A01H501U')).toBeVisible();
    const thumbnail = page.getByRole('img', { name: 'Signature' });
    await expect.poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(40);
    await expect(page.getByRole('button', { name: 'Lock', exact: true })).toBeVisible();

    const bytes = buildPdf(pagesOf(1, 'Private page'));
    await page.locator('app-drop-zone input[type="file"]').setInputFiles({ name: 'private.pdf', mimeType: 'application/pdf', buffer: bytes });
    await expect(page.getByRole('toolbar', { name: 'Document' })).toBeVisible();
    await page.getByRole('button', { name: 'Place Signature' }).click();
    await page.getByRole('button', { name: 'Place Tax code' }).click();
    await expect(page.locator('.element-image')).toHaveCount(1);

    const later = requests.slice(afterLogin);
    const logins = later.filter((request) => request.url().endsWith('/api/auth/login'));
    expect(logins).toHaveLength(1);
    for (const request of later) {
      const body = request.postDataBuffer() ?? Buffer.alloc(0);
      expect(request.url()).not.toContain(encodeURIComponent(PASSWORD));
      if (!logins.includes(request)) expect(body.includes(Buffer.from(PASSWORD))).toBe(false);
      expect(body.includes(Buffer.from('%PDF-'))).toBe(false);
    }
    const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie }));
    const session = (await page.context().cookies()).find((cookie) => cookie.name === 'selfsign_session')!;
    expect(session).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/', secure: false });
    expect(storage).not.toContain(session.value);
    expect(storage).not.toContain(PASSWORD);
  });

  test('stays unlocked across restarts and relocks after password rotation or disabling', async ({ browser }) => {
    // Five server restarts exceed the default timeout when the full suite runs in parallel.
    test.slow();
    await server.start('password-a');
    const first = await newPage(browser);
    await first.goto(server.url);
    await unlock(first, 'password-a');
    await expectWorkspace(first);
    const issued = await first.context().storageState();
    const cookie = issued.cookies.find((item) => item.name === 'selfsign_session')!;
    expect(cookie.expires * 1000).toBeGreaterThan(Date.now() + 390 * 24 * 60 * 60 * 1000);
    const authFile = () => readFile(path.join(server.dataDir, 'auth.json'), 'utf8');
    expect(await authFile()).not.toContain(cookie.value);
    expect(await authFile()).not.toContain('password-a');

    await server.start('password-a');
    const reopened = await newPage(browser, issued);
    await reopened.goto(server.url);
    await expectWorkspace(reopened);

    await server.start('password-b');
    await reopened.goto(server.url);
    await expect(unlockScreen(reopened)).toBeVisible();
    await server.start('password-a');
    const restored = await newPage(browser, issued);
    await restored.goto(server.url);
    await expect(unlockScreen(restored)).toBeVisible();
    expect(await authFile()).not.toMatch(/password-[ab]/);

    await unlock(restored, 'password-a');
    await expectWorkspace(restored);
    const second = await restored.context().storageState();
    await server.start();
    await restored.goto(server.url);
    await expectWorkspace(restored);
    await expect(restored.getByRole('button', { name: 'Lock', exact: true })).toHaveCount(0);
    await server.start('password-a');
    const reenabled = await newPage(browser, second);
    await reenabled.goto(server.url);
    await expect(unlockScreen(reenabled)).toBeVisible();
  });

  test('Lock revokes only the current session and relocks other tabs without replaying writes', async ({ browser }) => {
    await server.start(PASSWORD);
    const tab = await newPage(browser);
    await tab.goto(server.url);
    await unlock(tab);
    await expectWorkspace(tab);
    const sibling = await tab.context().newPage();
    await sibling.goto(server.url);
    await expectWorkspace(sibling);
    const other = await newPage(browser);
    await other.goto(server.url);
    await unlock(other);
    await expectWorkspace(other);

    const lock = tab.getByRole('button', { name: 'Lock', exact: true });
    await lock.hover();
    await expect(tab.locator('.mat-mdc-tooltip')).toHaveText('Lock');
    await lock.click();
    await expect(unlockScreen(tab)).toBeVisible();
    await expect(tab.getByLabel('Password')).toBeFocused();
    expect((await tab.context().cookies()).some((cookie) => cookie.name === 'selfsign_session')).toBe(false);

    await sibling.getByRole('button', { name: 'Add text' }).click();
    const dialog = sibling.getByRole('dialog', { name: 'Add value' });
    await dialog.getByLabel('Label').fill('Lost write');
    await dialog.getByLabel('Value').fill('Should not be saved');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(unlockScreen(sibling)).toBeVisible();
    await expect(sibling.getByRole('dialog')).toHaveCount(0);
    await expect(sibling.getByText('Should not be saved')).toHaveCount(0);

    await unlock(sibling);
    await expectWorkspace(sibling);
    await expect(sibling.getByRole('button', { name: 'Add text' })).toBeVisible();
    await expect(sibling.getByText('Should not be saved')).toHaveCount(0);

    await other.reload();
    await expectWorkspace(other);
    const send = await server.session(PASSWORD);
    expect(await (await send('/api/values')).json()).toEqual([]);
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`unlock screen fits desktop and 360px layouts in the ${colorScheme} theme`, async ({ browser }) => {
      await server.start(PASSWORD);
      const context = await browser.newContext({ colorScheme });
      const page = await context.newPage();
      for (const viewport of [{ width: 1440, height: 900 }, { width: 360, height: 740 }]) {
        await page.setViewportSize(viewport);
        await page.goto(server.url);
        await expect(unlockScreen(page)).toBeVisible();
        const layout = await page.evaluate(() => {
          const panel = document.querySelector('.unlock-panel')!.getBoundingClientRect();
          const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Unlock')!;
          return {
            panel: { left: panel.left, right: panel.right },
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            font: getComputedStyle(document.querySelector('h1')!).fontFamily,
            button: getComputedStyle(button).borderRadius,
            background: getComputedStyle(document.querySelector('.unlock-panel')!).backgroundColor,
          };
        });
        expect(layout.overflow).toBe(0);
        expect(layout.panel.left).toBeGreaterThanOrEqual(0);
        expect(layout.panel.right).toBeLessThanOrEqual(viewport.width);
        expect(layout.font).toContain('system-ui');
        expect(parseFloat(layout.button)).toBeGreaterThan(8);
        const [red] = layout.background.match(/\d+/g)!.map(Number);
        if (colorScheme === 'dark') expect(red).toBeLessThan(80);
        else expect(red).toBeGreaterThan(200);

        await expect(page.getByLabel('Password')).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(page.getByRole('button', { name: 'Unlock' })).toBeFocused();
      }

      await page.getByLabel('Password').fill(PASSWORD);
      await page.getByRole('button', { name: 'Unlock' }).press('Enter');
      await expect(page.getByRole('button', { name: 'Lock', exact: true })).toBeVisible();
      const header = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        lock: document.querySelector('button[aria-label="Lock"]')!.getBoundingClientRect().right,
        theme: document.querySelector('app-theme-toggle')!.getBoundingClientRect().left,
      }));
      expect(header.overflow).toBe(0);
      expect(header.lock).toBeLessThanOrEqual(header.theme);
      await context.close();
    });
  }
});

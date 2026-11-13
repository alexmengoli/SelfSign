import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { AUTH_FILE, LoginRateLimiter, SESSION_COOKIE, XSRF_TOKEN_COOKIE } from '../src/auth.js';
import type { TrustProxy } from '../src/config.js';

const PASSWORD = 'correct horse battery staple';
const HOST = 'selfsign.test';
const ORIGIN = `http://${HOST}`;
const PNG_BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const ID = '00000000-0000-4000-8000-000000000000';

type Method = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE';
type Headers = Record<string, string | undefined>;
interface RequestOptions { payload?: unknown; headers?: Headers; csrf?: boolean }

function imageForm(label: string, bytes: Buffer): { payload: Buffer; headers: Record<string, string> } {
  const boundary = 'selfsign-auth-boundary';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="label"\r\n\r\n${label}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

/** Minimal browser stand-in: stores cookies and sends same-origin headers. */
class Browser {
  readonly cookies = new Map<string, string>();

  constructor(private app: FastifyInstance) {}

  use(app: FastifyInstance): this {
    this.app = app;
    return this;
  }

  async request(method: Method, url: string, options: RequestOptions = {}): Promise<LightMyRequestResponse> {
    const headers: Headers = { host: HOST, ...this.cookieHeader() };
    if (method !== 'GET' && method !== 'HEAD') {
      headers['origin'] = ORIGIN;
      headers['sec-fetch-site'] = 'same-origin';
      const token = this.cookies.get(XSRF_TOKEN_COOKIE);
      if (token && options.csrf !== false) headers['x-xsrf-token'] = token;
    }
    const merged = Object.fromEntries(
      Object.entries({ ...headers, ...options.headers }).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    const response = await this.app.inject({
      method,
      url,
      headers: merged,
      payload: options.payload as string | object | Buffer | undefined,
    });
    for (const cookie of response.cookies as { name: string; value: string; maxAge?: number }[]) {
      if (cookie.maxAge === 0 || cookie.value === '') this.cookies.delete(cookie.name);
      else this.cookies.set(cookie.name, cookie.value);
    }
    return response;
  }

  async bootstrap(): Promise<LightMyRequestResponse> {
    return this.request('GET', '/api/auth/status');
  }

  async login(password = PASSWORD): Promise<LightMyRequestResponse> {
    await this.bootstrap();
    return this.request('POST', '/api/auth/login', { payload: { password } });
  }

  private cookieHeader(): Record<string, string> {
    if (this.cookies.size === 0) return {};
    return { cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ') };
  }
}

function setCookie(response: LightMyRequestResponse, name: string): string | undefined {
  const header = response.headers['set-cookie'];
  const values = Array.isArray(header) ? header : header === undefined ? [] : [String(header)];
  return values.find((value) => value.startsWith(`${name}=`));
}

describe('authentication', () => {
  let tempDir: string;
  let dataDir: string;
  let webRoot: string;
  let app: FastifyInstance;

  const start = async (password: string | undefined, trustProxy?: TrustProxy) => {
    app = await buildApp({ dataDir, webRoot, password, trustProxy });
    return app;
  };

  const restart = async (password: string | undefined) => {
    await app.close();
    return start(password);
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'selfsign-auth-'));
    dataDir = path.join(tempDir, 'data');
    webRoot = path.join(tempDir, 'web');
    await mkdir(webRoot, { recursive: true });
    await writeFile(path.join(webRoot, 'index.html'), '<!doctype html><app-root></app-root>');
    await writeFile(path.join(webRoot, 'main.js'), 'console.log(1);');
  });

  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('disabled', () => {
    it.each([undefined, ''])('keeps the API open without credentials when the password is %j', async (password) => {
      await start(password);
      const status = await app.inject({ method: 'GET', url: '/api/auth/status' });
      expect(status.json()).toEqual({ enabled: false, authenticated: true });
      expect(status.headers['set-cookie']).toBeUndefined();

      const created = await app.inject({ method: 'POST', url: '/api/values', payload: { label: 'Name', text: 'Ada' } });
      expect(created.statusCode).toBe(201);
      const values = await app.inject({ method: 'GET', url: '/api/values' });
      expect(values.json()).toHaveLength(1);
      expect(values.headers['cache-control']).toBe('no-store');
      expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'x' } })).statusCode).toBe(404);
    });
  });

  describe('enabled', () => {
    it('rejects every protected route without a session, leaving storage unchanged', async () => {
      await start(PASSWORD);
      app.get('/api/future-route', async () => ({ secret: 'data' }));
      const owner = new Browser(app);
      await owner.login();
      const text = (await owner.request('POST', '/api/values', { payload: { label: 'Tax code', text: 'RSSMRA' } })).json<{ id: string }>();
      const image = (await owner.request('POST', '/api/values/image', imageForm('Signature', PNG_BYTES))).json<{ id: string; imageId: string }>();
      const dataBefore = await readFile(path.join(dataDir, 'data.json'), 'utf8');
      const imagesBefore = await readdir(path.join(dataDir, 'images'));

      const attacker = new Browser(app);
      await attacker.bootstrap();
      const cases: [Method, string, RequestOptions?][] = [
        ['GET', '/api/values'],
        ['HEAD', '/api/values'],
        ['POST', '/api/values', { payload: { label: 'x', text: 'y' } }],
        ['POST', '/api/values/image', imageForm('x', PNG_BYTES)],
        ['PUT', `/api/values/${text.id}`, { payload: { label: 'x', text: 'y' } }],
        ['PUT', `/api/values/${image.id}/image`, imageForm('x', PNG_BYTES)],
        ['DELETE', `/api/values/${text.id}`],
        ['PUT', '/api/values/order', { payload: { ids: [image.id, text.id] } }],
        ['GET', '/api/settings'],
        ['PUT', '/api/settings', { payload: { dateFormat: 'yyyy-MM-dd' } }],
        ['GET', `/api/images/${image.imageId}`],
        ['GET', `/api/images/${ID}`],
        ['GET', '/api/future-route'],
        ['GET', '/api/unknown'],
      ];
      for (const [method, url, options] of cases) {
        const response = await attacker.request(method, url, options);
        expect(response.statusCode, `${method} ${url}`).toBe(401);
        expect(response.body, `${method} ${url}`).not.toMatch(/RSSMRA|Tax code|Signature|secret/);
        expect(response.headers['cache-control']).toBe('no-store');
      }
      // Encoded paths resolve to the same routes and must not bypass the check.
      expect((await attacker.request('GET', '/%61pi/values')).statusCode).not.toBe(200);
      expect(await readFile(path.join(dataDir, 'data.json'), 'utf8')).toBe(dataBefore);
      expect(await readdir(path.join(dataDir, 'images'))).toEqual(imagesBefore);
    });

    it('keeps health, status, static files and the SPA public', async () => {
      await start(PASSWORD);
      const health = await app.inject({ method: 'GET', url: '/api/health' });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual({ status: 'ok' });
      const status = await app.inject({ method: 'GET', url: '/api/auth/status' });
      expect(status.json()).toEqual({ enabled: true, authenticated: false });
      expect(status.headers['cache-control']).toBe('no-store');
      expect((await app.inject({ method: 'GET', url: '/' })).body).toContain('<app-root>');
      expect((await app.inject({ method: 'GET', url: '/some/page' })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/main.js' })).statusCode).toBe(200);
    });

    it('creates an opaque HttpOnly SameSite=Strict session cookie and loads data with it', async () => {
      await start(PASSWORD);
      const browser = new Browser(app);
      expect((await browser.login('wrong')).json()).toEqual({ error: 'Incorrect password' });
      expect(browser.cookies.has(SESSION_COOKIE)).toBe(false);

      const response = await browser.login();
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      const cookie = setCookie(response, SESSION_COOKIE)!;
      expect(cookie).toMatch(/; HttpOnly/);
      expect(cookie).toMatch(/; SameSite=Strict/);
      expect(cookie).toMatch(/; Path=\//);
      expect(cookie).toMatch(/; Max-Age=34560000/);
      expect(cookie).not.toMatch(/Secure/);
      expect(cookie).not.toContain(PASSWORD);

      const xsrf = setCookie(await browser.bootstrap(), XSRF_TOKEN_COOKIE)!;
      expect(xsrf).not.toMatch(/HttpOnly/);
      expect(xsrf).toMatch(/SameSite=Strict/);

      const values = await browser.request('GET', '/api/values');
      expect(values.statusCode).toBe(200);
      expect(setCookie(values, SESSION_COOKIE)).toMatch(/Max-Age=34560000/);
      expect((await browser.request('POST', '/api/values', { payload: { label: 'A', text: 'B' } })).statusCode).toBe(201);
      expect((await browser.bootstrap()).json()).toEqual({ enabled: true, authenticated: true });
    });

    it('marks cookies Secure only for HTTPS reported by an explicitly trusted proxy', async () => {
      await start(PASSWORD);
      const spoofed = new Browser(app);
      await spoofed.request('GET', '/api/auth/status', { headers: { 'x-forwarded-proto': 'https' } });
      const plain = await spoofed.request('POST', '/api/auth/login', {
        payload: { password: PASSWORD }, headers: { 'x-forwarded-proto': 'https' },
      });
      expect(setCookie(plain, SESSION_COOKIE)).not.toMatch(/Secure/);

      await app.close();
      await start(PASSWORD, ['127.0.0.1']);
      const proxied = new Browser(app);
      await proxied.request('GET', '/api/auth/status', { headers: { 'x-forwarded-proto': 'https' } });
      const secure = await proxied.request('POST', '/api/auth/login', {
        payload: { password: PASSWORD }, headers: { 'x-forwarded-proto': 'https', origin: `https://${HOST}` },
      });
      expect(secure.statusCode).toBe(200);
      expect(setCookie(secure, SESSION_COOKIE)).toMatch(/; Secure/);
    });

    it('serves protected images only with a session and without HTTP caching', async () => {
      await start(PASSWORD);
      const browser = new Browser(app);
      await browser.login();
      const image = (await browser.request('POST', '/api/values/image', imageForm('Signature', PNG_BYTES))).json<{ imageId: string }>();
      const response = await browser.request('GET', `/api/images/${image.imageId}`);
      expect(response.rawPayload).toEqual(PNG_BYTES);
      expect(response.headers['cache-control']).toBe('no-store');
      await browser.request('POST', '/api/auth/logout');
      expect((await browser.request('GET', `/api/images/${image.imageId}`)).statusCode).toBe(401);
    });
  });

  describe('session lifecycle', () => {
    it('keeps sessions across restarts with the same password and stores only digests', async () => {
      await start(PASSWORD);
      const browser = new Browser(app);
      await browser.login();
      const token = browser.cookies.get(SESSION_COOKIE)!;

      await restart(PASSWORD);
      browser.use(app);
      expect((await browser.request('GET', '/api/values')).statusCode).toBe(200);

      const stored = await readFile(path.join(dataDir, AUTH_FILE), 'utf8');
      expect(stored).not.toContain(token);
      expect(stored).not.toContain(PASSWORD);
      expect(JSON.parse(stored).sessions).toHaveLength(1);
    });

    it('revokes all sessions when the password changes, even if the old one returns', async () => {
      await start('password-a');
      const browser = new Browser(app);
      await browser.login('password-a');
      const oldSession = browser.cookies.get(SESSION_COOKIE)!;

      await restart('password-b');
      browser.use(app);
      expect((await browser.request('GET', '/api/values')).statusCode).toBe(401);
      await restart('password-a');
      browser.use(app).cookies.set(SESSION_COOKIE, oldSession);
      expect((await browser.request('GET', '/api/values')).statusCode).toBe(401);
      expect(await readFile(path.join(dataDir, AUTH_FILE), 'utf8')).not.toContain('password-a');
    });

    it('revokes sessions when authentication is disabled and later re-enabled', async () => {
      await start(PASSWORD);
      const browser = new Browser(app);
      await browser.login();
      const oldSession = browser.cookies.get(SESSION_COOKIE)!;

      await restart(undefined);
      expect(JSON.parse(await readFile(path.join(dataDir, AUTH_FILE), 'utf8'))).toEqual({
        version: 1, verifier: null, sessions: [],
      });
      await restart(PASSWORD);
      browser.use(app).cookies.set(SESSION_COOKIE, oldSession);
      expect((await browser.request('GET', '/api/values')).statusCode).toBe(401);
    });

    it('locks only the current session', async () => {
      await start(PASSWORD);
      const first = new Browser(app);
      const second = new Browser(app);
      await first.login();
      await second.login();

      const lock = await first.request('POST', '/api/auth/logout');
      expect(lock.statusCode).toBe(204);
      expect(setCookie(lock, SESSION_COOKIE)).toMatch(/Max-Age=0/);
      expect(first.cookies.has(SESSION_COOKIE)).toBe(false);
      expect((await first.request('GET', '/api/values')).statusCode).toBe(401);
      expect((await second.request('GET', '/api/values')).statusCode).toBe(200);
    });
  });

  describe('request forgery and throttling', () => {
    it('rejects cross-origin and token-less login and mutations before side effects', async () => {
      await start(PASSWORD);
      const browser = new Browser(app);
      await browser.bootstrap();
      const crossSite = { 'sec-fetch-site': 'cross-site', origin: 'http://evil.test' };
      expect((await browser.request('POST', '/api/auth/login', { payload: { password: PASSWORD }, headers: crossSite })).statusCode).toBe(403);
      expect((await browser.request('POST', '/api/auth/login', {
        payload: { password: PASSWORD }, headers: { 'sec-fetch-site': undefined, origin: 'http://evil.test' },
      })).statusCode).toBe(403);
      expect((await browser.request('POST', '/api/auth/login', {
        payload: { password: PASSWORD }, headers: { 'sec-fetch-site': undefined, origin: 'null' },
      })).statusCode).toBe(403);
      expect((await browser.request('POST', '/api/auth/login', { payload: { password: PASSWORD }, csrf: false })).statusCode).toBe(403);
      expect(browser.cookies.has(SESSION_COOKIE)).toBe(false);

      await browser.login();
      const before = await readFile(path.join(dataDir, 'data.json'), 'utf8').catch(() => '');
      const forged: [Method, string, RequestOptions][] = [
        ['POST', '/api/values', { payload: { label: 'x', text: 'y' }, headers: crossSite }],
        ['POST', '/api/values/image', { ...imageForm('x', PNG_BYTES), headers: { ...imageForm('x', PNG_BYTES).headers, ...crossSite } }],
        ['PUT', '/api/settings', { payload: { dateFormat: 'yyyy-MM-dd' }, headers: { 'sec-fetch-site': 'same-site' } }],
        ['POST', '/api/values/image', { ...imageForm('x', PNG_BYTES), csrf: false }],
        ['DELETE', `/api/values/${ID}`, { csrf: false }],
        ['POST', '/api/auth/logout', { headers: crossSite }],
      ];
      for (const [method, url, options] of forged) {
        expect((await browser.request(method, url, options)).statusCode, `${method} ${url}`).toBe(403);
      }
      expect(await readFile(path.join(dataDir, 'data.json'), 'utf8').catch(() => '')).toBe(before);
      expect(await readdir(path.join(dataDir, 'images'))).toEqual([]);
      expect((await browser.request('GET', '/api/values')).statusCode).toBe(200);
      expect((await browser.request('PUT', '/api/settings', {
        payload: { dateFormat: 'yyyy-MM-dd' }, headers: { 'sec-fetch-site': undefined },
      })).statusCode).toBe(200);
    });

    it('throttles five failed logins per client for one minute despite spoofed forwarding headers', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      await start(PASSWORD);
      const browser = new Browser(app);
      await browser.bootstrap();
      for (let attempt = 0; attempt < 5; attempt++) {
        expect((await browser.request('POST', '/api/auth/login', { payload: { password: `wrong-${attempt}` } })).statusCode).toBe(401);
      }
      const blocked = await browser.request('POST', '/api/auth/login', {
        payload: { password: PASSWORD }, headers: { 'x-forwarded-for': '203.0.113.7' },
      });
      expect(blocked.statusCode).toBe(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(60);
      expect(browser.cookies.has(SESSION_COOKIE)).toBe(false);

      vi.setSystemTime(Date.now() + 61_000);
      expect((await browser.request('POST', '/api/auth/login', { payload: { password: PASSWORD } })).statusCode).toBe(200);
    });
  });
});

describe('LoginRateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('expires entries after the window', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const limiter = new LoginRateLimiter();
    for (let attempt = 0; attempt < 5; attempt++) limiter.recordFailure('a');
    limiter.recordFailure('b');
    expect(limiter.retryAfterSeconds('a')).toBe(60);
    expect(limiter.retryAfterSeconds('b')).toBeUndefined();
    vi.setSystemTime(Date.now() + 60_000);
    expect(limiter.retryAfterSeconds('a')).toBeUndefined();
    expect(limiter.size).toBe(0);
  });
});

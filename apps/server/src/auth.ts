import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import cookie, { type CookieSerializeOptions } from '@fastify/cookie';
import csrfProtection from '@fastify/csrf-protection';
import { isApiPath, type AuthStatus } from '@selfsign/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';

export const SESSION_COOKIE = 'selfsign_session';
export const CSRF_SECRET_COOKIE = 'selfsign_csrf';
/** Read by Angular's HttpClient, which echoes it in the `X-XSRF-TOKEN` header. */
export const XSRF_TOKEN_COOKIE = 'XSRF-TOKEN';
/** Browsers cap cookie lifetimes at 400 days; the cookie is renewed on use. */
export const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
export const AUTH_FILE = 'auth.json';

const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MS = 60_000;
const LAST_USED_RESOLUTION_MS = 24 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PUBLIC_ROUTES = new Set([
  'GET /api/health',
  'HEAD /api/health',
  'GET /api/auth/status',
  'HEAD /api/auth/status',
  'POST /api/auth/login',
  'POST /api/auth/logout',
]);

const SESSION_COOKIE_OPTIONS: CookieSerializeOptions = {
  path: '/',
  httpOnly: true,
  sameSite: 'strict',
  secure: 'auto',
  maxAge: COOKIE_MAX_AGE_SECONDS,
};

interface PasswordVerifier {
  salt: string;
  hash: string;
}

interface StoredSession {
  digest: string;
  createdAt: number;
  lastUsedAt: number;
}

interface AuthFileData {
  version: 1;
  /** Salted scrypt hash of the password that issued the stored sessions; null while disabled. */
  verifier: PasswordVerifier | null;
  sessions: StoredSession[];
}

/** Persistent session digests plus the password generation that issued them. */
export class SessionStore {
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly filePath: string,
    private verifier: PasswordVerifier | null,
    private readonly sessions: Map<string, StoredSession>,
  ) {}

  static async open(dataDir: string, password: string | undefined): Promise<SessionStore> {
    const filePath = path.join(dataDir, AUTH_FILE);
    const stored = await readAuthFile(filePath);
    if (password === undefined) {
      const store = new SessionStore(filePath, null, new Map());
      // Disabling authentication revokes every session issued before.
      if (stored?.verifier || stored?.sessions.length) await store.persist();
      return store;
    }
    if (stored?.verifier && await matchesVerifier(password, stored.verifier)) {
      const cutoff = Date.now() - COOKIE_MAX_AGE_SECONDS * 1000;
      const active = stored.sessions.filter((session) => session.lastUsedAt > cutoff);
      const store = new SessionStore(filePath, stored.verifier, new Map(active.map((session) => [session.digest, session])));
      if (active.length !== stored.sessions.length) await store.persist();
      return store;
    }
    const salt = randomBytes(16);
    const verifier = { salt: salt.toString('base64'), hash: (await hashPassword(password, salt)).toString('base64') };
    const store = new SessionStore(filePath, verifier, new Map());
    await store.persist();
    return store;
  }

  get enabled(): boolean {
    return this.verifier !== null;
  }

  async verifyPassword(candidate: string): Promise<boolean> {
    return this.verifier !== null && matchesVerifier(candidate, this.verifier);
  }

  async createSession(): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    this.sessions.set(digestToken(token), { digest: digestToken(token), createdAt: now, lastUsedAt: now });
    await this.persist();
    return token;
  }

  async authenticate(token: string | undefined): Promise<boolean> {
    if (!this.enabled || token === undefined || !TOKEN_PATTERN.test(token)) return false;
    const session = this.sessions.get(digestToken(token));
    if (!session) return false;
    const now = Date.now();
    if (now - session.lastUsedAt > LAST_USED_RESOLUTION_MS) {
      session.lastUsedAt = now;
      await this.persist();
    }
    return true;
  }

  async revoke(token: string | undefined): Promise<void> {
    if (token === undefined || !TOKEN_PATTERN.test(token)) return;
    if (this.sessions.delete(digestToken(token))) await this.persist();
  }

  private persist(): Promise<void> {
    const operation = this.writeQueue.then(() => this.write());
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  private async write(): Promise<void> {
    const data: AuthFileData = { version: 1, verifier: this.verifier, sessions: [...this.sessions.values()] };
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify(data), { flag: 'wx', mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}

/** Counts failed logins per client; pending attempts count as failures until they succeed. */
export class LoginRateLimiter {
  private readonly entries = new Map<string, { failures: number; resetAt: number }>();

  retryAfterSeconds(key: string): number | undefined {
    this.sweep();
    const entry = this.entries.get(key);
    if (!entry || entry.failures < LOGIN_MAX_FAILURES) return undefined;
    return Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000));
  }

  recordFailure(key: string): void {
    this.sweep();
    const entry = this.entries.get(key);
    if (entry) entry.failures += 1;
    else this.entries.set(key, { failures: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  get size(): number {
    this.sweep();
    return this.entries.size;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
  }
}

export async function registerAuth(app: FastifyInstance, dataDir: string, password: string | undefined): Promise<void> {
  const sessions = await SessionStore.open(dataDir, password);

  app.addHook('onRequest', async (request, reply) => {
    if (isApiRequest(request)) reply.header('Cache-Control', 'no-store');
  });

  if (!sessions.enabled) {
    app.get('/api/auth/status', async (): Promise<AuthStatus> => ({ enabled: false, authenticated: true }));
    return;
  }

  await app.register(cookie);
  await app.register(csrfProtection, {
    cookieKey: CSRF_SECRET_COOKIE,
    cookieOpts: { ...SESSION_COOKIE_OPTIONS },
  });
  const limiter = new LoginRateLimiter();

  app.addHook('onRequest', async (request, reply) => {
    if (!isApiRequest(request)) return;
    if (!PUBLIC_ROUTES.has(`${request.method} ${request.routeOptions.url}`)) {
      const token = request.cookies[SESSION_COOKIE];
      if (!(await sessions.authenticate(token))) {
        if (token !== undefined) reply.clearCookie(SESSION_COOKIE, { path: '/' });
        return reply.code(401).send({ error: 'Authentication required.' });
      }
      reply.setCookie(SESSION_COOKIE, token!, SESSION_COOKIE_OPTIONS);
    }
    if (UNSAFE_METHODS.has(request.method) && isCrossOrigin(request)) {
      return reply.code(403).send({ error: 'Cross-origin request rejected.' });
    }
  });

  app.addHook('onRequest', (request, reply, done) => {
    if (isApiRequest(request) && UNSAFE_METHODS.has(request.method)) app.csrfProtection(request, reply, done);
    else done();
  });

  app.get('/api/auth/status', async (request, reply): Promise<AuthStatus> => {
    const token = request.cookies[SESSION_COOKIE];
    const authenticated = await sessions.authenticate(token);
    if (authenticated) reply.setCookie(SESSION_COOKIE, token!, SESSION_COOKIE_OPTIONS);
    else if (token !== undefined) reply.clearCookie(SESSION_COOKIE, { path: '/' });
    reply.setCookie(XSRF_TOKEN_COOKIE, reply.generateCsrf(), { ...SESSION_COOKIE_OPTIONS, httpOnly: false });
    return { enabled: true, authenticated };
  });

  app.post('/api/auth/login', async (request, reply) => {
    const client = request.ip;
    const retryAfter = limiter.retryAfterSeconds(client);
    if (retryAfter !== undefined) {
      return reply.code(429).header('Retry-After', String(retryAfter)).send({ error: 'Too many attempts. Try again later.' });
    }
    // Count before the slow comparison so parallel guesses cannot exceed the limit.
    limiter.recordFailure(client);
    const body = request.body;
    const candidate = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['password'] : undefined;
    if (typeof candidate !== 'string' || !(await sessions.verifyPassword(candidate))) {
      return reply.code(401).send({ error: 'Incorrect password' });
    }
    limiter.reset(client);
    reply.setCookie(SESSION_COOKIE, await sessions.createSession(), SESSION_COOKIE_OPTIONS);
    return { enabled: true, authenticated: true } satisfies AuthStatus;
  });

  app.post('/api/auth/logout', async (request, reply) => {
    await sessions.revoke(request.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });
}

function isApiRequest(request: FastifyRequest): boolean {
  const route = request.routeOptions.url;
  return (route !== undefined && isApiPath(route)) || isApiPath(request.url.split('?')[0] ?? '');
}

/** Fetch metadata first, then Origin; requests without either come from non-browser clients. */
function isCrossOrigin(request: FastifyRequest): boolean {
  const site = request.headers['sec-fetch-site'];
  if (site !== undefined) return site !== 'same-origin' && site !== 'none';
  const origin = request.headers.origin;
  if (origin === undefined) return false;
  try {
    const source = new URL(origin);
    // Parsing the Host with the Origin's scheme normalizes default ports on both sides.
    return source.host !== new URL(`${source.protocol}//${request.host}`).host;
  } catch {
    return true;
  }
}

function digestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function hashPassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

async function matchesVerifier(password: string, verifier: PasswordVerifier): Promise<boolean> {
  const expected = Buffer.from(verifier.hash, 'base64');
  const actual = await hashPassword(password, Buffer.from(verifier.salt, 'base64'));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** An unreadable file only revokes sessions, so it is treated as absent rather than fatal. */
async function readAuthFile(filePath: string): Promise<AuthFileData | undefined> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    const data = JSON.parse(raw) as Partial<AuthFileData>;
    const verifier = data.verifier;
    const validVerifier = verifier === null ||
      (typeof verifier?.salt === 'string' && typeof verifier.hash === 'string');
    const validSessions = Array.isArray(data.sessions) && data.sessions.every((session) =>
      typeof session?.digest === 'string' && typeof session.createdAt === 'number' && typeof session.lastUsedAt === 'number');
    return data.version === 1 && validVerifier && validSessions
      ? { version: 1, verifier: verifier ?? null, sessions: data.sessions! }
      : { version: 1, verifier: null, sessions: [] };
  } catch {
    return { version: 1, verifier: null, sessions: [] };
  }
}

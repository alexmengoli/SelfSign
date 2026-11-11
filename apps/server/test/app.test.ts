import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, CSP_NONCE_PLACEHOLDER } from '../src/app.js';

const INDEX_HTML = `<!doctype html><html><body><app-root ngCspNonce="${CSP_NONCE_PLACEHOLDER}"></app-root></body></html>`;

describe('server app', () => {
  let tempDir: string;
  let webRoot: string;
  let dataDir: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'selfsign-'));
    webRoot = path.join(tempDir, 'web');
    dataDir = path.join(tempDir, 'nested', 'data');
    await mkdir(path.join(webRoot, 'assets'), { recursive: true });
    await writeFile(path.join(webRoot, 'index.html'), INDEX_HTML);
    await writeFile(path.join(webRoot, 'assets', 'app.js'), 'console.log(1);');
    app = await buildApp({ dataDir, webRoot });
  });

  afterEach(async () => {
    await app.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates a missing data directory on startup', () => {
    expect(existsSync(dataDir)).toBe(true);
  });

  it('reports health', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it.each(['/', '/some/route', '/index.html', '/some/route?x=1'])('serves index.html for page route %s', async (url) => {
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('<app-root');
    expect(response.body).not.toContain(CSP_NONCE_PLACEHOLDER);
  });

  it('injects the per-request CSP style nonce into index.html', async () => {
    const first = await app.inject({ method: 'GET', url: '/' });
    const second = await app.inject({ method: 'GET', url: '/' });
    const nonce = /ngCspNonce="([^"]+)"/.exec(first.body)?.[1];

    expect(nonce).toBeTruthy();
    expect(first.headers['content-security-policy']).toContain(`'nonce-${nonce}'`);
    expect(second.body).not.toContain(`ngCspNonce="${nonce}"`);
  });

  it('serves static assets', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('console.log(1);');
  });

  it.each(['/api/unknown', '/api', '/assets/missing.js'])('returns 404 instead of index.html for %s', async (url) => {
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('<app-root');
  });

  it('sends a self-only CSP and nosniff on every response', async () => {
    for (const url of ['/', '/api/health', '/assets/app.js']) {
      const response = await app.inject({ method: 'GET', url });
      const csp = String(response.headers['content-security-policy']);

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("connect-src 'self'");
      expect(csp).not.toContain('unsafe-inline');
      expect(csp).not.toContain('upgrade-insecure-requests');
      expect(csp).not.toMatch(/https?:/);
    }
  });
});

describe('server app data directory', () => {
  it('fails with a clear message when the data directory cannot be used', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'selfsign-'));
    const filePath = path.join(tempDir, 'not-a-directory');
    await writeFile(filePath, '');
    try {
      await expect(buildApp({ dataDir: filePath, webRoot: tempDir })).rejects.toThrow(/is not a writable directory/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe('server app without a web build', () => {
  it('serves the API and returns 404 for pages', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'selfsign-'));
    const app = await buildApp({ dataDir: path.join(tempDir, 'data'), webRoot: path.join(tempDir, 'missing') });
    try {
      expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(404);
    } finally {
      await app.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

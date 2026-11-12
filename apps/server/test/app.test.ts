import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, CSP_NONCE_PLACEHOLDER } from '../src/app.js';

const INDEX_HTML = `<!doctype html><html><body><app-root ngCspNonce="${CSP_NONCE_PLACEHOLDER}"></app-root></body></html>`;
const PNG_BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const JPEG_BYTES = Buffer.from([255, 216, 255, 0]);

function imageForm(label: string | undefined, bytes: Buffer, filename: string): { payload: Buffer; headers: Record<string, string> } {
  const boundary = 'selfsign-test-boundary';
  const fields = label === undefined ? '' :
    `--${boundary}\r\nContent-Disposition: form-data; name="label"\r\n\r\n${label}\r\n`;
  const payload = Buffer.concat([
    Buffer.from(`${fields}--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

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

  it('persists values, order, and settings across app restarts', async () => {
    const taxCode = await app.inject({
      method: 'POST', url: '/api/values', payload: { label: 'Tax code', text: 'RSSMRA80A01H501U' },
    });
    const address = await app.inject({
      method: 'POST', url: '/api/values', payload: { label: 'Address', text: 'Main Street' },
    });
    expect(taxCode.statusCode).toBe(201);
    expect(address.statusCode).toBe(201);
    const firstId = taxCode.json<{ id: string }>().id;
    const secondId = address.json<{ id: string }>().id;

    expect((await app.inject({
      method: 'PUT', url: '/api/values/order', payload: { ids: [secondId, firstId] },
    })).json<{ id: string }[]>().map(({ id }) => id)).toEqual([secondId, firstId]);
    expect((await app.inject({ method: 'PUT', url: '/api/values/order', payload: { ids: [secondId, secondId] } })).statusCode)
      .toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/settings', payload: { dateFormat: 'yyyy-MM-dd' } })).json())
      .toEqual({ dateFormat: 'yyyy-MM-dd' });
    expect((await app.inject({ method: 'GET', url: '/api/values' })).statusCode).toBe(200);
    const imageResponse = await app.inject({
      method: 'POST', url: '/api/values/image', ...imageForm('Saved image', PNG_BYTES, 'saved.png'),
    });
    expect(imageResponse.statusCode).toBe(201);
    const savedImage = imageResponse.json<{ id: string; imageId: string }>();

    await app.close();
    app = await buildApp({ dataDir, webRoot });
    expect((await app.inject({ method: 'GET', url: '/api/values' })).json<{ id: string }[]>().map(({ id }) => id))
      .toEqual([secondId, firstId, savedImage.id]);
    expect((await app.inject({ method: 'GET', url: '/api/settings' })).json()).toEqual({ dateFormat: 'yyyy-MM-dd' });
    expect((await app.inject({ method: 'GET', url: `/api/images/${savedImage.imageId}` })).rawPayload).toEqual(PNG_BYTES);
    expect((await app.inject({ method: 'PUT', url: `/api/values/${firstId}`, payload: { label: 'Tax ID', text: 'updated' } }))
      .statusCode).toBe(200);
  });

  it('detects image content, serves replacements, and removes image files on delete', async () => {
    const uploaded = await app.inject({
      method: 'POST', url: '/api/values/image', ...imageForm('Signature', PNG_BYTES, 'signature.png'),
    });
    expect(uploaded.statusCode).toBe(201);
    const value = uploaded.json<{ id: string; imageId: string; mimeType: string }>();
    expect(value.mimeType).toBe('image/png');
    const original = await app.inject({ method: 'GET', url: `/api/images/${value.imageId}` });
    expect(original.headers['content-type']).toContain('image/png');
    expect(original.rawPayload).toEqual(PNG_BYTES);

    const replacement = await app.inject({
      method: 'PUT', url: `/api/values/${value.id}/image`, ...imageForm('Signature v2', JPEG_BYTES, 'replacement.jpg'),
    });
    expect(replacement.statusCode).toBe(200);
    const updated = replacement.json<{ imageId: string; mimeType: string; label: string }>();
    expect(updated).toMatchObject({ label: 'Signature v2', mimeType: 'image/jpeg' });
    expect(await readdir(path.join(dataDir, 'images'))).toEqual([`${updated.imageId}.jpg`]);
    expect((await app.inject({ method: 'GET', url: `/api/images/${updated.imageId}` })).headers['content-type']).toContain('image/jpeg');
    expect((await app.inject({ method: 'DELETE', url: `/api/values/${value.id}` })).statusCode).toBe(204);
    expect(await readdir(path.join(dataDir, 'images'))).toEqual([]);
    expect((await app.inject({ method: 'GET', url: `/api/images/${updated.imageId}` })).statusCode).toBe(404);
  });

  it('rejects invalid values, unsupported image bytes, and malformed IDs', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/values', payload: { label: '', text: 'x' } })).statusCode)
      .toBe(400);
    expect((await app.inject({
      method: 'POST', url: '/api/values/image', ...imageForm('Not an image', Buffer.from('not PNG'), 'renamed.png'),
    })).statusCode).toBe(415);
    expect((await app.inject({ method: 'GET', url: '/api/images/not-a-uuid' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: '/api/values/not-a-uuid' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/images/%2e%2e' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/values/00000000-0000-4000-8000-000000000000' })).statusCode)
      .toBe(404);
    expect((await app.inject({ method: 'PUT', url: '/api/settings', payload: { dateFormat: 'yyyy/MM/dd' } })).statusCode)
      .toBe(400);
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

import { constants, existsSync } from 'node:fs';
import { access, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { isApiPath } from '@selfsign/shared';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { registerApi } from './api.js';

export interface AppOptions {
  dataDir: string;
  webRoot: string;
  logger?: boolean;
}

/** Placeholder in the web build's index.html, replaced by the per-request CSP style nonce. */
export const CSP_NONCE_PLACEHOLDER = '__CSP_NONCE__';

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  await ensureWritableDirectory(options.dataDir);

  const app = Fastify({ logger: options.logger ?? false });

  await app.register(helmet, {
    enableCSPNonces: true,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'blob:', 'data:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
      },
    },
    // Self-hosted over plain HTTP on a LAN is a supported setup; HSTS belongs to a TLS proxy.
    strictTransportSecurity: false,
  });

  await app.register(registerApi);

  const indexPath = path.join(options.webRoot, 'index.html');
  const indexHtml = existsSync(indexPath) ? await readFile(indexPath, 'utf8') : undefined;

  const sendIndex = (reply: FastifyReply) =>
    reply
      .header('Cache-Control', 'no-cache')
      .type('text/html; charset=utf-8')
      .send(indexHtml?.replaceAll(CSP_NONCE_PLACEHOLDER, reply.cspNonce.style));

  if (indexHtml !== undefined) {
    await app.register(fastifyStatic, {
      root: options.webRoot,
      index: false,
      allowedPath: (pathname) => pathname !== '/index.html',
    });
    app.get('/', (_request, reply) => sendIndex(reply));
  }

  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split('?')[0] ?? '/';
    const isPageRequest =
      (request.method === 'GET' || request.method === 'HEAD') &&
      !isApiPath(pathname) &&
      (path.posix.extname(pathname) === '' || pathname === '/index.html');

    if (indexHtml !== undefined && isPageRequest) {
      return sendIndex(reply);
    }
    return reply.code(404).send({ error: 'Not Found' });
  });

  return app;
}

async function ensureWritableDirectory(directory: string): Promise<void> {
  try {
    await mkdir(directory, { recursive: true });
    await access(directory, constants.W_OK);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Data directory "${directory}" is not a writable directory: ${reason}`, { cause: error });
  }
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ServerConfig {
  port: number;
  dataDir: string;
  webRoot: string;
}

const DEFAULT_PORT = 8080;
const DEFAULT_WEB_ROOT = fileURLToPath(new URL('../../web/dist/browser', import.meta.url));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: parsePort(env['PORT']),
    dataDir: path.resolve(env['DATA_DIR'] || './data'),
    webRoot: DEFAULT_WEB_ROOT,
  };
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value === '') {
    return DEFAULT_PORT;
  }
  const port = Number(value);
  if (!/^\d+$/.test(value) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT "${value}": expected an integer between 1 and 65535.`);
  }
  return port;
}

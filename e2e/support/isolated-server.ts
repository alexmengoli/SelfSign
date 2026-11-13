import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** A private server process with its own port and data directory, so restarts never affect other specs. */
export class IsolatedServer {
  private child?: ChildProcess;
  private port = 0;

  private constructor(readonly dataDir: string) {}

  static async create(): Promise<IsolatedServer> {
    return new IsolatedServer(await mkdtemp(path.join(tmpdir(), 'selfsign-e2e-auth-')));
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(password?: string): Promise<void> {
    await this.stop();
    this.port = await freePort();
    let output = '';
    const child = spawn(process.execPath, ['apps/server/dist/main.js'], {
      env: { ...process.env, PORT: String(this.port), DATA_DIR: this.dataDir, APP_PASSWORD: password ?? '', TRUST_PROXY: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    this.child = child;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Server exited early:\n${output}`);
      try {
        if ((await fetch(`${this.url}/api/health`)).ok) return;
      } catch {
        // Not listening yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Server did not become healthy:\n${output}`);
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null) return;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await exited;
  }

  async dispose(): Promise<void> {
    await this.stop();
    await rm(this.dataDir, { recursive: true, force: true });
  }

  /** Logs in like a browser API client and returns a fetch bound to that session. */
  async session(password: string): Promise<(url: string, init?: RequestInit) => Promise<Response>> {
    const cookies = new Map<string, string>();
    const send = async (url: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set('cookie', [...cookies].map(([name, value]) => `${name}=${value}`).join('; '));
      const token = cookies.get('XSRF-TOKEN');
      if (token) headers.set('x-xsrf-token', token);
      const response = await fetch(`${this.url}${url}`, { ...init, headers });
      for (const cookie of response.headers.getSetCookie()) {
        const [pair] = cookie.split(';');
        const [name, ...value] = pair!.split('=');
        cookies.set(name!, value.join('='));
      }
      return response;
    };
    await send('/api/auth/status');
    const login = await send('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }),
    });
    if (!login.ok) throw new Error(`Login failed with ${login.status}`);
    return send;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('No port'))));
    });
  });
}

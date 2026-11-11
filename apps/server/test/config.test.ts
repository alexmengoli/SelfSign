import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('uses defaults', () => {
    const config = loadConfig({});
    expect(config.port).toBe(8080);
    expect(config.dataDir).toBe(path.resolve('./data'));
    expect(config.webRoot.replaceAll('\\', '/')).toMatch(/apps\/web\/dist\/browser$/);
  });

  it('reads PORT and DATA_DIR', () => {
    const config = loadConfig({ PORT: '9000', DATA_DIR: '/srv/selfsign' });
    expect(config.port).toBe(9000);
    expect(config.dataDir).toBe(path.resolve('/srv/selfsign'));
  });

  it.each(['0', '65536', 'abc', '80.5', '-1'])('rejects invalid PORT %s', (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(/Invalid PORT/);
  });
});

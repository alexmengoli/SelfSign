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

  it.each([[undefined], ['']])('disables authentication when APP_PASSWORD is %j', (password) => {
    expect(loadConfig({ APP_PASSWORD: password }).password).toBeUndefined();
  });

  it('enables authentication with a nonempty APP_PASSWORD', () => {
    expect(loadConfig({ APP_PASSWORD: ' secret ' }).password).toBe(' secret ');
  });

  it.each([
    [undefined, false],
    ['', false],
    ['false', false],
    ['true', true],
    ['127.0.0.1, 10.0.0.0/8', ['127.0.0.1', '10.0.0.0/8']],
  ])('parses TRUST_PROXY %j', (value, expected) => {
    expect(loadConfig({ TRUST_PROXY: value }).trustProxy).toEqual(expected);
  });
});

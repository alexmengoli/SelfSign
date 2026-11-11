import { describe, expect, it } from 'vitest';
import { isApiPath } from './index.js';

describe('isApiPath', () => {
  it('matches the API prefix and its sub-paths', () => {
    expect(isApiPath('/api')).toBe(true);
    expect(isApiPath('/api/health')).toBe(true);
  });

  it('does not match other paths', () => {
    expect(isApiPath('/')).toBe(false);
    expect(isApiPath('/apis')).toBe(false);
    expect(isApiPath('/settings/api')).toBe(false);
  });
});

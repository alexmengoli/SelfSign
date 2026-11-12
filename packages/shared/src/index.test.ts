import { describe, expect, it } from 'vitest';
import { DEFAULT_DATE_FORMAT, DATE_FORMATS, formatDate, isApiPath, isDateFormat } from './index.js';

describe('formatDate', () => {
  const date = new Date(2026, 10, 12);

  it.each([
    ['dd/MM/yyyy', '12/11/2026'],
    ['MM/dd/yyyy', '11/12/2026'],
    ['yyyy-MM-dd', '2026-11-12'],
    ['dd.MM.yyyy', '12.11.2026'],
  ] as const)('formats %s', (format, expected) => {
    expect(formatDate(date, format)).toBe(expected);
  });

  it('exposes and validates the supported formats', () => {
    expect(DEFAULT_DATE_FORMAT).toBe('dd/MM/yyyy');
    expect(DATE_FORMATS).toEqual(['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'dd.MM.yyyy']);
    expect(isDateFormat('yyyy-MM-dd')).toBe(true);
    expect(isDateFormat('yyyy/MM/dd')).toBe(false);
  });
});

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

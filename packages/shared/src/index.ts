export const API_PREFIX = '/api';

export interface HealthResponse {
  status: 'ok';
}

export interface AuthStatus {
  /** False when the server runs without `APP_PASSWORD`. */
  enabled: boolean;
  authenticated: boolean;
}

export const DATE_FORMATS = ['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'dd.MM.yyyy'] as const;

export type DateFormat = (typeof DATE_FORMATS)[number];

export const DEFAULT_DATE_FORMAT: DateFormat = 'dd/MM/yyyy';

export interface SavedValue {
  id: string;
  kind: 'text' | 'image';
  label: string;
  text?: string;
  imageId?: string;
  mimeType?: string;
}

export interface Settings {
  dateFormat: DateFormat;
}

export function isDateFormat(value: unknown): value is DateFormat {
  return typeof value === 'string' && DATE_FORMATS.some((format) => format === value);
}

export function formatDate(date: Date, format: DateFormat): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).padStart(4, '0');

  switch (format) {
    case 'dd/MM/yyyy':
      return `${day}/${month}/${year}`;
    case 'MM/dd/yyyy':
      return `${month}/${day}/${year}`;
    case 'yyyy-MM-dd':
      return `${year}-${month}-${day}`;
    case 'dd.MM.yyyy':
      return `${day}.${month}.${year}`;
  }
}

export function isApiPath(pathname: string): boolean {
  return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
}

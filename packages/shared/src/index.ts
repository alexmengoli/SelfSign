export const API_PREFIX = '/api';

export interface HealthResponse {
  status: 'ok';
}

export function isApiPath(pathname: string): boolean {
  return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
}

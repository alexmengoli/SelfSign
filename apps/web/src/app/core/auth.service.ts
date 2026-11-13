import { HttpClient, HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import type { AuthStatus } from '@selfsign/shared';
import { firstValueFrom, tap } from 'rxjs';
import { FieldLibraryService } from '../sidebar/field-library.service';

export type AuthState = 'checking' | 'unavailable' | 'locked' | 'unlocked';

export type UnlockResult =
  | { kind: 'unlocked' | 'incorrect' | 'failed' }
  | { kind: 'throttled'; retryAfterSeconds: number };

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly library = inject(FieldLibraryService);

  readonly state = signal<AuthState>('checking');
  readonly enabled = signal(false);

  async check(): Promise<void> {
    this.state.set('checking');
    try {
      const status = await firstValueFrom(this.http.get<AuthStatus>('/api/auth/status'));
      this.enabled.set(status.enabled);
      if (status.authenticated) this.state.set('unlocked');
      else this.markLocked();
    } catch {
      this.state.set('unavailable');
    }
  }

  async unlock(password: string): Promise<UnlockResult> {
    try {
      await firstValueFrom(this.http.post<AuthStatus>('/api/auth/login', { password }));
      this.state.set('unlocked');
      return { kind: 'unlocked' };
    } catch (error) {
      if (!(error instanceof HttpErrorResponse)) return { kind: 'failed' };
      if (error.status === 401) return { kind: 'incorrect' };
      if (error.status === 429) {
        return { kind: 'throttled', retryAfterSeconds: Math.max(1, Number(error.headers.get('Retry-After')) || 60) };
      }
      return { kind: 'failed' };
    }
  }

  /** Revokes this browser's session; returns false if the server could not be reached. */
  async lock(): Promise<boolean> {
    try {
      await firstValueFrom(this.http.post<void>('/api/auth/logout', null));
    } catch {
      return false;
    }
    this.markLocked();
    return true;
  }

  handleUnauthorized(): void {
    if (this.state() === 'unlocked') this.markLocked();
  }

  private markLocked(): void {
    this.library.reset();
    this.state.set('locked');
  }
}

/** Relocks the app when any protected request reports a missing or revoked session. */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  return next(request).pipe(tap({
    error: (error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && !request.url.startsWith('/api/auth/')) {
        auth.handleUnauthorized();
      }
    },
  }));
};

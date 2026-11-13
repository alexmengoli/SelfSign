import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { App } from './app';
import { authInterceptor } from './core/auth.service';
import { FieldLibraryService } from './sidebar/field-library.service';

describe('App', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function settle(fixture: ComponentFixture<App>): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }

  async function render(status?: { enabled: boolean; authenticated: boolean } | 'error'): Promise<ComponentFixture<App>> {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    if (status === 'error') {
      http.expectOne('/api/auth/status').flush('down', { status: 502, statusText: 'Bad Gateway' });
    } else if (status) {
      http.expectOne('/api/auth/status').flush(status);
    }
    await settle(fixture);
    return fixture;
  }

  function flushWorkspace(): void {
    http.expectOne('/api/values').flush([{ id: 'value-1', kind: 'text', label: 'Tax code', text: 'RSSMRA' }]);
    http.expectOne('/api/settings').flush({ dateFormat: 'dd/MM/yyyy' });
  }

  async function submitPassword(fixture: ComponentFixture<App>, password: string): Promise<void> {
    const element = fixture.nativeElement as HTMLElement;
    const input = element.querySelector<HTMLInputElement>('input[type="password"]')!;
    input.value = password;
    input.dispatchEvent(new Event('input'));
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle(fixture);
  }

  function button(element: HTMLElement, text: string): HTMLButtonElement | undefined {
    return [...element.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === text);
  }

  it('shows neither workspace nor unlock form and requests no saved data while checking access', async () => {
    const fixture = await render();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('app-sidebar, main, app-unlock-screen')).toBeNull();
    http.expectNone('/api/values');
    http.expectNone('/api/settings');
    http.expectOne('/api/auth/status').flush({ enabled: true, authenticated: false });
    await settle(fixture);
    expect(element.querySelector('app-unlock-screen')).not.toBeNull();
    http.expectNone('/api/values');
  });

  it('unlocks with the correct password after a generic incorrect-password message', async () => {
    const fixture = await render({ enabled: true, authenticated: false });
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('h1')?.textContent).toBe('Unlock SelfSign');
    expect(element.querySelector('mat-label')?.textContent).toBe('Password');
    expect(element.querySelector('input')?.getAttribute('autocomplete')).toBe('current-password');
    expect(button(element, 'Unlock')).toBeDefined();
    expect(element.querySelector('app-sidebar')).toBeNull();
    expect(element.querySelector('button[aria-label="Lock"]')).toBeNull();

    await submitPassword(fixture, 'wrong');
    const failed = http.expectOne({ method: 'POST', url: '/api/auth/login' });
    expect(failed.request.body).toEqual({ password: 'wrong' });
    expect(button(element, 'Unlock')?.disabled).toBe(true);
    failed.flush({ error: 'Incorrect password' }, { status: 401, statusText: 'Unauthorized' });
    await settle(fixture);
    expect(element.querySelector('[role="alert"]')?.textContent).toBe('Incorrect password');
    expect(element.querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
    expect(button(element, 'Unlock')?.disabled).toBe(false);
    expect(element.querySelector('app-sidebar')).toBeNull();

    await submitPassword(fixture, 'secret');
    http.expectOne({ method: 'POST', url: '/api/auth/login' }).flush({ enabled: true, authenticated: true });
    await settle(fixture);
    flushWorkspace();
    await settle(fixture);
    expect(element.querySelector('app-unlock-screen')).toBeNull();
    expect(element.querySelector('aside app-sidebar')?.textContent).toContain('RSSMRA');
    expect(element.querySelector('button[aria-label="Lock"]')).not.toBeNull();
  });

  it('reports connectivity and throttling failures without claiming the password is wrong', async () => {
    const fixture = await render({ enabled: true, authenticated: false });
    const element = fixture.nativeElement as HTMLElement;

    await submitPassword(fixture, 'secret');
    http.expectOne('/api/auth/login').flush('down', { status: 502, statusText: 'Bad Gateway' });
    await settle(fixture);
    expect(element.querySelector('[role="alert"]')?.textContent).toBe('Could not reach the server. Try again.');

    await submitPassword(fixture, 'secret');
    http.expectOne('/api/auth/login').flush({ error: 'Too many attempts.' }, {
      status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '42' },
    });
    await settle(fixture);
    expect(element.querySelector('[role="alert"]')?.textContent).toBe('Too many attempts. Try again in 42 seconds.');
    expect(element.querySelector('app-sidebar')).toBeNull();
  });

  it('offers Retry when the access check fails', async () => {
    const fixture = await render('error');
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[role="alert"]')?.textContent).toBe('Could not connect to the server.');
    expect(element.querySelector('app-sidebar')).toBeNull();

    button(element, 'Retry')!.click();
    await settle(fixture);
    http.expectOne('/api/auth/status').flush({ enabled: true, authenticated: true });
    await settle(fixture);
    flushWorkspace();
    expect(element.querySelector('app-sidebar')).not.toBeNull();
  });

  it('locks the session and clears saved data', async () => {
    const fixture = await render({ enabled: true, authenticated: true });
    flushWorkspace();
    await settle(fixture);
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('RSSMRA');

    element.querySelector<HTMLButtonElement>('button[aria-label="Lock"]')!.click();
    await settle(fixture);
    http.expectOne({ method: 'POST', url: '/api/auth/logout' }).flush(null, { status: 204, statusText: 'No Content' });
    await settle(fixture);
    expect(element.querySelector('app-unlock-screen')).not.toBeNull();
    expect(element.querySelector('app-sidebar')).toBeNull();
    expect(element.textContent).not.toContain('RSSMRA');
    expect(TestBed.inject(FieldLibraryService).values()).toEqual([]);
  });

  it('relocks when a protected request reports a lost session and does not retry it', async () => {
    const fixture = await render({ enabled: true, authenticated: true });
    flushWorkspace();
    await settle(fixture);
    const element = fixture.nativeElement as HTMLElement;
    const library = TestBed.inject(FieldLibraryService);

    const saving = library.addText('Name', 'Ada').catch(() => 'failed');
    http.expectOne({ method: 'POST', url: '/api/values' }).flush({ error: 'Authentication required.' }, {
      status: 401, statusText: 'Unauthorized',
    });
    expect(await saving).toBe('failed');
    await settle(fixture);
    expect(element.querySelector('app-unlock-screen')).not.toBeNull();
    expect(library.values()).toEqual([]);

    await submitPassword(fixture, 'secret');
    http.expectOne('/api/auth/login').flush({ enabled: true, authenticated: true });
    await settle(fixture);
    flushWorkspace();
    http.expectNone({ method: 'POST', url: '/api/values' });
  });

  it('renders the header with the theme control in English', async () => {
    const fixture = await render({ enabled: false, authenticated: true });
    flushWorkspace();
    const element = fixture.nativeElement as HTMLElement;

    const logos = [...element.querySelectorAll<HTMLImageElement>('header img[alt="SelfSign"]')];
    expect(logos.map((image) => image.getAttribute('src'))).toEqual([
      'branding/selfsign-logotype-light.svg',
      'branding/selfsign-logotype-dark.svg',
    ]);
    expect(element.querySelector('header')?.textContent?.trim()).toBe('');
    const symbol = element.querySelector<HTMLImageElement>('.brand-symbol');
    expect(symbol?.getAttribute('src')).toBe('branding/selfsign-logo.svg');
    expect(symbol?.alt).toBe('');
    const labels = [...element.querySelectorAll('mat-button-toggle button')].map((button) => button.getAttribute('aria-label'));
    expect(labels).toEqual(['System', 'Light', 'Dark']);
  });

  it('shows the sidebar and document area without Lock when authentication is disabled', async () => {
    const fixture = await render({ enabled: false, authenticated: true });
    flushWorkspace();
    await settle(fixture);
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('aside[aria-label="Fields"] app-sidebar')).not.toBeNull();
    expect(element.querySelector('main')?.textContent).toContain('Drop a PDF here or click to browse');
    expect(element.querySelector('button[aria-label="Lock"]')).toBeNull();
    expect(element.querySelector('app-unlock-screen')).toBeNull();
  });
});

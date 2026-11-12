import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders the header with the theme control in English', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
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

  it('shows the sidebar and document area in the desktop layout', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('aside[aria-label="Fields"] app-sidebar')).not.toBeNull();
    expect(element.querySelector('main')?.textContent).toContain('Drop a PDF here or click to browse');
  });
});

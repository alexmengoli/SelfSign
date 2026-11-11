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

    expect(element.querySelector('header')?.textContent).toContain('SelfSign');
    const labels = [...element.querySelectorAll('mat-button-toggle button')].map((button) => button.getAttribute('aria-label'));
    expect(labels).toEqual(['System', 'Light', 'Dark']);
  });

  it('shows the sidebar and document area in the desktop layout', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('aside[aria-label="Fields"] app-sidebar')).not.toBeNull();
    expect(element.querySelector('main')?.textContent).toContain('Open a PDF to get started.');
  });
});

import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="title">Fields</h2>
    <p class="hint">Your saved values, current values and free text will appear here.</p>
  `,
  styles: `
    :host {
      display: block;
      padding: 16px;
    }

    .title {
      margin: 0 0 8px;
      font: var(--mat-sys-title-medium);
    }

    .hint {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class Sidebar {}

import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, inject, signal } from '@angular/core';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Sidebar } from './sidebar';

@Component({
  selector: 'app-fields-sheet',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, Sidebar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown.escape)': 'dismissOnEscape($event)' },
  template: `
    <button
      matFab
      type="button"
      class="fields-fab fields-fab-close"
      aria-label="Close Fields"
      matTooltip="Close Fields"
      aria-expanded="true"
      [attr.aria-controls]="dialogId()"
      (click)="sheet.dismiss()"
    >
      <mat-icon svgIcon="close-fields" />
    </button>
    <div class="fields-sheet-content">
      <app-sidebar />
    </div>
  `,
  styles: `
    :host {
      display: block;
      position: relative;
    }

    .fields-fab-close {
      position: absolute;
      right: calc(16px + env(safe-area-inset-right, 0px));
      bottom: calc(100% + 16px);
      width: 56px;
      height: 56px;
      border-radius: 50%;
    }

    .fields-sheet-content {
      max-height: calc(100dvh - 60px - 56px - 32px - env(safe-area-inset-top, 0px));
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 8px 16px max(8px, env(safe-area-inset-bottom, 0px));
      border-radius: var(--app-panel-radius) var(--app-panel-radius) 0 0;
    }
  `,
})
export class FieldsSheet {
  protected readonly sheet = inject<MatBottomSheetRef<FieldsSheet>>(MatBottomSheetRef);
  protected readonly dialogId = signal<string | null>(null);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    afterNextRender(() => {
      this.dialogId.set(this.element.nativeElement.closest('[role="dialog"]')?.id ?? null);
    });
  }

  protected dismissOnEscape(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.sheet.dismiss();
  }
}
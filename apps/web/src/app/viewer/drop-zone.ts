import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { registerViewerIcons } from './viewer-icons';

@Component({
  selector: 'app-drop-zone',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="panel">
      <button type="button" class="target" [class.active]="dragActive()" [disabled]="busy()" (click)="fileInput.click()">
        <mat-icon svgIcon="viewer-document" class="icon" />
        <span>Drop a PDF here or click to browse</span>
      </button>
      <input #fileInput type="file" accept="application/pdf,.pdf" hidden (change)="onFileChange($event)" />
      @if (busy()) {
        <p class="status" role="status">Opening PDF...</p>
      }
      @if (error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      align-items: center;
      justify-content: center;
      min-height: 0;
      padding: 24px;
    }

    .panel {
      display: grid;
      justify-items: center;
      gap: 12px;
      max-width: 100%;
    }

    .target {
      display: grid;
      justify-items: center;
      gap: 12px;
      width: min(440px, 100%);
      padding: 40px 24px;
      border: 2px dashed var(--mat-sys-outline);
      border-radius: var(--app-panel-radius);
      background: var(--mat-sys-surface-container-low);
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-title-medium);
      cursor: pointer;

      &:hover,
      &.active {
        border-color: var(--mat-sys-primary);
        background: var(--mat-sys-surface-container);
      }

      &:focus-visible {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: 3px;
      }

      &:disabled {
        cursor: progress;
      }
    }

    .icon {
      width: 48px;
      height: 48px;
      color: var(--mat-sys-primary);
    }

    .status {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
    }

    .error {
      margin: 0;
      color: var(--mat-sys-error);
      text-align: center;
    }
  `,
})
export class DropZone {
  readonly busy = input(false);
  readonly error = input<string | null>(null);
  readonly dragActive = input(false);
  readonly fileSelected = output<File>();

  constructor() {
    registerViewerIcons(inject(MatIconRegistry), inject(DomSanitizer));
  }

  protected onFileChange(event: Event): void {
    const field = event.target as HTMLInputElement;
    const file = field.files?.[0];
    field.value = '';
    if (file) this.fileSelected.emit(file);
  }
}

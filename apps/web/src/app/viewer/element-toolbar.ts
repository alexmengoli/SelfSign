import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DomSanitizer } from '@angular/platform-browser';
import { DOCUMENT_FONTS } from '../core/document-fonts';
import type { PlacedElement, PlacedText } from './document-store';
import { registerViewerIcons } from './viewer-icons';

export interface ContentRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MARGIN = 8;
const GAP = 12;

function clamp(value: number, min: number, max: number): number {
  return max < min ? min : Math.min(max, Math.max(min, value));
}

@Component({
  selector: 'app-element-toolbar',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'element-toolbar',
    '[style.left.px]': 'left()',
    '[style.top.px]': 'top()',
  },
  template: `
    @if (textElement(); as text) {
      <select aria-label="Font" (change)="onFontChange($event)">
        @for (font of fonts; track font.family) {
          <option [value]="font.family" [selected]="font.family === text.font">{{ font.label }}</option>
        }
      </select>
      <input type="number" aria-label="Font size" min="6" max="72" step="1" [value]="text.fontSize" (change)="onSizeChange($event)" />
      <input type="color" aria-label="Color" [value]="text.color" (change)="onColorChange($event)" />
    }
    <button mat-icon-button type="button" aria-label="Duplicate" matTooltip="Duplicate" (click)="duplicate.emit()">
      <mat-icon svgIcon="viewer-duplicate" />
    </button>
    <button mat-icon-button type="button" aria-label="Delete" matTooltip="Delete" (click)="remove.emit()">
      <mat-icon svgIcon="viewer-delete" />
    </button>
  `,
  styles: `
    :host {
      position: absolute;
      z-index: 3;
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 4px;
      border-radius: 999px;
      background: var(--mat-sys-surface-container-high);
      box-shadow: var(--app-panel-shadow);
      white-space: nowrap;
    }

    select,
    input {
      height: 32px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      background: var(--mat-sys-surface);
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-body-medium);
      padding: 0 6px;
    }

    select {
      max-width: 128px;
    }

    input[type='number'] {
      width: 60px;
    }

    input[type='color'] {
      width: 36px;
      padding: 2px;
    }
  `,
})
export class ElementToolbar {
  readonly element = input.required<PlacedElement>();
  /** Bounds of the element's rotated box in content coordinates. */
  readonly anchor = input.required<ContentRect>();
  /** Visible part of the document in content coordinates. */
  readonly bounds = input.required<ContentRect>();
  readonly fontChange = output<string>();
  readonly sizeChange = output<number>();
  readonly colorChange = output<string>();
  readonly duplicate = output<void>();
  readonly remove = output<void>();

  protected readonly fonts = DOCUMENT_FONTS;
  protected readonly textElement = computed<PlacedText | null>(() => {
    const element = this.element();
    return element.kind === 'text' ? element : null;
  });
  private readonly size = signal({ width: 0, height: 0 });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly left = computed(() => {
    const anchor = this.anchor();
    const bounds = this.bounds();
    const { width } = this.size();
    return clamp(anchor.left + anchor.width / 2 - width / 2, bounds.left + MARGIN, bounds.left + bounds.width - width - MARGIN);
  });

  protected readonly top = computed(() => {
    const anchor = this.anchor();
    const bounds = this.bounds();
    const { height } = this.size();
    const above = anchor.top - height - GAP;
    if (above >= bounds.top + MARGIN) return above;
    return clamp(anchor.top + anchor.height + GAP, bounds.top + MARGIN, bounds.top + bounds.height - height - MARGIN);
  });

  constructor() {
    registerViewerIcons(inject(MatIconRegistry), inject(DomSanitizer));
    afterRenderEffect(() => {
      this.element();
      const { offsetWidth, offsetHeight } = this.host.nativeElement;
      this.size.set({ width: offsetWidth, height: offsetHeight });
    });
  }

  protected onFontChange(event: Event): void {
    this.fontChange.emit((event.target as HTMLSelectElement).value);
  }

  protected onSizeChange(event: Event): void {
    const size = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(size)) this.sizeChange.emit(size);
  }

  protected onColorChange(event: Event): void {
    this.colorChange.emit((event.target as HTMLInputElement).value);
  }
}

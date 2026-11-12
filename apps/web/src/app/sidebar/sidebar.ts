import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DomSanitizer } from '@angular/platform-browser';
import { type SavedValue } from '@selfsign/shared';
import { LayoutService } from '../core/layout.service';
import { FieldLibraryService, getApiErrorMessage } from './field-library.service';
import { ItemRow } from './item-row';
import { ConfirmDeleteDialog, ValueDialog, type ValueDialogData } from './value-dialog';

@Component({
  selector: 'app-sidebar',
  imports: [
    CdkDropList, CdkDrag, CdkDragHandle, ItemRow,
    MatButtonModule, MatDialogModule, MatIconModule,
    MatSnackBarModule, MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="title">Fields</h2>

    <section aria-labelledby="text-heading">
      <div class="section-heading">
        <h3 id="text-heading">Text</h3>
        <button mat-button type="button" (click)="openValueDialog('text')">Add text</button>
      </div>

      <div class="item-list">
        <app-item-row
          cdkDrag
          [cdkDragData]="freeTextPlacement"
          [cdkDragDisabled]="!library.documentLoaded() || layout.isMobile()"
        >
          <span rowMove class="placement-wrap" [matTooltip]="freeTextHint()">
            <button
              mat-icon-button
              type="button"
              cdkDragHandle
              [disabled]="!library.documentLoaded() || layout.isMobile()"
              aria-label="Move Text"
            ><mat-icon svgIcon="move-field" /></button>
          </span>
          <span rowContent class="item-text">Text</span>
          <span rowPlace class="placement-wrap" [matTooltip]="placementHint()">
            <button
              mat-icon-button
              type="button"
              [disabled]="!library.documentLoaded()"
              aria-label="Place Text"
              matTooltip="Place"
              (click)="placeFreeText()"
            ><mat-icon svgIcon="place-field" /></button>
          </span>
        </app-item-row>

        <app-item-row>
          <span rowContent class="date-label">
            <span>Today's date</span>
            <small>{{ library.todayPreview() }}</small>
          </span>
          <span rowPlace class="placement-wrap" [matTooltip]="placementHint()">
            <button
              mat-icon-button
              type="button"
              [disabled]="!library.documentLoaded()"
              aria-label="Place Today's date"
              matTooltip="Place"
              (click)="placeToday()"
            ><mat-icon svgIcon="place-field" /></button>
          </span>
          <button rowEdit mat-icon-button type="button" aria-label="Change date format" matTooltip="Change date format" (click)="cycleDateFormat()">
            <mat-icon svgIcon="swap-format" />
          </button>
        </app-item-row>

        @if (library.valuesState() === 'loading' && library.values().length === 0) {
          <p class="status" role="status">Loading saved values...</p>
        } @else if (library.valuesState() === 'error') {
          <div class="load-error" role="alert">
            <span>Could not load saved values.</span>
            <button mat-button type="button" (click)="retry()">Retry</button>
          </div>
        }

        <div cdkDropList class="saved-list" aria-label="Saved text values" (cdkDropListDropped)="reorder('text', $event)">
          @for (value of textValues(); track value.id) {
            <app-item-row cdkDrag>
              <button
                rowMove
                mat-icon-button
                type="button"
                class="drag-handle"
                cdkDragHandle
                [attr.aria-label]="'Move ' + value.label"
                matTooltip="Reorder"
              ><mat-icon svgIcon="move-field" /></button>
              <span rowContent class="saved-preview" [title]="value.text">{{ previewValue(value.text) }}</span>
              <span rowPlace class="placement-wrap" [matTooltip]="placementHint()">
                <button
                  mat-icon-button
                  type="button"
                  [disabled]="!library.documentLoaded()"
                  [attr.aria-label]="'Place ' + value.label"
                  matTooltip="Place"
                  (click)="placeSaved(value)"
                ><mat-icon svgIcon="place-field" /></button>
              </span>
              <button rowEdit mat-icon-button type="button" [attr.aria-label]="'Edit ' + value.label" matTooltip="Edit" (click)="openValueDialog(value.kind, value)">
                <mat-icon svgIcon="edit-field" />
              </button>
              <button rowDelete mat-icon-button type="button" [attr.aria-label]="'Delete ' + value.label" matTooltip="Delete" (click)="confirmDelete(value)">
                <mat-icon svgIcon="delete-field" />
              </button>
            </app-item-row>
          }
        </div>
      </div>
    </section>

    <section aria-labelledby="images-heading">
      <div class="section-heading">
        <h3 id="images-heading">Images</h3>
        <button mat-button type="button" (click)="openValueDialog('image')">Add image</button>
      </div>

      @if (library.valuesState() === 'loading' && library.values().length === 0) {
        <p class="status" role="status">Loading saved values...</p>
      } @else if (library.valuesState() === 'error') {
        <div class="load-error" role="alert">
          <span>Could not load saved values.</span>
          <button mat-button type="button" (click)="retry()">Retry</button>
        </div>
      }

      <div cdkDropList class="saved-list" aria-label="Saved images" (cdkDropListDropped)="reorder('image', $event)">
        @for (value of imageValues(); track value.id) {
          <app-item-row cdkDrag>
            <button
              rowMove
              mat-icon-button
              type="button"
              class="drag-handle"
              cdkDragHandle
              [attr.aria-label]="'Move ' + value.label"
              matTooltip="Reorder"
            ><mat-icon svgIcon="move-field" /></button>
            <img rowLead class="thumbnail" [src]="library.imageUrl(value)" [alt]="value.label" />
            <span rowPlace class="placement-wrap" [matTooltip]="placementHint()">
              <button
                mat-icon-button
                type="button"
                [disabled]="!library.documentLoaded()"
                [attr.aria-label]="'Place ' + value.label"
                matTooltip="Place"
                (click)="placeSaved(value)"
              ><mat-icon svgIcon="place-field" /></button>
            </span>
            <button rowEdit mat-icon-button type="button" [attr.aria-label]="'Edit ' + value.label" matTooltip="Edit" (click)="openValueDialog(value.kind, value)">
              <mat-icon svgIcon="edit-field" />
            </button>
            <button rowDelete mat-icon-button type="button" [attr.aria-label]="'Delete ' + value.label" matTooltip="Delete" (click)="confirmDelete(value)">
              <mat-icon svgIcon="delete-field" />
            </button>
          </app-item-row>
        }
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
      padding: 16px;
    }

    .title {
      margin: 0 0 16px;
      font: var(--mat-sys-title-medium);
    }

    section + section {
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid var(--mat-sys-outline-variant);
    }

    h3 {
      margin: 0;
      font: var(--mat-sys-title-small);
    }

    .section-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }

    .placement-wrap {
      display: inline-flex;
    }

    .placement-wrap button:disabled {
      color: var(--mat-sys-on-surface-variant);
    }

    .item-list,
    .saved-list {
      display: grid;
      gap: 4px;
    }

    app-item-row mat-icon {
      display: flex;
      width: 18px;
      height: 18px;
    }

    .item-text,
    .saved-preview {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .saved-preview {
      color: var(--mat-sys-on-surface-variant);
    }

    .date-label {
      display: grid;
      justify-items: start;
      gap: 2px;
      min-width: 0;
    }

    .date-label small {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .load-error {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      color: var(--mat-sys-error);
    }

    .status {
      margin: 8px 0;
      color: var(--mat-sys-on-surface-variant);
    }

    .drag-handle {
      cursor: grab;
    }

    .thumbnail {
      width: 32px;
      height: 32px;
      object-fit: contain;
      background: var(--mat-sys-surface);
    }

    .cdk-drag-preview {
      border-radius: 8px;
      background: var(--mat-sys-surface-container-high);
      box-shadow: var(--app-panel-shadow);
    }

    .cdk-drag-placeholder {
      opacity: 0.35;
    }
  `,
})
export class Sidebar {
  protected readonly library = inject(FieldLibraryService);
  protected readonly layout = inject(LayoutService);
  protected readonly freeTextPlacement = { kind: 'text', text: '' } as const;
  protected readonly textValues = computed(() => this.library.values().filter((value) => value.kind === 'text'));
  protected readonly imageValues = computed(() => this.library.values().filter((value) => value.kind === 'image'));
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly sheet = inject(MatBottomSheetRef, { optional: true });

  constructor() {
    const sanitizer = inject(DomSanitizer);
    inject(MatIconRegistry).addSvgIconLiteral('move-field', sanitizer.bypassSecurityTrustHtml(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
        <path d="M12 2 9 5h2v4h2V5h2l-3-3zM5 9l-3 3 3 3v-2h4v-2H5V9zm14 0v2h-4v2h4v2l3-3-3-3v2zm-8 6v4H9l3 3 3-3h-2v-4h-2z" />
      </svg>
    `));
    const icons = inject(MatIconRegistry);
    icons.addSvgIconLiteral('edit-field', sanitizer.bypassSecurityTrustHtml(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.04a1 1 0 0 0 0-1.42l-2.5-2.5a1 1 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 2-1.66z" /></svg>
    `));
    icons.addSvgIconLiteral('delete-field', sanitizer.bypassSecurityTrustHtml(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg>
    `));
    icons.addSvgIconLiteral('place-field', sanitizer.bypassSecurityTrustHtml(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" /></svg>
    `));
    icons.addSvgIconLiteral('swap-format', sanitizer.bypassSecurityTrustHtml(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z" /></svg>
    `));
    void this.library.load();
  }

  protected placementHint(): string {
    return this.library.documentLoaded() ? '' : 'Open a PDF to place fields';
  }

  protected freeTextHint(): string {
    if (!this.library.documentLoaded()) return 'Open a PDF to place fields';
    return this.layout.isMobile() ? '' : 'Move Text';
  }

  protected previewValue(text?: string): string {
    return text?.replace(/\s+/g, ' ').trim() ?? '';
  }

  protected placeFreeText(): void {
    this.library.placeText('');
    this.sheet?.dismiss();
  }

  protected placeToday(): void {
    this.library.placeToday();
    this.sheet?.dismiss();
  }

  protected async placeSaved(value: SavedValue): Promise<void> {
    try {
      await this.library.placeValue(value);
      this.sheet?.dismiss();
    } catch (error) {
      this.snackBar.open(getApiErrorMessage(error, 'Could not load saved value.'), 'Close', { duration: 5000 });
    }
  }

  protected openValueDialog(kind: 'text' | 'image', value?: SavedValue): void {
    this.dialog.open<ValueDialog, ValueDialogData>(ValueDialog, {
      width: 'min(440px, calc(100vw - 32px))',
      data: { kind, value },
    });
  }

  protected confirmDelete(value: SavedValue): void {
    const ref = this.dialog.open<ConfirmDeleteDialog, { label: string }, boolean>(ConfirmDeleteDialog, {
      data: { label: value.label },
    });
    ref.afterClosed().subscribe(async (confirmed) => {
      if (!confirmed) return;
      try {
        await this.library.deleteValue(value);
      } catch (error) {
        this.snackBar.open(getApiErrorMessage(error, 'Could not delete saved value.'), 'Close', { duration: 5000 });
      }
    });
  }

  protected async reorder(kind: SavedValue['kind'], event: CdkDragDrop<SavedValue[]>): Promise<void> {
    const previousValues = [...this.library.values()];
    const section = previousValues.filter((value) => value.kind === kind);
    moveItemInArray(section, event.previousIndex, event.currentIndex);
    let next = 0;
    const values = previousValues.map((value) => (value.kind === kind ? section[next++]! : value));
    this.library.values.set(values);
    try {
      await this.library.reorder(values.map(({ id }) => id));
    } catch (error) {
      this.library.values.set(previousValues);
      this.snackBar.open(getApiErrorMessage(error, 'Could not reorder saved values.'), 'Close', { duration: 5000 });
    }
  }

  protected async cycleDateFormat(): Promise<void> {
    try {
      await this.library.cycleDateFormat();
    } catch (error) {
      this.snackBar.open(getApiErrorMessage(error, 'Could not save date format.'), 'Close', { duration: 5000 });
    }
  }

  protected async retry(): Promise<void> {
    await this.library.loadValues();
  }
}
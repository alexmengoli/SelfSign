import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { SavedValue } from '@selfsign/shared';
import { FieldLibraryService, getApiErrorMessage } from './field-library.service';

export interface ValueDialogData {
  kind: 'text' | 'image';
  value?: SavedValue;
}

@Component({
  selector: 'app-value-dialog',
  imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ data.value ? 'Edit value' : 'Add value' }}</h2>
    <form [formGroup]="form" (ngSubmit)="save()">
      <mat-dialog-content class="dialog-content">
        <mat-form-field appearance="outline">
          <mat-label>Label</mat-label>
          <input matInput formControlName="label" maxlength="100" required />
          @if (form.controls.label.hasError('required')) {
            <mat-error>Label is required.</mat-error>
          } @else if (form.controls.label.hasError('maxlength')) {
            <mat-error>Label must be 100 characters or fewer.</mat-error>
          }
        </mat-form-field>

        @if (data.kind === 'text') {
          <mat-form-field appearance="outline">
            <mat-label>Value</mat-label>
            <textarea matInput formControlName="text" rows="5" required></textarea>
            @if (form.controls.text.hasError('required')) {
              <mat-error>Value is required.</mat-error>
            }
          </mat-form-field>
        } @else {
          <label class="file-label" for="image-file">Image</label>
          <input id="image-file" type="file" accept="image/png,image/jpeg" (change)="selectFile($event)" />
          @if (selectedFile) {
            <span class="file-name">{{ selectedFile.name }}</span>
          } @else if (data.value) {
            <span class="file-name">Choose a replacement image or keep the current one.</span>
          }
          @if (data.kind === 'image' && !data.value && !selectedFile && attempted()) {
            <span class="field-error">Select a PNG or JPEG image.</span>
          }
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="saving()">Save</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .dialog-content {
      display: grid;
      gap: 8px;
      min-width: min(360px, calc(100vw - 80px));
      padding-top: 8px;
    }

    mat-form-field {
      width: 100%;
    }

    .file-label {
      font: var(--mat-sys-label-large);
    }

    input[type='file'] {
      max-width: 100%;
    }

    .file-name {
      color: var(--mat-sys-on-surface-variant);
      overflow-wrap: anywhere;
    }

    .field-error {
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-small);
    }
  `,
})
export class ValueDialog {
  protected readonly data = inject<ValueDialogData>(MAT_DIALOG_DATA);
  protected readonly form = new FormGroup({
    label: new FormControl(this.data.value?.label ?? '', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    text: new FormControl(this.data.value?.text ?? '', { nonNullable: true, validators: [Validators.required] }),
  });
  protected readonly attempted = signal(false);
  protected readonly saving = signal(false);
  protected selectedFile?: File;
  private readonly library = inject(FieldLibraryService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialogRef = inject(MatDialogRef<ValueDialog, SavedValue>);

  protected selectFile(event: Event): void {
    this.selectedFile = (event.target as HTMLInputElement).files?.[0];
  }

  protected async save(): Promise<void> {
    this.attempted.set(true);
    this.form.markAllAsTouched();
    if (this.form.controls.label.invalid ||
      (this.data.kind === 'text' && this.form.controls.text.invalid) ||
      (this.data.kind === 'image' && !this.data.value && !this.selectedFile)) return;
    this.saving.set(true);
    const { label, text } = this.form.getRawValue();
    try {
      const value = this.data.value
        ? await this.library.editValue(this.data.value, label, this.data.kind === 'text' ? text : undefined, this.selectedFile)
        : this.data.kind === 'text'
          ? await this.library.addText(label, text)
          : await this.library.addImage(label, this.selectedFile!);
      this.dialogRef.close(value);
    } catch (error) {
      this.snackBar.open(getApiErrorMessage(error, 'Could not save value.'), 'Close', { duration: 5000 });
      this.saving.set(false);
    }
  }
}

@Component({
  selector: 'app-confirm-delete-dialog',
  imports: [MatButtonModule, MatDialogModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Delete "{{ data.label }}"?</h2>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button mat-flat-button type="button" [mat-dialog-close]="true">Delete</button>
    </mat-dialog-actions>
  `,
})
export class ConfirmDeleteDialog {
  protected readonly data = inject<{ label: string }>(MAT_DIALOG_DATA);
}
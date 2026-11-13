import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-unlock-screen',
  imports: [MatButtonModule, MatFormFieldModule, MatInputModule, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="unlock-panel" aria-labelledby="unlock-title">
      <img class="unlock-symbol" src="branding/selfsign-logo.svg" alt="" width="48" height="48" />
      <h1 id="unlock-title">Unlock SelfSign</h1>
      @if (auth.state() === 'unavailable') {
        <p class="unlock-message unlock-error" role="alert">Could not connect to the server.</p>
        <button #retryButton mat-flat-button type="button" (click)="retry()">Retry</button>
      } @else {
        <p class="unlock-message">Enter the password to access SelfSign.</p>
        <form [formGroup]="form" (ngSubmit)="submit()">
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>Password</mat-label>
            <input
              #passwordInput
              matInput
              type="password"
              name="password"
              autocomplete="current-password"
              formControlName="password"
              [readonly]="submitting()"
              [attr.aria-invalid]="error() ? true : null"
              [attr.aria-describedby]="error() ? 'unlock-error' : null"
            />
          </mat-form-field>
          <p id="unlock-error" class="unlock-error" role="alert">{{ error() }}</p>
          <button mat-flat-button type="submit" [disabled]="submitting()" [attr.aria-busy]="submitting()">Unlock</button>
          <span class="visually-hidden" role="status">{{ submitting() ? 'Unlocking' : '' }}</span>
        </form>
      }
    </section>
  `,
  styles: `
    :host {
      display: grid;
      place-items: center;
      min-height: 0;
      overflow-y: auto;
      padding: var(--app-surface-gap);
      background: var(--mat-sys-surface-container);
    }

    .unlock-panel {
      display: grid;
      justify-items: center;
      gap: 12px;
      box-sizing: border-box;
      width: min(400px, 100%);
      padding: 32px 24px 24px;
      border-radius: var(--app-panel-radius);
      background: var(--mat-sys-surface-container-low);
      box-shadow: var(--app-panel-shadow);
      text-align: center;
    }

    .unlock-symbol {
      display: block;
      width: 48px;
      height: 48px;
    }

    h1 {
      margin: 0;
      font: var(--mat-sys-headline-small);
      color: var(--mat-sys-on-surface);
    }

    .unlock-message {
      margin: 0;
      font: var(--mat-sys-body-medium);
      color: var(--mat-sys-on-surface-variant);
    }

    form {
      display: grid;
      gap: 8px;
      width: 100%;
      margin-top: 8px;
    }

    mat-form-field {
      width: 100%;
    }

    .unlock-error {
      min-height: 20px;
      margin: 0;
      font: var(--mat-sys-body-medium);
      color: var(--mat-sys-error);
    }

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
})
export class UnlockScreen {
  protected readonly auth = inject(AuthService);
  protected readonly form = new FormGroup({ password: new FormControl('', { nonNullable: true }) });
  protected readonly submitting = signal(false);
  protected readonly error = signal('');
  private readonly passwordInput = viewChild('passwordInput', { read: ElementRef<HTMLInputElement> });
  private readonly retryButton = viewChild('retryButton', { read: ElementRef<HTMLButtonElement> });

  constructor() {
    afterNextRender(() => this.focus());
  }

  protected async submit(): Promise<void> {
    if (this.submitting()) return;
    const password = this.form.controls.password.value;
    if (password === '') {
      this.error.set('Enter the password.');
      this.focus();
      return;
    }
    this.submitting.set(true);
    this.error.set('');
    const result = await this.auth.unlock(password);
    this.submitting.set(false);
    switch (result.kind) {
      case 'unlocked':
        return;
      case 'incorrect':
        this.error.set('Incorrect password');
        break;
      case 'throttled':
        this.error.set(`Too many attempts. Try again in ${result.retryAfterSeconds} seconds.`);
        break;
      case 'failed':
        this.error.set('Could not reach the server. Try again.');
        break;
    }
    this.passwordInput()?.nativeElement.select();
    this.focus();
  }

  protected async retry(): Promise<void> {
    await this.auth.check();
    this.focus();
  }

  private focus(): void {
    setTimeout(() => (this.passwordInput() ?? this.retryButton())?.nativeElement.focus());
  }
}

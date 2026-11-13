import { CdkDropList } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { MatBottomSheet, MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DomSanitizer } from '@angular/platform-browser';
import { AuthService } from './core/auth.service';
import { LayoutService } from './core/layout.service';
import { ThemeToggle } from './shell/theme-toggle';
import { UnlockScreen } from './shell/unlock-screen';
import { FieldsSheet } from './sidebar/fields-sheet';
import { Sidebar } from './sidebar/sidebar';
import { PdfViewer } from './viewer/pdf-viewer';

@Component({
  selector: 'app-root',
  imports: [
    CdkDropList, MatBottomSheetModule, MatButtonModule, MatIconModule, MatTooltipModule, PdfViewer, Sidebar, ThemeToggle, UnlockScreen,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly layout = inject(LayoutService);
  protected readonly fieldsOpen = signal(false);
  private readonly bottomSheet = inject(MatBottomSheet);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly fieldsFab = viewChild('fieldsFab', { read: ElementRef<HTMLButtonElement> });

  constructor() {
    const sanitizer = inject(DomSanitizer);
    inject(MatIconRegistry).addSvgIconLiteral('fields', sanitizer.bypassSecurityTrustHtml(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
        <path d="M19 5v14H5V5h14m1-2H4c-.55 0-1 .45-1 1v16c0 .55.45 1 1 1h16c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1zM11 7h6v2h-6V7zm0 4h6v2h-6v-2zm0 4h6v2h-6v-2zM7 7h2v2H7V7zm0 4h2v2H7v-2zm0 4h2v2H7v-2z" />
      </svg>
    `));
    inject(MatIconRegistry).addSvgIconLiteral('close-fields', sanitizer.bypassSecurityTrustHtml(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
        <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
      </svg>
    `));
    inject(MatIconRegistry).addSvgIconLiteral('lock', sanitizer.bypassSecurityTrustHtml(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
        <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
      </svg>
    `));
    effect(() => {
      if (!this.layout.isMobile()) {
        this.bottomSheet.dismiss();
      }
    });
    effect(() => {
      // Overlays live outside the workspace, so close them when access is lost.
      if (this.auth.state() !== 'unlocked') {
        this.bottomSheet.dismiss();
        this.dialog.closeAll();
      }
    });
    void this.auth.check();
  }

  protected async lock(): Promise<void> {
    if (!(await this.auth.lock())) {
      this.snackBar.open('Could not lock. Try again.', 'Close', { duration: 5000 });
    }
  }

  protected openFields(): void {
    if (this.fieldsOpen() || !this.layout.isMobile()) return;
    this.fieldsOpen.set(true);
    const sheet = this.bottomSheet.open(FieldsSheet, {
      ariaLabel: 'Fields',
      panelClass: 'app-fields-sheet',
      restoreFocus: false,
    });
    sheet.afterDismissed().subscribe(() => {
      this.fieldsOpen.set(false);
      this.changeDetector.detectChanges();
      this.fieldsFab()?.nativeElement.focus();
    });
  }
}

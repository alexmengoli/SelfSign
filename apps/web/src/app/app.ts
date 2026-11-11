import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { MatBottomSheet, MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DomSanitizer } from '@angular/platform-browser';
import { LayoutService } from './core/layout.service';
import { ThemeToggle } from './shell/theme-toggle';
import { FieldsSheet } from './sidebar/fields-sheet';
import { Sidebar } from './sidebar/sidebar';

@Component({
  selector: 'app-root',
  imports: [MatBottomSheetModule, MatButtonModule, MatIconModule, MatTooltipModule, Sidebar, ThemeToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly layout = inject(LayoutService);
  protected readonly fieldsOpen = signal(false);
  private readonly bottomSheet = inject(MatBottomSheet);
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
    effect(() => {
      if (!this.layout.isMobile()) {
        this.bottomSheet.dismiss();
      }
    });
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

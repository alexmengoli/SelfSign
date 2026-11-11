import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { MatBottomSheet, MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { LayoutService } from './core/layout.service';
import { ThemeToggle } from './shell/theme-toggle';
import { Sidebar } from './sidebar/sidebar';

@Component({
  selector: 'app-root',
  imports: [MatBottomSheetModule, MatButtonModule, Sidebar, ThemeToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly layout = inject(LayoutService);
  private readonly bottomSheet = inject(MatBottomSheet);

  constructor() {
    effect(() => {
      if (!this.layout.isMobile()) {
        this.bottomSheet.dismiss();
      }
    });
  }

  protected openFields(): void {
    this.bottomSheet.open(Sidebar, { ariaLabel: 'Fields', panelClass: 'app-fields-sheet' });
  }
}

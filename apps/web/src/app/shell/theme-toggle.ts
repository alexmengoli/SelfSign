import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { type ThemePreference, ThemeService } from '../core/theme.service';

@Component({
  selector: 'app-theme-toggle',
  imports: [MatButtonToggleModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-button-toggle-group
      hideSingleSelectionIndicator
      aria-label="Theme"
      [value]="theme.preference()"
      (change)="select($event.value)"
    >
      <mat-button-toggle value="system" aria-label="System" matTooltip="System">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </svg>
      </mat-button-toggle>
      <mat-button-toggle value="light" aria-label="Light" matTooltip="Light">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      </mat-button-toggle>
      <mat-button-toggle value="dark" aria-label="Dark" matTooltip="Dark">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
        </svg>
      </mat-button-toggle>
    </mat-button-toggle-group>
  `,
  styles: `
    :host {
      display: inline-flex;
    }

    mat-button-toggle-group {
      --mat-button-toggle-height: 36px;
    }

    mat-button-toggle {
      width: 40px;
      flex: none;
    }

    svg {
      display: block;
      width: 18px;
      height: 18px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `,
})
export class ThemeToggle {
  protected readonly theme = inject(ThemeService);

  protected select(preference: ThemePreference): void {
    this.theme.setPreference(preference);
  }
}

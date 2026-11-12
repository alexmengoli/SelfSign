import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-item-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="slot slot-move"><ng-content select="[rowMove]" /></span>
    <span class="slot slot-lead"><ng-content select="[rowLead]" /></span>
    <span class="slot slot-content"><ng-content select="[rowContent]" /></span>
    <span class="slot"><ng-content select="[rowPlace]" /></span>
    <span class="slot"><ng-content select="[rowEdit]" /></span>
    <span class="slot"><ng-content select="[rowDelete]" /></span>
  `,
  styles: `
    :host {
      /* Material sizes icon-button SVGs with this token; keeps them inside the 18px mat-icon boxes. */
      --mat-icon-button-icon-size: 18px;
      display: grid;
      grid-template-columns: 40px 32px minmax(0, 1fr) 40px 40px 40px;
      align-items: center;
      box-sizing: border-box;
      height: 48px;
      padding: 4px 0;
      border-radius: 8px;
      background: var(--mat-sys-surface-container);
    }

    .slot {
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 0;
      height: 40px;
    }

    .slot-content {
      flex-direction: column;
      justify-content: center;
      align-items: stretch;
      padding-inline: 8px;
      text-align: left;
    }
  `,
})
export class ItemRow {}

import { ChangeDetectionStrategy, Component, DestroyRef, effect, ElementRef, inject, input, untracked, viewChild } from '@angular/core';
import type { PDFDocumentProxy } from 'pdfjs-dist';

/** Caps canvas memory at high zoom on large pages. */
const MAX_CANVAS_PIXELS = 16_000_000;

type PdfPageProxy = Awaited<ReturnType<PDFDocumentProxy['getPage']>>;

@Component({
  selector: 'app-pdf-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #canvas aria-hidden="true"></canvas>`,
  styles: `
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
  `,
})
export class PdfPage {
  readonly pdf = input.required<PDFDocumentProxy>();
  readonly pageNumber = input.required<number>();
  readonly zoom = input.required<number>();
  /** False for pages away from the viewport; their canvas memory is released. */
  readonly active = input.required<boolean>();

  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private task: { cancel(): void } | null = null;
  private renderId = 0;

  constructor() {
    effect(() => {
      const canvas = this.canvasRef();
      const pdf = this.pdf();
      const pageNumber = this.pageNumber();
      const zoom = this.zoom();
      const active = this.active();
      if (!canvas) return;
      untracked(() => {
        if (active) void this.render(pdf, pageNumber, zoom);
        else this.release();
      });
    });
    inject(DestroyRef).onDestroy(() => this.release());
  }

  private async render(pdf: PDFDocumentProxy, pageNumber: number, zoom: number): Promise<void> {
    this.cancelRender();
    const renderId = this.renderId;
    try {
      const page: PdfPageProxy = await pdf.getPage(pageNumber);
      const canvas = this.canvasRef()?.nativeElement;
      const context = canvas?.getContext('2d');
      if (!canvas || !context || renderId !== this.renderId) return;

      const { width, height } = page.getViewport({ scale: 1 });
      const devicePixelRatio = window.devicePixelRatio || 1;
      const scale = Math.min(zoom * devicePixelRatio, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
      const viewport = page.getViewport({ scale });
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));

      const task = page.render({ canvas, canvasContext: context, viewport });
      this.task = task;
      await task.promise;
    } catch {
      // Cancelled renders and pages that cannot be drawn stay blank.
    }
  }

  private cancelRender(): void {
    this.renderId++;
    this.task?.cancel();
    this.task = null;
  }

  private release(): void {
    this.cancelRender();
    const canvas = this.canvasRef()?.nativeElement;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

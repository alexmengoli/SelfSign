import { CdkDragDrop } from '@angular/cdk/drag-drop';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DomSanitizer } from '@angular/platform-browser';
import { registerDocumentFonts } from '../core/font-files';
import { downloadPdf } from '../export/download';
import { exportFileName } from '../export/export-geometry';
import { exportPdf, preloadPdfExport } from '../export/pdf-export';
import { FieldLibraryService, type FieldPlacement } from '../sidebar/field-library.service';
import { ConfirmCloseDialog } from './close-dialog';
import { DropZone } from './drop-zone';
import {
  boundsHalfExtents,
  boxCenter,
  clampFontSize,
  localSizeAt,
  MIN_IMAGE_WIDTH,
  NUDGE_STEP,
  placeCenteredOnPage,
  type PointXY,
  resizeFrame,
  type ResizeFrame,
  rotationFromPointer,
  SHIFT_NUDGE_STEP,
  snapRotation,
} from './geometry';
import { type ContentRect, ElementToolbar } from './element-toolbar';
import {
  DEFAULT_IMAGE_WIDTH,
  DEFAULT_TEXT_FONT,
  DEFAULT_TEXT_SIZE,
  DocumentStore,
  type PlacedElement,
} from './document-store';
import { clampZoom, computeLayout, currentPageIndex, fitPageZoom, fitWidthZoom, MAX_ZOOM, MIN_ZOOM, nearestPageAnchor, nextZoomPreset, pageIndexAt, pageScrollTop, visiblePageRange } from './layout';
import { PdfPage } from './pdf-page';
import { INVALID_PDF_MESSAGE, openPdf, PdfOpenError, type PageSize } from './pdf-source';
import { measureTextBox } from './text-metrics';
import { registerViewerIcons } from './viewer-icons';

const DRAG_THRESHOLD_PX = 3;
const EXPORT_FAILED_MESSAGE = 'Export failed. Your document was not changed.';
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 24;
/** Room kept free above and below a selected element for its rotate handle. */
const ROTATE_HANDLE_SPACE = 36;
const ARROW_DIRECTIONS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

type ZoomMode = 'fitWidth' | 'fitPage' | 'custom';

interface ElementView {
  element: PlacedElement;
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  selected: boolean;
  editing: boolean;
  anchor: ContentRect;
}

interface PagePoint {
  pageIndex: number;
  x: number;
  y: number;
}

interface DropPreview {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MoveGesture {
  kind: 'move';
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  grabX: number;
  grabY: number;
  before: PlacedElement;
}

interface ResizeGesture {
  kind: 'resize';
  id: string;
  pointerId: number;
  before: PlacedElement;
  frame: ResizeFrame;
  startWidth: number;
  startFontSize: number;
  aspect: number;
}

interface RotateGesture {
  kind: 'rotate';
  id: string;
  pointerId: number;
  before: PlacedElement;
}

type Gesture = MoveGesture | ResizeGesture | RotateGesture;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function isInDialogOverlay(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.cdk-overlay-container') !== null;
}

function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function touchDistance(touches: TouchList): number {
  return Math.hypot(touches[0]!.clientX - touches[1]!.clientX, touches[0]!.clientY - touches[1]!.clientY);
}

@Component({
  selector: 'app-pdf-viewer',
  imports: [DropZone, ElementToolbar, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, PdfPage],
  providers: [DocumentStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pdf-viewer.html',
  styleUrl: './pdf-viewer.scss',
  host: {
    class: 'viewer-host',
    '(window:dragover)': 'onWindowDragOver($event)',
    '(window:dragleave)': 'onWindowDragLeave($event)',
    '(window:drop)': 'onWindowDrop($event)',
    '(window:keydown)': 'onWindowKeydown($event)',
    '(window:beforeunload)': 'onBeforeUnload($event)',
  },
})
export class PdfViewer {
  protected readonly store = inject(DocumentStore);
  private readonly fieldLibrary = inject(FieldLibraryService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly injector = inject(Injector);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly editor = viewChild<ElementRef<HTMLTextAreaElement>>('editor');

  protected readonly opening = signal(false);
  protected readonly exporting = signal(false);
  protected readonly canExport = computed(() => this.store.elements().length > 0);
  protected readonly openError = signal<string | null>(null);
  protected readonly fileDragActive = signal(false);
  protected readonly zoomMode = signal<ZoomMode>('fitWidth');
  private readonly customZoom = signal(1);
  private readonly viewport = signal({ width: 0, height: 0 });
  private readonly scrollPosition = signal({ left: 0, top: 0 });
  private readonly dropPreview = signal<DropPreview | null>(null);
  private readonly dropPreviewSize = measureTextBox('', DEFAULT_TEXT_FONT, DEFAULT_TEXT_SIZE);

  protected readonly minZoom = MIN_ZOOM;
  protected readonly maxZoom = MAX_ZOOM;
  protected readonly nextZoomPreset = nextZoomPreset;
  protected readonly pageCount = computed(() => this.store.document()?.pages.length ?? 0);
  protected readonly zoom = computed(() => {
    const pages: readonly PageSize[] = this.store.document()?.pages ?? [];
    const viewport = this.viewport();
    switch (this.zoomMode()) {
      case 'fitWidth':
        return fitWidthZoom(viewport.width, pages);
      case 'fitPage':
        return fitPageZoom(viewport.width, viewport.height, pages);
      case 'custom':
        return clampZoom(this.customZoom());
    }
  });
  protected readonly zoomPercent = computed(() => Math.round(this.zoom() * 100));
  protected readonly layout = computed(() =>
    computeLayout(this.store.document()?.pages ?? [], this.zoom(), this.viewport().width));
  protected readonly currentIndex = computed(() =>
    currentPageIndex(this.layout(), this.scrollPosition().top, this.viewport().height));
  /** Pages within one screen of the viewport; only these keep canvas memory. */
  protected readonly renderRange = computed(() =>
    visiblePageRange(this.layout(), this.scrollPosition().top - this.viewport().height, this.viewport().height * 3));
  protected readonly viewportRect = computed<ContentRect>(() => ({
    left: this.scrollPosition().left,
    top: this.scrollPosition().top,
    width: this.viewport().width,
    height: this.viewport().height,
  }));
  protected readonly elementViews = computed(() => this.buildElementViews());
  protected readonly selectedView = computed(() => this.elementViews().find((view) => view.selected) ?? null);
  protected readonly previewView = computed(() => {
    const preview = this.dropPreview();
    const page = preview ? this.layout().pages[preview.pageIndex] : undefined;
    if (!preview || !page) return null;
    const zoom = this.zoom();
    return {
      left: page.left + preview.x * zoom,
      top: page.top + preview.y * zoom,
      width: preview.width * zoom,
      height: preview.height * zoom,
    };
  });

  private gesture: Gesture | null = null;
  private lastTap: { id: string; time: number; x: number; y: number } | null = null;
  private readonly gestureMove = (event: PointerEvent) => this.updateGesture(event);
  private readonly gestureEnd = (event: PointerEvent) => this.finishGesture(event, false);
  private readonly gestureCancel = (event: PointerEvent) => this.finishGesture(event, true);
  private readonly dropMove = (event: PointerEvent) => this.updateDropPreview(event.clientX, event.clientY);

  constructor() {
    registerViewerIcons(inject(MatIconRegistry), inject(DomSanitizer));
    this.fieldLibrary.placementRequests
      .pipe(takeUntilDestroyed())
      .subscribe((placement) => void this.placeFromSidebar(placement));

    effect((onCleanup) => {
      const element = this.scroller()?.nativeElement;
      if (!element) return;
      const measure = () => this.viewport.set({ width: element.clientWidth, height: element.clientHeight });
      measure();
      const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
      observer?.observe(element);

      let pinch: { distance: number; zoom: number } | null = null;
      const onWheel = (event: WheelEvent) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        const rect = element.getBoundingClientRect();
        this.changeZoom('custom', clampZoom(this.zoom() * Math.exp(-event.deltaY * 0.0025)), {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      };
      const onTouchStart = (event: TouchEvent) => {
        if (event.touches.length === 2) pinch = { distance: touchDistance(event.touches), zoom: this.zoom() };
      };
      const onTouchMove = (event: TouchEvent) => {
        if (!pinch || event.touches.length !== 2) return;
        event.preventDefault();
        const rect = element.getBoundingClientRect();
        const [first, second] = [event.touches[0]!, event.touches[1]!];
        this.changeZoom('custom', clampZoom(pinch.zoom * (touchDistance(event.touches) / pinch.distance)), {
          x: (first.clientX + second.clientX) / 2 - rect.left,
          y: (first.clientY + second.clientY) / 2 - rect.top,
        });
      };
      const onTouchEnd = (event: TouchEvent) => {
        if (event.touches.length < 2) pinch = null;
      };
      element.addEventListener('wheel', onWheel, { passive: false });
      element.addEventListener('touchstart', onTouchStart, { passive: true });
      element.addEventListener('touchmove', onTouchMove, { passive: false });
      element.addEventListener('touchend', onTouchEnd);
      element.addEventListener('touchcancel', onTouchEnd);
      onCleanup(() => {
        observer?.disconnect();
        element.removeEventListener('wheel', onWheel);
        element.removeEventListener('touchstart', onTouchStart);
        element.removeEventListener('touchmove', onTouchMove);
        element.removeEventListener('touchend', onTouchEnd);
        element.removeEventListener('touchcancel', onTouchEnd);
      });
    });
  }

  protected onWindowDragOver(event: DragEvent): void {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    const loaded = this.store.document() !== null;
    if (event.dataTransfer) event.dataTransfer.dropEffect = loaded ? 'none' : 'copy';
    this.fileDragActive.set(!loaded);
  }

  protected onWindowDragLeave(event: DragEvent): void {
    if (carriesFiles(event) && event.relatedTarget === null) this.fileDragActive.set(false);
  }

  protected onWindowDrop(event: DragEvent): void {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    this.fileDragActive.set(false);
    const file = event.dataTransfer?.files[0];
    if (file && !this.store.document()) void this.openFile(file);
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.store.elements().length === 0) return;
    event.preventDefault();
    event.returnValue = '';
  }

  protected onWindowKeydown(event: KeyboardEvent): void {
    if (!this.store.document() || this.store.editing() || event.defaultPrevented) return;
    if (isTypingTarget(event.target) || isInDialogOverlay(event.target)) return;
    const selectedId = this.store.selectedId();
    const key = event.key.toLowerCase();
    if (event.ctrlKey || event.metaKey) {
      if (event.altKey) return;
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) this.store.redo();
        else this.store.undo();
      } else if (key === 'y') {
        event.preventDefault();
        this.store.redo();
      } else if (key === 'd' && selectedId) {
        event.preventDefault();
        this.store.duplicate(selectedId);
      }
      return;
    }
    if (event.key === 'Escape') {
      this.store.select(null);
      return;
    }
    if (!selectedId) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.store.remove(selectedId);
      return;
    }
    const direction = ARROW_DIRECTIONS[event.key];
    if (direction) {
      event.preventDefault();
      const step = event.shiftKey ? SHIFT_NUDGE_STEP : NUDGE_STEP;
      this.store.nudge(selectedId, direction[0] * step, direction[1] * step);
    }
  }

  protected async openFile(file: File): Promise<void> {
    if (this.opening() || this.store.document()) return;
    this.opening.set(true);
    this.openError.set(null);
    try {
      const buffer = await file.arrayBuffer();
      const opened = await openPdf(buffer);
      await registerDocumentFonts();
      this.store.open({ name: file.name, buffer, ...opened });
      this.zoomMode.set('fitWidth');
      this.fieldLibrary.documentLoaded.set(true);
      preloadPdfExport();
    } catch (error) {
      if (!(error instanceof PdfOpenError)) console.error('PDF could not be opened:', error);
      this.openError.set(error instanceof PdfOpenError ? error.message : INVALID_PDF_MESSAGE);
    } finally {
      this.opening.set(false);
    }
  }

  protected requestClose(): void {
    if (this.store.elements().length === 0) {
      this.closeDocument();
      return;
    }
    this.dialog
      .open<ConfirmCloseDialog, void, boolean>(ConfirmCloseDialog)
      .afterClosed()
      .subscribe((confirmed) => {
        if (confirmed) this.closeDocument();
      });
  }

  /** Builds the signed copy in the browser; the open document and its elements stay as they are. */
  protected async exportDocument(): Promise<void> {
    const loaded = this.store.document();
    if (!loaded || this.exporting() || !this.canExport()) return;
    this.exporting.set(true);
    try {
      this.store.endTextEdit();
      const bytes = await exportPdf({ buffer: loaded.buffer, pages: loaded.pages, elements: this.store.elements() });
      if (this.store.document() === loaded) downloadPdf(bytes, exportFileName(loaded.name));
    } catch (error) {
      console.error('PDF export failed:', error);
      this.snackBar.open(EXPORT_FAILED_MESSAGE, 'Close', { duration: 8000 });
    } finally {
      this.exporting.set(false);
    }
  }

  protected onScroll(event: Event): void {
    const element = event.target as HTMLElement;
    this.scrollPosition.set({ left: element.scrollLeft, top: element.scrollTop });
  }

  /** Changes zoom and keeps the content under `anchor` (viewport pixels, default center) in place. */
  protected changeZoom(mode: ZoomMode, zoom: number | null, anchor?: PointXY): void {
    const element = this.scroller()?.nativeElement;
    const anchorX = anchor?.x ?? (element?.clientWidth ?? 0) / 2;
    const anchorY = anchor?.y ?? (element?.clientHeight ?? 0) / 2;
    const located = element ? nearestPageAnchor(this.layout(), element.scrollLeft + anchorX, element.scrollTop + anchorY) : null;
    this.zoomMode.set(mode);
    if (zoom !== null) this.customZoom.set(zoom);
    if (!element || !located) return;
    afterNextRender(() => {
      const box = this.layout().pages[located.index];
      if (!box) return;
      element.scrollLeft = box.left + located.fx * box.width - anchorX;
      element.scrollTop = box.top + located.fy * box.height - anchorY;
      this.scrollPosition.set({ left: element.scrollLeft, top: element.scrollTop });
    }, { injector: this.injector });
  }

  protected goToPage(index: number): void {
    const element = this.scroller()?.nativeElement;
    if (!element) return;
    const target = Math.min(this.pageCount() - 1, Math.max(0, index));
    element.scrollTop = pageScrollTop(this.layout(), target);
  }

  protected onPageInputKeydown(event: KeyboardEvent): void {
    const field = event.target as HTMLInputElement;
    if (event.key === 'Escape') {
      field.value = String(this.currentIndex() + 1);
      field.blur();
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const page = Number(field.value.trim());
    if (Number.isInteger(page) && page >= 1 && page <= this.pageCount()) {
      this.goToPage(page - 1);
      field.value = String(page);
    } else {
      field.value = String(this.currentIndex() + 1);
    }
  }

  protected resetPageInput(event: FocusEvent): void {
    (event.target as HTMLInputElement).value = String(this.currentIndex() + 1);
  }

  protected onContentPointerDown(event: PointerEvent): void {
    const target = event.target as Element;
    if (target.closest('.element-toolbar')) return;
    const editing = this.store.editing();
    const elementId = target.closest<HTMLElement>('[data-element-id]')?.dataset['elementId'];
    if (editing && elementId === editing.elementId) return;
    if (editing) this.store.endTextEdit();
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (!elementId) {
      this.store.select(null);
      return;
    }
    const handle = target.closest<HTMLElement>('[data-handle]')?.dataset['handle'];
    if (handle === 'resize') this.beginResize(elementId, event);
    else if (handle === 'rotate') this.beginRotate(elementId, event);
    else this.beginMove(elementId, event);
  }

  protected onEditInput(event: Event): void {
    this.store.setEditingText((event.target as HTMLTextAreaElement).value);
  }

  protected onEditKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    this.store.endTextEdit();
  }

  /** Drag from the sidebar entered the document area: show the placement preview on pages. */
  dragEntered(): void {
    window.addEventListener('pointermove', this.dropMove);
  }

  dragExited(): void {
    window.removeEventListener('pointermove', this.dropMove);
    this.dropPreview.set(null);
  }

  /** Drops a sidebar item at the pointer; nothing is placed outside a page. */
  dropPlacement(event: CdkDragDrop<unknown>): void {
    this.dragExited();
    const placement = event.item.data as FieldPlacement | undefined;
    const point = this.pagePoint(event.dropPoint.x, event.dropPoint.y);
    if (!placement || !point || !this.store.document()) return;
    const center = { x: point.x, y: point.y };
    if (placement.kind === 'text') this.placeText(placement.text, point.pageIndex, center);
    else void this.placeImageFromUrl(placement.imageUrl, point.pageIndex, center);
  }

  private closeDocument(): void {
    this.gesture = null;
    this.stopGestureListeners();
    this.lastTap = null;
    this.dragExited();
    this.store.close();
    this.zoomMode.set('fitWidth');
    this.customZoom.set(1);
    this.scrollPosition.set({ left: 0, top: 0 });
    this.fieldLibrary.documentLoaded.set(false);
  }

  private buildElementViews(): ElementView[] {
    const layout = this.layout();
    const zoom = this.zoom();
    const selectedId = this.store.selectedId();
    const editingId = this.store.editing()?.elementId;
    const views: ElementView[] = [];
    for (const element of this.store.elements()) {
      const page = layout.pages[element.pageIndex];
      if (!page) continue;
      const left = page.left + element.x * zoom;
      const top = page.top + element.y * zoom;
      const width = element.width * zoom;
      const height = element.height * zoom;
      const half = boundsHalfExtents(width, height, element.rotation);
      const centerX = left + width / 2;
      const centerY = top + height / 2;
      views.push({
        element,
        left,
        top,
        width,
        height,
        fontSize: element.kind === 'text' ? element.fontSize * zoom : 0,
        fontFamily: element.kind === 'text' ? `"${element.font}", sans-serif` : 'inherit',
        selected: element.id === selectedId,
        editing: element.id === editingId,
        anchor: { left: centerX - half.x, top: centerY - half.y - ROTATE_HANDLE_SPACE, width: half.x * 2, height: half.y * 2 + ROTATE_HANDLE_SPACE * 2 },
      });
    }
    return views;
  }

  private contentPoint(clientX: number, clientY: number): PointXY | null {
    const element = this.scroller()?.nativeElement;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: clientX - rect.left + element.scrollLeft, y: clientY - rect.top + element.scrollTop };
  }

  /** Page point under the pointer, or null when the pointer is outside every page. */
  private pagePoint(clientX: number, clientY: number): PagePoint | null {
    const point = this.contentPoint(clientX, clientY);
    if (!point) return null;
    const pageIndex = pageIndexAt(this.layout(), point.x, point.y);
    const page = this.layout().pages[pageIndex];
    if (pageIndex < 0 || !page) return null;
    const zoom = this.zoom();
    return { pageIndex, x: (point.x - page.left) / zoom, y: (point.y - page.top) / zoom };
  }

  /** Pointer position in points on a given page, even when it lies outside the page. */
  private pointOnPage(pageIndex: number, clientX: number, clientY: number): PointXY {
    const point = this.contentPoint(clientX, clientY);
    const page = this.layout().pages[pageIndex];
    if (!point || !page) return { x: 0, y: 0 };
    const zoom = this.zoom();
    return { x: (point.x - page.left) / zoom, y: (point.y - page.top) / zoom };
  }

  private beginMove(id: string, event: PointerEvent): void {
    const element = this.store.get(id);
    if (!element) return;
    this.store.select(id);
    const center = boxCenter(element);
    const pointer = this.pointOnPage(element.pageIndex, event.clientX, event.clientY);
    this.gesture = {
      kind: 'move',
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      grabX: pointer.x - center.x,
      grabY: pointer.y - center.y,
      before: element,
    };
    this.startGestureListeners();
  }

  private beginResize(id: string, event: PointerEvent): void {
    const element = this.store.get(id);
    if (!element) return;
    this.store.select(id);
    this.gesture = {
      kind: 'resize',
      id,
      pointerId: event.pointerId,
      before: element,
      frame: resizeFrame(element),
      startWidth: element.width,
      startFontSize: element.kind === 'text' ? element.fontSize : 0,
      aspect: element.width / element.height,
    };
    this.startGestureListeners();
  }

  private beginRotate(id: string, event: PointerEvent): void {
    const element = this.store.get(id);
    if (!element) return;
    this.store.select(id);
    this.gesture = { kind: 'rotate', id, pointerId: event.pointerId, before: element };
    this.startGestureListeners();
  }

  private updateGesture(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (gesture.kind === 'move') this.updateMove(gesture, event);
    else if (gesture.kind === 'resize') this.updateResize(gesture, event);
    else this.updateRotate(gesture, event);
  }

  private updateMove(gesture: MoveGesture, event: PointerEvent): void {
    if (!gesture.moved && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < DRAG_THRESHOLD_PX) return;
    gesture.moved = true;
    const point = this.pagePoint(event.clientX, event.clientY);
    if (!point) return;
    this.store.moveLive(gesture.id, point.pageIndex, { x: point.x - gesture.grabX, y: point.y - gesture.grabY });
  }

  private updateResize(gesture: ResizeGesture, event: PointerEvent): void {
    const element = this.store.get(gesture.id);
    if (!element) return;
    const local = localSizeAt(gesture.frame, this.pointOnPage(element.pageIndex, event.clientX, event.clientY));
    if (element.kind === 'image') {
      const width = Math.max(MIN_IMAGE_WIDTH, local.width);
      this.store.resizeImageLive(gesture.id, gesture.frame, width, width / gesture.aspect);
      return;
    }
    const scale = gesture.startWidth > 0 ? local.width / gesture.startWidth : 1;
    this.store.resizeTextLive(gesture.id, clampFontSize(gesture.startFontSize * scale));
  }

  private updateRotate(gesture: RotateGesture, event: PointerEvent): void {
    const element = this.store.get(gesture.id);
    if (!element) return;
    let rotation = rotationFromPointer(boxCenter(element), this.pointOnPage(element.pageIndex, event.clientX, event.clientY));
    if (event.shiftKey) rotation = snapRotation(rotation);
    this.store.rotateLive(gesture.id, rotation);
  }

  private finishGesture(event: PointerEvent, cancelled: boolean): void {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    this.gesture = null;
    this.stopGestureListeners();
    if (gesture.kind === 'move') {
      if (!gesture.moved) {
        if (!cancelled) this.registerTap(gesture.id, event);
        return;
      }
      if (cancelled || !this.pagePoint(event.clientX, event.clientY)) this.store.restoreSnapshot(gesture.before);
      else this.store.recordGesture(gesture.before, 'move');
      return;
    }
    if (cancelled) this.store.restoreSnapshot(gesture.before);
    else this.store.recordGesture(gesture.before, gesture.kind);
  }

  /** Two quick taps on a text element start editing it; works for mouse and touch. */
  private registerTap(id: string, event: PointerEvent): void {
    const now = performance.now();
    const previous = this.lastTap;
    this.lastTap = { id, time: now, x: event.clientX, y: event.clientY };
    if (!previous || previous.id !== id || now - previous.time > DOUBLE_TAP_MS ||
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) > DOUBLE_TAP_PX) {
      return;
    }
    this.lastTap = null;
    if (this.store.get(id)?.kind === 'text') this.startEditing(id, false);
  }

  private startGestureListeners(): void {
    window.addEventListener('pointermove', this.gestureMove);
    window.addEventListener('pointerup', this.gestureEnd);
    window.addEventListener('pointercancel', this.gestureCancel);
  }

  private stopGestureListeners(): void {
    window.removeEventListener('pointermove', this.gestureMove);
    window.removeEventListener('pointerup', this.gestureEnd);
    window.removeEventListener('pointercancel', this.gestureCancel);
  }

  private startEditing(id: string, pending: boolean): void {
    this.store.beginTextEdit(id, pending);
    afterNextRender(() => {
      const textarea = this.editor()?.nativeElement;
      const element = this.store.get(id);
      if (!textarea || element?.kind !== 'text') return;
      textarea.value = element.text;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }, { injector: this.injector });
  }

  private updateDropPreview(clientX: number, clientY: number): void {
    const point = this.pagePoint(clientX, clientY);
    if (!point) {
      this.dropPreview.set(null);
      return;
    }
    const box = placeCenteredOnPage(
      { x: 0, y: 0, width: this.dropPreviewSize.width, height: this.dropPreviewSize.height, rotation: 0 },
      point,
      this.store.pageSize(point.pageIndex),
    );
    this.dropPreview.set({ pageIndex: point.pageIndex, x: box.x, y: box.y, width: box.width, height: box.height });
  }

  private async placeFromSidebar(placement: FieldPlacement): Promise<void> {
    if (!this.store.document()) return;
    const pageIndex = this.currentIndex();
    const center = this.visibleCenter(pageIndex);
    if (placement.kind === 'text') {
      this.placeText(placement.text, pageIndex, center);
      return;
    }
    await this.placeImageFromUrl(placement.imageUrl, pageIndex, center);
  }

  /** Center of the part of a page that is currently visible; the page center when none is visible. */
  private visibleCenter(pageIndex: number): PointXY {
    const element = this.scroller()?.nativeElement;
    const page = this.layout().pages[pageIndex];
    const size = this.store.pageSize(pageIndex);
    if (!element || !page) return { x: size.width / 2, y: size.height / 2 };
    const left = Math.max(page.left, element.scrollLeft);
    const right = Math.min(page.left + page.width, element.scrollLeft + element.clientWidth);
    const top = Math.max(page.top, element.scrollTop);
    const bottom = Math.min(page.top + page.height, element.scrollTop + element.clientHeight);
    if (right <= left || bottom <= top) return { x: size.width / 2, y: size.height / 2 };
    const zoom = this.zoom();
    return { x: ((left + right) / 2 - page.left) / zoom, y: ((top + bottom) / 2 - page.top) / zoom };
  }

  private placeText(text: string, pageIndex: number, center: PointXY): void {
    if (!this.store.document()) return;
    const element = this.store.createText({ pageIndex, center, text });
    if (text.trim() === '') {
      this.store.insertPending(element);
      this.startEditing(element.id, true);
      return;
    }
    this.store.addElement(element);
  }

  private async placeImageFromUrl(url: string, pageIndex: number, center: PointXY): Promise<void> {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Image request failed with ${response.status}`);
      await this.placeImage(await response.blob(), pageIndex, center);
    } catch {
      this.snackBar.open('Could not place image.', 'Close', { duration: 5000 });
    }
  }

  private async placeImage(blob: Blob, pageIndex: number, center: PointXY): Promise<void> {
    try {
      const bitmap = await createImageBitmap(blob);
      const aspect = bitmap.height / bitmap.width;
      bitmap.close();
      if (!this.store.document()) return;
      const width = DEFAULT_IMAGE_WIDTH;
      this.store.addElement(this.store.createImage({
        pageIndex,
        center,
        blob,
        imageUrl: this.store.createObjectUrl(blob),
        width,
        height: width * aspect,
      }));
    } catch {
      this.snackBar.open('Could not place image.', 'Close', { duration: 5000 });
    }
  }
}

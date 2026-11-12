import { computed, Injectable, signal } from '@angular/core';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { DEFAULT_DOCUMENT_FONT_ID, DOCUMENT_FONTS } from '../core/document-fonts';
import { CommandHistory, type Command } from './command-history';
import {
  boundsHalfExtents,
  boxCenter,
  boxFromFrame,
  clampFontSize,
  DUPLICATE_OFFSET,
  fitsOnPage,
  placeCenteredOnPage,
  resizeFrame,
  type PageDimensions,
  type PointXY,
  type ResizeFrame,
} from './geometry';
import type { PageSize } from './pdf-source';
import { measureTextBox } from './text-metrics';

export const DEFAULT_TEXT_FONT = DOCUMENT_FONTS.find((font) => font.id === DEFAULT_DOCUMENT_FONT_ID)?.family ?? 'Noto Sans';
export const DEFAULT_TEXT_SIZE = 12;
export const DEFAULT_TEXT_COLOR = '#000000';
export const DEFAULT_IMAGE_WIDTH = 150;

const NUDGE_MERGE_WINDOW_MS = 1000;
const FALLBACK_PAGE: PageDimensions = { width: 612, height: 792 };

export interface LoadedDocument {
  name: string;
  /** Original file bytes, kept unchanged for export. */
  buffer: ArrayBuffer;
  pdf: PDFDocumentProxy;
  pages: PageSize[];
  destroy: () => Promise<void>;
}

interface ElementBase {
  id: string;
  /** Zero-based page index. */
  pageIndex: number;
  /** Top-left of the unrotated box in page points, top-left origin. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, clockwise, about the box center. */
  rotation: number;
}

export interface PlacedText extends ElementBase {
  kind: 'text';
  text: string;
  font: string;
  fontSize: number;
  color: string;
}

export interface PlacedImage extends ElementBase {
  kind: 'image';
  imageBlob: Blob;
  imageUrl: string;
}

export type PlacedElement = PlacedText | PlacedImage;

export type ElementPatch = Partial<Omit<ElementBase, 'id'>> & Partial<Pick<PlacedText, 'text' | 'font' | 'fontSize' | 'color'>>;

export interface EditSession {
  elementId: string;
  /** State before editing began; null for a new free text element that is not yet in history. */
  snapshot: PlacedElement | null;
}

class ElementUpdate implements Command {
  at = Date.now();
  after: PlacedElement;

  constructor(
    readonly label: string,
    readonly key: string | undefined,
    private readonly before: PlacedElement,
    after: PlacedElement,
    private readonly write: (element: PlacedElement) => void,
  ) {
    this.after = after;
  }

  undo(): void {
    this.write(this.before);
  }

  redo(): void {
    this.write(this.after);
  }
}

function sameElementState(a: PlacedElement, b: PlacedElement): boolean {
  if (a.kind !== b.kind || a.pageIndex !== b.pageIndex || a.x !== b.x || a.y !== b.y ||
    a.width !== b.width || a.height !== b.height || a.rotation !== b.rotation) {
    return false;
  }
  if (a.kind === 'text' && b.kind === 'text') {
    return a.text === b.text && a.font === b.font && a.fontSize === b.fontSize && a.color === b.color;
  }
  return true;
}

function newElementId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Element model for one open document; every user change goes through here so undo and redo stay consistent. */
@Injectable()
export class DocumentStore {
  readonly document = signal<LoadedDocument | null>(null);
  readonly elements = signal<readonly PlacedElement[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly editing = signal<EditSession | null>(null);

  private readonly history = new CommandHistory();
  private readonly historyVersion = signal(0);
  private readonly objectUrls = new Set<string>();

  readonly canUndo = computed(() => {
    this.historyVersion();
    return this.history.canUndo;
  });

  readonly canRedo = computed(() => {
    this.historyVersion();
    return this.history.canRedo;
  });

  open(loaded: LoadedDocument): void {
    this.reset();
    this.document.set(loaded);
  }

  close(): void {
    const loaded = this.document();
    this.reset();
    this.document.set(null);
    void loaded?.destroy();
  }

  createObjectUrl(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.objectUrls.add(url);
    return url;
  }

  get(id: string): PlacedElement | undefined {
    return this.elements().find((element) => element.id === id);
  }

  pageSize(pageIndex: number): PageDimensions {
    return this.document()?.pages[pageIndex] ?? FALLBACK_PAGE;
  }

  createText(input: { pageIndex: number; center: PointXY; text: string }): PlacedText {
    const box = measureTextBox(input.text, DEFAULT_TEXT_FONT, DEFAULT_TEXT_SIZE);
    const placed = placeCenteredOnPage(
      { x: 0, y: 0, width: box.width, height: box.height, rotation: 0 },
      input.center,
      this.pageSize(input.pageIndex),
    );
    return {
      ...placed,
      id: newElementId(),
      kind: 'text',
      pageIndex: input.pageIndex,
      text: input.text,
      font: DEFAULT_TEXT_FONT,
      fontSize: DEFAULT_TEXT_SIZE,
      color: DEFAULT_TEXT_COLOR,
    };
  }

  createImage(input: { pageIndex: number; center: PointXY; blob: Blob; imageUrl: string; width: number; height: number }): PlacedImage {
    const placed = placeCenteredOnPage(
      { x: 0, y: 0, width: input.width, height: input.height, rotation: 0 },
      input.center,
      this.pageSize(input.pageIndex),
    );
    return {
      ...placed,
      id: newElementId(),
      kind: 'image',
      pageIndex: input.pageIndex,
      imageBlob: input.blob,
      imageUrl: input.imageUrl,
    };
  }

  /** Adds an element as one undoable step. */
  addElement(element: PlacedElement): void {
    const index = this.elements().length;
    this.elements.update((list) => [...list, element]);
    this.selectedId.set(element.id);
    this.recordInsert(element, index);
  }

  /** Adds a free text element; it becomes an undoable step when its first editing session ends. */
  insertPending(element: PlacedElement): void {
    this.elements.update((list) => [...list, element]);
    this.selectedId.set(element.id);
  }

  select(id: string | null): void {
    this.selectedId.set(id);
  }

  remove(id: string): void {
    const index = this.elements().findIndex((element) => element.id === id);
    const element = this.elements()[index];
    if (!element) return;
    this.removeById(id);
    this.recordRemove(element, index);
  }

  duplicate(id: string): void {
    const source = this.get(id);
    if (!source) return;
    const offset = { ...source, x: source.x + DUPLICATE_OFFSET, y: source.y + DUPLICATE_OFFSET };
    const placed = placeCenteredOnPage(offset, boxCenter(offset), this.pageSize(source.pageIndex));
    this.addElement({ ...source, id: newElementId(), x: placed.x, y: placed.y });
  }

  nudge(id: string, dx: number, dy: number): void {
    const element = this.get(id);
    if (!element) return;
    this.writeElement(id, { x: element.x + dx, y: element.y + dy });
    this.recordReplacement(element, 'move', `nudge:${id}:${dx}:${dy}`);
  }

  /** Places the element on a page with its center near `center`, clamped inside the page. */
  moveLive(id: string, pageIndex: number, center: PointXY): void {
    const element = this.get(id);
    if (!element) return;
    const moved = { ...element, pageIndex };
    const placed = placeCenteredOnPage(moved, center, this.pageSize(pageIndex));
    this.writeElement(id, { pageIndex, x: placed.x, y: placed.y });
  }

  rotateLive(id: string, rotation: number): void {
    const element = this.get(id);
    if (!element) return;
    const half = boundsHalfExtents(element.width, element.height, rotation);
    const page = this.pageSize(element.pageIndex);
    if (2 * half.x > page.width || 2 * half.y > page.height) return;
    this.writeElement(id, { rotation });
  }

  resizeImageLive(id: string, frame: ResizeFrame, width: number, height: number): boolean {
    return this.tryWrite(id, boxFromFrame(frame, width, height));
  }

  resizeTextLive(id: string, fontSize: number): boolean {
    const element = this.get(id);
    if (element?.kind !== 'text') return false;
    return this.tryWrite(id, this.textPatch(element, { fontSize: clampFontSize(fontSize) }));
  }

  /** Records a gesture that already updated the element live, comparing against its state before the gesture. */
  recordGesture(before: PlacedElement, label: string): void {
    this.recordReplacement(before, label);
  }

  restoreSnapshot(snapshot: PlacedElement): void {
    this.replaceElement(snapshot);
  }

  setFont(id: string, font: string): void {
    const element = this.get(id);
    if (element?.kind !== 'text' || element.font === font) return;
    this.patch(id, this.textPatch(element, { font }), 'font');
  }

  setFontSize(id: string, fontSize: number): void {
    const element = this.get(id);
    const size = clampFontSize(fontSize);
    if (element?.kind !== 'text' || element.fontSize === size) return;
    this.patch(id, this.textPatch(element, { fontSize: size }), 'size');
  }

  setColor(id: string, color: string): void {
    const element = this.get(id);
    if (element?.kind !== 'text' || element.color === color) return;
    this.patch(id, { color }, 'color');
  }

  beginTextEdit(id: string, pending = false): void {
    const element = this.get(id);
    if (element?.kind !== 'text') return;
    this.selectedId.set(id);
    this.editing.set({ elementId: id, snapshot: pending ? null : element });
  }

  setEditingText(text: string): void {
    const session = this.editing();
    const element = session ? this.get(session.elementId) : undefined;
    if (element?.kind !== 'text') return;
    this.writeElement(element.id, this.textPatch(element, { text }));
  }

  /** Ends the current text session: empty text is removed, otherwise the session becomes one undo step. */
  endTextEdit(): void {
    const session = this.editing();
    if (!session) return;
    this.editing.set(null);
    const element = this.get(session.elementId);
    if (element?.kind !== 'text') return;
    const index = this.elements().findIndex((item) => item.id === element.id);
    if (element.text.trim() === '') {
      this.removeById(element.id);
      if (session.snapshot) this.recordRemove(session.snapshot, index);
      return;
    }
    if (session.snapshot) this.recordReplacement(session.snapshot, 'edit text');
    else this.recordInsert(element, index);
  }

  undo(): void {
    this.endTextEdit();
    if (this.history.undo()) this.afterHistoryChange();
  }

  redo(): void {
    this.endTextEdit();
    if (this.history.redo()) this.afterHistoryChange();
  }

  private textPatch(element: PlacedText, changes: Partial<Pick<PlacedText, 'text' | 'font' | 'fontSize'>>): ElementPatch {
    const next = { text: element.text, font: element.font, fontSize: element.fontSize, ...changes };
    const box = measureTextBox(next.text, next.font, next.fontSize);
    const placed = boxFromFrame(resizeFrame(element), box.width, box.height);
    return { ...changes, x: placed.x, y: placed.y, width: placed.width, height: placed.height };
  }

  private patch(id: string, patch: ElementPatch, label: string): void {
    const before = this.get(id);
    if (!before) return;
    this.writeElement(id, patch);
    this.recordReplacement(before, label);
  }

  private tryWrite(id: string, patch: ElementPatch): boolean {
    const element = this.get(id);
    if (!element) return false;
    const merged = { ...element, ...patch };
    if (!fitsOnPage(merged, this.pageSize(merged.pageIndex))) return false;
    this.writeElement(id, patch);
    return true;
  }

  private writeElement(id: string, patch: ElementPatch): void {
    this.elements.update((list) =>
      list.map((element) => (element.id === id ? this.fitToPage({ ...element, ...patch }) : element)));
  }

  private fitToPage(element: PlacedElement): PlacedElement {
    const placed = placeCenteredOnPage(element, boxCenter(element), this.pageSize(element.pageIndex));
    return { ...element, x: placed.x, y: placed.y };
  }

  private replaceElement(element: PlacedElement): void {
    this.elements.update((list) => list.map((item) => (item.id === element.id ? element : item)));
  }

  private insertAt(element: PlacedElement, index: number): void {
    this.elements.update((list) => {
      const next = list.filter((item) => item.id !== element.id);
      next.splice(Math.min(index, next.length), 0, element);
      return next;
    });
  }

  private removeById(id: string): void {
    this.elements.update((list) => list.filter((item) => item.id !== id));
    if (this.selectedId() === id) this.selectedId.set(null);
    if (this.editing()?.elementId === id) this.editing.set(null);
  }

  private recordInsert(element: PlacedElement, index: number): void {
    this.record({
      label: 'add',
      undo: () => this.removeById(element.id),
      redo: () => this.insertAt(element, index),
    });
  }

  private recordRemove(element: PlacedElement, index: number): void {
    this.record({
      label: 'delete',
      undo: () => this.insertAt(element, index),
      redo: () => this.removeById(element.id),
    });
  }

  private recordReplacement(before: PlacedElement, label: string, key?: string): void {
    const after = this.get(before.id);
    if (!after || sameElementState(before, after)) return;
    const top = this.history.top;
    if (key && top instanceof ElementUpdate && top.key === key && Date.now() - top.at < NUDGE_MERGE_WINDOW_MS) {
      top.after = after;
      top.at = Date.now();
      this.historyVersion.update((version) => version + 1);
      return;
    }
    this.record(new ElementUpdate(label, key, before, after, (element) => this.replaceElement(element)));
  }

  private record(command: Command): void {
    this.history.record(command);
    this.historyVersion.update((version) => version + 1);
  }

  private afterHistoryChange(): void {
    const selected = this.selectedId();
    if (selected && !this.get(selected)) this.selectedId.set(null);
    this.historyVersion.update((version) => version + 1);
  }

  private reset(): void {
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls.clear();
    this.elements.set([]);
    this.selectedId.set(null);
    this.editing.set(null);
    this.history.clear();
    this.historyVersion.update((version) => version + 1);
  }
}

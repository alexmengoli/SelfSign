import type { PageSize } from './pdf-source';

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
export const ZOOM_PRESETS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
/** Space around the page column in CSS pixels. */
export const CONTENT_PADDING = 16;
export const PAGE_GAP = 16;

export interface PageBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DocumentLayout {
  width: number;
  height: number;
  pages: readonly PageBox[];
}

export interface PageAnchor {
  index: number;
  /** Horizontal position inside the page as a fraction of its width. */
  fx: number;
  /** Vertical position inside the page as a fraction of its height. */
  fy: number;
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function nextZoomPreset(zoom: number, direction: 1 | -1): number {
  if (direction === 1) {
    return ZOOM_PRESETS.find((preset) => preset > zoom + 1e-6) ?? MAX_ZOOM;
  }
  return [...ZOOM_PRESETS].reverse().find((preset) => preset < zoom - 1e-6) ?? MIN_ZOOM;
}

export function fitWidthZoom(viewportWidth: number, pages: readonly PageSize[]): number {
  if (viewportWidth <= 0 || pages.length === 0) return 1;
  const widest = pages.reduce((max, page) => Math.max(max, page.width), 0);
  return clampZoom((viewportWidth - 2 * CONTENT_PADDING) / widest);
}

export function fitPageZoom(viewportWidth: number, viewportHeight: number, pages: readonly PageSize[]): number {
  const widthZoom = fitWidthZoom(viewportWidth, pages);
  if (viewportHeight <= 0 || pages.length === 0) return widthZoom;
  const tallest = pages.reduce((max, page) => Math.max(max, page.height), 0);
  return Math.min(widthZoom, clampZoom((viewportHeight - 2 * CONTENT_PADDING) / tallest));
}

export function computeLayout(pages: readonly PageSize[], zoom: number, viewportWidth: number): DocumentLayout {
  const widestPage = pages.reduce((max, page) => Math.max(max, page.width * zoom), 0);
  const width = Math.max(viewportWidth, widestPage + 2 * CONTENT_PADDING);
  let top = CONTENT_PADDING;
  const boxes = pages.map((page): PageBox => {
    const box = { left: (width - page.width * zoom) / 2, top, width: page.width * zoom, height: page.height * zoom };
    top += box.height + PAGE_GAP;
    return box;
  });
  return { width, height: boxes.length > 0 ? top - PAGE_GAP + CONTENT_PADDING : 2 * CONTENT_PADDING, pages: boxes };
}

/** Index of the first page whose bottom edge lies below `y`, or the page count when none does. */
function firstPageEndingAfter(pages: readonly PageBox[], y: number): number {
  let low = 0;
  let high = pages.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const page = pages[middle]!;
    if (page.top + page.height > y) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** Page under a content-space point, or -1 for gutters and areas outside the page column. */
export function pageIndexAt(layout: DocumentLayout, x: number, y: number): number {
  const index = firstPageEndingAfter(layout.pages, y);
  const page = layout.pages[index];
  if (!page || y < page.top) return -1;
  return x >= page.left && x <= page.left + page.width ? index : -1;
}

/** Nearest page to a content-space point, with the point expressed as a fraction of that page. */
export function nearestPageAnchor(layout: DocumentLayout, x: number, y: number): PageAnchor | null {
  if (layout.pages.length === 0) return null;
  const index = Math.min(firstPageEndingAfter(layout.pages, y), layout.pages.length - 1);
  const page = layout.pages[index]!;
  return { index, fx: (x - page.left) / page.width, fy: (y - page.top) / page.height };
}

/** Pages intersecting the content-space band [top, top + height]. */
export function visiblePageRange(layout: DocumentLayout, top: number, height: number): { first: number; last: number } {
  const pages = layout.pages;
  if (pages.length === 0) return { first: 0, last: -1 };
  const first = Math.min(firstPageEndingAfter(pages, top), pages.length - 1);
  let last = first;
  while (last + 1 < pages.length && pages[last + 1]!.top < top + height) last++;
  return { first, last };
}

/** Page that covers the largest part of the viewport band [top, top + height]. */
export function currentPageIndex(layout: DocumentLayout, top: number, height: number): number {
  const pages = layout.pages;
  if (pages.length === 0) return 0;
  const bottom = top + Math.max(height, 1);
  let best = Math.min(firstPageEndingAfter(pages, top), pages.length - 1);
  let bestOverlap = 0;
  for (let index = firstPageEndingAfter(pages, top); index < pages.length && pages[index]!.top < bottom; index++) {
    const page = pages[index]!;
    const overlap = Math.min(page.top + page.height, bottom) - Math.max(page.top, top);
    if (overlap > bestOverlap) {
      best = index;
      bestOverlap = overlap;
    }
  }
  return best;
}

/** Scroll offset that shows a page with a small margin above it. */
export function pageScrollTop(layout: DocumentLayout, index: number): number {
  const page = layout.pages[index];
  return page ? Math.max(0, page.top - CONTENT_PADDING) : 0;
}

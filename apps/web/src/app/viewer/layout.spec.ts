import {
  CONTENT_PADDING,
  computeLayout,
  currentPageIndex,
  fitPageZoom,
  fitWidthZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  nearestPageAnchor,
  nextZoomPreset,
  PAGE_GAP,
  pageIndexAt,
  pageScrollTop,
  visiblePageRange,
} from './layout';

const letter = { width: 612, height: 792 };
const pages = [letter, letter, letter];

describe('computeLayout', () => {
  it('stacks pages with gaps and centers them in the viewport width', () => {
    const layout = computeLayout(pages, 1, 800);

    expect(layout.width).toBe(800);
    expect(layout.pages[0]).toEqual({ left: (800 - 612) / 2, top: CONTENT_PADDING, width: 612, height: 792 });
    expect(layout.pages[1]?.top).toBe(CONTENT_PADDING + 792 + PAGE_GAP);
    expect(layout.height).toBe(CONTENT_PADDING + 3 * 792 + 2 * PAGE_GAP + CONTENT_PADDING);
  });

  it('widens the content when the zoomed page is wider than the viewport', () => {
    const layout = computeLayout(pages, 2, 400);

    expect(layout.width).toBe(612 * 2 + 2 * CONTENT_PADDING);
    expect(layout.pages[0]?.left).toBe(CONTENT_PADDING);
  });
});

describe('zoom', () => {
  it('fits the widest page inside the padding and clamps to the zoom range', () => {
    expect(fitWidthZoom(612 + 2 * CONTENT_PADDING, pages)).toBeCloseTo(1);
    expect(fitWidthZoom(100000, pages)).toBe(MAX_ZOOM);
    expect(fitWidthZoom(20, pages)).toBe(MIN_ZOOM);
    expect(fitWidthZoom(0, pages)).toBe(1);
  });

  it('fits the tallest page height when fitting a whole page', () => {
    expect(fitPageZoom(2000, 792 + 2 * CONTENT_PADDING, pages)).toBeCloseTo(1);
    expect(fitPageZoom(2000, 432, pages)).toBeCloseTo((432 - 2 * CONTENT_PADDING) / 792, 6);
  });

  it('moves through the zoom presets and stops at the limits', () => {
    expect(nextZoomPreset(1, 1)).toBe(1.25);
    expect(nextZoomPreset(1, -1)).toBe(0.75);
    expect(nextZoomPreset(1.1, 1)).toBe(1.25);
    expect(nextZoomPreset(1.1, -1)).toBe(1);
    expect(nextZoomPreset(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(nextZoomPreset(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });
});

describe('page lookup', () => {
  const layout = computeLayout(pages, 1, 800);

  it('finds the page under a point and ignores gutters and margins', () => {
    expect(pageIndexAt(layout, 400, 100)).toBe(0);
    expect(pageIndexAt(layout, 400, CONTENT_PADDING + 792 + PAGE_GAP / 2)).toBe(-1);
    expect(pageIndexAt(layout, 10, 100)).toBe(-1);
    expect(pageIndexAt(layout, 400, 1700)).toBe(2);
  });

  it('reports the page that covers most of the viewport', () => {
    expect(currentPageIndex(layout, 0, 800)).toBe(0);
    expect(currentPageIndex(layout, 700, 800)).toBe(1);
    expect(currentPageIndex(layout, 2000, 800)).toBe(2);
    expect(currentPageIndex(layout, 5000, 800)).toBe(2);
  });

  it('returns the pages that intersect a band', () => {
    expect(visiblePageRange(layout, 0, 800)).toEqual({ first: 0, last: 0 });
    expect(visiblePageRange(layout, 700, 800)).toEqual({ first: 0, last: 1 });
  });

  it('expresses a point as a fraction of its nearest page', () => {
    const anchor = nearestPageAnchor(layout, 400, 412);

    expect(anchor?.index).toBe(0);
    expect(anchor?.fx).toBeCloseTo(0.5);
    expect(anchor?.fy).toBeCloseTo(0.5);
  });

  it('scrolls to a page with a small margin above it', () => {
    expect(pageScrollTop(layout, 0)).toBe(0);
    expect(pageScrollTop(layout, 2)).toBe(layout.pages[2]!.top - CONTENT_PADDING);
  });
});

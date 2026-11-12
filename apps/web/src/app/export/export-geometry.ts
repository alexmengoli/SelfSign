import type { Placement } from '../viewer/geometry';

/** PDF affine matrix [a b c d e f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = readonly [number, number, number, number, number, number];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Visible page area in user space, normalized so x1 < x2 and y1 < y2. */
export interface PageView {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type PageRotation = 0 | 90 | 180 | 270;

export interface PageGeometry {
  view: PageView;
  rotation: PageRotation;
}

/** Ascent and descent as fractions of the font size, as used by the browser for line layout. */
export interface FontVerticalMetrics {
  ascent: number;
  descent: number;
}

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Applies `first`, then `second`. */
export function multiply(first: Matrix, second: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = first;
  const [a2, b2, c2, d2, e2, f2] = second;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

export function applyMatrix(matrix: Matrix, x: number, y: number): { x: number; y: number } {
  const [a, b, c, d, e, f] = matrix;
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

/** Same rule as pdf.js: anything that is not a multiple of 90 counts as 0. */
export function normalizePageRotation(degrees: number): PageRotation {
  if (!Number.isFinite(degrees) || degrees % 90 !== 0) return 0;
  return (((degrees % 360) + 360) % 360) as PageRotation;
}

function toView(rect: Rect): PageView {
  return {
    x1: Math.min(rect.x, rect.x + rect.width),
    y1: Math.min(rect.y, rect.y + rect.height),
    x2: Math.max(rect.x, rect.x + rect.width),
    y2: Math.max(rect.y, rect.y + rect.height),
  };
}

/** The displayed area like pdf.js computes it: CropBox clipped to MediaBox, or MediaBox when they do not overlap. */
export function pageView(mediaBox: Rect, cropBox?: Rect): PageView {
  const media = toView(mediaBox);
  if (!cropBox) return media;
  const crop = toView(cropBox);
  const view = {
    x1: Math.max(media.x1, crop.x1),
    y1: Math.max(media.y1, crop.y1),
    x2: Math.min(media.x2, crop.x2),
    y2: Math.min(media.y2, crop.y2),
  };
  return view.x2 > view.x1 && view.y2 > view.y1 ? view : media;
}

/** Page size in points as displayed, after the page rotation. */
export function displaySize(geometry: PageGeometry): { width: number; height: number } {
  const width = geometry.view.x2 - geometry.view.x1;
  const height = geometry.view.y2 - geometry.view.y1;
  return geometry.rotation % 180 === 0 ? { width, height } : { width: height, height: width };
}

/** Maps displayed page points (top-left origin, y down) to PDF user space. */
export function displayToUserMatrix({ view, rotation }: PageGeometry): Matrix {
  switch (rotation) {
    case 0:
      return [1, 0, 0, -1, view.x1, view.y2];
    case 90:
      return [0, 1, 1, 0, view.x1, view.y1];
    case 180:
      return [-1, 0, 0, 1, view.x2, view.y1];
    case 270:
      return [0, -1, -1, 0, view.x2, view.y2];
  }
}

/**
 * Maps an element's own frame (origin at the bottom-left of its unrotated box, y up, in points)
 * to PDF user space, so content drawn there appears where the element is shown on screen.
 */
export function elementMatrix(geometry: PageGeometry, element: Placement): Matrix {
  const radians = (element.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const flipToCenter: Matrix = [1, 0, 0, -1, -element.width / 2, element.height / 2];
  const rotate: Matrix = [cos, sin, -sin, cos, 0, 0];
  const toDisplay: Matrix = [1, 0, 0, 1, element.x + element.width / 2, element.y + element.height / 2];
  return multiply(multiply(multiply(flipToCenter, rotate), toDisplay), displayToUserMatrix(geometry));
}

/** Baseline of each text line in the element frame (y up), matching CSS line-height half-leading. */
export function lineBaselines(lineCount: number, fontSize: number, lineHeight: number, metrics: FontVerticalMetrics, boxHeight: number): number[] {
  const lineBox = fontSize * lineHeight;
  const ascent = metrics.ascent * fontSize;
  const descent = metrics.descent * fontSize;
  const offset = (lineBox - (ascent + descent)) / 2 + ascent;
  return Array.from({ length: lineCount }, (_, index) => boxHeight - (index * lineBox + offset));
}

/**
 * Places the stored image (unit square, y up) into a box so it shows like the browser does
 * for the JPEG EXIF orientation (1–8).
 */
export function imagePlacementMatrix(orientation: number, width: number, height: number): Matrix {
  // Oriented position (xd, yd) from stored position (x, y), both normalized with y down.
  const [a1, b1, c1, a2, b2, c2] = (
    {
      2: [-1, 0, 1, 0, 1, 0],
      3: [-1, 0, 1, 0, -1, 1],
      4: [1, 0, 0, 0, -1, 1],
      5: [0, 1, 0, 1, 0, 0],
      6: [0, -1, 1, 1, 0, 0],
      7: [0, -1, 1, -1, 0, 1],
      8: [0, 1, 0, -1, 0, 1],
    } as Partial<Record<number, Matrix>>
  )[orientation] ?? [1, 0, 0, 0, 1, 0];
  return [width * a1, -height * a2, -width * b1, height * b2, width * (b1 + c1), height * (1 - b2 - c2)];
}

/** Parses `#rgb` or `#rrggbb` into 0–1 channels; anything else is black. */
export function parseHexColor(color: string): { red: number; green: number; blue: number } {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return { red: 0, green: 0, blue: 0 };
  const hex = match[1]!.length === 3 ? match[1]!.replace(/./g, '$&$&') : match[1]!;
  const channel = (index: number) => parseInt(hex.slice(index, index + 2), 16) / 255;
  return { red: channel(0), green: channel(2), blue: channel(4) };
}

/** `contract.pdf` → `contract-signed.pdf`; the last `.pdf` extension is replaced in any letter case. */
export function exportFileName(name: string): string {
  const base = name.replace(/\.pdf$/i, '') || 'document';
  return `${base}-signed.pdf`;
}

export interface PointXY {
  x: number;
  y: number;
}

export interface PageDimensions {
  width: number;
  height: number;
}

/** Element box in page points: unrotated top-left corner plus rotation (degrees, clockwise) about its center. */
export interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/** Top-left corner and axes of an element at the start of a resize. */
export interface ResizeFrame {
  anchor: PointXY;
  rotation: number;
}

export const DUPLICATE_OFFSET = 10;
export const NUDGE_STEP = 1;
export const SHIFT_NUDGE_STEP = 10;
export const MIN_FONT_SIZE = 6;
export const MAX_FONT_SIZE = 72;
export const MIN_IMAGE_WIDTH = 12;
export const ROTATION_SNAP = 15;

const EPSILON = 1e-6;

export function normalizeRotation(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

export function snapRotation(degrees: number): number {
  return normalizeRotation(Math.round(degrees / ROTATION_SNAP) * ROTATION_SNAP);
}

export function clampFontSize(size: number): number {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)));
}

export function boxCenter(box: Placement): PointXY {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Half extents of the axis-aligned bounds that enclose a rotated box. */
export function boundsHalfExtents(width: number, height: number, rotation: number): PointXY {
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return { x: (width / 2) * cos + (height / 2) * sin, y: (width / 2) * sin + (height / 2) * cos };
}

function clampCoordinate(value: number, half: number, size: number): number {
  if (half * 2 >= size) return size / 2;
  return Math.min(size - half, Math.max(half, value));
}

/** Moves the box so its rotated bounds stay inside the page, as close to `center` as possible. */
export function placeCenteredOnPage(box: Placement, center: PointXY, page: PageDimensions): Placement {
  const half = boundsHalfExtents(box.width, box.height, box.rotation);
  const cx = clampCoordinate(center.x, half.x, page.width);
  const cy = clampCoordinate(center.y, half.y, page.height);
  return { ...box, x: cx - box.width / 2, y: cy - box.height / 2 };
}

export function fitsOnPage(box: Placement, page: PageDimensions): boolean {
  const center = boxCenter(box);
  const half = boundsHalfExtents(box.width, box.height, box.rotation);
  return (
    center.x - half.x >= -EPSILON &&
    center.x + half.x <= page.width + EPSILON &&
    center.y - half.y >= -EPSILON &&
    center.y + half.y <= page.height + EPSILON
  );
}

/** Rotation in degrees for a pointer around a center, where 0 points straight up. */
export function rotationFromPointer(center: PointXY, pointer: PointXY): number {
  return normalizeRotation((Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI + 90);
}

export function resizeFrame(box: Placement): ResizeFrame {
  const center = boxCenter(box);
  const radians = (box.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const localX = -box.width / 2;
  const localY = -box.height / 2;
  return {
    anchor: { x: center.x + localX * cos - localY * sin, y: center.y + localX * sin + localY * cos },
    rotation: box.rotation,
  };
}

/** Width and height along the frame's axes for a pointer that drags the bottom-right handle. */
export function localSizeAt(frame: ResizeFrame, pointer: PointXY): { width: number; height: number } {
  const radians = (frame.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = pointer.x - frame.anchor.x;
  const dy = pointer.y - frame.anchor.y;
  return { width: dx * cos + dy * sin, height: -dx * sin + dy * cos };
}

/** Box of the given size whose top-left corner stays at the frame anchor. */
export function boxFromFrame(frame: ResizeFrame, width: number, height: number): Placement {
  const radians = (frame.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const center = {
    x: frame.anchor.x + (width / 2) * cos - (height / 2) * sin,
    y: frame.anchor.y + (width / 2) * sin + (height / 2) * cos,
  };
  return { x: center.x - width / 2, y: center.y - height / 2, width, height, rotation: frame.rotation };
}

import {
  boundsHalfExtents,
  boxCenter,
  boxFromFrame,
  clampFontSize,
  fitsOnPage,
  localSizeAt,
  normalizeRotation,
  placeCenteredOnPage,
  type Placement,
  resizeFrame,
  rotationFromPointer,
  snapRotation,
} from './geometry';

const page = { width: 612, height: 792 };

describe('rotation', () => {
  it('normalizes and snaps rotations to 15 degree steps', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(720)).toBe(0);
    expect(snapRotation(37)).toBe(30);
    expect(snapRotation(38)).toBe(45);
    expect(snapRotation(-10)).toBe(345);
  });

  it('measures the pointer angle with 0 degrees pointing up and positive clockwise', () => {
    const center = { x: 100, y: 100 };

    expect(rotationFromPointer(center, { x: 100, y: 50 })).toBeCloseTo(0);
    expect(rotationFromPointer(center, { x: 150, y: 100 })).toBeCloseTo(90);
    expect(rotationFromPointer(center, { x: 100, y: 150 })).toBeCloseTo(180);
  });
});

describe('bounds and placement', () => {
  it('computes the axis-aligned bounds of a rotated box', () => {
    const flat = boundsHalfExtents(100, 40, 0);
    const upright = boundsHalfExtents(100, 40, 90);

    expect(flat.x).toBeCloseTo(50);
    expect(flat.y).toBeCloseTo(20);
    expect(upright.x).toBeCloseTo(20);
    expect(upright.y).toBeCloseTo(50);
  });

  it('keeps a box inside the page when its center is outside', () => {
    const box: Placement = { x: 600, y: -20, width: 100, height: 40, rotation: 0 };
    const placed = placeCenteredOnPage(box, boxCenter(box), page);

    expect(fitsOnPage(placed, page)).toBe(true);
    expect(placed.x).toBeCloseTo(512);
    expect(placed.y).toBeCloseTo(0);
  });

  it('centers a box that is larger than the page on that axis', () => {
    const wide: Placement = { x: 0, y: 0, width: 1000, height: 10, rotation: 0 };
    const placed = placeCenteredOnPage(wide, { x: 0, y: 0 }, page);

    expect(placed.x).toBeCloseTo(306 - 500);
    expect(fitsOnPage(placed, page)).toBe(false);
  });

  it('keeps the rotated bounds of a rotated box inside the page', () => {
    const diagonal: Placement = { x: 0, y: 0, width: 300, height: 40, rotation: 45 };
    const placed = placeCenteredOnPage(diagonal, { x: 10, y: 10 }, page);

    expect(fitsOnPage(placed, page)).toBe(true);
  });
});

describe('resizing', () => {
  it('keeps the top-left corner fixed while dragging the bottom-right handle of a rotated box', () => {
    const box: Placement = { x: 200, y: 300, width: 100, height: 50, rotation: 30 };
    const frame = resizeFrame(box);
    const radians = (30 * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const pointer = {
      x: frame.anchor.x + 120 * cos - 60 * sin,
      y: frame.anchor.y + 120 * sin + 60 * cos,
    };

    const size = localSizeAt(frame, pointer);
    const resized = boxFromFrame(frame, size.width, size.height);

    expect(size.width).toBeCloseTo(120);
    expect(size.height).toBeCloseTo(60);
    expect(resizeFrame(resized).anchor.x).toBeCloseTo(frame.anchor.x);
    expect(resizeFrame(resized).anchor.y).toBeCloseTo(frame.anchor.y);
  });

  it('limits font sizes to 6 to 72 pt', () => {
    expect(clampFontSize(3)).toBe(6);
    expect(clampFontSize(100)).toBe(72);
    expect(clampFontSize(12.4)).toBe(12);
  });
});

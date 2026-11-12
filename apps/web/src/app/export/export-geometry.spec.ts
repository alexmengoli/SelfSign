import {
  applyMatrix,
  displaySize,
  displayToUserMatrix,
  elementMatrix,
  exportFileName,
  imagePlacementMatrix,
  lineBaselines,
  normalizePageRotation,
  type PageGeometry,
  type PageRotation,
  pageView,
  parseHexColor,
} from './export-geometry';

/** A page whose CropBox does not start at the origin and sits inside a shifted MediaBox. */
const croppedView = pageView({ x: -20, y: 30, width: 700, height: 900 }, { x: 50, y: 100, width: 400, height: 600 });

function geometry(rotation: PageRotation): PageGeometry {
  return { view: croppedView, rotation };
}

function expectPoint(actual: { x: number; y: number }, x: number, y: number): void {
  expect(actual.x).toBeCloseTo(x, 6);
  expect(actual.y).toBeCloseTo(y, 6);
}

function expectAt(actual: { x: number; y: number }, expected: readonly number[]): void {
  expectPoint(actual, expected[0]!, expected[1]!);
}

describe('page geometry', () => {
  it('normalizes page rotation like pdf.js', () => {
    expect(normalizePageRotation(-90)).toBe(270);
    expect(normalizePageRotation(450)).toBe(90);
    expect(normalizePageRotation(45)).toBe(0);
    expect(normalizePageRotation(Number.NaN)).toBe(0);
  });

  it('uses the CropBox clipped to the MediaBox, normalized', () => {
    expect(croppedView).toEqual({ x1: 50, y1: 100, x2: 450, y2: 700 });
    expect(pageView({ x: 0, y: 0, width: 300, height: 400 }, { x: 200, y: -50, width: 300, height: 100 }))
      .toEqual({ x1: 200, y1: 0, x2: 300, y2: 50 });
    expect(pageView({ x: 612, y: 792, width: -612, height: -792 })).toEqual({ x1: 0, y1: 0, x2: 612, y2: 792 });
    expect(pageView({ x: 0, y: 0, width: 100, height: 100 }, { x: 200, y: 200, width: 10, height: 10 }))
      .toEqual({ x1: 0, y1: 0, x2: 100, y2: 100 });
  });

  it('swaps the displayed size for quarter-turn rotations', () => {
    expect(displaySize(geometry(0))).toEqual({ width: 400, height: 600 });
    expect(displaySize(geometry(90))).toEqual({ width: 600, height: 400 });
    expect(displaySize(geometry(180))).toEqual({ width: 400, height: 600 });
    expect(displaySize(geometry(270))).toEqual({ width: 600, height: 400 });
  });

  it.each([
    // Displayed top-left, top-right and bottom-left corners in user space for each rotation.
    [0, [50, 700], [450, 700], [50, 100]],
    [90, [50, 100], [50, 700], [450, 100]],
    [180, [450, 100], [50, 100], [450, 700]],
    [270, [450, 700], [450, 100], [50, 700]],
  ] as const)('maps displayed corners to user space at %i degrees', (rotation, topLeft, topRight, bottomLeft) => {
    const page = geometry(rotation);
    const matrix = displayToUserMatrix(page);
    const size = displaySize(page);
    expectAt(applyMatrix(matrix, 0, 0), topLeft);
    expectAt(applyMatrix(matrix, size.width, 0), topRight);
    expectAt(applyMatrix(matrix, 0, size.height), bottomLeft);
  });
});

describe('element placement', () => {
  const element = { x: 40, y: 60, width: 120, height: 30, rotation: 0 };

  it.each([0, 90, 180, 270] as const)('maps the element frame onto its displayed box at page rotation %i', (rotation) => {
    const page = geometry(rotation);
    const toUser = displayToUserMatrix(page);
    const matrix = elementMatrix(page, element);
    const expected = (x: number, y: number) => applyMatrix(toUser, x, y);
    const bottomLeft = expected(40, 90);
    const topRight = expected(160, 60);
    expectPoint(applyMatrix(matrix, 0, 0), bottomLeft.x, bottomLeft.y);
    expectPoint(applyMatrix(matrix, 120, 30), topRight.x, topRight.y);
  });

  it('keeps text upright relative to the displayed page (no mirroring)', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const [a, b, c, d] = elementMatrix(geometry(rotation), element);
      expect(a * d - b * c).toBeCloseTo(1, 6);
    }
  });

  it('rotates the element clockwise about its center, as on screen', () => {
    const page = geometry(90);
    const toUser = displayToUserMatrix(page);
    const matrix = elementMatrix(page, { ...element, rotation: 90 });
    const center = applyMatrix(toUser, 100, 75);
    expectPoint(applyMatrix(matrix, 60, 15), center.x, center.y);
    // The displayed top-left corner (-60, -15 from center) turns to (+15, -60) on screen.
    const corner = applyMatrix(toUser, 115, 15);
    expectPoint(applyMatrix(matrix, 0, 30), corner.x, corner.y);
  });
});

describe('text and images', () => {
  it('places line baselines with CSS half-leading', () => {
    const baselines = lineBaselines(2, 10, 1.25, { ascent: 0.8, descent: 0.2 }, 25);
    expect(baselines[0]).toBeCloseTo(25 - (1.25 + 8), 6);
    expect(baselines[1]).toBeCloseTo(25 - (12.5 + 1.25 + 8), 6);
  });

  it('keeps an unrotated image upright and stretches it to the box', () => {
    expect(imagePlacementMatrix(1, 80, 40)).toEqual([80, -0, -0, 40, 0, 0]);
  });

  it.each([
    // Stored top-left and top-right corners in the box (y up) for every EXIF orientation.
    [2, [80, 40], [0, 40]],
    [3, [80, 0], [0, 0]],
    [4, [0, 0], [80, 0]],
    [5, [0, 40], [0, 0]],
    [6, [80, 40], [80, 0]],
    [7, [80, 0], [80, 40]],
    [8, [0, 0], [0, 40]],
  ] as const)('applies EXIF orientation %i', (orientation, topLeft, topRight) => {
    const matrix = imagePlacementMatrix(orientation, 80, 40);
    expectAt(applyMatrix(matrix, 0, 1), topLeft);
    expectAt(applyMatrix(matrix, 1, 1), topRight);
  });

  it('parses picker colors', () => {
    expect(parseHexColor('#ff8000')).toEqual({ red: 1, green: 128 / 255, blue: 0 });
    expect(parseHexColor('#0F0')).toEqual({ red: 0, green: 1, blue: 0 });
    expect(parseHexColor('red')).toEqual({ red: 0, green: 0, blue: 0 });
  });
});

describe('export file name', () => {
  it.each([
    ['contract.pdf', 'contract-signed.pdf'],
    ['Scan.PDF', 'Scan-signed.pdf'],
    ['a.b.pdf', 'a.b-signed.pdf'],
    ['notes', 'notes-signed.pdf'],
  ])('%s → %s', (name, expected) => {
    expect(exportFileName(name)).toBe(expected);
  });
});

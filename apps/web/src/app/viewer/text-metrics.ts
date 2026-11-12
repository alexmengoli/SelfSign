import { DOCUMENT_FONTS } from '../core/document-fonts';

/** Line height as a multiple of the font size; shared by on-screen text and measured text boxes. */
export const TEXT_LINE_HEIGHT = 1.25;
/** Width of an empty text element in font-size units, so it stays easy to click and edit. */
const EMPTY_TEXT_WIDTH_EM = 6;

export interface TextBox {
  width: number;
  height: number;
}

let measuringContext: OffscreenCanvasRenderingContext2D | null | undefined;

function getMeasuringContext(): OffscreenCanvasRenderingContext2D | null {
  if (measuringContext === undefined) {
    measuringContext = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d');
  }
  return measuringContext;
}

function measureLine(line: string, family: string, fontSize: number): number {
  const context = getMeasuringContext();
  if (!context) return line.length * fontSize * 0.55;
  context.font = `${fontSize}px "${family}"`;
  return context.measureText(line).width;
}

/** Size in points of a text element with the given content, font and size. */
export function measureTextBox(text: string, family: string, fontSize: number): TextBox {
  const lines = text.split('\n');
  const widest = lines.reduce((max, line) => Math.max(max, measureLine(line, family, fontSize)), 0);
  const minimumWidth = text.trim() === '' ? fontSize * EMPTY_TEXT_WIDTH_EM : fontSize;
  return {
    width: Math.max(widest, minimumWidth),
    height: lines.length * fontSize * TEXT_LINE_HEIGHT,
  };
}

/** Loads the bundled fonts so measurements and on-screen text use the real glyphs. */
export async function loadDocumentFonts(): Promise<void> {
  await Promise.all(
    DOCUMENT_FONTS.map((font) => document.fonts.load(`12px "${font.family}"`).catch(() => [])),
  );
}

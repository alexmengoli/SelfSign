import type { PDFDocument } from 'pdf-lib';

type Fontkit = Parameters<PDFDocument['registerFontkit']>[0];

interface TrueTypeSubset {
  glyf: Uint8Array[];
  offset: number;
  _addGlyph(glyphId: number): number;
}

let patched = false;

/**
 * @pdf-lib/fontkit 1.1.1 writes small subsets with a short `loca` table (offsets halved) but does not pad glyphs
 * to an even length, so every glyph after an odd-length one is read from the wrong offset and renders blank.
 * Padding each copied glyph to an even length keeps all offsets exact.
 */
export function padTrueTypeSubsetGlyphs(fontkit: Fontkit, fontBytes: ArrayBuffer): void {
  if (patched) return;
  const subset = fontkit.create(new Uint8Array(fontBytes)).createSubset() as unknown as TrueTypeSubset;
  const prototype = Object.getPrototypeOf(subset) as TrueTypeSubset;
  const addGlyph = prototype._addGlyph;
  prototype._addGlyph = function (this: TrueTypeSubset, glyphId: number): number {
    const index = addGlyph.call(this, glyphId);
    const data = this.glyf[index]!;
    if (data.length % 2 === 1) {
      // The encoder only accepts its own Buffer polyfill, so the padded copy is made with the same class.
      const BufferClass = data.constructor as { alloc?: (size: number) => Uint8Array };
      const padded = BufferClass.alloc ? BufferClass.alloc(data.length + 1) : new Uint8Array(data.length + 1);
      padded.set(data);
      this.glyf[index] = padded;
      this.offset += 1;
    }
    return index;
  };
  patched = true;
}

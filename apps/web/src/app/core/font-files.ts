import { DOCUMENT_FONTS } from './document-fonts';

const files = new Map<string, Promise<ArrayBuffer>>();
const faces = new Map<string, Promise<void>>();

/** Bytes of a bundled font file, downloaded once and shared by the on-screen preview and PDF export. */
export function loadFontFile(url: string): Promise<ArrayBuffer> {
  let file = files.get(url);
  if (!file) {
    file = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`Font request for ${url} failed with ${response.status}`);
      return response.arrayBuffer();
    });
    // A failed download is retried on next use instead of failing forever.
    file.catch(() => files.delete(url));
    files.set(url, file);
  }
  return file;
}

/** Registers the bundled fonts for on-screen text from the shared bytes; fonts that fail keep the fallback. */
export async function registerDocumentFonts(): Promise<void> {
  await Promise.allSettled(DOCUMENT_FONTS.map((font) => {
    let face = faces.get(font.family);
    if (!face) {
      face = loadFontFile(font.url).then(async (bytes) => {
        const fontFace = new FontFace(font.family, bytes);
        await fontFace.load();
        document.fonts.add(fontFace);
      });
      face.catch((error: unknown) => {
        faces.delete(font.family);
        console.error(`Font ${font.family} could not be loaded:`, error);
      });
      faces.set(font.family, face);
    }
    return face;
  }));
}

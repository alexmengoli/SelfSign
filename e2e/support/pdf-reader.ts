import { fileURLToPath } from 'node:url';

export interface PdfPageSummary {
  text: string;
  rotate: number;
  view: number[];
  annotations: string[];
}

export interface PdfSummary {
  pageCount: number;
  pages: PdfPageSummary[];
  fields: string[];
  title: string | undefined;
}

/** Reads a PDF with pdf.js in Node: page text, geometry, annotations, form fields and metadata. */
export async function readPdf(bytes: Buffer): Promise<PdfSummary> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    // Form widgets without their own appearance need the standard font data.
    standardFontDataUrl: `${fileURLToPath(new URL('../../node_modules/pdfjs-dist/standard_fonts', import.meta.url))}/`,
  });
  try {
    const doc = await task.promise;
    const pages: PdfPageSummary[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push({
        text: content.items.map((item) => ('str' in item ? item.str : '')).join(' '),
        rotate: page.rotate,
        view: [...page.view],
        annotations: (await page.getAnnotations()).map((annotation: { subtype: string }) => annotation.subtype),
      });
    }
    const fieldObjects: unknown = await doc.getFieldObjects();
    const fields = (fieldObjects instanceof Map ? [...fieldObjects.keys()] : Object.keys(fieldObjects ?? {})).sort();
    const { info } = await doc.getMetadata();
    return { pageCount: doc.numPages, pages, fields, title: (info as { Title?: string }).Title };
  } finally {
    await task.destroy();
  }
}

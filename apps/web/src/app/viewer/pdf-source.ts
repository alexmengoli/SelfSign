import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface PageSize {
  /** Displayed width in PDF points, after the page's /Rotate. */
  width: number;
  /** Displayed height in PDF points, after the page's /Rotate. */
  height: number;
}

export interface OpenedPdf {
  pdf: PDFDocumentProxy;
  pages: PageSize[];
  destroy: () => Promise<void>;
}

export const INVALID_PDF_MESSAGE = 'This file is not a valid PDF.';
export const PASSWORD_MESSAGE = 'Password-protected PDFs are not supported.';

export class PdfOpenError extends Error {
  constructor(readonly reason: 'invalid' | 'password') {
    super(reason === 'password' ? PASSWORD_MESSAGE : INVALID_PDF_MESSAGE);
    this.name = 'PdfOpenError';
  }
}

const PDF_HEADER = '%PDF-';
const HEADER_SEARCH_LENGTH = 1024;

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfJsModule: Promise<PdfJsModule> | undefined;

/**
 * Loads pdf.js on first use so the rest of the app stays small. The legacy build is used because the main build
 * calls Uint8Array.prototype.toHex without a polyfill, which older browsers lack; the legacy build adds it.
 */
function loadPdfJs(): Promise<PdfJsModule> {
  pdfJsModule ??= import('pdfjs-dist/legacy/build/pdf.mjs')
    .then((module) => {
      module.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      return module;
    })
    .catch((error: unknown) => {
      // A failed import must not stay cached, or every later open would fail until the page reloads.
      pdfJsModule = undefined;
      throw error;
    });
  return pdfJsModule;
}

export function hasPdfHeader(bytes: Uint8Array): boolean {
  return String.fromCharCode(...bytes.subarray(0, HEADER_SEARCH_LENGTH)).includes(PDF_HEADER);
}

/** The user sees one generic message for every failure, so the underlying error goes to the console. */
function reportOpenFailure(error: unknown): void {
  console.error('PDF could not be opened:', error);
}

/** Parses the PDF and reads every displayed page size; throws PdfOpenError when it cannot be used. */
export async function openPdf(buffer: ArrayBuffer): Promise<OpenedPdf> {
  if (!hasPdfHeader(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, HEADER_SEARCH_LENGTH)))) {
    throw new PdfOpenError('invalid');
  }
  const pdfJs = await loadPdfJs();
  const task = pdfJs.getDocument({
    // pdf.js transfers the bytes it parses, so it receives a copy and the original buffer stays intact.
    data: buffer.slice(0),
    cMapUrl: '/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/standard_fonts/',
    iccUrl: '/iccs/',
    wasmUrl: '/wasm/',
    useWasm: false,
  });
  const destroy = () => task.destroy();
  let pdf: PDFDocumentProxy;
  try {
    pdf = await task.promise;
  } catch (error) {
    await destroy();
    if (error instanceof Error && error.name === 'PasswordException') throw new PdfOpenError('password');
    reportOpenFailure(error);
    throw new PdfOpenError('invalid');
  }

  try {
    if (pdf.numPages === 0) throw new PdfOpenError('invalid');
    const pages: PageSize[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const { width, height } = (await pdf.getPage(pageNumber)).getViewport({ scale: 1 });
      pages.push({ width, height });
    }
    return { pdf, pages, destroy };
  } catch (error) {
    await destroy();
    if (error instanceof PdfOpenError) throw error;
    reportOpenFailure(error);
    throw new PdfOpenError('invalid');
  }
}

import type { PDFDocument, PDFFont, PDFImage, PDFPage } from 'pdf-lib';
import { DEFAULT_DOCUMENT_FONT_ID, DOCUMENT_FONTS } from '../core/document-fonts';
import { loadFontFile } from '../core/font-files';
import type { PlacedElement, PlacedImage, PlacedText } from '../viewer/document-store';
import type { PageSize } from '../viewer/pdf-source';
import { measureFontVerticalMetrics, TEXT_LINE_HEIGHT } from '../viewer/text-metrics';
import {
  displaySize,
  elementMatrix,
  imagePlacementMatrix,
  lineBaselines,
  type Matrix,
  normalizePageRotation,
  type PageGeometry,
  pageView,
  parseHexColor,
} from './export-geometry';
import { padTrueTypeSubsetGlyphs } from './fontkit-padding';
import { detectImageFormat, jpegOrientation } from './image-format';

export interface ExportInput {
  /** Original file bytes; they are read, never modified. */
  buffer: ArrayBuffer;
  /** Displayed page sizes from the viewer, used to confirm both libraries see the same pages. */
  pages: readonly PageSize[];
  elements: readonly PlacedElement[];
}

type PdfLib = typeof import('pdf-lib');

interface Libraries {
  pdfLib: PdfLib;
  fontkit: Parameters<PDFDocument['registerFontkit']>[0];
}

const PAGE_SIZE_TOLERANCE = 0.5;

let libraries: Promise<Libraries> | undefined;

/** Loads pdf-lib lazily so the initial bundle stays small. */
function loadLibraries(): Promise<Libraries> {
  libraries ??= Promise.all([import('pdf-lib'), import('@pdf-lib/fontkit')])
    .then(([pdfLib, fontkit]) => ({ pdfLib, fontkit: fontkit.default }))
    .catch((error: unknown) => {
      libraries = undefined;
      throw error;
    });
  return libraries;
}

/** Fetches the export code in the background, so clicking Export makes no network request. */
export function preloadPdfExport(): void {
  loadLibraries().catch((error: unknown) => console.error('PDF export code could not be preloaded:', error));
}

function pageGeometry(page: PDFPage): PageGeometry {
  return {
    view: pageView(page.getMediaBox(), page.getCropBox()),
    rotation: normalizePageRotation(page.getRotation().angle),
  };
}

/** Draws the placed elements into the page content of a copy of the document and returns the new file. */
export async function exportPdf(input: ExportInput): Promise<Uint8Array> {
  const { pdfLib, fontkit } = await loadLibraries();
  const { PDFDocument, concatTransformationMatrix, popGraphicsState, pushGraphicsState, rgb } = pdfLib;
  const pdf = await PDFDocument.load(input.buffer, { updateMetadata: false });
  pdf.registerFontkit(fontkit);

  const pages = pdf.getPages();
  if (pages.length !== input.pages.length) throw new Error(`Expected ${input.pages.length} pages, found ${pages.length}`);
  const geometries = pages.map((page, index) => {
    const geometry = pageGeometry(page);
    const size = displaySize(geometry);
    const shown = input.pages[index]!;
    if (Math.abs(size.width - shown.width) > PAGE_SIZE_TOLERANCE || Math.abs(size.height - shown.height) > PAGE_SIZE_TOLERANCE) {
      throw new Error(`Page ${index + 1} is ${size.width}x${size.height} pt, but ${shown.width}x${shown.height} pt on screen`);
    }
    return geometry;
  });

  const fonts = new Map<string, Promise<PDFFont>>();
  const images = new Map<Blob, Promise<{ image: PDFImage; orientation: number }>>();

  const embedFont = (family: string): Promise<PDFFont> => {
    const entry = DOCUMENT_FONTS.find((font) => font.family === family) ??
      DOCUMENT_FONTS.find((font) => font.id === DEFAULT_DOCUMENT_FONT_ID)!;
    let font = fonts.get(entry.url);
    if (!font) {
      font = loadFontFile(entry.url).then((bytes) => {
        padTrueTypeSubsetGlyphs(fontkit, bytes);
        return pdf.embedFont(bytes, { subset: true });
      });
      fonts.set(entry.url, font);
    }
    return font;
  };

  const embedImage = (blob: Blob): Promise<{ image: PDFImage; orientation: number }> => {
    let embedded = images.get(blob);
    if (!embedded) {
      embedded = blob.arrayBuffer().then(async (buffer) => {
        const bytes = new Uint8Array(buffer);
        const format = detectImageFormat(bytes);
        if (format === 'png') return { image: await pdf.embedPng(bytes), orientation: 1 };
        if (format === 'jpeg') return { image: await pdf.embedJpg(bytes), orientation: jpegOrientation(bytes) };
        throw new Error('Unsupported image format');
      });
      images.set(blob, embedded);
    }
    return embedded;
  };

  const drawText = async (page: PDFPage, element: PlacedText): Promise<void> => {
    const font = await embedFont(element.font);
    const { red, green, blue } = parseHexColor(element.color);
    const lines = element.text.split('\n');
    const metrics = measureFontVerticalMetrics(element.font);
    const baselines = lineBaselines(lines.length, element.fontSize, TEXT_LINE_HEIGHT, metrics, element.height);
    lines.forEach((line, index) => {
      if (line.length === 0) return;
      page.drawText(line, { x: 0, y: baselines[index]!, font, size: element.fontSize, color: rgb(red, green, blue) });
    });
  };

  const drawImage = async (page: PDFPage, element: PlacedImage): Promise<void> => {
    const { image, orientation } = await embedImage(element.imageBlob);
    page.pushOperators(concatTransformationMatrix(...imagePlacementMatrix(orientation, element.width, element.height)));
    page.drawImage(image, { x: 0, y: 0, width: 1, height: 1 });
  };

  for (const element of input.elements) {
    const page = pages[element.pageIndex];
    const geometry = geometries[element.pageIndex];
    if (!page || !geometry) throw new Error(`Element on missing page ${element.pageIndex + 1}`);
    const matrix: Matrix = elementMatrix(geometry, element);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...matrix));
    if (element.kind === 'text') await drawText(page, element);
    else await drawImage(page, element);
    page.pushOperators(popGraphicsState());
  }

  return pdf.save({ updateFieldAppearances: false });
}

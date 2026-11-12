import { randomBytes } from 'node:crypto';

export interface PdfPageSpec {
  text: string;
  width?: number;
  height?: number;
  rotate?: 0 | 90 | 180 | 270;
  /** [llx lly urx ury]; overrides width and height. */
  mediaBox?: [number, number, number, number];
  cropBox?: [number, number, number, number];
}

export interface PdfOptions {
  encrypted?: boolean;
  title?: string;
  /** Adds a text form field with this name on the first page. */
  formField?: string;
  /** Adds a URI link annotation on the first page. */
  link?: string;
}

/** Builds a small, valid PDF with classic cross-reference data and non-embedded Helvetica text. */
export function buildPdf(pages: PdfPageSpec[], options: PdfOptions = {}): Buffer {
  const objects: (string | Buffer)[] = [];
  const add = (body: string | Buffer): number => objects.push(body);
  const catalogId = add('');
  const pagesId = add('');
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds: number[] = [];
  const firstPageAnnots: number[] = [];
  let fieldId: number | undefined;
  if (options.formField) {
    fieldId = add(
      `<< /Type /Annot /Subtype /Widget /FT /Tx /T (${options.formField}) /V (Filled) /Rect [72 600 272 624] /F 4 >>`,
    );
    firstPageAnnots.push(fieldId);
  }
  if (options.link) {
    firstPageAnnots.push(add(`<< /Type /Annot /Subtype /Link /Rect [72 560 272 580] /Border [0 0 0] /A << /S /URI /URI (${options.link}) >> >>`));
  }

  pages.forEach((page, index) => {
    const [x1, y1, x2, y2] = page.mediaBox ?? [0, 0, page.width ?? 612, page.height ?? 792];
    const content = `BT /F1 24 Tf ${x1 + 72} ${y2 - 96} Td (${page.text.replace(/[()\\]/g, '')}) Tj ET`;
    const contentId = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const rotate = page.rotate ? ` /Rotate ${page.rotate}` : '';
    const cropBox = page.cropBox ? ` /CropBox [${page.cropBox.join(' ')}]` : '';
    const annots = index === 0 && firstPageAnnots.length > 0 ? ` /Annots [${firstPageAnnots.map((id) => `${id} 0 R`).join(' ')}]` : '';
    pageIds.push(add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [${x1} ${y1} ${x2} ${y2}]${cropBox}` +
      ` /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >>${rotate}${annots} >>`,
    ));
  });

  const acroForm = fieldId ? ` /AcroForm << /Fields [${fieldId} 0 R] /NeedAppearances true >>` : '';
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R${acroForm} >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const infoRef = options.title ? ` /Info ${add(`<< /Title (${options.title}) /Producer (SelfSign tests) >>`)} 0 R` : '';

  let encryptRef = '';
  let idEntry = '';
  if (options.encrypted) {
    const encryptId = add(
      `<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O <${randomBytes(32).toString('hex')}> /U <${randomBytes(32).toString('hex')}> >>`,
    );
    encryptRef = ` /Encrypt ${encryptId} 0 R`;
    const id = randomBytes(16).toString('hex');
    idEntry = ` /ID [<${id}> <${id}>]`;
  }

  const chunks: Buffer[] = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  let offset = chunks[0]!.length;
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(offset);
    const chunk = Buffer.from(`${index + 1} 0 obj\n${typeof body === 'string' ? body : body.toString('latin1')}\nendobj\n`, 'latin1');
    chunks.push(chunk);
    offset += chunk.length;
  });

  const xrefOffset = offset;
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((value) => `${String(value).padStart(10, '0')} 00000 n \n`)].join('');
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R${infoRef}${encryptRef}${idEntry} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref + trailer, 'latin1'));
  return Buffer.concat(chunks);
}

export function pagesOf(count: number, prefix = 'Page'): PdfPageSpec[] {
  return Array.from({ length: count }, (_, index) => ({ text: `${prefix} ${index + 1}` }));
}

export function validPdf(pageCount = 3): Buffer {
  return buildPdf(pagesOf(pageCount));
}

export function encryptedPdf(): Buffer {
  return buildPdf(pagesOf(1), { encrypted: true });
}

/** Valid PDF cut off mid-file, so the trailer and cross-reference table are missing. */
export function truncatedPdf(): Buffer {
  const full = validPdf(2);
  return full.subarray(0, Math.floor(full.length / 3));
}

export function corruptedPdf(): Buffer {
  return Buffer.from(`%PDF-1.4\n${'garbage stream data '.repeat(200)}\n%%EOF\n`, 'latin1');
}

# pdf-export: Client-side PDF export with flattened elements
Scope: area:export
Status: archived
Base: new

## Goal
Generate and download the filled/signed PDF entirely in the browser, drawing every placed element
into the page content exactly as shown on screen, without altering the rest of the document.

## Requirements
- R1: The toolbar has an `Export` button, disabled with tooltip `Place at least one field to export` when no elements are placed, enabled otherwise. While exporting it shows progress and cannot be triggered twice.
- R2: The exported PDF contains every placed element flattened into page content (not annotations or form fields) at the same page, position, size, rotation, font, size and color as on screen. Text is drawn with the embedded (subset) bundled font, including multi-line text and `àèéìòù`; images are embedded at their original resolution, PNG transparency preserved.
- R3: The download filename is `<original base name>-signed.pdf`, e.g. `contract.pdf` → `contract-signed.pdf`, `Scan.PDF` → `Scan-signed.pdf`.
- R4: Everything else in the original is preserved: page count and order, existing content, form fields, annotations, links, page rotation and document metadata.
- R5: Pages with `/Rotate` 90/180/270 and non-zero `MediaBox`/`CropBox` origins place elements correctly (same visual position as on screen).
- R6: Export runs fully client-side: no network request carries document data. Clicking `Export` itself makes no network request, because the bundled fonts and the export library are already loaded.
- R7: On failure, `Export failed. Your document was not changed.` is shown; the document and placed elements stay intact. After a successful export the editing state is kept, so the user can continue editing and export again.

## Approach
- `pdf-lib` + `@pdf-lib/fontkit` load the original `ArrayBuffer` from `DocumentStore`, embed the bundled TTFs (`subset: true`) and images, and draw with `drawText`/`drawImage` using a transform from the `pdf-viewer` element model (points, displayed orientation, top-left origin) to the page's user space accounting for rotation and box origin. Download via `Blob` + object URL.
- Conversion logic is a pure module in `apps/web` for unit testing. Depends on `app-foundation` and `pdf-viewer`.
- The bundled TTFs are fetched once at app startup. The same bytes are registered with `new FontFace(...)` for the on-screen preview, replacing the CSS `@font-face` rules, and reused for embedding, so fonts are downloaded only once. A failed load is not cached; export retries it. `pdf-lib`/`@pdf-lib/fontkit` stay lazy chunks, preloaded in the background when a document is opened.

## Tasks
- [x] T1: Implement the `Export` button state, progress and double-trigger guard (R1)
- [x] T2: Implement coordinate transformation for rotated pages and box origins as a pure module with unit tests (R5)
- [x] T3: Implement the export pipeline with font subset embedding, multi-line text, images, rotation and colors (R2, R4, R6)
- [x] T4: Implement filename derivation and download (R3)
- [x] T5: Implement error handling and post-export state retention (R7)
- [x] T6: Write Vitest and Playwright export tests with fixtures (normal, rotated, cropped, form-field PDFs) (R1–R7)
- [x] T7: Load the bundled font bytes once and share them between the preview (`FontFace`) and export; remove the CSS `@font-face` rules (R2, R6)
- [x] T8: Preload `pdf-lib`/`@pdf-lib/fontkit` when a document is opened (R6)

## Verification
- R1: `e2e/pdf-export.spec.ts` "enables Export only…": `aria-disabled=true` plus tooltip `Place at least one field to export` with no elements; enabled after placing; with the preloaded pdf-lib chunk held, the button shows `Exporting…` plus a spinner and is disabled; double click plus an extra forced click → exactly 1 download (`Scan-signed.pdf`) | pass
- R2: `e2e/pdf-export.spec.ts` "flattens text and images…": pdf.js text of the export contains `Signed àèéìòù` / `Second line 0123456789` and the date; after reopening, ink bounds stay within 3px, ink amount within 0.6–1.6x, color within 40/channel and mean difference below 20, compared with the on-screen elements (Noto Serif multi-line, PNG, Caveat 28pt `#c00000` rotated 30°). Earlier observed: bounds ≤2px, mean ≤7. The transparent half of the PNG stays page-white; the image XObject is 80x40 with `/SMask`. `foundation.spec.ts` accented-glyph test passes with the script-registered fonts. Fix needed: @pdf-lib/fontkit 1.1.1 subsets dropped glyphs (unpadded glyphs with a short `loca`), patched in `fontkit-padding.ts` | pass
- R3: Vitest `export-geometry.spec.ts`: `contract.pdf`, `Scan.PDF`, `a.b.pdf`, `notes` cases; Playwright: suggested filenames `Scan-signed.pdf`, `layout-signed.pdf`, `contract-signed.pdf` | pass
- R4: `e2e/pdf-export.spec.ts` "keeps pages, content…": 3 pages in order with original text, `/Rotate` (0/270/0), view boxes, annotations (`Link`, `Widget`), field names (`customer`) and Title `Service agreement` equal the original. pdf-lib loads with `updateMetadata: false` and saves with `updateFieldAppearances: false` | pass
- R5: Vitest `export-geometry.spec.ts`: corner mapping for 0/90/180/270 on a CropBox `[50 100 450 700]` inside a shifted MediaBox, element frames, clockwise element rotation, no mirroring; Playwright pixel check on a `/Rotate 90` page with MediaBox `[20 40 632 832]` and CropBox `[60 100 560 760]` | pass
- R6: `e2e/pdf-export.spec.ts` "flattens text and images…": after in-flight requests settle, 0 http(s) requests occur between the Export click and the download; across the whole test each of the 3 font files is requested exactly once (preview and export share the bytes). Vitest `font-files.spec.ts`: one fetch per font, failed downloads retried | pass
- R7: `e2e/pdf-export.spec.ts` "reports a failed export…": with the font files unavailable from startup, the snackbar shows `Export failed. Your document was not changed.`, the element keeps its text and position, Undo and Export stay enabled; once the fonts are available, export succeeds; editing the text and exporting again produces `Keep me again` | pass
- Gates: `npm run lint` pass; `npm test` pass (shared 7, server 24, web 72); production build has no warnings (initial total 728.61 kB; pdf-lib/fontkit lazy). `npm run e2e`: the first run had 1 failure in the unrelated `field-library.spec.ts:44` (confirm dialog not found; 3 serial tests then skipped). It passed when rerun alone (4/4), and a full rerun gave 74/74; `pdf-export` + `foundation` `--repeat-each=2` 60/60 | pass

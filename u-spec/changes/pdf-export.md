# pdf-export: Client-side PDF export with flattened elements
Scope: area:export
Status: ready
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
- R6: Export runs fully client-side: no network request carries document data.
- R7: On failure, `Export failed. Your document was not changed.` is shown; the document and placed elements stay intact. After a successful export the editing state is kept, so the user can continue editing and export again.

## Approach
- `pdf-lib` + `@pdf-lib/fontkit` load the original `ArrayBuffer` from `DocumentStore`, embed the bundled TTFs (`subset: true`) and images, and draw with `drawText`/`drawImage` using a transform from the `pdf-viewer` element model (points, displayed orientation, top-left origin) to the page's user space accounting for rotation and box origin. Download via `Blob` + object URL.
- Conversion logic is a pure module in `apps/web` for unit testing. Depends on `app-foundation` and `pdf-viewer`.

## Tasks
- [ ] T1: Implement the `Export` button state, progress and double-trigger guard (R1)
- [ ] T2: Implement coordinate transformation for rotated pages and box origins as a pure module with unit tests (R5)
- [ ] T3: Implement the export pipeline with font subset embedding, multi-line text, images, rotation and colors (R2, R4, R6)
- [ ] T4: Implement filename derivation and download (R3)
- [ ] T5: Implement error handling and post-export state retention (R7)
- [ ] T6: Write Vitest and Playwright export tests with fixtures (normal, rotated, cropped, form-field PDFs) (R1–R7)

## Verification
- R1: Playwright: disabled with no elements; enabled after placing one; double click triggers one download | not run
- R2: Playwright: export, reopen with pdf.js, extract text → contains placed text incl. `àèéìòù`; rendered pixel comparison of element area vs. on-screen within tolerance; transparent PNG keeps background visible | not run
- R3: Vitest: `contract.pdf`→`contract-signed.pdf`, `Scan.PDF`→`Scan-signed.pdf`, `a.b.pdf`→`a.b-signed.pdf` | not run
- R4: Playwright/Vitest: exported page count, form field names, annotation count, metadata title equal the original | not run
- R5: Vitest transform tests for 0/90/180/270 and offset CropBox; Playwright pixel check on rotated fixture | not run
- R6: Playwright: no network requests during export | not run
- R7: Playwright with forced export error: message shown, elements intact; after success, edit and export again works | not run

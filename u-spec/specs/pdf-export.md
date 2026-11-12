# pdf-export: Client-side PDF export with flattened elements
Scope: area:export

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

# pdf-viewer: Upload, rendering, navigation and element editing
Scope: area:viewer
Status: archived
Base: new

## Goal
Let the user open a PDF locally, read it with page navigation and zoom, and place, edit and
arrange text and image elements on its pages on desktop and mobile. Nothing is uploaded.
Sidebar items are defined by `field-library`; file generation by `pdf-export`.

## Requirements
- R1: With no document, the document area shows a drop zone `Drop a PDF here or click to browse`. Dropping a file anywhere in the window or picking one via the file dialog opens it. Only one PDF is open at a time.
- R2: Non-PDF, corrupted and encrypted/password-protected files are rejected with `This file is not a valid PDF.` or `Password-protected PDFs are not supported.`; the drop zone stays visible. No app-level size limit.
- R3: Pages render in a continuous vertical scroll, crisp on HiDPI screens, rendering only pages near the viewport so large documents stay responsive. Page rotation (`/Rotate`) is respected.
- R4: The toolbar shows the file name, page indicator `n / N` (current page = page mostly in view), a page number input (Enter jumps; invalid values revert) and `Previous`/`Next` buttons (disabled at bounds).
- R5: Zoom: `Zoom out`/`Zoom in` buttons, `Fit width`, `Fit page`, Ctrl/Cmd+mouse wheel, pinch on touch; range 25–400%, current percentage shown; default `Fit width`. Zoom keeps the current page in view, and elements keep their position relative to page content at every zoom.
- R6: Desktop placement: dragging a sidebar item over a page shows a preview; dropping places the element at the drop point and selects it; dropping outside any page places nothing.
- R7: Mobile placement (<768px): tapping a sidebar item places the element centered in the visible part of the current page and selects it; then it is moved by dragging with a finger.
- R8: Element types: text (saved text, `Today's date`, free `Text`) and image (saved image). Free `Text` starts empty in edit mode; a text element left empty when editing ends is removed. Defaults: text `Noto Sans`, 12 pt, black; image 150 CSS px wide at 100% zoom with original aspect ratio.
- R9: Selecting (click/tap) shows an outline, a resize handle and a rotate handle. Move by dragging with mouse/touch, including onto another page; releasing outside any page reverts the move. The element's rotated bounding box is clamped inside its page. Image resize keeps aspect ratio; text resize scales font size (6–72 pt). Rotation is free; holding Shift snaps to 15°.
- R10: A floating toolbar above the selected element offers `Font` (`Noto Sans`, `Noto Serif`, `Caveat`), `Size` (6–72 pt) and `Color` picker for text, plus `Duplicate` (copy offset by 10 pt, selected) and `Delete` for all elements. It stays within the viewport.
- R11: Double-click (desktop) or double-tap (mobile) on a text element enters inline editing; Enter inserts a new line; the box auto-sizes to content; Esc or clicking outside ends editing.
- R12: Desktop shortcuts (not while editing text, except Esc): Ctrl/Cmd+Z undo; Ctrl/Cmd+Shift+Z and Ctrl+Y redo; Delete/Backspace delete selected; arrows nudge 1 pt, Shift+arrows 10 pt; Ctrl/Cmd+D duplicate; Esc ends editing or deselects.
- R13: Undo/Redo toolbar buttons and shortcuts cover add, move, resize, rotate, style change, text edit (one step per editing session), duplicate and delete; history keeps the last 100 steps and resets when the document is closed.
- R14: When at least one element is placed, closing/reloading the tab triggers the browser `beforeunload` warning. `Close document` asks `Discard changes and close this document?` (no confirm if no elements) and returns to the drop zone. Document and elements are kept only in memory.
- R15: Opening, rendering and editing a PDF (including placing saved images) send no request containing PDF bytes and no request to external origins, per global `app-foundation` R4.

## Approach
- `pdfjs-dist` with bundled worker for rendering; per-page canvas plus an overlay layer for elements; `IntersectionObserver` for lazy rendering and current-page tracking.
- `DocumentStore` (signals) holds the original `ArrayBuffer`, file name, page sizes and `PlacedElement[]`: `{ id, pageIndex, kind, x, y, width, height, rotation, text?, font?, fontSize?, color?, imageBlob? }`, coordinates in PDF points in the page's displayed (rotated) orientation, top-left origin. This model is the contract for `pdf-export`.
- Pointer Events for move/resize/rotate (unified mouse/touch), `touch-action` tuned so page scroll still works outside elements. Command-pattern undo stack.
- Depends on `app-foundation` and `field-library` placement payloads.

## Tasks
- [x] T1: Implement drop zone, file picker, window drop and PDF validation/error messages (R1, R2)
- [x] T2: Implement lazy HiDPI page rendering with rotation support (R3)
- [x] T3: Implement page indicator, page input and previous/next navigation (R4)
- [x] T4: Implement zoom controls, fit modes, Ctrl+wheel and pinch (R5)
- [x] T5: Implement `DocumentStore` element model and overlay rendering with bundled fonts (R5, R8)
- [x] T6: Implement desktop drag-to-place and mobile tap-to-place (R6, R7)
- [x] T7: Implement selection, move across pages, clamping, resize and rotate handles (R9)
- [x] T8: Implement floating element toolbar and inline text editing (R10, R11)
- [x] T9: Implement undo/redo history and keyboard shortcuts (R12, R13)
- [x] T10: Implement `Close document` and `beforeunload` handling (R14)
- [x] T11: Write Vitest tests (coordinate conversion, clamping, history) and Playwright flows on desktop and mobile viewports (R1–R14)
- [x] T12: Add a Playwright network-privacy test covering open, render, place, edit and close (R15)

## Verification
Run results: `npm run e2e` passed 70/70 (Playwright starts its own server; run with `E2E_PORT=4812` because VS Code held port 4810); `npm test` passed (shared 7, server 24, web 40); `npm run lint` clean; `npm run build -w @selfsign/web` passed.
- R1: e2e `pdf-viewer.spec.ts`: drop zone text shown; a window drop opens a PDF; a drop while a PDF is open is ignored; picking uses the drop zone's file input (`setInputFiles`). Manual: a 5-page real PDF opened via the file input on the built and dev servers (integrated browser, Chrome 150). | pass
- R2: e2e: `.txt`, corrupted and truncated files show `This file is not a valid PDF.`; an encrypted file shows `Password-protected PDFs are not supported.`; the drop zone stays visible after each. No size limit exists in code. | pass
- R3: e2e: a 200-page PDF keeps at most 6 rendered canvases while scrolling; a `/Rotate 90` page renders landscape (upright glyph orientation was not compared pixel by pixel); at device scale 2 canvas pixels are about 2x CSS pixels. | pass
- R4: e2e: indicator `1 / 200` follows scrolling; `5` + Enter jumps to page 5; `0` and `abc` revert; Previous is disabled on page 1 and Next on the last page. | pass
- R5: e2e: zoom buttons stop at 25% and 400% and disable there; Fit width is the default; a placed element keeps its page-relative position at 25% and 400%; Ctrl+wheel changes zoom; a two-finger touch pinch changes zoom; Fit page shows the first page whole. | pass
- R6: e2e `drag from the sidebar places free text...`: the drop preview shows over page 2 and the free Text element lands there in edit mode; `drops outside every page place nothing` passes. After field-library T16, dragging `Today's date`, a saved text and a saved image from the sidebar onto a page places each at the drop point (field-placement e2e). | pass
- R7: e2e mobile (390px, touch): tapping Place centers the element in the visible page area and selects it; a CDP touch drag moves it. | pass
- R8: e2e: defaults Noto Sans, 12 and #000000 in the element toolbar; free Text starts in edit mode; an empty text element is removed when editing ends; a saved 2:1 image is 150 px wide at 100% zoom. | pass
- R9: e2e: a move onto page 2 applies and a move released outside pages reverts; moved elements stay inside page bounds; image resize keeps the 2:1 ratio and undo restores the width; text resize changes size and clamps at 6 pt; Shift rotation lands on a 15° multiple and undo restores 0°. | pass
- R10: e2e: font, size and color apply from the floating toolbar; Duplicate offsets 10 pt and selects the copy; Delete removes; the toolbar stays inside the visible area; toolbar undo and redo restore the size. | pass
- R11: e2e: double-click enters editing; Enter adds a line and the box grows to two lines; Escape ends editing; undo restores the previous text; Delete and Backspace remove characters only while editing. | pass
- R12: e2e `keyboard shortcuts...`: arrows move 1 pt and Shift+arrows 10 pt; Ctrl and Meta variants of Z, Shift+Z, Y, D, Delete and Escape perform their actions; Delete while editing text removes characters only. | pass
- R13: Vitest `command-history.spec.ts`: 101 steps keep the latest 100, and a new change clears redo. `document-store.spec.ts`: repeated nudges merge into one step, a new free text is one step, emptied text is removed and restored by undo, duplicate offset, font clamp. e2e undo/redo covers add, nudge, duplicate, delete, font size, rotation, text edit and image resize. | pass
- R14: e2e: `beforeunload` is cancelled only when elements exist, and a real `beforeunload` dialog appears on navigation (dismissed, document kept); `Close document` asks `Discard changes and close this document?` (Cancel keeps the document, Discard returns to the drop zone); no prompt when nothing was placed. | pass
- R15: e2e `pdf-privacy.spec.ts`: opening, paging, placing a saved image and a free text, editing, zooming and closing send only same-origin requests (blob: and data: excluded); no request body contains `%PDF-` or the fixture's first 96 bytes; non-GET requests, if any, are saved-value API calls. | pass

# pdf-viewer: Upload, rendering, navigation and element editing
Scope: area:viewer
Status: ready
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

## Approach
- `pdfjs-dist` with bundled worker for rendering; per-page canvas plus an overlay layer for elements; `IntersectionObserver` for lazy rendering and current-page tracking.
- `DocumentStore` (signals) holds the original `ArrayBuffer`, file name, page sizes and `PlacedElement[]`: `{ id, pageIndex, kind, x, y, width, height, rotation, text?, font?, fontSize?, color?, imageBlob? }`, coordinates in PDF points in the page's displayed (rotated) orientation, top-left origin. This model is the contract for `pdf-export`.
- Pointer Events for move/resize/rotate (unified mouse/touch), `touch-action` tuned so page scroll still works outside elements. Command-pattern undo stack.
- Depends on `app-foundation` and `field-library` placement payloads.

## Tasks
- [ ] T1: Implement drop zone, file picker, window drop and PDF validation/error messages (R1, R2)
- [ ] T2: Implement lazy HiDPI page rendering with rotation support (R3)
- [ ] T3: Implement page indicator, page input and previous/next navigation (R4)
- [ ] T4: Implement zoom controls, fit modes, Ctrl+wheel and pinch (R5)
- [ ] T5: Implement `DocumentStore` element model and overlay rendering with bundled fonts (R5, R8)
- [ ] T6: Implement desktop drag-to-place and mobile tap-to-place (R6, R7)
- [ ] T7: Implement selection, move across pages, clamping, resize and rotate handles (R9)
- [ ] T8: Implement floating element toolbar and inline text editing (R10, R11)
- [ ] T9: Implement undo/redo history and keyboard shortcuts (R12, R13)
- [ ] T10: Implement `Close document` and `beforeunload` handling (R14)
- [ ] T11: Write Vitest tests (coordinate conversion, clamping, history) and Playwright flows on desktop and mobile viewports (R1–R14)

## Verification
- R1: Playwright: drop PDF on window and pick via dialog → pages render | not run
- R2: Playwright: `.txt`, truncated PDF, encrypted PDF → exact messages, drop zone stays | not run
- R3: Playwright: 200-page PDF opens and scrolls responsively; only nearby pages have canvases; rotated-page fixture renders upright as in other viewers | not run
- R4: Playwright: scroll updates `n / N`; input `5` + Enter jumps; `0`/`abc` revert; buttons disabled at first/last | not run
- R5: Playwright: buttons/Ctrl+wheel change zoom within 25–400%; placed element stays on same text at 50% and 300% | not run
- R6: Playwright desktop: drag item to page 2 → element on page 2 at drop point, selected; drop on gutter → none | not run
- R7: Playwright 390px with touch: tap item → element centered in visible page area; touch drag moves it | not run
- R8: Playwright: free `Text` starts editing; empty on blur removed; defaults as specified | not run
- R9: Playwright: move to other page; release outside pages reverts; resize image keeps ratio; text resize changes font size within limits; Shift-rotate snaps to 15°; cannot leave page bounds | not run
- R10: Playwright: change font/size/color applies; duplicate offsets 10 pt; delete removes | not run
- R11: Playwright: double-click edit, multi-line text, Esc ends editing | not run
- R12: Playwright: each shortcut performs its action; Delete while editing text deletes characters only | not run
- R13: Vitest history: 101 actions keep 100; Playwright: undo/redo each operation type | not run
- R14: Playwright: with elements, `beforeunload` dialog fires; `Close document` confirm returns to drop zone; without elements no confirm | not run

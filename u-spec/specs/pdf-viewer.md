# pdf-viewer: Upload, rendering, navigation and element editing
Scope: area:viewer

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
- R16: After a successful export completes and the exported file is downloaded, `Close document` closes the document without showing `Discard changes and close this document?` when no document edit has occurred since that export.
- R17: After a successful export, any subsequent document edit—including adding, moving, resizing, rotating, styling, editing, duplicating or deleting an element, and undoing or redoing such a change—makes `Close document` show `Discard changes and close this document?` again.
- R18: A failed export or an export that does not complete successfully does not change the unsaved state; existing unsaved edits continue to require confirmation when closing.
- R19: After a successful export and with no subsequent document edit, leaving or reloading the page does not trigger the browser `beforeunload` warning. Any subsequent document edit re-enables that warning.
- R20: The existing behavior remains unchanged for documents with no placed elements and for successful export's editing state: the open document and its elements remain available for continued editing.

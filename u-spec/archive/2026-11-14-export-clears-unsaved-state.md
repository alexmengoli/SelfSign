# export-clears-unsaved-state: Treat a successful export as the saved editing state
Scope: area:viewer
Status: archived
Base: new

## Goal
Avoid warning the user about losing changes after a successful PDF export when the document has not been modified since that export. Keep the warning behavior for failed or cancelled exports and for any later modification.

## Requirements
- R1: After a successful export completes and the exported file is downloaded, `Close document` closes the document without showing `Discard changes and close this document?` when no document edit has occurred since that export.
- R2: After a successful export, any subsequent document edit—including adding, moving, resizing, rotating, styling, editing, duplicating or deleting an element, and undoing or redoing such a change—makes `Close document` show `Discard changes and close this document?` again.
- R3: A failed export or an export that does not complete successfully does not change the unsaved state; existing unsaved edits continue to require confirmation when closing.
- R4: After a successful export and with no subsequent document edit, leaving or reloading the page does not trigger the browser `beforeunload` warning. Any subsequent document edit re-enables that warning.
- R5: The existing behavior remains unchanged for documents with no placed elements and for successful export's editing state: the open document and its elements remain available for continued editing.

## Approach
Track whether the current in-memory document state has changed since the latest successful export, using the existing document editing/history change boundaries rather than treating the presence of elements as the dirty-state signal. Mark the current state clean only after export and download complete for the still-open document; leave it dirty on export failure or cancellation. Use this state for both `requestClose` and `onBeforeUnload`. Add focused viewer/export regression coverage for clean-after-export, dirty-after-edit, and failed-export cases.

## Tasks
- [x] T1: Add document dirty-state tracking and a successful-export clean-state transition, covering R1, R2, R3 and R5.
- [x] T2: Use the dirty-state signal for `Close document` confirmation and the browser `beforeunload` handler, covering R1, R2 and R4.

## Verification
- R1: `npm test -w @selfsign/web`, `npm run build`, and `npx playwright test e2e/pdf-export.spec.ts --workers=1` pass; the successful-export close regression reports `ok`. | passed
- R2: `npm test -w @selfsign/web`, `npm run lint`, and `npx playwright test e2e/pdf-export.spec.ts --workers=1` pass; the edit-after-export close regression reports `ok`. | passed
- R3: `npx playwright test e2e/pdf-export.spec.ts --workers=1` passes; the failed-export close regression reports `ok`. | passed
- R4: The dirty-state handler uses the same signal as close confirmation, and the focused Playwright export suite passes. | passed
- R5: `npm test -w @selfsign/web` and `npm run build` pass; existing no-elements and export-continuation behavior was not changed by the implementation. | passed

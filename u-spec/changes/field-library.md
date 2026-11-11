# field-library: Sidebar with saved, current and free fields
Scope: area:sidebar
Status: ready
Base: new

## Goal
Provide the sidebar that lists every element the user can place on the document: a free `Text`
element for document-specific values that are not saved, current values (`Today's date`), and
user-defined saved values (text or image) persisted server-side without authentication.
Placement and editing on the page are defined by `pdf-viewer`.

## Requirements
- R1: The sidebar has three sections in this order: `Text` (one item `Text` that creates an empty free text element, never saved), `Current values` (item `Today's date` showing a live preview of the formatted date) and `Saved values` (user-defined items). The sidebar is always visible so values can be managed without a document; placing items is disabled (with tooltip `Open a PDF to place fields`) until a PDF is loaded.
- R2: `Add value` → `Text` opens a dialog with `Label` (required, 1–100 chars) and `Value` (required, multi-line); `Save` adds it at the end of `Saved values` and persists it. Example: label `Tax code`, value `RSSMRA80A01H501U`.
- R3: `Add value` → `Image` opens a dialog with `Label` (required, 1–100 chars) and a file picker accepting PNG and JPEG only; the item shows a thumbnail. Other formats (checked by content, not just extension) are rejected with `Only PNG and JPEG images are supported.` PNG transparency is preserved. No app-level size limit.
- R4: Each saved item has `Edit` (change label/value, or label/replace image) and `Delete`; delete asks `Delete "<label>"?` with `Cancel`/`Delete`, and removes the stored image file for image items.
- R5: Saved items can be reordered by dragging a handle; the order persists across reloads.
- R6: Saved values and images persist on the server in `DATA_DIR` and survive server/container restarts. All browsers reaching the server share the same data (last write wins).
- R7: Settings are server-side. `Current values` contains a `Date format` selector with `dd/MM/yyyy` (default), `MM/dd/yyyy`, `yyyy-MM-dd`, `dd.MM.yyyy`; the choice persists. `Today's date` uses the browser's local date at placement time, e.g. 12 Nov 2026 with `dd/MM/yyyy` → `12/11/2026`.
- R8: Placing any sidebar item creates an independent element: later edits on the page do not change the saved value, and editing/deleting a saved value does not change already placed elements.
- R9: If the API is unreachable or fails, `Saved values` shows `Could not load saved values.` with `Retry`, and failed saves show an error snackbar keeping dialog input. `Text` and `Today's date` (using the default format if settings failed) remain usable; PDF viewing and export are unaffected.
- R10: Below `768px`, the sidebar is a bottom sheet opened by a `Fields` button; tapping an item places it (per `pdf-viewer`) and closes the sheet. Management actions (add/edit/delete/reorder) remain available in the sheet.
- R11: REST API (`/api`), JSON unless noted, validated server-side with 400 on invalid input, 404 on unknown IDs, 415 on unsupported image type:
  `GET /values`; `POST /values` (text); `POST /values/image` (multipart `label`, `file`); `PUT /values/:id` (label/text); `PUT /values/:id/image` (multipart replace); `DELETE /values/:id`; `PUT /values/order` (`{ ids }`, must be a permutation of existing IDs); `GET /images/:id` (bytes with correct `Content-Type`); `GET /settings`; `PUT /settings` (`{ dateFormat }`, one of the four presets). IDs are server-generated UUIDs; any non-UUID ID is rejected (no path traversal).

## Approach
- Shared types in `packages/shared`: `SavedValue = { id, kind: 'text' | 'image', label, text?, imageId?, mimeType? }`, `Settings = { dateFormat }`, `DateFormat` union.
- Server: `DATA_DIR/data.json` (`{ values: SavedValue[] (ordered), settings }`) written atomically (temp file + rename, serialized writes); images at `DATA_DIR/images/<uuid>.png|jpg`. `@fastify/multipart` without file size limit; image type detected by magic bytes.
- Web: `FieldLibraryService` (signals) wrapping the API; sidebar component with Angular CDK drag-drop for reorder; Material dialogs, snackbar and bottom sheet. Drag/tap sources emit a placement payload `{ kind: 'text' | 'image', text?, imageUrl?/blob }` consumed by `pdf-viewer`.
- Depends on `app-foundation`.

## Tasks
- [ ] T1: Add shared types and date-format utility with unit tests (R7, R11)
- [ ] T2: Implement server storage (atomic JSON, image files) and REST endpoints with validation (R2, R3, R4, R5, R6, R7, R11)
- [ ] T3: Build sidebar sections, disabled state without a document, and placement payloads (R1, R8)
- [ ] T4: Implement add/edit/delete dialogs for text and image values with validation messages (R2, R3, R4)
- [ ] T5: Implement drag-handle reordering with persistence (R5)
- [ ] T6: Implement the date format selector and `Today's date` preview (R7)
- [ ] T7: Implement API error states, Retry and snackbars (R9)
- [ ] T8: Implement mobile bottom sheet behavior (R10)
- [ ] T9: Write server Vitest tests, web Vitest tests and Playwright sidebar flows (R1–R11)

## Verification
- R1: Playwright: sections in order; without PDF, items show disabled tooltip; add/edit still works | not run
- R2: Playwright: add `Tax code`/`RSSMRA80A01H501U` → listed last, present after reload; empty label blocked | not run
- R3: Playwright: upload PNG with alpha → thumbnail shows transparency; `.gif` or `.png`-renamed text file → error message; server test returns 415 | not run
- R4: Playwright: edit label persists; delete confirm removes item; server test: image file removed from `DATA_DIR/images` | not run
- R5: Playwright: reorder then reload → same order; server test: non-permutation → 400 | not run
- R6: Restart server (and container) → values and images still served | not run
- R7: Vitest: each preset formats 2026-11-12 correctly; Playwright: change format → preview updates and persists after reload | not run
- R8: Playwright: place saved value, edit placed text, check sidebar unchanged; edit saved value, placed element unchanged | not run
- R9: Playwright with `page.route('/api/**', abort)`: error + Retry visible, `Text` and `Today's date` placeable; Retry after unblocking loads values | not run
- R10: Playwright at 390px: `Fields` opens sheet, tap item places and closes sheet | not run
- R11: Vitest (Fastify inject) for every endpoint, including 400/404/415 and `../` / non-UUID IDs rejected | not run

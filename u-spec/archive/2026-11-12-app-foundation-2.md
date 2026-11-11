# app-foundation: Project stack, container, theme and shared UI rules
Scope: global
Status: archived
Base: 975254931DF4B9383E313851716F35A819D7F2A2ECA4F1E2223C730CD8C549E1

## Goal
Bootstrap SelfSign, a self-hosted web app that visually signs and fills PDFs entirely in the browser.
Define the project-wide stack, Docker deployment, privacy rules, theme, layout and bundled fonts
shared by the `viewer`, `sidebar` and `export` areas. Replace the rigid, edge-attached shell appearance
with rounded controls and floating tool surfaces, and move the desktop Fields panel to the right.
Correct the vertical alignment of the theme icons within their existing pill segments.
Cryptographic/digital signatures (PAdES, certificates) and authentication are out of scope.
This change does not implement pending viewer, field-library or export features.

## Requirements
- R1: The repository is an npm workspaces monorepo with `apps/web` (Angular, latest stable, standalone components, signals), `apps/server` (Node Active LTS + Fastify) and `packages/shared` (shared TypeScript types); TypeScript `strict` everywhere. Root scripts `npm run dev`, `npm run build`, `npm run lint`, `npm test`, `npm run e2e` exist and succeed on a clean checkout after `npm ci`. Framework/runtime versions are pinned.
- R2: One server process serves the Angular build as static files (SPA fallback to `index.html` for non-`/api` GET routes) and the REST API under `/api`, on `PORT` (default `8080`). Data lives in `DATA_DIR` (default `/data` in the container, `./data` in dev), created on startup if missing. `GET /api/health` returns `200 {"status":"ok"}`.
- R3: A multi-stage `Dockerfile` produces a single image that runs as a non-root user, exposes `8080`, declares volume `/data`, has a `HEALTHCHECK` on `/api/health`, and builds for `linux/amd64` and `linux/arm64`. A `docker-compose.yml` example maps `8080:8080` and a `./data:/data` volume; saved data survives `docker compose down && docker compose up -d`.
- R4: PDF processing is client-side only: PDF bytes are never sent to the server (no request body contains the PDF while loading, editing or exporting). The app makes no requests to external origins (fonts, pdf.js worker and assets are bundled). The server sends `Content-Security-Policy` restricted to `'self'` (plus `blob:`/`data:` where required for images and workers) and `X-Content-Type-Options: nosniff`.
- R5: All UI text (labels, buttons, messages, errors, tooltips, page title) is in English.
- R6: A header theme control offers `System`, `Light`, `Dark`; default `System` follows `prefers-color-scheme` and reacts live to OS changes. The choice is stored in `localStorage` and restored on reload. Both themes meet WCAG AA text contrast.
- R7: UI uses Angular Material (M3) with a custom minimal theme. Layout is desktop-first: header, document area on the left filling the available space, Fields sidebar on the right. At widths of `768px` and above the panel occupies its own layout column without covering the document. Below `768px` width the layout switches to mobile mode (sidebar as bottom sheet, defined by `field-library`) with no horizontal page scroll at 360px width except inside the zoomed document area.
- R8: Fonts `Noto Sans` (default), `Noto Serif` and `Caveat` (all OFL) are bundled locally, used both for on-screen rendering of text elements and for export, and support Latin characters including `àèéìòùÀÈÉÌÒÙ`.
- R9: `README.md` documents: purpose, privacy model (files never leave the browser), `docker compose` quick start, env vars (`PORT`, `DATA_DIR`), volume permissions for the non-root user, multi-arch build via `docker buildx build --platform linux/amd64,linux/arm64`, local development, and a security note that there is no authentication so anyone reaching the port can read/modify saved data (including signature images) and the service should be kept on a trusted network or behind a reverse proxy/VPN with auth.
- R10: Test tooling: Vitest for `apps/web`, `apps/server` and `packages/shared`; Playwright for E2E against the built server. Each area spec adds its own tests.
- R11: Theme and other segmented selection controls use one pill-shaped group with a rounded selected segment, no hard rectangular segment dividers, and a clearly distinguishable selection in light and dark themes. The theme control remains icon-only with English tooltips and accessible names `System`, `Light`, `Dark`; exactly one option is selected. Keyboard operation, visible focus, hover feedback and theme persistence remain functional.
- R12: The desktop Fields panel is an inset floating surface with all four corners rounded, a subtle elevation shadow, and visible gaps from the header, document area and window edges; it has no full-height divider attaching it to the document. Panel content scrolls within the available height without clipping its controls. At `1440x900` it appears to the right of, and does not overlap, the document area. The mobile sheet retains its existing opening, dismissal and responsive transition behavior.
- R13: Rounded controls and floating tool surfaces are shared visual rules, not one-off theme-toggle styling. Buttons and segmented controls use rounded or pill shapes; tool panels use consistent rounded corners, spacing and restrained elevation in both themes. The mobile bottom sheet has rounded top corners while remaining bottom-attached. Do not wrap every page section in a card or add nested decorative cards. Actual PDF page geometry and exported document content remain rectangular and unaffected; stack, colors, fonts and feature behavior are otherwise unchanged.
- R14: Each `System`, `Light`, `Dark` icon is vertically centered inside its actual theme button, with at most `1px` difference between their bounding-box vertical centers. Theme buttons retain a stable `36px` height and `40px` segment width; SVGs remain `18x18px`. Centering holds at `1440x900` and `360x740`, in light and dark themes, for selected and unselected options and during hover or keyboard focus. Preserve the existing icons, pill appearance, horizontal placement and theme behavior.

## Approach
The implemented shell in `apps/web/src/app/app.html` and `apps/web/src/app/app.scss` already places
the document before an inset right-side `320px` Fields panel. Preserve its `768px` breakpoint,
`12px` gutters, `16px` panel corners, internal scrolling and mobile bottom-sheet behavior.
Shared shape and elevation rules live in `apps/web/src/styles.scss`; keep these rules and the
existing Material pill selection semantics, tooltips and ThemeService behavior.
Read-only browser measurements on 2026-11-12 found all three SVG vertical centers `2.5px` above
their button centers: buttons measured `23px` high, SVGs `18px`, while the inline-block Material
label reported `36px` line-height and the SVG used `display: block`. The likely local cause is
the label/SVG sizing interaction rather than the icon paths or header placement.
In `apps/web/src/app/shell/theme-toggle.ts` and, only where needed for the inner Material label,
narrowly scoped rules in `apps/web/src/styles.scss`, make the actual button/label geometry honor
the existing `36px` control height and explicitly center the SVG using layout alignment.
Avoid per-icon offsets, transforms or path changes; do not alter other controls or the shell.
The correction in `apps/web/src/styles.scss` scopes Flexbox centering and explicit button/label
height to `app-theme-toggle`; other controls and SVG paths are unchanged. Extended checks in
`e2e/foundation.spec.ts` compare each SVG bounding box with its actual button and verify stable
dimensions across selection/hover/focus. Desktop/mobile screenshots were reviewed in both themes.

## Tasks
- [x] T1: Move the desktop Fields panel to the right and add inset spacing, rounded corners, elevation and safe internal scrolling while preserving mobile behavior (R7, R12).
- [x] T2: Retain the implemented pill theme selector and correct its button/label sizing and vertical icon alignment; preserve accessible selection, tooltips, focus and theme behavior (R5, R6, R11, R14).
- [x] T3: Define and apply shared rounded control/tool-surface rules, including mobile sheet top corners, without changing document geometry or unrelated appearance (R13).
- [x] T4: Preserve existing foundation coverage and extend the pill-selector tests with button/icon dimensions and vertical-center assertions across desktop/mobile, both themes, selection, hover and keyboard focus (R5, R6, R7, R11, R12, R13, R14).
- [x] T5: Run focused foundation checks, then build, unit tests and lint; confirm unchanged foundation contracts and record any unavailable deployment checks (R1, R2, R3, R4, R8, R9, R10).
- [x] T6: After the alignment correction, run the focused foundation suite, build, unit tests and lint; review both-theme desktop/mobile screenshots and refresh affected verification evidence (R1, R4, R5, R6, R10, R11, R14).

## Verification
- R1: `npm ci` and `npm run e2e` passed for the initial implementation on 2026-11-12. After the alignment correction, `npm run build`, `npm run lint`, `npm test` and `npx playwright test e2e/foundation.spec.ts --workers=1` passed. `npm run dev` restarted the API/static server on `8080` and Angular on `4200` so cached startup HTML references the rebuilt stylesheet. Pinned dependencies, lockfile and strict configuration are unchanged. Installation previously reported 10 moderate dependency advisories; no dependency changes were made. | passed
- R2: `npm test` passed all 21 server tests; `npm run e2e` passed static/CSP checks. The isolated production container served `200` health with `status: ok` and the SPA after recreation. | passed
- R3: Deployment files are unchanged. In WSL Docker, `docker buildx build --platform linux/amd64,linux/arm64 --output type=oci,dest=/tmp/selfsign-foundation-check.oci.tar` succeeded with a temporary docker-container builder; a separate amd64 build loaded `selfsign:foundation-check`. Image inspection confirmed user `node`, `8080/tcp`, `/data` and the healthcheck. The existing Compose configuration, parsed as JSON and overridden only for isolated image/name/port/temporary bind storage, passed healthy startup, non-root write and saved-data survival across `docker compose down` and `docker compose up -d --wait`. Test containers and builder were removed; the preview on `8080` was not replaced. | passed
- R4: `npm run e2e` passed self-only CSP, nosniff, no external requests and no console/CSP errors. Diff review confirms only layout/styles and tests changed, with no PDF upload path introduced. | passed
- R5: Foundation English UI checks and all three rendered English tooltip checks passed in `npx playwright test e2e/foundation.spec.ts --workers=1` and `npm run e2e`. Accessible names remain `System`, `Light`, `Dark`. | passed
- R6: Existing live System/OS, explicit preference, reload persistence and WCAG AA text contrast checks passed in both themes. | passed
- R7: Foundation E2E passed right-side inset/non-overlap geometry at `768`, `1024`, `1440`, and mobile-only bottom-sheet behavior with zero horizontal overflow at `360` and `767`. | passed
- R8: The bundled-font/accented-character E2E check passed; font assets, font definitions and export-related code are unchanged. | passed
- R9: Reviewed `README.md`: purpose, browser privacy, Compose startup, env vars, non-root volume permissions, multi-arch build, local development and unauthenticated-access warning remain documented; no left-sidebar guidance exists. | passed
- R10: After the alignment correction, `npm test` passed 31 Vitest tests across all three workspaces. `npm run build` followed by `npx playwright test e2e/foundation.spec.ts --workers=1` passed all 19 foundation E2E tests against the production build, including the four new alignment cases; the initial `npm run e2e` gate also passed before this correction. | passed
- R11: After correction, the production build, all 19 foundation E2E checks, all 31 unit tests and lint passed. Existing pointer selection, ArrowRight cycling, single selection, tooltips, visible 2px keyboard focus, 999px capsule/segment radii, distinct selection backgrounds and zero segment borders remain covered and passing. Reviewed header screenshots at `1440x900` and `360x740` in Light and Dark confirm centered, unclipped icons and preserved pill styling. | passed
- R12: Focused and full E2E runs passed 12px desktop gaps, 320px panel width, 16px corners, nonzero shadow and no divider/overlap. An injected overflowing test field remained reachable by focus and scrolled inside the panel. Mobile Escape dismissal, focus restoration, reopening and resize-to-desktop dismissal passed. | passed
- R13: Both-theme desktop/mobile screenshot review confirms shared pill controls and floating panel styling, with 16px mobile sheet top corners and bottom attachment. E2E confirms shared button/capsule radii; diff review confirms no document/export styling or nested decorative cards. Restored the shared browser's original System preference and cleared temporary viewport/media overrides after review. `git diff --check` and editor diagnostics passed. | passed
- R14: The initial browser measurement reproduced `-2.5px` vertical offset and `23px` button height. After correction, all four new `icons stay centered` cases passed independently, then passed again within the 19-test foundation suite. They assert `36px` button height, `40px` button/segment width, `18x18px` SVGs and absolute vertical-center difference at most `1px` for every option across selection, hover and keyboard focus at `1440x900` and `360x740` in both themes. Live measurements after preview restart confirmed exactly `0px` offset for all three icons in all four combinations; screenshots confirm visual centering without overflow. Restored the original Light preference and `360x740` viewport. `npm run build`, `npm test`, `npm run lint`, editor diagnostics and `git diff --check` passed. | passed
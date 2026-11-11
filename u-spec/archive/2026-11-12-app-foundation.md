# app-foundation: Project stack, container, theme and shared UI rules
Scope: global
Status: archived
Base: new

## Goal
Bootstrap SelfSign, a self-hosted web app that visually signs and fills PDFs entirely in the browser.
Define the project-wide stack, Docker deployment, privacy rules, theme, layout and bundled fonts
shared by the `viewer`, `sidebar` and `export` areas. Cryptographic/digital signatures (PAdES,
certificates) and authentication are out of scope.

## Requirements
- R1: The repository is an npm workspaces monorepo with `apps/web` (Angular, latest stable, standalone components, signals), `apps/server` (Node Active LTS + Fastify) and `packages/shared` (shared TypeScript types); TypeScript `strict` everywhere. Root scripts `npm run dev`, `npm run build`, `npm run lint`, `npm test`, `npm run e2e` exist and succeed on a clean checkout after `npm ci`. Framework/runtime versions are pinned.
- R2: One server process serves the Angular build as static files (SPA fallback to `index.html` for non-`/api` GET routes) and the REST API under `/api`, on `PORT` (default `8080`). Data lives in `DATA_DIR` (default `/data` in the container, `./data` in dev), created on startup if missing. `GET /api/health` returns `200 {"status":"ok"}`.
- R3: A multi-stage `Dockerfile` produces a single image that runs as a non-root user, exposes `8080`, declares volume `/data`, has a `HEALTHCHECK` on `/api/health`, and builds for `linux/amd64` and `linux/arm64`. A `docker-compose.yml` example maps `8080:8080` and a `./data:/data` volume; saved data survives `docker compose down && docker compose up -d`.
- R4: PDF processing is client-side only: PDF bytes are never sent to the server (no request body contains the PDF while loading, editing or exporting). The app makes no requests to external origins (fonts, pdf.js worker and assets are bundled). The server sends `Content-Security-Policy` restricted to `'self'` (plus `blob:`/`data:` where required for images and workers) and `X-Content-Type-Options: nosniff`.
- R5: All UI text (labels, buttons, messages, errors, tooltips, page title) is in English.
- R6: A header theme control offers `System`, `Light`, `Dark`; default `System` follows `prefers-color-scheme` and reacts live to OS changes. The choice is stored in `localStorage` and restored on reload. Both themes meet WCAG AA text contrast.
- R7: UI uses Angular Material (M3) with a custom minimal theme. Layout is desktop-first: header, sidebar on the left, document area filling the rest. Below `768px` width the layout switches to mobile mode (sidebar as bottom sheet, defined by `field-library`) with no horizontal page scroll at 360px width except inside the zoomed document area.
- R8: Fonts `Noto Sans` (default), `Noto Serif` and `Caveat` (all OFL) are bundled locally, used both for on-screen rendering of text elements and for export, and support Latin characters including `àèéìòùÀÈÉÌÒÙ`.
- R9: `README.md` documents: purpose, privacy model (files never leave the browser), `docker compose` quick start, env vars (`PORT`, `DATA_DIR`), volume permissions for the non-root user, multi-arch build via `docker buildx build --platform linux/amd64,linux/arm64`, local development, and a security note that there is no authentication so anyone reaching the port can read/modify saved data (including signature images) and the service should be kept on a trusted network or behind a reverse proxy/VPN with auth.
- R10: Test tooling: Vitest for `apps/web`, `apps/server` and `packages/shared`; Playwright for E2E against the built server. Each area spec adds its own tests.

## Approach
- Layout: `apps/web`, `apps/server`, `packages/shared`, root `package.json` workspaces, root `tsconfig.base.json`, ESLint (angular-eslint + typescript-eslint).
- Server: Fastify with `@fastify/static` for the web build, `@fastify/helmet` (or explicit hooks) for headers. Config read from env only. `index.html` is served by the server with a per-request CSP style nonce (`ngCspNonce`) so no `'unsafe-inline'` is needed; startup fails with a clear message if `DATA_DIR` is not writable.
- Web: Angular with Material M3 theme via CSS variables; `color-scheme` handled by a `ThemeService` setting `data-theme` on `<html>` (plus `public/theme-init.js` to avoid a theme flash); fonts as local `@font-face` TTF assets in `apps/web/public/fonts`, the same files used for screen and export embedding (`DOCUMENT_FONTS` in `apps/web/src/app/core/document-fonts.ts`).
- Docker: build stage (`node:<lts>`), runtime stage (`node:<lts>-alpine`), `USER node`, only production deps of the server plus the web build.
- Order of application: `app-foundation` → `field-library` → `pdf-viewer` → `pdf-export`.

## Tasks
- [x] T1: Create the monorepo skeleton, shared tsconfig, lint config and root scripts (R1, R10)
- [x] T2: Implement the Fastify server: static SPA serving, `/api/health`, `PORT`/`DATA_DIR` config, security headers (R2, R4)
- [x] T3: Create the Angular app shell: header, sidebar slot, document slot, responsive breakpoint, Material M3 minimal theme, English texts (R5, R7)
- [x] T4: Implement the theme control with `System`/`Light`/`Dark`, live OS sync and `localStorage` persistence (R6)
- [x] T5: Bundle Noto Sans, Noto Serif, Caveat locally for screen and export use (R4, R8)
- [x] T6: Add `Dockerfile`, `.dockerignore`, `docker-compose.yml` with healthcheck, non-root user, `/data` volume (R3)
- [x] T7: Set up Vitest and Playwright and write foundation tests (R2, R4, R6, R7, R10)
- [x] T8: Write `README.md` (R9)

## Verification
- R1: `npm ci && npm run lint && npm run build && npm test` exit 0 | passed: all exit 0 (Angular 22.2.6, TypeScript 6.0.3, Node 24.22.1 locally; Docker pinned to Node 26.13.1 Active LTS); `tsc` typecheck of every project exit 0. `npm audit --omit=dev`: 0 vulnerabilities (10 moderate dev-only advisories in the ESLint toolchain)
- R2: Vitest/Fastify inject: `GET /api/health` → 200 `{"status":"ok"}`; `GET /some/route` → `index.html`; `PORT=9000` listens on 9000; missing `DATA_DIR` is created | passed: 21 server tests (health, SPA fallback for `/`, `/some/route`, `/index.html`, 404 for `/api/*` and missing assets, missing `DATA_DIR` created, invalid `PORT` rejected); built server started with `PORT=9000` and a missing temp `DATA_DIR` listened on 9000 and created the directory
- R3: `docker compose up -d --build` → container healthy, `http://localhost:8080` loads; `docker inspect` user is non-root; `docker buildx build --platform linux/amd64,linux/arm64 .` succeeds; data persists after recreate | passed (Docker 24.0.7 in WSL Ubuntu): `docker compose build` and `up -d` → `healthy`; `http://localhost:8080/` 200 with CSP/`nosniff`, no console errors in browser; `Config.User=node`, `uid=1000`; file written to `/data` survived `docker compose down` + `up -d`; `docker buildx build --platform linux/amd64,linux/arm64 .` exit 0 (QEMU binfmt for arm64); arm64 image ran under emulation as `aarch64` and became `healthy`; image size 198MB
- R4: Playwright: record all requests during app load → none to external origins and no CSP violations; response headers include CSP and `nosniff`. The "no PDF bytes sent" check is verified where PDFs are handled: `pdf-viewer` R15 (load/edit) and `pdf-export` R6 (export) | passed: E2E confirms no external requests and no console/CSP errors on app load, CSP `'self'` without `unsafe-inline` and `nosniff` on all responses (also from the Docker container)
- R5: Manual review of all screens and Playwright snapshots: English only | passed: integrated-browser review of desktop, mobile and bottom sheet; E2E checks `lang="en"`, title and visible texts
- R6: Playwright `emulateMedia({ colorScheme })` with `System` follows dark/light; selecting `Dark` persists after reload | passed: E2E live OS switch and persistence of `Dark`/`Light` across reload; AA contrast (>= 4.5) checked for visible texts in both themes at 1440px and 360px
- R7: Playwright at 1440px shows sidebar left; at 360px no horizontal page scroll and bottom-sheet mode is active | passed: E2E (fixed a 1px header overflow at 360px); bottom sheet opens from `Fields` and closes when resizing to desktop
- R8: Rendering test with `àèéìòù` in each font shows no missing glyphs on screen | passed: E2E canvas fallback comparison for `àèéìòùÀÈÉÌÒÙ` in all three fonts; sanity check detects Greek missing from Caveat
- R9: README review covers every listed topic | passed: purpose, privacy, compose quick start, `PORT`/`DATA_DIR`, UID 1000 volume permissions, `docker buildx` multi-arch, local development, no-auth security note
- R10: `npm test` and `npm run e2e` run Vitest and Playwright suites | passed: Vitest 2 + 21 + 8 tests, Playwright 10 tests

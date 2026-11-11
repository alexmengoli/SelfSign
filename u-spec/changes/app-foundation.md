# app-foundation: Project stack, container, theme and shared UI rules
Scope: global
Status: ready
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
- Server: Fastify with `@fastify/static` for the web build, `@fastify/helmet` (or explicit hooks) for headers. Config read from env only.
- Web: Angular with Material M3 theme via CSS variables; `color-scheme` handled by a `ThemeService` toggling a class on `<html>`; fonts as local `@font-face` assets (woff2 for screen, TTF copies in assets for export embedding).
- Docker: build stage (`node:<lts>`), runtime stage (`node:<lts>-alpine`), `USER node`, only production deps of the server plus the web build.
- Order of application: `app-foundation` → `field-library` → `pdf-viewer` → `pdf-export`.

## Tasks
- [ ] T1: Create the monorepo skeleton, shared tsconfig, lint config and root scripts (R1, R10)
- [ ] T2: Implement the Fastify server: static SPA serving, `/api/health`, `PORT`/`DATA_DIR` config, security headers (R2, R4)
- [ ] T3: Create the Angular app shell: header, sidebar slot, document slot, responsive breakpoint, Material M3 minimal theme, English texts (R5, R7)
- [ ] T4: Implement the theme control with `System`/`Light`/`Dark`, live OS sync and `localStorage` persistence (R6)
- [ ] T5: Bundle Noto Sans, Noto Serif, Caveat locally for screen and export use (R4, R8)
- [ ] T6: Add `Dockerfile`, `.dockerignore`, `docker-compose.yml` with healthcheck, non-root user, `/data` volume (R3)
- [ ] T7: Set up Vitest and Playwright and write foundation tests (R2, R4, R6, R7, R10)
- [ ] T8: Write `README.md` (R9)

## Verification
- R1: `npm ci && npm run lint && npm run build && npm test` exit 0 | not run
- R2: Vitest/Fastify inject: `GET /api/health` → 200 `{"status":"ok"}`; `GET /some/route` → `index.html`; `PORT=9000` listens on 9000; missing `DATA_DIR` is created | not run
- R3: `docker compose up -d --build` → container healthy, `http://localhost:8080` loads; `docker inspect` user is non-root; `docker buildx build --platform linux/amd64,linux/arm64 .` succeeds; data persists after recreate | not run
- R4: Playwright: record all requests during load/edit/export of a PDF → none to external origins and none with PDF bytes; response headers include CSP and `nosniff` | not run
- R5: Manual review of all screens and Playwright snapshots: English only | not run
- R6: Playwright `emulateMedia({ colorScheme })` with `System` follows dark/light; selecting `Dark` persists after reload | not run
- R7: Playwright at 1440px shows sidebar left; at 360px no horizontal page scroll and bottom-sheet mode is active | not run
- R8: Rendering test with `àèéìòù` in each font shows no missing glyphs on screen | not run
- R9: README review covers every listed topic | not run
- R10: `npm test` and `npm run e2e` run Vitest and Playwright suites | not run

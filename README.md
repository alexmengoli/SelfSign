# SelfSign

SelfSign is a self-hosted web app for filling in and visually signing PDF documents directly in your browser.
Open a PDF, drag text, dates and signature images onto its pages, and download the result.

> SelfSign adds **visual** signatures (images and text drawn on the page). It does not create
> cryptographic/digital signatures (PAdES, certificates).

## Privacy model

- **Your PDFs never leave your browser.** Opening, rendering, editing and exporting happen entirely
  client-side; PDF bytes are never sent to the server.
- The server only stores the values you choose to save (for example your name, tax code or a signature
  image) and a few settings, as files in its data directory.
- The app loads nothing from external origins: fonts, scripts and the PDF engine are bundled. A strict
  `Content-Security-Policy` restricted to `'self'` is sent with every response.

## Quick start with Docker Compose

```yaml
services:
  selfsign:
    image: selfsign:latest
    build: .
    container_name: selfsign
    ports:
      - "8080:8080"
    volumes:
      - ./data:/data
    restart: unless-stopped
```

```sh
git clone <this repository> selfsign && cd selfsign
mkdir -p data && sudo chown 1000:1000 data   # see "Volume permissions"
docker compose up -d --build
```

Open `http://<host>:8080`. Saved data lives in `./data` and survives
`docker compose down && docker compose up -d`.

## Configuration

| Variable   | Default                                    | Description                                    |
| ---------- | ------------------------------------------ | ---------------------------------------------- |
| `PORT`     | `8080`                                     | HTTP port the server listens on.               |
| `DATA_DIR` | `/data` in the container, `./data` locally | Directory for saved values, images and settings. Created on startup if missing. |

The container exposes a health endpoint at `GET /api/health` (used by the image `HEALTHCHECK`).

## Volume permissions

The container runs as the non-root user `node` (UID `1000`, GID `1000`). The mounted data directory
must be writable by that user, otherwise the server stops at startup with
`Data directory "/data" is not a writable directory`.

- Bind mount: create the folder before the first start and give it to UID 1000:
  `mkdir -p data && sudo chown 1000:1000 data`.
- Named volume: Docker initializes it with the correct owner automatically, for example
  `volumes: [selfsign-data:/data]`.

## Security note

**SelfSign has no authentication.** Anyone who can reach its port can read and modify the saved data,
including your signature images. Keep it on a trusted network, or expose it only through a reverse
proxy or VPN that adds authentication and TLS.

## Building a multi-architecture image

The image supports `linux/amd64` and `linux/arm64` (for example a Raspberry Pi):

```sh
docker run --privileged --rm tonistiigi/binfmt --install arm64   # once, on amd64 hosts without arm64 emulation
docker buildx create --use --name selfsign-builder   # once
docker buildx build --platform linux/amd64,linux/arm64 -t <registry>/selfsign:latest --push .
```

Omit `--push` and use `--load` with a single `--platform` to build only for the local machine.

## Local development

Requirements: Node.js Active LTS (see `.nvmrc`, `>=24.15` supported) and npm.

```sh
npm ci
npm run dev        # API on http://localhost:9000, web app with live reload on http://localhost:4200
```

In development, set `PORT` before running the command to change the API port; the web proxy uses the same value.

| Command         | Description                                                    |
| --------------- | -------------------------------------------------------------- |
| `npm run build` | Builds `packages/shared`, `apps/server` and `apps/web`.        |
| `npm run lint`  | Lints the whole repository with ESLint.                        |
| `npm test`      | Runs the Vitest unit tests of all workspaces.                  |
| `npm run e2e`   | Builds everything and runs the Playwright end-to-end tests (`npx playwright install chromium` once). |

After a build, `npm start -w @selfsign/server` serves the production web build and the API on port 8080.

### Repository layout

```
apps/web         Angular frontend (Angular Material, standalone components, signals)
apps/server      Fastify server: REST API under /api and static web build
packages/shared  TypeScript types shared by frontend and backend
e2e              Playwright end-to-end tests
```

## Fonts

Text elements use the bundled fonts Noto Sans, Noto Serif and Caveat, licensed under the
SIL Open Font License 1.1 (see `apps/web/public/fonts/OFL-*.txt`).

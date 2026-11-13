<p align="center">
  <img src="apps/web/public/branding/selfsign-logo.svg" alt="SelfSign logo" width="180">
</p>

# SelfSign

SelfSign is a self-hosted web app for filling in and visually signing PDF documents directly in your browser.
Open a PDF, drag text, dates and signature images onto its pages, and download the result.

> SelfSign adds **visual** signatures (images and text drawn on the page). It does not create
> cryptographic/digital signatures (PAdES, certificates).

## Quick start with Docker Compose

### Install from the published image

To install SelfSign without cloning the repository or building the image locally. If you want to
protect access with a shared password, copy `.env.example` to `.env`, set `APP_PASSWORD`, and then
start the container. If SelfSign is exposed through a reverse proxy, set `TRUST_PROXY` as described
in the configuration section.

```sh
mkdir selfsign
cd selfsign

curl -O https://raw.githubusercontent.com/alexmengoli/SelfSign/main/docker-compose.release.yml
mv docker-compose.release.yml docker-compose.yml

mkdir data
docker compose up -d
```

Open `http://<host>:3394`. Saved data lives in `./data` and survives
container restarts and updates.

### Build from source

```yaml
services:
  selfsign:
    image: selfsign:latest
    build: .
    container_name: selfsign
    ports:
      - "3394:3394"
    volumes:
      - ./data:/data
    environment:
      # Optional shared password; empty disables authentication. Set it here or in the shell/.env file.
      APP_PASSWORD: ${APP_PASSWORD:-}
      # Optional: trusted reverse proxy IPs/CIDRs (see README). Empty trusts none.
      TRUST_PROXY: ${TRUST_PROXY:-}
    restart: unless-stopped
```

```sh
git clone <this repository> selfsign && cd selfsign
mkdir -p data
docker compose up -d --build
```

Open `http://<host>:3394`. Saved data lives in `./data` and survives
`docker compose down && docker compose up -d`.

## Privacy model

- **Your PDFs never leave your browser.** Opening, rendering, editing and exporting happen entirely
  client-side; PDF bytes are never sent to the server.
- The server only stores the values you choose to save (for example your name, tax code or a signature
  image) and a few settings, as files in its data directory.
- The app loads nothing from external origins: scripts and the PDF engine are bundled. A strict
  `Content-Security-Policy` restricted to `'self'` is sent with every response.

## Configuration

| Variable       | Default                                    | Description                                    |
| -------------- | ------------------------------------------ | ---------------------------------------------- |
| `PORT`         | `3394`                                     | HTTP port the server listens on.               |
| `DATA_DIR`     | `/data` in the container, `./data` locally | Directory for saved values, images, settings and session data. Created on startup if missing. |
| `APP_PASSWORD` | empty                                      | Optional shared access password. Empty or unset disables authentication. |
| `TRUST_PROXY`  | empty                                      | Reverse proxies whose `X-Forwarded-*` headers are trusted: comma-separated IPs/CIDRs, or `true` for every hop. Empty trusts none. |

Environment changes apply only after the service restarts (`docker compose up -d` recreates it).

The container exposes a public health endpoint at `GET /api/health` (used by the image `HEALTHCHECK`).

## Local development

Requirements: Node.js Active LTS (see `.nvmrc`, `>=24.15` supported) and npm.

```sh
npm ci
npm run dev        # API on http://localhost:9000, web app with live reload on http://localhost:4200
```

In development, set `PORT` before running the command to change the API port; the web proxy uses the same value.
`npm run dev` also reads the repository's `.env` file if present (for example `APP_PASSWORD`); restart it after
changing `.env`.

| Command         | Description                                                    |
| --------------- | -------------------------------------------------------------- |
| `npm run build` | Builds `packages/shared`, `apps/server` and `apps/web`.        |
| `npm run lint`  | Lints the whole repository with ESLint.                        |
| `npm test`      | Runs the Vitest unit tests of all workspaces.                  |
| `npm run e2e`   | Builds everything and runs the Playwright end-to-end tests (`npx playwright install chromium` once). |

After a build, `npm start -w @selfsign/server` serves the production web build and the API on port 3394.

### Repository layout

```
apps/web         Angular frontend (Angular Material, standalone components, signals)
apps/server      Fastify server: REST API under /api and static web build
packages/shared  TypeScript types shared by frontend and backend
e2e              Playwright end-to-end tests
```

## FAQ

### Is SelfSign vibe-coded?

No. SelfSign is not vibe-coded. It is created using spec-driven design (SDD), with AI
used as a development aid. The project follows the [u-spec framework](https://github.com/alexmengoli/u-spec)
for specifying, implementing and documenting changes.

### Does SelfSign create legally valid digital signatures?

No. SelfSign adds visual signatures such as images and text to PDFs. It does not create cryptographic
signatures, certificates or PAdES documents.

### Where are my PDFs processed?

PDF files are opened, rendered, edited and exported entirely in your browser. PDF bytes are not sent
to the SelfSign server.

## Author

SelfSign is created and maintained by [Alex Mengoli](https://github.com/alexmengoli).

## License

SelfSign is released under the [MIT License](https://opensource.org/license/mit/).

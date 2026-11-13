# SelfSign

SelfSign is a self-hosted web app for filling in and visually signing PDF documents directly in your browser.
Open a PDF, drag text, dates and signature images onto its pages, and download the result.

> SelfSign adds **visual** signatures (images and text drawn on the page). It does not create
> cryptographic/digital signatures (PAdES, certificates).

## Privacy model

- **Your PDFs never leave your browser.** Opening, rendering, editing and exporting happen entirely
  client-side; PDF bytes are never sent to the server.
- The server only stores the values you choose to save (for example your name, tax code or a signature
  image) and a few settings, as files in its data directory. With an access password it also stores
  session digests there (see [Access password](#access-password)).
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
    environment:
      # Optional shared password; empty disables authentication. Set it here or in the shell/.env file.
      APP_PASSWORD: ${APP_PASSWORD:-}
      # Optional: trusted reverse proxy IPs/CIDRs (see README). Empty trusts none.
      TRUST_PROXY: ${TRUST_PROXY:-}
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

| Variable       | Default                                    | Description                                    |
| -------------- | ------------------------------------------ | ---------------------------------------------- |
| `PORT`         | `8080`                                     | HTTP port the server listens on.               |
| `DATA_DIR`     | `/data` in the container, `./data` locally | Directory for saved values, images, settings and session data. Created on startup if missing. |
| `APP_PASSWORD` | empty                                      | Optional shared access password. Empty or unset disables authentication. See [Access password](#access-password). |
| `TRUST_PROXY`  | empty                                      | Reverse proxies whose `X-Forwarded-*` headers are trusted: comma-separated IPs/CIDRs, or `true` for every hop. Empty trusts none. |

Environment changes apply only after the service restarts (`docker compose up -d` recreates it).

The container exposes a public health endpoint at `GET /api/health` (used by the image `HEALTHCHECK`).

## Volume permissions

The container runs as the non-root user `node` (UID `1000`, GID `1000`). The mounted data directory
must be writable by that user, otherwise the server stops at startup with
`Data directory "/data" is not a writable directory`.

- Bind mount: create the folder before the first start and give it to UID 1000:
  `mkdir -p data && sudo chown 1000:1000 data`.
- Named volume: Docker initializes it with the correct owner automatically, for example
  `volumes: [selfsign-data:/data]`.

## Access password

By default SelfSign has no authentication. Set `APP_PASSWORD` to require one shared password before
anyone can see or change saved values, settings and signature images. There are no user accounts, roles
or password recovery: whoever knows the password has full access.

Disabled (default):

```yaml
    environment:
      APP_PASSWORD: ""
```

Enabled, either directly in `docker-compose.yml` or through substitution from the shell or a `.env`
file next to it (see [`.env.example`](.env.example); never commit `.env`):

```yaml
    environment:
      APP_PASSWORD: ${APP_PASSWORD:-}
```

```sh
echo 'APP_PASSWORD=choose-a-long-passphrase' > .env
docker compose up -d
```

- **Unlocking:** the app shows an unlock screen. After the correct password the browser receives an
  opaque `HttpOnly`, `SameSite=Strict` session cookie; the password itself is never stored in the browser
  or sent again.
- **Staying unlocked:** sessions have no timeout. They survive reloads, browser restarts and container
  recreation or updates, as long as the same data volume and password are used. The cookie lasts about
  400 days (the browser maximum) and is renewed while you use the app. Clearing site data, private
  windows or browser cookie limits can still ask you to unlock again.
- **Lock:** the lock button in the header ends the session of that browser only. Other tabs of the same
  browser return to the unlock screen on their next request; other browsers stay unlocked.
- **Revoking all browsers:** change `APP_PASSWORD` and restart the service. Every existing session is
  revoked, even if you later switch back to an earlier password. Starting once without a password also
  revokes all sessions.
- **Data volume:** sessions are stored in `auth.json` in `DATA_DIR` as SHA-256 digests, together with a
  salted scrypt hash used to detect password changes. The plaintext password is never written to disk or
  logged. Keep the volume persistent, otherwise every restart locks all browsers.
- **Brute force:** after five wrong passwords from the same client IP within one minute, further
  attempts are rejected with `429 Too Many Requests` until the minute ends.
- **Cross-site requests:** login and all changes require a same-origin request with an anti-CSRF token;
  requests from other sites are rejected.

### Reverse proxy and HTTPS

The password and the session cookie travel in clear text over plain HTTP. Plain HTTP is fine on a
trusted local network; anywhere else, put SelfSign behind an HTTPS reverse proxy. Behind a proxy, set
`TRUST_PROXY` to the proxy's address (for example `TRUST_PROXY: 172.18.0.0/16` for a proxy container on
the same Docker network) so that the server sees the real client IP for login throttling and marks the
cookie `Secure` when the proxy reports HTTPS. Do not trust forwarding headers from untrusted clients:
leave `TRUST_PROXY` empty when browsers connect directly.

## Security note

- **Without `APP_PASSWORD`, SelfSign has no authentication.** Anyone who can reach its port can read and
  modify the saved data, including your signature images. Keep it on a trusted network, or expose it
  only through a reverse proxy or VPN that adds authentication and TLS.
- The access password is access control, not encryption: SelfSign does not encrypt the data volume and
  does not provide TLS itself. Anyone who can read the Compose file, the container environment or the
  Docker volume is outside this protection.
- PDFs are never sent to the server in either mode.

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
`npm run dev` also reads the repository's `.env` file if present (for example `APP_PASSWORD`); restart it after
changing `.env`.

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

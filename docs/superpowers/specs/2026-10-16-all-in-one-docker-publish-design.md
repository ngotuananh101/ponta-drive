# Ponta Drive — All-in-One Docker Image & GHCR Publish Workflow Design

**Date:** 2026-10-16
**Status:** Draft — awaiting user review
**Target repository:** https://github.com/ngotuananh101/ponta-drive

---

## 1. Goal

Provide a turnkey self-hosted deployment experience for Ponta Drive by:
1. Packaging both the Vue 3 frontend and the Go backend into a single "All-in-One" Docker container image that can be deployed with a single `docker run` or minimal compose file without needing local builds.
2. Providing an automated GitHub Actions workflow (`.github/workflows/docker-publish.yml`) that builds, caches, tags, and publishes this image to GitHub Container Registry (`ghcr.io`).
3. Supporting an optional deployment webhook trigger via GitHub Actions secrets (`DEPLOY_WEBHOOK`) to notify deployment targets (e.g., Portainer, Watchtower, Coolify, or custom runner) upon successful image publication.

---

## 2. Requirements and Success Criteria

### Success Criteria
1. **Single Image Packaging**: Running `docker run -d -p 8080:8080 -v ponta_storage:/app/storage ghcr.io/<owner>/ponta-drive:latest` brings up a fully functional Ponta Drive instance with SQLite.
2. **Zero In-Container Code Compilation**: The production image contains only compiled artifacts (Go binary, static HTML/JS/CSS assets) and lightweight runtime dependencies (Alpine + Nginx). No Node, Bun, or Go SDK remains in the final image.
3. **Database Flexibility**: Defaults to internal SQLite at `/app/storage/database.sqlite`, but seamlessly connects to external MariaDB/MySQL/PostgreSQL when configured via standard environment variables (`DB_CONNECTION`, `DB_HOST`, etc.).
4. **Automated Migrations**: In-container entrypoint executes database migrations automatically before starting traffic listeners.
5. **Clean Process Management**: Both the Go backend (`ponta-api`) and Nginx run concurrently inside the container. Signals (`SIGTERM`, `SIGINT`) are caught and propagated cleanly to both processes to allow graceful shutdown without timeouts.
6. **Automated CI/CD**: Pushing to the `main` branch or pushing a Git release tag (`v*.*.*`) builds and pushes multi-tag images to GHCR using layer caching.
7. **Optional Deploy Webhook**: If the repository secret `DEPLOY_WEBHOOK` is set, a POST request is dispatched to the webhook URL after successful image publication. If unset or empty, the step is skipped cleanly without failing the job.

---

## 3. Architecture

### 3.1 Container Internal Architecture

```
                                Container Boundary (:8080)
┌────────────────────────────────────────────────────────────────────────┐
│                                                                        │
│  HTTP Traffic (:8080)                                                  │
│        │                                                               │
│        ▼                                                               │
│  ┌───────────┐  /assets/*           ┌─────────────────────────────┐    │
│  │   Nginx   │ ───────────────────► │ Static files                │    │
│  │           │  everything else     │ (/usr/share/nginx/html)     │    │
│  │           │  (SPA fallback)      │                             │    │
│  │           │                                                    │    │
│  │           │  /auth, /v1, /ping, /api (Reverse Proxy)           │    │
│  │           │ ──────────────────────────────────────┐            │    │
│  └───────────┘                                       │            │    │
│                                                      ▼            │    │
│                                              ┌───────────────┐    │
│                                              │ Go Backend    │    │
│                                              │ (ponta-api)   │    │
│                                              │ 127.0.0.1:3000│    │
│                                              └───────┬───────┘    │
│                                                      │            │
│                                                      ▼            │
│                                              ┌───────────────┐    │
│                                              │ SQLite DB /   │    │
│                                              │ Local Storage │    │
│                                              │ /app/storage  │    │
│                                              └───────────────┘    │
│                                                                        │
│  Process Supervision (deploy/entrypoint.sh):                          │
│  - Executes /app/ponta-api artisan migrate --force                    │
│  - Starts ponta-api (background, PID tracked)                         │
│  - Starts nginx (background, PID tracked)                             │
│  - Traps SIGTERM/SIGINT -> sends SIGTERM to both, waits for exit      │
│  - Monitors process liveness -> exits if either process crashes       │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.2 File Structure

```
ponta-drive/
├── .github/
│   └── workflows/
│       └── docker-publish.yml      # CI/CD: Build and publish to GHCR
├── Dockerfile                      # Root multi-stage Dockerfile
├── deploy/
│   ├── entrypoint.sh               # Dual-process lifecycle and signal coordinator
│   └── nginx.conf                  # Nginx reverse proxy and SPA static server
├── backend/                        # Go backend source
└── frontend/                       # Vue 3 frontend source
```

---

## 4. Component Specifications

### 4.1 Multi-Stage Dockerfile (`Dockerfile`)

Multi-stage build separating compile-time dependencies from the runtime image:

- **Stage 1 (`backend-build`)**:
  - Base: `golang:1.25-bookworm`
  - Copies `go.mod`, `go.sum`, downloads dependencies with cache mount.
  - Builds binary with `CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/ponta-api .`.
- **Stage 2 (`frontend-build`)**:
  - Base: `oven/bun:1.4.2`
  - Copies `package.json`, `bun.lock`, runs `bun install --frozen-lockfile`.
  - Builds SPA via `bun run build-only` producing `/app/dist`.
- **Stage 3 (`runtime`)**:
  - Base: `alpine:3.20`
  - Installs runtime packages: `ca-certificates`, `tzdata`, `nginx`, `curl`.
  - Creates dedicated application user `app` (`uid: 10001`).
  - Sets up `/app/storage` with appropriate permissions for SQLite and file storage.
  - Copies:
    - `/out/ponta-api` to `/app/ponta-api`
    - Backend assets: `resources/`, `public/`, `lang/`, `config/` to `/app/`
    - `/app/dist` from frontend-build to `/usr/share/nginx/html`
    - `deploy/nginx.conf` to `/etc/nginx/http.d/default.conf`
    - `deploy/entrypoint.sh` to `/app/entrypoint.sh` (executable)
  - Exposed Port: `8080`
  - Volume: `/app/storage`
  - Entrypoint: `["/app/entrypoint.sh"]`

### 4.2 Nginx Configuration (`deploy/nginx.conf`)

- Listens on `0.0.0.0:8080`.
- Root directory: `/usr/share/nginx/html`, default index: `index.html`.
- API Proxy block:
  - Route pattern: `~ ^/(auth|v1|ping|api)(/|$)`
  - Proxies to `http://127.0.0.1:3000`
  - Passes headers: `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`.
  - Sets `client_max_body_size 0` to allow unlimited streaming payload uploads.
- Asset caching block:
  - Route pattern: `/assets/`
  - 1-year cache expiration with immutable cache header.
- SPA fallback block:
  - `location / { try_files $uri $uri/ /index.html; }`.

### 4.3 Container Entrypoint (`deploy/entrypoint.sh`)

POSIX-compliant shell script executing inside Alpine runtime:

1. **Default Environment Setup**:
   - `ROLE=${ROLE:-api}`
   - `APP_HOST=${APP_HOST:-127.0.0.1}`
   - `APP_PORT=${APP_PORT:-3000}`
   - `DB_CONNECTION=${DB_CONNECTION:-sqlite}`
   - `DB_DATABASE=${DB_DATABASE:-/app/storage/database.sqlite}`
   - `QUEUE_CONNECTION=${QUEUE_CONNECTION:-sync}`
2. **Directory Permissions**:
   - Ensures `/app/storage` and subdirectories (`app`, `framework`, `logs`) exist with correct ownership.
3. **Database Migrations**:
   - If `ROLE` is `api`, executes `/app/ponta-api artisan migrate --force`.
4. **Dual Process Execution & Supervision**:
   - Launches `/app/ponta-api` in background, captures `API_PID`.
   - Launches `nginx -g 'daemon off;'` in background, captures `NGINX_PID`.
5. **Signal Trapping**:
   - Captures `SIGTERM` and `SIGINT`.
   - Sends `SIGTERM` to both `API_PID` and `NGINX_PID`.
   - Awaits process termination.
6. **Liveness Polling**:
   - Monitors active PIDs with periodic sleep; if either process exits unexpectedly, terminates the other and exits with non-zero status.

### 4.4 GitHub Actions Workflow (`.github/workflows/docker-publish.yml`)

- **Triggers**:
  - `push` to branch `main`
  - `push` of tags matching `v*.*.*`
  - `workflow_dispatch` (manual run)
- **Permissions**:
  - `contents: read`
  - `packages: write`
- **Jobs (`publish`)**:
  - Runs on `ubuntu-latest`.
  - Steps:
    1. `actions/checkout@v4`
    2. `docker/setup-buildx-action@v3`
    3. `docker/login-action@v3` with `registry: ghcr.io`, `username: ${{ github.actor }}`, `password: ${{ secrets.GITHUB_TOKEN }}`
    4. `docker/metadata-action@v5` with image name `ghcr.io/${{ github.repository }}`:
       - Tag strategies:
         - `type=raw,value=latest,enable={{is_default_branch}}`
         - `type=semver,pattern={{version}}`
         - `type=semver,pattern={{major}}.{{minor}}`
         - `type=sha,format=short`
    5. `docker/build-push-action@v6`:
       - Context: `.`
       - File: `./Dockerfile`
       - Push: `true`
       - Tags: outputs from metadata-action
       - Labels: outputs from metadata-action
       - Cache: `cache-from: type=gha`, `cache-to: type=gha,mode=max`
    6. `Trigger Deploy Webhook`:
       - Condition: `if: ${{ secrets.DEPLOY_WEBHOOK != '' }}`
       - Environment: `DEPLOY_WEBHOOK_URL: ${{ secrets.DEPLOY_WEBHOOK }}`
       - Action: `curl -s -S -f -X POST "$DEPLOY_WEBHOOK_URL"`

---

## 5. Usage and Deployment Examples

### 5.1 Simple `docker run` (SQLite)
```bash
docker run -d \
  --name ponta-drive \
  -p 8080:8080 \
  -v ponta_storage:/app/storage \
  -e APP_KEY="base64:32CharactersLongBase64KeyString=" \
  -e JWT_SECRET="your-jwt-secret-here" \
  --restart unless-stopped \
  ghcr.io/ngotuananh101/ponta-drive:latest
```

### 5.2 Single-Container Docker Compose (`docker-compose.prod.yml`)
```yaml
services:
  app:
    image: ghcr.io/ngotuananh101/ponta-drive:latest
    ports:
      - "127.0.0.1:8080:8080"
    environment:
      - APP_KEY=${APP_KEY}
      - JWT_SECRET=${JWT_SECRET}
      - DB_CONNECTION=sqlite
      - DB_DATABASE=/app/storage/database.sqlite
    volumes:
      - ponta_storage:/app/storage
    restart: unless-stopped

volumes:
  ponta_storage:
```

---

## 6. Verification and Testing Plan

| Stage | Test Item | Verification Method | Expected Result |
|---|---|---|---|
| Local Build | Multi-stage Docker build | `docker build -t ponta-drive:test .` | Image compiles cleanly without errors |
| Container Boot | Process & Port verification | `docker run --rm -p 8080:8080 -e APP_KEY=... ponta-drive:test` | Nginx listens on 8080, Go API on 3000, migrations run |
| API Routing | Proxy routing through Nginx | `curl http://localhost:8080/ping` | Returns pong status response from Go backend |
| Frontend Serving | Static asset serving | `curl http://localhost:8080/` | Returns HTML with Vue SPA bundle script links |
| SPA Fallback | Non-existent frontend route | `curl http://localhost:8080/cloud/s3/files` | Returns `index.html` (handled by Vue Router) |
| Shutdown | Graceful shutdown | `docker stop -t 5 <container_id>` | Container stops cleanly under 3 seconds without SIGKILL |
| CI/CD Lint | GitHub Action syntax validation | YAML lint and action schema checks | Clean syntax, valid action references |

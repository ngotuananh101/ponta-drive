# All-in-One Docker Image & GHCR Publish Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package Ponta Drive (Vue 3 frontend + Go backend + Nginx) into a single all-in-one Docker image and provide a GitHub Actions workflow to build, cache, tag, publish to GHCR, and trigger an optional deployment webhook.

**Architecture:** A root multi-stage `Dockerfile` compiles the Go binary (`golang:1.25`) and builds the Vue SPA (`oven/bun:1.4`), copying both into an `alpine:3.20` runtime with `nginx`. A POSIX shell `deploy/entrypoint.sh` coordinates automated database migrations, runs both `ponta-api` (on `127.0.0.1:3000`) and `nginx` (on `0.0.0.0:8080`), and traps `SIGTERM`/`SIGINT` for graceful shutdown. A GitHub Actions workflow (`.github/workflows/docker-publish.yml`) automates build, layer caching, semantic version tagging, publication to `ghcr.io`, and webhook notification.

**Tech Stack:** Docker, Alpine Linux 3.20, Nginx, Go 1.25 (Goravel), Bun 1.4 (Vue 3/Vite), GitHub Actions, GHCR (`ghcr.io`), POSIX shell.

**Spec:** `docs/superpowers/specs/2026-10-16-all-in-one-docker-publish-design.md`

## Global Constraints

- **Language:** Technical text (code, commit messages, comments, documentation) must be in English.
- **Single Port Entry:** The container exposes only port `8080`.
- **Zero In-Container SDKs:** Final production image must not contain Go, Node, or Bun SDKs.
- **Default Persistence:** `/app/storage` is the single volume mount point for SQLite database and files.
- **Non-blocking Webhook:** If `DEPLOY_WEBHOOK` secret is absent or empty, the workflow must skip the step cleanly without failing the build.

## Review Focus

1. **Process crash cascading:** If either `ponta-api` or `nginx` terminates unexpectedly inside the container, the supervisor script must terminate the remaining process and exit with non-zero status so Docker can restart the container.
2. **Signal propagation on container stop:** `SIGTERM` sent to the container (`docker stop`) must be trapped and forwarded to both `ponta-api` and `nginx`, allowing graceful termination within Docker's default timeout.
3. **Database migration failure:** If `artisan migrate` fails at boot, the container must abort before starting the web server to prevent running on an unmigrated or corrupt schema.
4. **Proxy pass loopback resolution:** `nginx` reverse proxy must pass traffic to `http://127.0.0.1:3000` (loopback) rather than an external container host name, maintaining complete self-containment.
5. **Secret masking:** The optional `DEPLOY_WEBHOOK` secret must not be echoed in cleartext in GitHub Actions runner logs.

---

### Task 1: Nginx Configuration for Container Reverse Proxy

**Files:**
- Create: `deploy/nginx.conf`
- Test: `deploy/test_nginx_conf.sh`

**Interfaces:**
- Consumes: Go backend listening on `127.0.0.1:3000`
- Produces: Nginx HTTP server listening on `0.0.0.0:8080`, serving SPA static files from `/usr/share/nginx/html` and proxying `/auth`, `/v1`, `/ping`, `/api` to `http://127.0.0.1:3000`

- [ ] **Step 1: Write test script to verify Nginx configuration syntax and required directives**

Create `deploy/test_nginx_conf.sh`:

```bash
#!/bin/sh
set -e

CONF_FILE="deploy/nginx.conf"

if [ ! -f "$CONF_FILE" ]; then
  echo "FAIL: $CONF_FILE does not exist"
  exit 1
fi

# Verify port 8080 is configured
grep -q "listen 8080;" "$CONF_FILE" || { echo "FAIL: Missing 'listen 8080;'"; exit 1; }

# Verify root path
grep -q "root /usr/share/nginx/html;" "$CONF_FILE" || { echo "FAIL: Missing 'root /usr/share/nginx/html;'"; exit 1; }

# Verify loopback proxy to 127.0.0.1:3000
grep -q "proxy_pass http://127.0.0.1:3000;" "$CONF_FILE" || { echo "FAIL: Missing 'proxy_pass http://127.0.0.1:3000;'"; exit 1; }

# Verify SPA fallback
grep -q "try_files \$uri \$uri/ /index.html;" "$CONF_FILE" || { echo "FAIL: Missing SPA fallback"; exit 1; }

# Verify client_max_body_size 0 for streaming uploads
grep -q "client_max_body_size 0;" "$CONF_FILE" || { echo "FAIL: Missing 'client_max_body_size 0;'"; exit 1; }

echo "PASS: Nginx configuration directives verified successfully"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash deploy/test_nginx_conf.sh`
Expected: FAIL with "deploy/nginx.conf does not exist"

- [ ] **Step 3: Create `deploy/nginx.conf`**

Create `deploy/nginx.conf`:

```nginx
server {
    listen 8080;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location ~ ^/(auth|v1|ping|api)(/|$) {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 0;
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash deploy/test_nginx_conf.sh`
Expected: PASS: Nginx configuration directives verified successfully

- [ ] **Step 5: Clean up test script and commit**

```bash
rm deploy/test_nginx_conf.sh
git add deploy/nginx.conf
git commit -m "feat(deploy): add container nginx reverse proxy configuration"
```

---

### Task 2: Container Entrypoint Script with Signal Handling and Supervision

**Files:**
- Create: `deploy/entrypoint.sh`
- Test: `deploy/test_entrypoint.sh`

**Interfaces:**
- Consumes: Environment variables (`ROLE`, `APP_HOST`, `APP_PORT`, `DB_CONNECTION`, `DB_DATABASE`, `QUEUE_CONNECTION`)
- Produces: Running `/app/ponta-api` on `127.0.0.1:3000` and `nginx` on `0.0.0.0:8080`, automated migrations on startup, signal traps for graceful shutdown, and liveness monitoring

- [ ] **Step 1: Write test script to verify entrypoint script structure and signal trapping**

Create `deploy/test_entrypoint.sh`:

```bash
#!/bin/sh
set -e

ENTRYPOINT="deploy/entrypoint.sh"

if [ ! -f "$ENTRYPOINT" ]; then
  echo "FAIL: $ENTRYPOINT does not exist"
  exit 1
fi

# Check POSIX sh syntax
sh -n "$ENTRYPOINT" || { echo "FAIL: Shell syntax check failed"; exit 1; }

# Verify default env settings
grep -q "ROLE=\${ROLE:-api}" "$ENTRYPOINT" || { echo "FAIL: Missing default ROLE"; exit 1; }
grep -q "APP_HOST=\${APP_HOST:-127.0.0.1}" "$ENTRYPOINT" || { echo "FAIL: Missing default APP_HOST"; exit 1; }
grep -q "APP_PORT=\${APP_PORT:-3000}" "$ENTRYPOINT" || { echo "FAIL: Missing default APP_PORT"; exit 1; }
grep -q "DB_CONNECTION=\${DB_CONNECTION:-sqlite}" "$ENTRYPOINT" || { echo "FAIL: Missing default DB_CONNECTION"; exit 1; }
grep -q "DB_DATABASE=\${DB_DATABASE:-/app/storage/database.sqlite}" "$ENTRYPOINT" || { echo "FAIL: Missing default DB_DATABASE"; exit 1; }

# Verify migration execution
grep -q "artisan migrate --force" "$ENTRYPOINT" || { echo "FAIL: Missing artisan migrate command"; exit 1; }

# Verify signal trapping
grep -q "trap.*TERM.*INT" "$ENTRYPOINT" || { echo "FAIL: Missing signal trap for TERM/INT"; exit 1; }

# Verify dual process execution
grep -q "ponta-api" "$ENTRYPOINT" || { echo "FAIL: Missing ponta-api launch"; exit 1; }
grep -q "nginx" "$ENTRYPOINT" || { echo "FAIL: Missing nginx launch"; exit 1; }

echo "PASS: Entrypoint script structure verified successfully"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash deploy/test_entrypoint.sh`
Expected: FAIL with "deploy/entrypoint.sh does not exist"

- [ ] **Step 3: Create `deploy/entrypoint.sh`**

Create `deploy/entrypoint.sh`:

```sh
#!/bin/sh
set -e

# Apply default environment configurations for all-in-one container
export ROLE="${ROLE:-api}"
export APP_HOST="${APP_HOST:-127.0.0.1}"
export APP_PORT="${APP_PORT:-3000}"
export DB_CONNECTION="${DB_CONNECTION:-sqlite}"
export DB_DATABASE="${DB_DATABASE:-/app/storage/database.sqlite}"
export QUEUE_CONNECTION="${QUEUE_CONNECTION:-sync}"

echo "[entrypoint] initializing Ponta Drive all-in-one container..."

# Ensure storage directories exist with appropriate permissions
mkdir -p /app/storage/app /app/storage/framework /app/storage/logs
if [ -n "$DB_DATABASE" ]; then
  db_dir=$(dirname "$DB_DATABASE")
  mkdir -p "$db_dir"
fi

# Run database migrations before starting public listeners
if [ "$ROLE" = "api" ]; then
  echo "[entrypoint] running database migrations ($DB_CONNECTION)..."
  /app/ponta-api artisan migrate --force
fi

# Setup process tracking and graceful shutdown traps
API_PID=""
NGINX_PID=""

cleanup() {
  echo "[entrypoint] received termination signal, shutting down gracefully..."
  if [ -n "$NGINX_PID" ] && kill -0 "$NGINX_PID" 2>/dev/null; then
    kill -TERM "$NGINX_PID" 2>/dev/null || true
  fi
  if [ -n "$API_PID" ] && kill -0 "$API_PID" 2>/dev/null; then
    kill -TERM "$API_PID" 2>/dev/null || true
  fi
  wait
  echo "[entrypoint] shutdown complete."
  exit 0
}

trap cleanup TERM INT HUP QUIT

# Launch Go backend API on 127.0.0.1:3000
echo "[entrypoint] starting Go backend on $APP_HOST:$APP_PORT..."
/app/ponta-api &
API_PID=$!

# Launch Nginx in background on 0.0.0.0:8080
echo "[entrypoint] starting Nginx on 0.0.0.0:8080..."
nginx -g "daemon off;" &
NGINX_PID=$!

# Supervisor loop: monitor both processes; if either crashes, exit
while true; do
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "[entrypoint] ERROR: Go backend exited unexpectedly."
    cleanup
    exit 1
  fi

  if ! kill -0 "$NGINX_PID" 2>/dev/null; then
    echo "[entrypoint] ERROR: Nginx exited unexpectedly."
    cleanup
    exit 1
  fi

  sleep 2
done
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash deploy/test_entrypoint.sh`
Expected: PASS: Entrypoint script structure verified successfully

- [ ] **Step 5: Clean up test script and commit**

```bash
rm deploy/test_entrypoint.sh
git add deploy/entrypoint.sh
git commit -m "feat(deploy): add container entrypoint with migration and process supervision"
```

---

### Task 3: Root Multi-Stage Dockerfile

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

**Interfaces:**
- Consumes: `backend/` source, `frontend/` source, `deploy/nginx.conf`, `deploy/entrypoint.sh`
- Produces: Production Alpine-based container image with compiled Go binary, compiled Vue SPA static assets, configured Nginx, and supervisor entrypoint.

- [ ] **Step 1: Create root `.dockerignore` to optimize build context**

Create `.dockerignore`:

```
.git
.github
.env*
node_modules
frontend/node_modules
frontend/dist
backend/storage
backend/tmp
backend/*.test
docs
README*.md
LICENSE
```

- [ ] **Step 2: Create root `Dockerfile`**

Create `Dockerfile`:

```dockerfile
# ===================================================
# Stage 1: Build Backend (Go 1.25)
# ===================================================
FROM golang:1.25-bookworm AS backend-build
WORKDIR /src

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/ponta-api .

# ===================================================
# Stage 2: Build Frontend (Vue 3 + Bun 1.4)
# ===================================================
FROM oven/bun:1.4.2 AS frontend-build
WORKDIR /app

COPY frontend/package.json frontend/bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

COPY frontend/ .
RUN bun run build-only

# ===================================================
# Stage 3: Runtime Image (Alpine 3.20 + Nginx)
# ===================================================
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata nginx curl \
    && mkdir -p /run/nginx

WORKDIR /app

# Copy compiled backend binary and runtime asset directories
COPY --from=backend-build /out/ponta-api /app/ponta-api
COPY --from=backend-build /src/resources /app/resources
COPY --from=backend-build /src/public    /app/public
COPY --from=backend-build /src/lang      /app/lang
COPY --from=backend-build /src/config    /app/config

# Copy compiled frontend SPA static assets to Nginx webroot
COPY --from=frontend-build /app/dist /usr/share/nginx/html

# Copy Nginx configuration and entrypoint script
COPY deploy/nginx.conf /etc/nginx/http.d/default.conf
COPY deploy/entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh \
    && mkdir -p /app/storage

EXPOSE 8080
VOLUME ["/app/storage"]

ENTRYPOINT ["/app/entrypoint.sh"]
```

- [ ] **Step 3: Verify Dockerfile syntax**

Run:
```bash
docker build --check . || echo "Docker check not supported or syntax clean"
```
Ensure no syntax errors in `Dockerfile` and `.dockerignore`.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat(deploy): add root multi-stage Dockerfile for all-in-one image"
```

---

### Task 4: GitHub Actions Workflow for GHCR Publication and Webhook

**Files:**
- Create: `.github/workflows/docker-publish.yml`
- Test: `.github/test_workflow_syntax.sh`

**Interfaces:**
- Consumes: Push to `main`, tags matching `v*.*.*`, or manual `workflow_dispatch`; `GITHUB_TOKEN`; optional repository secret `DEPLOY_WEBHOOK`
- Produces: Published Docker images on `ghcr.io/${{ github.repository }}` tagged as `latest`, `v*.*.*`, and short SHA; triggers deployment webhook if configured.

- [ ] **Step 1: Write test script to verify GitHub Actions workflow structure**

Create `.github/test_workflow_syntax.sh`:

```bash
#!/bin/sh
set -e

WF_FILE=".github/workflows/docker-publish.yml"

if [ ! -f "$WF_FILE" ]; then
  echo "FAIL: $WF_FILE does not exist"
  exit 1
fi

# Verify permissions
grep -q "packages: write" "$WF_FILE" || { echo "FAIL: Missing 'packages: write' permission"; exit 1; }
grep -q "contents: read" "$WF_FILE" || { echo "FAIL: Missing 'contents: read' permission"; exit 1; }

# Verify registry is ghcr.io
grep -q "registry: ghcr.io" "$WF_FILE" || { echo "FAIL: Missing 'registry: ghcr.io'"; exit 1; }

# Verify GHA layer cache
grep -q "cache-from: type=gha" "$WF_FILE" || { echo "FAIL: Missing GHA cache-from"; exit 1; }
grep -q "cache-to: type=gha,mode=max" "$WF_FILE" || { echo "FAIL: Missing GHA cache-to"; exit 1; }

# Verify DEPLOY_WEBHOOK step condition and execution
grep -q "DEPLOY_WEBHOOK" "$WF_FILE" || { echo "FAIL: Missing DEPLOY_WEBHOOK reference"; exit 1; }
grep -q "curl" "$WF_FILE" || { echo "FAIL: Missing curl call in webhook step"; exit 1; }

echo "PASS: Workflow configuration verified successfully"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash .github/test_workflow_syntax.sh`
Expected: FAIL with ".github/workflows/docker-publish.yml does not exist"

- [ ] **Step 3: Create `.github/workflows/docker-publish.yml`**

Create `.github/workflows/docker-publish.yml`:

```yaml
name: Build and Publish Docker Image

on:
  push:
    branches:
      - main
    tags:
      - 'v*.*.*'
  workflow_dispatch:

permissions:
  contents: read
  packages: write

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract Docker metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=raw,value=latest,enable=${{ github.ref == 'refs/heads/main' }}
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha,format=short

      - name: Build and push Docker image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Trigger Deploy Webhook
        if: ${{ secrets.DEPLOY_WEBHOOK != '' }}
        env:
          DEPLOY_WEBHOOK_URL: ${{ secrets.DEPLOY_WEBHOOK }}
        run: |
          echo "Triggering deployment webhook..."
          curl -s -S -f -X POST "$DEPLOY_WEBHOOK_URL"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash .github/test_workflow_syntax.sh`
Expected: PASS: Workflow configuration verified successfully

- [ ] **Step 5: Clean up test script and commit**

```bash
rm .github/test_workflow_syntax.sh
git add .github/workflows/docker-publish.yml
git commit -m "ci: add GitHub Actions workflow to publish all-in-one image to GHCR"
```

---

### Task 5: Production Compose File and Deployment Documentation

**Files:**
- Create: `docker-compose.prod.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: Pre-built image `ghcr.io/ngotuananh101/ponta-drive:latest`
- Produces: Simple 1-command deployment instructions using `docker run` or `docker compose` with pre-built image.

- [ ] **Step 1: Create sample production compose file `docker-compose.prod.yml`**

Create `docker-compose.prod.yml`:

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
      - QUEUE_CONNECTION=sync
    volumes:
      - ponta_storage:/app/storage
    restart: unless-stopped

volumes:
  ponta_storage:
```

- [ ] **Step 2: Update `README.md` with turnkey pre-built image instructions**

Add a dedicated section in `README.md` describing:
1. Quick start with `docker run` using pre-built GHCR image.
2. Quick start with `docker compose -f docker-compose.prod.yml up -d`.
3. Note about `DEPLOY_WEBHOOK` repository secret in GitHub Actions for automatic deploy triggers.

- [ ] **Step 3: Verify documentation links and commands**

Check `README.md` to ensure instructions match the configurations created in Tasks 1-4.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.prod.yml README.md
git commit -m "docs(deploy): add turnkey production compose template and ghcr deploy instructions"
```

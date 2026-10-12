# Docker Deploy Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Ponta Drive monorepo a root-driven Docker deploy — two Compose files (app-only on SQLite, full on MariaDB) plus a per-component Dockerfile each — so that `docker compose up -d --build` deploys the whole app.

**Architecture:** The frontend image is an nginx server that both serves the built SPA and proxies the API prefixes to the backend, making it the single entry point. The backend is a pure-Go (no CGO) multi-stage image whose entrypoint runs migrations before starting the server. Compose files differ only in environment variables and the presence of MariaDB / an opt-in Caddy.

**Tech Stack:** Go 1.25 / Goravel 1.18 (`github.com/goravel/sqlite` 1.18, pure-Go), Vue 3 + Vite + Bun 1.4.2, Docker + Docker Compose, nginx, MariaDB 11, Caddy 2 (opt-in).

**Spec:** `docs/superpowers/specs/2026-10-13-docker-deploy-design.md`

## Global Constraints

- Response language to the user is Vietnamese; all code, identifiers, filenames, commit messages and repo docs are English.
- `APP_KEY` must be exactly 32 characters or the process exits — never leave it blank.
- The backend must bind `0.0.0.0` inside containers (`APP_HOST=0.0.0.0`); the default `127.0.0.1` is unreachable from the `web` container.
- The Goravel `migrate` command accepts **no** `--force` flag (verified: `The 'force' option does not exist`). Use `artisan migrate`.
- The repo already registers a `mariadb` DB connection (`driver: "mysql"`, via `mysqlfacades.Mysql("mariadb")`). File 2 uses `DB_CONNECTION=mariadb`; no new connection block.
- SQLite driver `github.com/goravel/sqlite v1.18.0` is pure Go — keep `CGO_ENABLED=0`.
- No secret may appear in a Dockerfile or a Compose file; all secrets live in `.env` (gitignored).
- Deploy mechanism is in-place build: `git pull` + `docker compose up -d --build`. No registry.
- Only the `web` service publishes a port, and only on the loopback: `127.0.0.1:8080:80`.
- Backend runtime needs `lang/`, `resources/`, `public/`, `config/` on disk (verified: path helpers resolve against the process working directory).

## Review Focus

Failure modes the spec implies but no task's tests fully exercise — each is pinned to a test in the owning task:

1. **Backend binds `127.0.0.1` in a container** → `web` cannot reach `api`; the app loads but every API call fails. (Task 4 test: `curl` through `web` returns pong.)
2. **Missing `APP_KEY`/`JWT_SECRET`** → container exits at boot with a terse message. (Task 4 test: a fresh boot with the documented `.env` comes up healthy.)
3. **Unknown `--force` flag in the entrypoint** → `artisan` aborts and the container never starts. (Task 3 test: entrypoint runs `artisan migrate` with no `--force`.)
4. **Backend image missing `lang/`/`resources/`** → `/` and translations fail at runtime. (Task 3 test: `/ping` and `/` respond inside the container.)
5. **Caddy enabled by accident on a host running nginx** → port 80/443 conflict. (Task 6 test: `up` without `--profile tls` starts no caddy container.)

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/config/database.go` (modify) | Register the `sqlite` connection |
| `backend/bootstrap/providers.go` (modify) | Register `sqlite.ServiceProvider` |
| `backend/database/migrations/20261004000000_add_uuid_to_cloud_accounts.go` (modify) | Backfill on the migrator's own connection |
| `backend/go.mod`, `backend/go.sum` (modify) | Add the sqlite module |
| `backend/.env.example` (modify) | Document `sqlite` + container values |
| `backend/Dockerfile` (create) | Multi-stage backend image |
| `backend/docker-entrypoint.sh` (create) | Run migrations, then exec the binary |
| `backend/.dockerignore` (create) | Keep build context small |
| `frontend/Dockerfile` (create) | Bun build → nginx |
| `frontend/nginx.conf` (create) | Serve SPA + proxy API |
| `frontend/.dockerignore` (create) | Keep build context small |
| `docker-compose.yml` (create) | File 1 — api (SQLite) + web |
| `docker-compose.full.yml` (create) | File 2 — api (MariaDB) + web + db + caddy (profile) |
| `deploy/Caddyfile` (create) | Reverse proxy to `web` for the opt-in Caddy |
| `.env.example` (create, root) | Compose variable template |
| `README.md` (modify) | Deployment section rewritten |

---

## Task 1: Add the SQLite driver

**Files:**
- Modify: `backend/go.mod`, `backend/go.sum`
- Modify: `backend/config/database.go:1-60`
- Modify: `backend/bootstrap/providers.go:32-58`

**Interfaces:**
- Produces: a `sqlite` DB connection selectable with `DB_CONNECTION=sqlite`; its database file path comes from `DB_DATABASE`.

- [ ] **Step 1: Add the module**

Run (in `backend/`):
```bash
go get github.com/goravel/sqlite@v1.18.0
```
Expected: `go.mod` gains `github.com/goravel/sqlite v1.18.0`.

- [ ] **Step 2: Register the connection**

In `backend/config/database.go`, add the import alias and a connection block. After the existing imports add:
```go
	sqlitefacades "github.com/goravel/sqlite/facades"
```
Inside the `"connections": map[string]any{ ... }` block (e.g. right after the `"postgres"` block) add:
```go
			"sqlite": map[string]any{
				"driver":   "sqlite",
				"database": config.Env("DB_DATABASE", "database/database.sqlite"),
				"prefix":   "",
				"singular": false,
				"via": func() (driver.Driver, error) {
					return sqlitefacades.Sqlite("sqlite")
				},
			},
```

- [ ] **Step 3: Register the service provider**

In `backend/bootstrap/providers.go`, add the import:
```go
	"github.com/goravel/sqlite"
```
and add `&sqlite.ServiceProvider{},` to the `Providers()` slice (next to `&postgres.ServiceProvider{}`).

- [ ] **Step 4: Build**

Run (in `backend/`):
```bash
go build ./... && go vet ./...
```
Expected: no output (success).

- [ ] **Step 5: Commit**

```bash
git add backend/go.mod backend/go.sum backend/config/database.go backend/bootstrap/providers.go
git commit -m "feat(backend): add sqlite database driver"
```

---

## Task 2: Fix the migration backfill connection

**Files:**
- Modify: `backend/database/migrations/20261004000000_add_uuid_to_cloud_accounts.go:36-46`

**Interfaces:**
- Consumes: nothing new.
- Produces: a migration that applies on both MariaDB and SQLite.

- [ ] **Step 1: Change the backfill to the migrator's connection**

In `backend/database/migrations/20261004000000_add_uuid_to_cloud_accounts.go`, replace the two backfill calls. Before:
```go
	var ids []uint
	if err := facades.Orm().Query().Table("cloud_accounts").
		Where("uuid IS NULL OR uuid = ''").
		Pluck("id", &ids); err != nil {
		return err
	}
	for _, id := range ids {
		_, _ = facades.Orm().Query().Table("cloud_accounts").
			Where("id", id).
			Update("uuid", uuid.New().String())
	}
```
After:
```go
	var ids []uint
	if err := facades.Schema().Orm().Query().Table("cloud_accounts").
		Where("uuid IS NULL OR uuid = ''").
		Pluck("id", &ids); err != nil {
		return err
	}
	for _, id := range ids {
		_, _ = facades.Schema().Orm().Query().Table("cloud_accounts").
			Where("id", id).
			Update("uuid", uuid.New().String())
	}
```

- [ ] **Step 2: Verify all migrations apply on SQLite**

Run (in `backend/`):
```bash
DB_CONNECTION=sqlite DB_DATABASE=/tmp/ponta_plan.sqlite go run . artisan migrate
```
Expected: every migration prints `Running: ...` and the run ends with `Migration success` (11 migrations). If the DB file exists from a prior run, delete it first.

- [ ] **Step 3: Verify the schema**

Run (in `backend/`):
```bash
go run . artisan migrate:status
```
Expected: all migrations listed as `Ran` with no failures.

- [ ] **Step 4: Clean up and commit**

```bash
rm -f /tmp/ponta_plan.sqlite
git add backend/database/migrations/20261004000000_add_uuid_to_cloud_accounts.go
git commit -m "fix(backend): run uuid backfill on the migrator connection

The migration backfilled cloud_accounts through facades.Orm(), a
different connection than the transaction the migrator runs Up() in.
MariaDB hides this because DDL auto-commits; SQLite does not, so the
backfill failed with 'no such column: uuid'."
```

---

## Task 3: Backend Docker image

**Files:**
- Create: `backend/Dockerfile`
- Create: `backend/docker-entrypoint.sh`
- Create: `backend/.dockerignore`
- Modify: `backend/.env.example`

**Interfaces:**
- Consumes: the sqlite connection from Task 1; the fixed migration from Task 2.
- Produces: an image whose entrypoint runs `artisan migrate` then execs the server; reads `ROLE`, `APP_HOST`, `APP_PORT`, `DB_*`, `APP_KEY`, `JWT_SECRET` from the environment.

- [ ] **Step 1: Write the entrypoint**

Create `backend/docker-entrypoint.sh`:
```sh
#!/bin/sh
set -e

if [ "${ROLE:-api}" = "api" ]; then
  echo "[entrypoint] running migrations"
  /app/ponta-api artisan migrate
fi

exec /app/ponta-api
```
Note: `migrate` takes no `--force` flag in Goravel.

- [ ] **Step 2: Write the Dockerfile**

Create `backend/Dockerfile`:
```dockerfile
# ---- build ----
FROM golang:1.25-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/ponta-api .

# ---- runtime ----
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 app
WORKDIR /app
COPY --from=build /out/ponta-api /app/ponta-api
COPY --from=build /src/resources /app/resources
COPY --from=build /src/public    /app/public
COPY --from=build /src/lang      /app/lang
COPY --from=build /src/config    /app/config
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh \
    && mkdir -p /app/storage \
    && chown -R app /app/storage
USER app
EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
```

- [ ] **Step 3: Write the dockerignore**

Create `backend/.dockerignore`:
```
.git
.env
.env.*
storage
tmp
*.test
README.md
README_zh.md
LICENSE
```

- [ ] **Step 4: Update `.env.example`**

In `backend/.env.example`, change the DB comment/values so SQLite is documented:
```ini
# DB_CONNECTION: sqlite, postgres, mysql, mariadb
# - sqlite: set DB_CONNECTION=sqlite and DB_DATABASE=/app/storage/database.sqlite
# - mariadb: the full Compose stack uses DB_CONNECTION=mariadb with DB_HOST=db
DB_CONNECTION=sqlite
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=database/database.sqlite
DB_USERNAME=root
DB_PASSWORD=
```

- [ ] **Step 5: Build the image**

Run (in `backend/`):
```bash
docker build -t ponta-api:test .
```
Expected: build succeeds.

- [ ] **Step 6: Smoke-test the container**

Run (in `backend/`):
```bash
docker run --rm -e APP_KEY=01234567890123456789012345678901 \
  -e JWT_SECRET=test -e DB_CONNECTION=sqlite \
  -e DB_DATABASE=/app/storage/database.sqlite -e APP_HOST=0.0.0.0 \
  -e APP_PORT=3000 -p 13000:3000 ponta-api:test &
sleep 8
curl -s http://127.0.0.1:13000/ping
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:13000/
docker stop $(docker ps -q --filter ancestor=ponta-api:test)
```
Expected: `/ping` returns JSON containing `"status":"ok"` and `"pong"`; `/` returns `200`.

- [ ] **Step 7: Commit**

```bash
git add backend/Dockerfile backend/docker-entrypoint.sh backend/.dockerignore backend/.env.example
git commit -m "feat(backend): add container image with migrate-on-boot entrypoint"
```

---

## Task 4: Frontend Docker image

**Files:**
- Create: `frontend/Dockerfile`
- Create: `frontend/nginx.conf`
- Create: `frontend/.dockerignore`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: an nginx image serving the SPA at `/` and proxying `^(/auth|/v1|/ping|/api)(/|$)` to `http://api:3000`.

- [ ] **Step 1: Write nginx.conf**

Create `frontend/nginx.conf`:
```nginx
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location ~ ^/(auth|v1|ping|api)(/|$) {
        proxy_pass http://api:3000;
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

- [ ] **Step 2: Write the Dockerfile**

Create `frontend/Dockerfile`:
```dockerfile
# ---- build ----
FROM oven/bun:1.4.2 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build-only

# ---- runtime ----
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

- [ ] **Step 3: Write the dockerignore**

Create `frontend/.dockerignore`:
```
node_modules
dist
.env
.env.*
.git
```

- [ ] **Step 4: Build the image**

Run (in `frontend/`):
```bash
docker build -t ponta-web:test .
```
Expected: build succeeds; `bun run build-only` runs inside the image.

- [ ] **Step 5: Commit**

```bash
git add frontend/Dockerfile frontend/nginx.conf frontend/.dockerignore
git commit -m "feat(frontend): add nginx image serving SPA and proxying the API"
```

---

## Task 5: Compose file 1 (app only, SQLite)

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example` (repository root)

**Interfaces:**
- Consumes: the `backend` and `frontend` images from Tasks 3–4.
- Produces: a stack reachable at `http://127.0.0.1:8080`; the `api` service name `api` resolvable from `web`.

- [ ] **Step 1: Write the root env template**

Create `.env.example`:
```ini
# Copy to .env and fill in. Never commit .env.

# 32 characters exactly. Generate with: openssl rand -hex 16
APP_KEY=
JWT_SECRET=

# Backend public URL and the frontend URL used in password-reset links
APP_URL=http://localhost:8080
FRONTEND_URL=http://localhost:8080

# --- Full stack only (docker-compose.full.yml) ---
DB_DATABASE=ponta_drive
DB_USERNAME=ponta_drive
DB_PASSWORD=
DB_ROOT_PASSWORD=

# --- Optional ---
MAIL_HOST=
MAIL_PORT=
MAIL_USERNAME=
MAIL_PASSWORD=
MAIL_FROM_ADDRESS=
MAIL_FROM_NAME=
AI_PROVIDER=
OPENAI_API_KEY=
OPENAI_BASE_URL=
```

- [ ] **Step 2: Write the compose file**

Create `docker-compose.yml`:
```yaml
services:
  api:
    build: ./backend
    env_file:
      - .env
    environment:
      ROLE: api
      APP_HOST: 0.0.0.0
      APP_PORT: 3000
      DB_CONNECTION: sqlite
      DB_DATABASE: /app/storage/database.sqlite
      QUEUE_CONNECTION: sync
    volumes:
      - api_storage:/app/storage
    restart: unless-stopped

  web:
    build: ./frontend
    depends_on:
      - api
    ports:
      - "127.0.0.1:8080:80"
    restart: unless-stopped

volumes:
  api_storage:
```

- [ ] **Step 3: Bring the stack up**

Run (repository root; first create `.env` from `.env.example` and fill `APP_KEY`):
```bash
docker compose up -d --build
docker compose ps
```
Expected: `api` and `web` both `Up`.

- [ ] **Step 4: Verify through the entry point**

```bash
curl -s http://127.0.0.1:8080/ping
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/
```
Expected: pong JSON from the API; `200` for the SPA.

- [ ] **Step 5: Verify persistence**

```bash
docker compose restart
docker compose exec api ls -l /app/storage/database.sqlite
```
Expected: the SQLite file still exists after restart.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "feat(deploy): add app-only compose stack on sqlite"
```

---

## Task 6: Compose file 2 (full, MariaDB, opt-in Caddy)

**Files:**
- Create: `docker-compose.full.yml`
- Create: `deploy/Caddyfile`

**Interfaces:**
- Consumes: the same images as Task 5; the `mariadb` DB connection.
- Produces: a stack with `api` (MariaDB, `QUEUE_CONNECTION=database`, in-process worker), `web`, `db`; and an opt-in `caddy` under profile `tls`.

- [ ] **Step 1: Write the Caddyfile**

Create `deploy/Caddyfile`:
```
{$SITE_ADDRESS:localhost} {
	reverse_proxy web:80
}
```

- [ ] **Step 2: Write the compose file**

Create `docker-compose.full.yml`:
```yaml
services:
  api:
    build: ./backend
    env_file:
      - .env
    environment:
      ROLE: api
      APP_HOST: 0.0.0.0
      APP_PORT: 3000
      DB_CONNECTION: mariadb
      DB_HOST: db
      DB_PORT: 3306
      QUEUE_CONNECTION: database
    volumes:
      - api_storage:/app/storage
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  web:
    build: ./frontend
    depends_on:
      - api
    ports:
      - "127.0.0.1:8080:80"
    restart: unless-stopped

  db:
    image: mariadb:11
    environment:
      MARIADB_DATABASE: ${DB_DATABASE}
      MARIADB_USER: ${DB_USERNAME}
      MARIADB_PASSWORD: ${DB_PASSWORD}
      MARIADB_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
    volumes:
      - db_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 5s
      timeout: 5s
      retries: 20
    restart: unless-stopped

  caddy:
    profiles:
      - tls
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./deploy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
    depends_on:
      - web
    restart: unless-stopped

volumes:
  api_storage:
  db_data:
  caddy_data:
```

- [ ] **Step 3: Confirm Caddy stays off by default**

Run (repository root):
```bash
docker compose -f docker-compose.full.yml config --services
```
Expected: `api`, `web`, `db` — **no** `caddy`.

- [ ] **Step 4: Bring the full stack up**

```bash
docker compose -f docker-compose.full.yml up -d --build
docker compose -f docker-compose.full.yml ps
```
Expected: `db` becomes healthy; `api` and `web` come up after it.

- [ ] **Step 5: Verify app + queue**

```bash
curl -s http://127.0.0.1:8080/ping
docker compose -f docker-compose.full.yml logs api | grep -i "migration success"
```
Expected: pong JSON; the api log shows migrations succeeded on MariaDB. Trigger a cloud-account sync from the UI and confirm the HTTP request returns immediately (the job runs in-process).

- [ ] **Step 6: Verify the Caddy profile starts it**

```bash
docker compose -f docker-compose.full.yml --profile tls config --services
```
Expected: the list now includes `caddy`.

- [ ] **Step 7: Tear down**

```bash
docker compose -f docker-compose.full.yml down
```

- [ ] **Step 8: Commit**

```bash
git add docker-compose.full.yml deploy/Caddyfile
git commit -m "feat(deploy): add full compose stack with mariadb and opt-in caddy"
```

---

## Task 7: Documentation

**Files:**
- Modify: `README.md` (Deployment section)

**Interfaces:**
- Consumes: everything above.
- Produces: operator-facing instructions.

- [ ] **Step 1: Rewrite the Deployment section**

In `README.md`, replace the current `## Deployment` body with:

```markdown
## Deployment

The stack is self-hosted with Docker. Compose files live at the repository
root; each component has its own `Dockerfile`.

### App only (SQLite)

```bash
cp .env.example .env        # set APP_KEY (openssl rand -hex 16) and JWT_SECRET
docker compose up -d --build
```

The app is served at `http://127.0.0.1:8080`.

### Full stack (MariaDB + opt-in Caddy)

```bash
cp .env.example .env        # set APP_KEY, JWT_SECRET, DB_* values
docker compose -f docker-compose.full.yml up -d --build
```

Add `--profile tls` only on a host with no nginx of its own.

### Behind an existing nginx

Point one server block at the published port:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Migrations run automatically at container start. To deploy an update:
`git pull && docker compose up -d --build`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document the Docker deploy workflow"
```

---

## Task 8: End-to-end verification

**Files:**
- No file changes; verification only.

- [ ] **Step 1: Backend gate**

Run (in `backend/`):
```bash
go build ./... && go vet ./... && go test ./...
```
Expected: all pass.

- [ ] **Step 2: Frontend gate**

Run (in `frontend/`):
```bash
bun run type-check && bun run test:run && bun run build-only
```
Expected: all pass; `dist/` produced.

- [ ] **Step 3: Compose 1 from a clean state**

```bash
docker compose down -v
docker compose up -d --build
curl -s http://127.0.0.1:8080/ping
docker compose down
```
Expected: pong; clean teardown.

- [ ] **Step 4: Compose 2 from a clean state**

```bash
docker compose -f docker-compose.full.yml down -v
docker compose -f docker-compose.full.yml up -d --build
curl -s http://127.0.0.1:8080/ping
docker compose -f docker-compose.full.yml down
```
Expected: pong; clean teardown.

- [ ] **Step 5: Confirm no secrets in images**

```bash
docker history --no-trunc ponta-api:test | grep -iE "secret|password|APP_KEY" || echo "no secrets in layers"
```
Expected: `no secrets in layers`.

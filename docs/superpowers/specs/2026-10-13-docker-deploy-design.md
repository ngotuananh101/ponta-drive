# Ponta Drive — Docker Deploy Environment Design

**Date:** 2026-10-13
**Status:** Draft — awaiting review
**Target repository:** https://github.com/ngotuananh101/ponta-drive

---

## 1. Goal

Provide a self-hosted Docker deploy environment for the monorepo, driven from
the repository root, so that a single command deploys the whole application.
Each component keeps its own `Dockerfile`; the root holds the Compose files that
wire them together.

Two Compose files, chosen deliberately:

| File | Purpose | Services |
|---|---|---|
| `docker-compose.yml` | Minimal — the app only | `api` (SQLite) + `web` |
| `docker-compose.full.yml` | Full — adds a real database | `api` (MariaDB) + `web` + `db` + `caddy` (opt-in profile) |

**Success criteria**

1. `docker compose up -d --build` from the repository root brings up a working
   app on `http://127.0.0.1:8080` using SQLite — no external database.
2. `docker compose -f docker-compose.full.yml up -d --build` brings up the same
   app backed by MariaDB, plus an opt-in Caddy edge.
3. The backend serves `/ping`, `/auth/*`, `/v1/*`; the frontend serves the SPA
   and proxies those API prefixes to the backend. Both are reachable through the
   single `web` entry point.
4. Migrations run automatically at container start; no manual step is required.
5. No secret is baked into an image or committed; all live in `.env`.
6. `cd backend && go build ./... && go vet ./...` and
   `cd frontend && bun run type-check && bun run test:run && bun run build-only`
   still succeed after the changes.

**Explicitly out of scope (decided with the user):** the host's own nginx and
TLS are the user's existing setup; this design only publishes one loopback port
for that nginx to proxy to. Registry-based image distribution and remote build
are out of scope — deploy is `git pull` + `docker compose up -d --build` on the
target host.

---

## 2. Context and decisions (verified)

Gathered by reading the repository and the Goravel framework source, and by a
throwaway feasibility spike (see §5).

**Decisions taken with the user**

| Question | Decision |
|---|---|
| Deploy scope | Both backend and frontend in Docker (full self-host; drop Cloudflare/Vercel) |
| Compose layout | Two files: app-only, and full |
| Database | File 1 → SQLite; File 2 → MariaDB |
| Edge proxy | The host already runs nginx → no Caddy in the base stack; a Caddy is kept **hidden behind a Compose profile** for hosts without nginx |
| Deploy mechanism | Build in place on the host (`git pull` + `up -d --build`) |
| Queue worker | **No separate worker container** — the app runs the queue worker in-process |

**Verified facts that shape the design**

- **Backend** (Goravel 1.18, Go 1.25): reads `APP_KEY` (must be exactly 32
  chars or the process exits), `JWT_SECRET`, `DB_*`, `FRONTEND_URL`, `MAIL_*`,
  `AI_PROVIDER`/`OPENAI_*`. It serves `/`, `/ping`, `/auth/*`, `/v1/*`, plus
  static `public/` and `favicon.ico`, and renders `resources/views/*.tmpl`. It
  writes to `storage/` (sessions, app files, SQLite DB).
- **Env loading**: Goravel reads a real `.env` file (viper `SetConfigFile`) and
  falls back to OS environment variables. In containers we pass configuration as
  OS environment variables; no `.env` file needs to exist inside the image.
- **Queue**: the framework has no `queue:work` command. A runner
  (`goravel:queue`) starts inside the server process and only runs when
  `queue.default`'s driver is not `sync`. The app's own `.env.example` documents
  exactly this: with `QUEUE_CONNECTION=database`, "a worker inside the server
  process then runs them". Therefore the `api` container handles jobs itself;
  adding a separate worker container would contradict the app's design.
- **SQLite feasibility**: `github.com/goravel/sqlite v1.18.0` uses
  `ncruces/go-sqlite3` (pure Go, WASM via `wazero`, no CGO). It builds and runs
  on Windows and Linux without a C toolchain. 11/11 migrations apply, with one
  required fix (§4.1c).
- **Frontend**: Vue 3 + Vite + Bun 1.4.2. `VITE_API_BASE_URL` empty means the
  SPA calls the API same-origin, so the web server must proxy `/auth`, `/v1`,
  `/ping`, `/api` to the backend. Build output is `dist/`.
- **Uploads** go directly to S3 via presigned URLs (verified in
  `frontend/src/api/upload.ts` and the backend upload controller), so the web
  server never handles large request bodies.

---

## 3. Architecture

```
ponta-drive/
├── docker-compose.yml            # FILE 1 — api + web (SQLite)
├── docker-compose.full.yml       # FILE 2 — api + web + db + caddy (profile: tls)
├── .env.example                  # committed template for compose
├── .env                          # real values (gitignored)
├── deploy/
│   └── Caddyfile                 # only used by the opt-in caddy service
├── backend/
│   ├── Dockerfile                # multi-stage: golang -> alpine, entrypoint migrates
│   ├── docker-entrypoint.sh
│   └── .dockerignore
└── frontend/
    ├── Dockerfile                # multi-stage: bun build -> nginx
    ├── nginx.conf                # serve SPA + proxy API to api:3000
    └── .dockerignore
```

**Data flow (full stack)**

```
Internet
   │
   ├─ host nginx (TLS, user-owned)  ──┐
   │                                   ├─► 127.0.0.1:8080
   └─ caddy (profile "tls", opt-in) ──┘        │
                                               ▼
                                        ┌─────────────┐
                                        │    web      │  nginx
                                        │  dist/ +    │
                                        │  nginx.conf │
                                        └──────┬──────┘
                       /auth,/v1,/ping,/api   │   everything else → index.html
                                               ▼
                                        ┌─────────────┐        ┌──────────┐
                                        │    api      │ ─────► │    db    │
                                        │ (Goravel,   │        │ MariaDB  │
                                        │  in-process │        │ (full)   │
                                        │  queue)     │        └──────────┘
                                        └─────────────┘
```

**Design principles**

- **One entry point per stack.** `web` (nginx) is the only published service; it
  serves static assets and proxies the API. This makes File 1 self-sufficient
  (no edge proxy needed) and lets File 2 reuse the frontend image unchanged.
- **Backend and database are never published.** They are reachable only on the
  internal Compose network; the host nginx only ever sees `127.0.0.1:8080`.
- **One image per component.** The backend image is identical in both files; only
  environment variables differ (SQLite vs MariaDB, sync vs database queue).

---

## 4. Components

### 4.1 Backend changes (small, required)

**(a) Add the SQLite driver** — for File 1.

- `go.mod` / `go.sum`: add `github.com/goravel/sqlite v1.18.0` (pulls
  `ncruces/go-sqlite3`, `ncruces/go-sqlite3/gormlite`, `tetratelabs/wazero`).
- `config/database.go`: add a `"sqlite"` connection block:

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
- `bootstrap/providers.go`: add `&sqlite.ServiceProvider{}`.
- Keep the existing `mysql`, `mariadb`, `postgres` connections for File 2. The
  repo already registers a `mariadb` connection (`driver: "mysql"`, via
  `mysqlfacades.Mysql("mariadb")`), so File 2 selects it directly — no new
  connection block is needed.

**(b) No `disabled_runners` change.** With no separate worker container, nothing
needs to disable HTTP or queue runners. `config/app.go` is left untouched.

**(c) Fix a latent migration bug** — `database/migrations/20261004000000_add_uuid_to_cloud_accounts.go`.

The backfill uses `facades.Orm().Query()`, but the migrator runs each migration
inside a transaction opened on `facades.Schema().Orm()`. These are two different
connection handles. On MariaDB, DDL auto-commits, so the second connection sees
the new `uuid` column; on SQLite, DDL stays inside the migration's transaction,
so the second connection does not see it and the query fails with
`no such column: uuid`. Change the two backfill queries to use the migrator's own
connection:

```go
// before
facades.Orm().Query().Table("cloud_accounts")...
// after
facades.Schema().Orm().Query().Table("cloud_accounts")...
```

This is a pre-existing latent bug (the backfill already runs outside the
transaction on MariaDB), not a SQLite-specific workaround.

**(d) `.env.example`** — update `DB_CONNECTION` to list `sqlite`, and document
the two modes (SQLite for File 1, MariaDB for File 2). No new mandatory key is
introduced.

### 4.2 `backend/Dockerfile`

Multi-stage; Alpine runtime (option B — the entrypoint runs migrations, which
needs a shell).

```dockerfile
# ---- build ----
FROM golang:1.25-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# pure-Go SQLite => no CGO
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
RUN chmod +x /app/docker-entrypoint.sh && mkdir -p /app/storage && chown -R app /app/storage
USER app
EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
```

`backend/docker-entrypoint.sh`:

```sh
#!/bin/sh
set -e
if [ "${ROLE:-api}" = "api" ]; then
  /app/ponta-api artisan migrate --force
fi
exec /app/ponta-api
```

`backend/.dockerignore`: `.git`, `.env`, `storage`, `tmp`, `*.test`,
`README*.md`, `LICENSE`.

### 4.3 `frontend/Dockerfile`

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

`build-only` is `vite build` alone; type-checking remains a local/CI gate. (To
make a type error fail the image build, switch to `bun run build`.)

`frontend/.dockerignore`: `node_modules`, `dist`, `.env*`, `.git`.

### 4.4 `frontend/nginx.conf`

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

### 4.5 `docker-compose.yml` (File 1 — app only, SQLite)

```yaml
services:
  api:
    build: ./backend
    env_file: [.env]
    environment:
      ROLE: api
      DB_CONNECTION: sqlite
      DB_DATABASE: /app/storage/database.sqlite
      QUEUE_CONNECTION: sync
    volumes:
      - api_storage:/app/storage
    restart: unless-stopped

  web:
    build: ./frontend
    depends_on: [api]
    ports:
      - "127.0.0.1:8080:80"
    restart: unless-stopped

volumes:
  api_storage:
```

### 4.6 `docker-compose.full.yml` (File 2 — full, MariaDB)

```yaml
services:
  api:
    build: ./backend
    env_file: [.env]
    environment:
      ROLE: api
      DB_CONNECTION: mariadb
      DB_HOST: db
      QUEUE_CONNECTION: database
    volumes:
      - api_storage:/app/storage
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  web:
    build: ./frontend
    depends_on: [api]
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
    profiles: [tls]
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./deploy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
    depends_on: [web]
    restart: unless-stopped

volumes:
  api_storage:
  db_data:
  caddy_data:
```

The `caddy` service is inert unless explicitly enabled:

```bash
docker compose -f docker-compose.full.yml --profile tls up -d --build
```

`deploy/Caddyfile` (reverse-proxies to `web`):

```
{$SITE_ADDRESS:localhost} {
    reverse_proxy web:80
}
```

### 4.7 Host nginx (documented, not created by this repo)

The user's existing nginx needs only one upstream:

```nginx
server {
    listen 443 ssl http2;
    server_name drive.example.com;
    ssl_certificate     /etc/letsencrypt/live/drive.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/drive.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

If the host nginx runs as a container instead, both stacks join an external
network and nginx proxies to `http://web:80` rather than the loopback port.

### 4.8 Environment and secrets

- `.env.example` (committed) lists every variable with placeholder values.
- `.env` (gitignored) holds the real values on the host.
- Compose reads `.env` via `env_file` and overrides per service with
  `environment:`.
- Required for the app to boot: `APP_KEY` (32 chars), `JWT_SECRET`.
- For File 2: `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`, `DB_ROOT_PASSWORD`.
- No secret is written into a Dockerfile or the Compose files.

---

## 5. Feasibility spike (SQLite)

A throwaway copy of the backend was created in a temporary directory, the SQLite
driver was added, and migrations were run. Results:

- `go get github.com/goravel/sqlite@v1.18.0` and `go build ./...` succeeded on
  Windows without CGO.
- Migrations 1–10 applied; migration 11 failed with
  `sqlite3: SQL logic error: no such column: uuid`.
- Instrumentation showed the `ADD COLUMN` succeeded (a fresh connection could
  see `uuid`), but the backfill query could not, because it ran on
  `facades.Orm()` while the migrator's transaction lives on
  `facades.Schema().Orm()`. On MariaDB this is invisible because DDL
  auto-commits; on SQLite it is fatal.
- After changing the backfill to `facades.Schema().Orm().Query()`, all 11
  migrations succeeded and the resulting schema contained the `uuid` column and
  the `cloud_accounts_uuid_unique` index.

The spike directory (which held a copied `.env` with real credentials) was
deleted after the investigation.

---

## 6. Testing

| Item | Command | Expected |
|---|---|---|
| Backend build/vet | `go build ./...` && `go vet ./...` (in `backend/`) | clean |
| Backend tests | `go test ./...` (in `backend/`) | pass |
| SQLite migrate | `DB_CONNECTION=sqlite DB_DATABASE=/tmp/t.sqlite go run . artisan migrate` | 11/11 success |
| Frontend type-check | `bun run type-check` (in `frontend/`) | pass |
| Frontend tests | `bun run test:run` (in `frontend/`) | pass |
| Frontend build | `bun run build-only` (in `frontend/`) | `dist/` produced |
| File 1 up | `docker compose up -d --build` then open `http://localhost:8080` | SPA loads; `/ping` returns pong |
| File 1 persistence | restart the stack; create data | data survives (volume) |
| File 2 up | `docker compose -f docker-compose.full.yml up -d --build` | api+web+db healthy; app works on MariaDB |
| File 2 queue | trigger a cloud sync | job runs in-process; request returns immediately |
| Caddy profile off | `docker compose -f docker-compose.full.yml up -d` | no caddy container; port 80/443 untouched |
| Secrets | `docker history` on the api image | no secret layers |

---

## 7. Risks and mitigations

| Risk | Level | Mitigation |
|---|---|---|
| SQLite single-writer contention | Low | File 1 is single-user; enable WAL and `busy_timeout` on the SQLite connection |
| `APP_KEY`/`JWT_SECRET` missing | High (crash) | Entrypoint fails fast; documented in `.env.example` |
| Migrations racing if `api` scaled >1 | Low | File 2 keeps `api` at one replica; scaling requires a separate `migrate` service (out of scope) |
| Caddy grabbing 80/443 on a host that already runs nginx | Medium | Caddy is behind profile `tls`, off by default |
| Backend image missing runtime assets | Medium | Dockerfile copies `lang/`, `resources/`, `public/`, `config/` explicitly |
| Stale `dist/` or `node_modules` leaking into the frontend image | Low | `.dockerignore` excludes both |
| Host nginx as a container cannot reach loopback | Low | Documented: join an external network and proxy to `web:80` |

---

## 8. Out of scope

- CI/CD pipelines and registry publishing (removed from the repo in a prior
  change; deploy is manual `git pull` + `up -d --build`).
- Kubernetes or any orchestrator beyond Docker Compose.
- Automated backups for MariaDB or the SQLite file.
- TLS certificate issuance by this repository (the host nginx owns TLS).
- Changing the application's business logic beyond the single migration fix.

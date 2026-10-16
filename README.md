# Ponta Drive

A multi-cloud drive application.

## Layout

| Path | Component | Stack |
|---|---|---|
| `backend/` | API | Go 1.25+ / Goravel |
| `frontend/` | Web app | Vue 3 + Vite + Bun 1.4.2 |
| `docs/superpowers/` | Specs and plans | Markdown |
| `run.bat` | Local dev launcher (Windows) | Batch |

## Development

Run both components from the repository root on Windows:

```bat
run.bat
```

This starts the backend with `air` (hot reload) and the frontend with
`bun run dev`. The Vite dev server proxies `/auth`, `/v1`, `/ping`, and `/api`
to the backend on `127.0.0.1:3000`.

### Backend only

```bash
cd backend
cp .env.example .env      # then fill in values
air                       # or: go run .
```

### Frontend only

```bash
cd frontend
bun install
bun run dev
```

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

On a host with no nginx of its own, add the opt-in Caddy profile:

```bash
docker compose -f docker-compose.full.yml --profile tls up -d --build
```

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

### Pre-built all-in-one image

The project publishes a pre-built image containing the backend, frontend, and
nginx reverse proxy to GitHub Container Registry:

```sh
ghcr.io/ngotuananh101/ponta-drive:latest
```

#### Quick start with `docker run`

```bash
docker run -d \
  --name ponta-drive \
  -p 8080:8080 \
  -e APP_KEY=$(openssl rand -hex 16) \
  -e JWT_SECRET=$(openssl rand -hex 32) \
  -v ponta_storage:/app/storage \
  ghcr.io/ngotuananh101/ponta-drive:latest
```

#### Quick start with Docker Compose

Use the production compose template for a simpler deployment:

```bash
docker compose -f docker-compose.prod.yml up -d
```

You must provide the required environment variables via `.env` file:

```bash
cp .env.example .env        # set APP_KEY and JWT_SECRET
docker compose -f docker-compose.prod.yml up -d
```

The data volume `ponta_storage` will be created automatically and persist
across container restarts.

#### GitHub Actions webhook

The GitHub Actions workflow automatically publishes the image on pushes to the
`main` branch. To trigger a manual deploy, add the `DEPLOY_WEBHOOK` secret to
the repository settings.

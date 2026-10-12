# Ponta Drive

A multi-cloud drive application.

## Layout

| Path | Component | Stack |
|---|---|---|
| `backend/` | API | Go 1.27 / Goravel, Docker |
| `frontend/` | Web app | Vue 3 + Vite + Bun |
| `docs/superpowers/` | Specs and plans | Markdown |

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

- Backend: `backend/deploy.sh` (run from `backend/`; it operates on the repo root).
- Frontend: Cloudflare Pages / Vercel with build root `frontend/`.

## CI

`.github/workflows/backend.yml` and `.github/workflows/frontend.yml` run only
when their subtree changes.

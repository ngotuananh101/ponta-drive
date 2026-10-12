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

Deployment is manual; no CI or deploy scripts are kept in this repository.
Build each component from its own subdirectory (`backend/`, `frontend/`) and
publish it with whatever pipeline you operate outside the repo.

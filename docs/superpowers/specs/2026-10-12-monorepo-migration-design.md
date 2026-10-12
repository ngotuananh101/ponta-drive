# Ponta Drive — Monorepo Migration Design

**Date:** 2026-10-12
**Status:** Draft — awaiting review
**Target repository:** https://github.com/ngotuananh101/ponta-drive

---

## 1. Goal

Consolidate the two independent repositories that make up Ponta Drive into a
single monorepo hosted at `ngotuananh101/ponta-drive`, preserving the full
commit history of both sides.

| Component | Current location | Current remote | Stack | Commits |
|---|---|---|---|---|
| Backend | `ponta_drive/backend` | `ponta-drive-api` (public) | Go 1.27 / Goravel, Docker | 99 |
| Frontend | `ponta_drive/frontend` | `ponta-drive` (public) | Vue 3 + Vite + Bun 1.4.2 | 122 |
| Root | `ponta_drive/` | *not a git repo* | `docs/`, `run.bat`, `.gitignore` | — |

**Success criteria**

1. `ngotuananh101/ponta-drive` contains `backend/` and `frontend/`, each with
   its full original history reachable via `git log`.
2. `cd backend && go build ./... && go vet ./...` succeeds.
3. `cd frontend && bun install && bun run build && bun run test:run` succeeds.
4. CI runs per-component on GitHub Actions with path filters.
5. `ponta-drive-api` is archived; no code is lost.
6. The local working directory is renamed to `ponta-drive` and builds.

**Explicitly out of scope (decided with the user):** changing anything on the
production server (`drive-api.ponta.dev`). The repo-side prerequisites
(`deploy.sh` correctness, Cloudflare/Vercel build-root settings) are in scope so
that the server update is a mechanical follow-up the user performs separately.

---

## 2. Current state (verified)

Verified directly against the working copies and the GitHub API:

- The parent directory `D:/Source/ponta/ponta_drive` is **not** a git repository.
  Only `backend/.git` and `frontend/.git` exist.
- Both GitHub repos are **public**. No `.env`, key, or credential file has ever
  been committed to either history (checked with
  `git log --all --pretty=format: --name-only | grep -iE '\.env|secret|key|pem'`).
- Backend `main` = `af0d1d9` (synced with `origin/main`); frontend `main` =
  `a419169` (synced). No stashes, no tags, no submodules, no git-lfs objects in
  either repo. Neither repo has CI.
- Branch state:
  - Backend local: `main`, `feature/forgot-reset-password` (merged),
    `feature/multi-cloud-s3-backend` (merged).
  - Backend remote: `main`, `feat/cloud-account-id` (**1 unmerged commit —
    breaking change: "identify cloud accounts by numeric id instead of uuid"**),
    `feat/move-item`, `feat/search-whole-account`, `fix/sync-internal-upload-prefix`
    (all merged into main).
  - Frontend local: `main`, `master` (ancestor of main), `feat/primevue-auth-login`,
    `feature/forgot-reset-password`, `feature/i18n-localization` (all merged).
  - Frontend remote: `main`, `feat/move-item`, `fix/scroll-areas-and-double-scroll`,
    `style/drive-actions-column`, `style/drive-grid-6-cols-2xl` (all merged via
    PRs #16–#18).
- No open PRs on either repo. `ponta-drive` `main` is not branch-protected.
- Backend coupling to its own root: 168 imports of the Go module path
  `ponta_drive/...`; runtime paths are **relative to the working directory**
  (e.g. `storage/logs/goravel.log` in `config/logging.go`). The module is
  self-contained — there are **no cross-repo imports**.
- Frontend coupling: all config (`vite.config.ts`, `tsconfig*.json`,
  `vercel.json`, `wrangler.jsonc`) is relative to the frontend root.
- Root-level shared content (`run.bat`, `.gitignore`, `docs/`) is already
  written against a `backend/` + `frontend/` layout.

**Consequence:** the migration is structurally clean — no source file needs a
path or module-name change, because each component keeps building from inside
its own subdirectory.

---

## 3. Target layout

```
ponta-drive/                          ← the single repository
├── backend/                          ← history from ponta-drive-api, unchanged content
│   ├── go.mod                        (module ponta_drive — unchanged)
│   ├── main.go  app/  routes/  config/  database/  bootstrap/ …
│   ├── Dockerfile  docker-compose.yml
│   ├── deploy.sh                     (MODIFIED — see §5)
│   └── .env                          (gitignored, local only)
├── frontend/                         ← history from ponta-drive, unchanged content
│   ├── package.json                  (name ponta_drive_web — unchanged)
│   ├── src/  vite.config.ts  tsconfig*.json
│   ├── vercel.json  wrangler.jsonc
│   └── .env                          (gitignored, local only)
├── docs/superpowers/                 ← moved into the repo (currently untracked)
├── run.bat                           ← kept at root (already monorepo-shaped)
├── .gitignore                        ← kept at root (already correct)
├── .gitattributes                    ← NEW (from frontend)
├── .github/workflows/                ← NEW (CI, see §6)
├── README.md                         ← NEW (monorepo README)
└── LICENSE                           ← optional; backend/LICENSE is MIT/goravel
```

Nothing is renamed inside `backend/` or `frontend/`.

---

## 4. History-preserving consolidation (Approach A)

Both histories are unrelated, so they are rewritten into disjoint subdirectories
and joined with a single merge commit.

### 4.1 Prerequisites

- `pip install git-filter-repo` (Python 3.14 is present). Verify with
  `git filter-repo --version`. Git 2.55 is present (filter-repo needs ≥ 2.36).
- All work happens in a **scratch directory** (e.g.
  `D:/Source/ponta/_migration`), never in place, so the live working copies and
  their untracked files (`.env`, `node_modules`, `.remember/`) are untouched
  until the swap in §7.

### 4.2 Procedure

```bash
# 0. Safety net: full mirror backups of both repos
git clone --mirror https://github.com/ngotuananh101/ponta-drive.git      front-mirror.git
git clone --mirror https://github.com/ngotuananh101/ponta-drive-api.git  back-mirror.git
cp -r front-mirror.git back-mirror.git  ../_backup/     # keep a second copy

# 1. Rewrite each history into its subdirectory (rewrites ALL refs)
git -C front-mirror.git filter-repo --to-subdirectory-filter frontend --force
git -C back-mirror.git  filter-repo --to-subdirectory-filter backend  --force

# 2. Build the monorepo, taking frontend as the base (ponta-drive already == frontend)
git clone front-mirror.git ponta-drive-monorepo
cd ponta-drive-monorepo
git remote add backend ../back-mirror.git
git fetch backend --tags

# 3. Join the two histories with one merge commit
git merge --allow-unrelated-histories backend/main \
  -m "chore: merge backend (ponta-drive-api) history into monorepo"

# 4. Preserve the one unmerged backend branch under a namespaced name
git branch backend/feat/cloud-account-id backend/feat/cloud-account-id
```

Path prefixes are disjoint (`frontend/…` vs `backend/…`), so the merge is
conflict-free. `filter-repo` rewrites every ref, so all other branches survive
the rewrite as commits already reachable from `main`; only the unmerged
`feat/cloud-account-id` needs an explicit branch ref, kept as
`backend/feat/cloud-account-id`.

### 4.3 Post-merge root additions (new commits on `main`)

```bash
# Bring the untracked root assets into the repo
cp -r /d/Source/ponta/ponta_drive/docs            ./docs
cp    /d/Source/ponta/ponta_drive/run.bat          ./run.bat
cp    /d/Source/ponta/ponta_drive/.gitignore       ./.gitignore
cp    /d/Source/ponta/ponta_drive/frontend/.gitattributes ./.gitattributes   # * text=auto eol=lf
# Add README.md, .github/workflows/*.yml (see §5, §6)
```

Then append `.remember/` and `.claude/` to the root `.gitignore` so agent
runtime artifacts are never committed.

---

## 5. File changes required

### 5.1 `backend/deploy.sh` — must change (highest-risk item)

Current behaviour, run from inside `backend/`:

```bash
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"
```

In the monorepo, `git reset --hard` acts on the **whole worktree regardless of
the current directory**, so a backend deploy would also reset `frontend/` and
the root files. Fix — run the git operations from the repository root and the
build operations from `backend/`:

```bash
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$PROJECT_DIR" rev-parse --show-toplevel)"

git -C "$REPO_ROOT" fetch origin "$BRANCH"
git -C "$REPO_ROOT" reset --hard "origin/$BRANCH"

cd "$PROJECT_DIR"          # all go build / artisan / docker-compose steps unchanged
```

Everything else in `deploy.sh` (go build, `artisan migrate`, `docker-compose
down/up`) already runs relative to `PROJECT_DIR` and needs no change.

### 5.2 Unchanged files

- `backend/`: `go.mod` (module `ponta_drive`), all 168 `ponta_drive/...`
  imports, `.air.toml`, `Dockerfile`, `docker-compose.yml`, `config/*`.
- `frontend/`: `package.json`, `vite.config.ts`, `tsconfig*.json`,
  `vercel.json`, `wrangler.jsonc`, `eslint.config.ts`, `bun.lock`.

### 5.3 Optional cleanups

- Replace the boilerplate Goravel `backend/README.md` / `README_zh.md` with a
  short real README (non-blocking).
- The file `docs/superpowers/research/2026-10-08-vue-file-preview-research.md`
  has a literal Windows path (`D:/Source/ponta/ponta_drive/frontend`) in its
  header; harmless, may be corrected.

---

## 6. CI — GitHub Actions (path-filtered)

Two independent workflows; each triggers only on its own subtree.

`.github/workflows/backend.yml`

```yaml
name: backend
on:
  push:    { branches: [main], paths: ['backend/**', '.github/workflows/backend.yml'] }
  pull_request: { paths: ['backend/**', '.github/workflows/backend.yml'] }
jobs:
  build:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: backend } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version-file: backend/go.mod }
      - run: go build ./...
      - run: go vet ./...
      # NOTE: see §9 open item — feature tests need a live MariaDB.
```

`.github/workflows/frontend.yml`

```yaml
name: frontend
on:
  push:    { branches: [main], paths: ['frontend/**', '.github/workflows/frontend.yml'] }
  pull_request: { paths: ['frontend/**', '.github/workflows/frontend.yml'] }
jobs:
  build:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: frontend } }
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version-file: frontend/.bun-version }
      - run: bun install --frozen-lockfile
      - run: bun run type-check
      - run: bun run lint
      - run: bun run test:run
      - run: bun run build
```

---

## 7. Local working copy swap and directory rename

Performed only **after** the push in §8 succeeds and the scratch build is green.

1. Rename the current directory: `D:/Source/ponta/ponta_drive` →
   `D:/Source/ponta/ponta-drive` (close editors/terminals first; note `_` → `-`).
2. `git clone https://github.com/ngotuananh101/ponta-drive.git` into the new
   path (or move the scratch clone there).
3. Restore local-only files from the backup: `backend/.env`, `frontend/.env`,
   and (if wanted) `.remember/`, `.claude/`, `tmp/`.
4. Rebuild: `cd backend && go build ./...`; `cd frontend && bun install`.

---

## 8. External systems to reconfigure

| System | Current | After migration | Owner |
|---|---|---|---|
| GitHub `ponta-drive` | holds frontend | force-push new monorepo `main` | this plan |
| GitHub `ponta-drive-api` | holds backend | **archive** (read-only) | this plan |
| Local directory | `ponta_drive` | `ponta-drive` | this plan |
| Server `drive-api.ponta.dev` | clones `ponta-drive-api`, runs `./deploy.sh` | clone `ponta-drive`, run `backend/deploy.sh` | **user, out of scope** |
| Cloudflare Pages/Worker (`drive.ponta.dev`, `ponta-drive.anhnt.workers.dev`) | build root = repo root | build root = `frontend/` | user |
| Vercel | `vercel.json` at root | project Root Directory = `frontend/` | user |

`wrangler.jsonc` (`name: ponta-drive`, `assets.directory: ./dist`) needs no edit:
run from `frontend/`, `./dist` resolves to `frontend/dist`. Only the
dashboard-side build root must change.

---

## 9. Risks and open items

1. **Force-push rewrites `main`.** All existing clones/forks of both repos must
   be re-cloned; any old PR branches are invalidated. Accepted — no open PRs,
   and both repos are solo-owned.
2. **`deploy.sh` resets the whole worktree** if not fixed (§5.1). Fixed before
   the push.
3. **Unmerged backend branch.** `origin/feat/cloud-account-id` is a breaking
   change kept as `backend/feat/cloud-account-id`; its future is a separate
   decision (merge, rebase, or drop).
4. **Commit SHAs change** for all commits (filter-repo rewrite). References to
   old SHAs in `docs/` and `.remember/` become historical notes only.
5. **Backend CI tests need a live MariaDB.** The existing backend test suite
   requires a database (per project history). Open item: either add a MariaDB
   service container to the CI job, or run only `go build`/`go vet` in CI and
   keep DB-backed tests local. **Recommendation:** start with build+vet in CI,
   add the DB service as a follow-up.
6. **Windows `safe.directory`.** The scratch clones may trip Git's "dubious
   ownership" guard; if so, add the paths to `git config --global
   safe.directory`.
7. **Secrets:** none found in either history; both repos are public, so merging
   exposes nothing new.

---

## 10. Execution order

1. Back up both repos as mirrors (two copies).
2. Install `git-filter-repo`; verify version.
3. Rewrite both mirrors into `frontend/` and `backend/` prefixes.
4. Merge unrelated histories into a scratch monorepo; preserve
   `backend/feat/cloud-account-id`.
5. Add root assets (`docs/`, `run.bat`, `.gitignore`, `.gitattributes`,
   `README.md`, CI workflows); fix `deploy.sh`; extend `.gitignore`.
6. Verify in scratch: backend `go build ./... && go vet ./...`; frontend
   `bun install && bun run type-check && bun run test:run && bun run build`;
   confirm `git log -- backend/` and `git log -- frontend/` both show full history.
7. Force-push `main` and push `backend/feat/cloud-account-id` to `ponta-drive`.
8. Archive `ponta-drive-api`; rename the local directory and re-clone; restore
   `.env` files; rebuild locally.
9. (User, separate) Update server clone path and Cloudflare/Vercel build roots.

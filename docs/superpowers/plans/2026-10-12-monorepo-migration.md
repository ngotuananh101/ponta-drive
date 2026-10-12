# Ponta Drive Monorepo Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the `ponta-drive-api` (backend) and `ponta-drive` (frontend) repositories into a single monorepo at `ngotuananh101/ponta-drive`, preserving the full commit history of both.

**Architecture:** Rewrite each repository's history into a disjoint subdirectory (`backend/` and `frontend/`) with `git filter-repo`, then join the two unrelated histories with a single merge commit. Add monorepo-root assets (docs, CI, README), fix the one file whose behaviour changes under a monorepo (`backend/deploy.sh`), verify both components build from their subdirectories, then force-push and archive the old backend repo.

**Tech Stack:** Git 2.55, `git-filter-repo` (Python 3.14), GitHub CLI (`gh`, authenticated as `ngotuananh101`), Go 1.27 / Goravel (backend), Bun 1.4.2 / Vue 3 / Vite (frontend), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-12-monorepo-migration-design.md`

## Global Constraints

- Target repo: `https://github.com/ngotuananh101/ponta-drive` (public, default branch `main`).
- Source repos: `https://github.com/ngotuananh101/ponta-drive.git` (frontend) and `https://github.com/ngotuananh101/ponta-drive-api.git` (backend).
- Do **not** rename or modify: `backend/go.mod` (module stays `ponta_drive`), the 168 `ponta_drive/...` imports, `backend/.air.toml`, `backend/Dockerfile`, `backend/docker-compose.yml`, `frontend/package.json` (`name` stays `ponta_drive_web`), `frontend/vite.config.ts`, `frontend/tsconfig*.json`, `frontend/vercel.json`, `frontend/wrangler.jsonc`, `frontend/bun.lock`.
- All scratch work happens in `D:/Source/ponta/_migration` (created fresh). Never run `filter-repo` against the live working copies at `D:/Source/ponta/ponta_drive/{backend,frontend}`.
- Never run a command that modifies the live working copies before Task 9; the live copies are the backup of untracked local state (`backend/.env`, `frontend/.env`, `.remember/`, `node_modules`).
- Server (`drive-api.ponta.dev`) is explicitly out of scope — do not SSH to it.
- Shell: this machine's `Bash` tool is Git Bash. Use POSIX paths (`/d/Source/...`); for `git` commands use `git -C <path>` rather than `cd` to avoid cwd drift.
- Verification commands are the "tests" in this plan: each task ends with a command whose expected output is stated.

## Review Focus

Failure modes most likely to bite a person running this plan, each pinned to a test in the task that owns it:

1. **A backend deploy resetting the frontend.** `deploy.sh` runs `git reset --hard`, which acts on the whole worktree regardless of cwd; if not fixed, deploying the backend silently discards frontend working-tree state. Pinned in Task 6.
2. **History loss on one side.** If the `--to-subdirectory-filter` step is skipped or run on the wrong mirror, one component's commits collapse or land at the repo root. Pinned in Task 4 (both `git log -- backend/` and `git log -- frontend/` must show their original first commit).
3. **The unmerged backend branch disappearing.** `feat/cloud-account-id` is not reachable from `main` and is lost unless explicitly re-branched. Pinned in Task 5.
4. **A build that only passes at the old path.** A hidden root-relative assumption would make `go build` or `bun run build` fail only after the move. Pinned in Task 7 (builds run with cwd inside each subdirectory of the scratch clone).
5. **Wrong component redeployed.** Cloudflare/Vercel build roots and the server clone path still point at the old layout; the repo cannot verify these, so Task 10 pins them as an explicit checklist the user completes.

---

### Task 1: Backup both repositories as mirrors

**Files:**
- Create: `D:/Source/ponta/_backup/front-mirror.git/` (bare mirror)
- Create: `D:/Source/ponta/_backup/back-mirror.git/` (bare mirror)

**Interfaces:**
- Consumes: nothing.
- Produces: two bare mirror clones with identical refs to the remotes; these are the rollback source for every later task.

- [ ] **Step 1: Create the backup directory and clone both repos as mirrors**

```bash
mkdir -p /d/Source/ponta/_backup
git clone --mirror https://github.com/ngotuananh101/ponta-drive.git     /d/Source/ponta/_backup/front-mirror.git
git clone --mirror https://github.com/ngotuananh101/ponta-drive-api.git /d/Source/ponta/_backup/back-mirror.git
```

- [ ] **Step 2: Verify both mirrors contain the expected refs and commit counts**

```bash
echo "FRONT refs:"; git -C /d/Source/ponta/_backup/front-mirror.git show-ref | wc -l
echo "FRONT commits (all):"; git -C /d/Source/ponta/_backup/front-mirror.git rev-list --all --count
echo "BACK refs:"; git -C /d/Source/ponta/_backup/back-mirror.git show-ref | wc -l
echo "BACK commits (all):"; git -C /d/Source/ponta/_backup/back-mirror.git rev-list --all --count
```

Expected: FRONT `rev-list --all --count` = `122`, BACK = `99`. Both `show-ref | wc -l` are non-zero.

- [ ] **Step 3: Verify the backend's known head commit is present in the mirror**

```bash
git -C /d/Source/ponta/_backup/back-mirror.git cat-file -t af0d1d997a14d19fc51650b68eb161ef23b7c32a
```

Expected: `commit`.

- [ ] **Step 4: No commit needed** — `_backup/` is outside any repository. This task's deliverable is the on-disk backups; it is verified by Steps 2–3.

---

### Task 2: Install and verify `git-filter-repo`

**Files:**
- No repository files. Installs a tool into the user's Python environment.

**Interfaces:**
- Consumes: nothing.
- Produces: a working `git filter-repo` command available to the shell.

- [ ] **Step 1: Install via pip**

```bash
python -m pip install --user git-filter-repo
```

- [ ] **Step 2: Verify the command resolves**

```bash
git filter-repo --version
```

Expected: prints a version like `2.47.0` (any version). If instead Git reports `'filter-repo' is not a git command`, add the Scripts directory to PATH for this shell and retry:

```bash
export PATH="$(python -c 'import sysconfig; print(sysconfig.get_path("scripts", "nt_user"))'):$PATH"
git filter-repo --version
```

- [ ] **Step 3: Verify Git is new enough**

```bash
git --version
```

Expected: `2.36` or newer (present machine has 2.55). `filter-repo` refuses older Git.

- [ ] **Step 4: No commit needed** — tool installation; verified by Steps 2–3.

---

### Task 3: Rewrite both histories into their subdirectories

**Files:**
- Modify (rewrite): `D:/Source/ponta/_backup/front-mirror.git/` — all refs rewritten to prefix `frontend/`
- Modify (rewrite): `D:/Source/ponta/_backup/back-mirror.git/` — all refs rewritten to prefix `backend/`

**Interfaces:**
- Consumes: the two mirrors from Task 1; the `git filter-repo` command from Task 2.
- Produces: two mirrors whose every commit has all paths under `frontend/` and `backend/` respectively; `frontend/main` and `backend/main` are the tips later tasks merge.

- [ ] **Step 1: Rewrite the frontend mirror into `frontend/`**

```bash
git -C /d/Source/ponta/_backup/front-mirror.git filter-repo --to-subdirectory-filter frontend --force
```

Expected: output ends with a line like `Parsed 122 commits` and `New history written in ...`.

- [ ] **Step 2: Verify every path in the rewritten frontend history is under `frontend/`**

```bash
git -C /d/Source/ponta/_backup/front-mirror.git ls-tree -r --name-only main | grep -cv '^frontend/'
```

Expected: `0` (zero paths outside `frontend/`).

- [ ] **Step 3: Rewrite the backend mirror into `backend/`**

```bash
git -C /d/Source/ponta/_backup/back-mirror.git filter-repo --to-subdirectory-filter backend --force
```

Expected: output ends with a line like `Parsed 99 commits`.

- [ ] **Step 4: Verify every path in the rewritten backend history is under `backend/`**

```bash
git -C /d/Source/ponta/_backup/back-mirror.git ls-tree -r --name-only main | grep -cv '^backend/'
```

Expected: `0`.

- [ ] **Step 5: Verify a known backend file is at its new path**

```bash
git -C /d/Source/ponta/_backup/back-mirror.git ls-tree -r --name-only main | grep -x 'backend/main.go'
```

Expected: prints `backend/main.go`.

- [ ] **Step 6: Verify commit counts survived the rewrite (nothing collapsed)**

```bash
git -C /d/Source/ponta/_backup/front-mirror.git rev-list --all --count
git -C /d/Source/ponta/_backup/back-mirror.git rev-list --all --count
```

Expected: `122` and `99` (unchanged from Task 1).

- [ ] **Step 7: No commit needed** — the mirrors are bare and outside any repo; verified by Steps 2–6.

---

### Task 4: Merge the two histories into a scratch monorepo

**Files:**
- Create: `D:/Source/ponta/_migration/ponta-drive-monorepo/` (working clone)

**Interfaces:**
- Consumes: `front-mirror.git` and `back-mirror.git` from Task 3.
- Produces: a working repository whose `main` has both `frontend/` and `backend/` trees, with two root commits joined by one merge commit.

- [ ] **Step 1: Create the scratch directory and clone the frontend history**

```bash
mkdir -p /d/Source/ponta/_migration
git clone /d/Source/ponta/_backup/front-mirror.git /d/Source/ponta/_migration/ponta-drive-monorepo
```

- [ ] **Step 2: Add the backend mirror as a remote and fetch it**

```bash
git -C /d/Source/ponta/_migration/ponta-drive-monorepo remote add backend /d/Source/ponta/_backup/back-mirror.git
git -C /d/Source/ponta/_migration/ponta-drive-monorepo fetch backend
```

- [ ] **Step 3: Merge the unrelated backend history**

```bash
git -C /d/Source/ponta/_migration/ponta-drive-monorepo merge --allow-unrelated-histories backend/main -m "chore: merge backend (ponta-drive-api) history into monorepo"
```

Expected: merge succeeds with no conflicts (the two path prefixes are disjoint). Output names the merge commit.

- [ ] **Step 4: Verify both trees exist at the monorepo root**

```bash
ls /d/Source/ponta/_migration/ponta-drive-monorepo
```

Expected: lists at least `backend` and `frontend`.

- [ ] **Step 5: Verify full backend history is reachable through `backend/`**

```bash
git -C /d/Source/ponta/_migration/ponta-drive-monorepo log --oneline -- backend/ | wc -l
git -C /d/Source/ponta/_migration/ponta-drive-monorepo log --oneline -- backend/ | tail -1
```

Expected: count is ≥ 99; the last line is the backend's original first commit (a Goravel scaffold commit, not the merge).

- [ ] **Step 6: Verify full frontend history is reachable through `frontend/`**

```bash
git -C /d/Source/ponta/_migration/ponta-drive-monorepo log --oneline -- frontend/ | wc -l
git -C /d/Source/ponta/_migration/ponta-drive-monorepo log --oneline -- frontend/ | tail -1
```

Expected: count is ≥ 122; the last line is `first commit` (`6c285bd`-equivalent, rewritten SHA).

- [ ] **Step 7: Verify there are exactly two root commits joined by the merge**

```bash
git -C /d/Source/ponta/_migration/ponta-drive-monorepo rev-list --max-parents=0 HEAD | wc -l
```

Expected: `2`.

- [ ] **Step 8: No commit needed** — the merge commit from Step 3 is this task's deliverable; verified by Steps 4–7.

---

### Task 5: Preserve the unmerged backend branch

**Files:**
- Create: branch `backend/feat/cloud-account-id` in `D:/Source/ponta/_migration/ponta-drive-monorepo/`

**Interfaces:**
- Consumes: the scratch monorepo from Task 4; the rewritten `backend/feat/cloud-account-id` ref in `back-mirror.git` from Task 3.
- Produces: a local branch `backend/feat/cloud-account-id` whose tip is the rewritten commit of the original breaking change, pushed in Task 9.

- [ ] **Step 1: Create the namespaced branch from the fetched backend remote**

```bash
git -C /d/Source/ponta/_migration/ponta-drive-monorepo branch backend/feat/cloud-account-id backend/feat/cloud-account-id
```

- [ ] **Step 2: Verify the branch exists and carries the breaking-change commit**

```bash
git -C /d/Source/ponta/_migration/ponta-drive-monorepo log --oneline -1 backend/feat/cloud-account-id
```

Expected: one line whose subject is `feat(api)!: identify cloud accounts by numeric id instead of uuid`.

- [ ] **Step 3: Verify the branch is not an ancestor of `main` (i.e. it was genuinely unmerged)**

```bash
git -C /d/Source/ponta/_migration/ponta-drive-monorepo merge-base --is-ancestor backend/feat/cloud-account-id main && echo "MERGED (unexpected)" || echo "UNMERGED (expected)"
```

Expected: `UNMERGED (expected)`.

- [ ] **Step 4: Verify the branch's tree contains the backend files at their new paths**

```bash
git -C /d/Source/ponta/_migration/ponta-drive-monorepo ls-tree -r --name-only backend/feat/cloud-account-id | grep -x 'backend/go.mod'
```

Expected: prints `backend/go.mod`.

- [ ] **Step 5: No commit needed** — branch creation; verified by Steps 2–4.

---

### Task 6: Add root assets and fix `deploy.sh`

**Files:**
- Create: `README.md` (repo root)
- Create: `.gitattributes` (repo root)
- Create: `.github/workflows/backend.yml`
- Create: `.github/workflows/frontend.yml`
- Create: `docs/` (copied from the live working copy, currently untracked)
- Create: `run.bat` (copied from the live working copy)
- Modify: `.gitignore` (repo root — extend with agent artifacts)
- Modify: `backend/deploy.sh` (lines ~52–55, the `git fetch` / `git reset` block)

**Interfaces:**
- Consumes: the scratch monorepo from Task 4.
- Produces: a repo root containing `README.md`, `.gitattributes`, `.github/workflows/{backend,frontend}.yml`, `docs/`, `run.bat`, an extended `.gitignore`, and a `backend/deploy.sh` whose git operations run from the repository root.

- [ ] **Step 1: Copy the untracked root assets into the scratch clone**

```bash
MONO=/d/Source/ponta/_migration/ponta-drive-monorepo
SRC=/d/Source/ponta/ponta_drive
cp -r "$SRC/docs"       "$MONO/docs"
cp    "$SRC/run.bat"     "$MONO/run.bat"
cp    "$SRC/.gitignore"  "$MONO/.gitignore"
cp    "$SRC/frontend/.gitattributes" "$MONO/.gitattributes"
```

- [ ] **Step 2: Verify the copied assets are present**

```bash
ls /d/Source/ponta/_migration/ponta-drive-monorepo
```

Expected: includes `README.md` is NOT yet required, but `docs`, `run.bat`, `.gitignore`, `.gitattributes` are present. Also confirm `docs/superpowers/specs` exists:

```bash
ls /d/Source/ponta/_migration/ponta-drive-monorepo/docs/superpowers/specs | head -3
```

Expected: lists spec files including `2026-10-12-monorepo-migration-design.md`.

- [ ] **Step 3: Extend `.gitignore` with agent runtime artifacts**

Append these lines to `/d/Source/ponta/_migration/ponta-drive-monorepo/.gitignore`:

```gitignore

# Agent runtime artifacts (Claude Code)
.remember
.claude
```

- [ ] **Step 4: Verify `.gitignore` ignores the new entries**

```bash
cd /d/Source/ponta/_migration/ponta-drive-monorepo && git check-ignore -v .remember .claude
```

Expected: prints a matching rule (`.gitignore:<line>:.remember`) for both paths.

- [ ] **Step 5: Write the root `README.md`**

Create `/d/Source/ponta/_migration/ponta-drive-monorepo/README.md` with exactly:

```markdown
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
```

- [ ] **Step 6: Write `.github/workflows/backend.yml`**

Create `/d/Source/ponta/_migration/ponta-drive-monorepo/.github/workflows/backend.yml` with exactly:

```yaml
name: backend
on:
  push:
    branches: [main]
    paths:
      - 'backend/**'
      - '.github/workflows/backend.yml'
  pull_request:
    paths:
      - 'backend/**'
      - '.github/workflows/backend.yml'
jobs:
  build:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version-file: backend/go.mod
          cache-dependency-path: backend/go.sum
      - run: go build ./...
      - run: go vet ./...
```

- [ ] **Step 7: Write `.github/workflows/frontend.yml`**

Create `/d/Source/ponta/_migration/ponta-drive-monorepo/.github/workflows/frontend.yml` with exactly:

```yaml
name: frontend
on:
  push:
    branches: [main]
    paths:
      - 'frontend/**'
      - '.github/workflows/frontend.yml'
  pull_request:
    paths:
      - 'frontend/**'
      - '.github/workflows/frontend.yml'
jobs:
  build:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: frontend/.bun-version
      - run: bun install --frozen-lockfile
      - run: bun run type-check
      - run: bun run lint
      - run: bun run test:run
      - run: bun run build
```

- [ ] **Step 8: Fix `backend/deploy.sh` — make git operations run from the repo root**

Replace the existing block in `/d/Source/ponta/_migration/ponta-drive-monorepo/backend/deploy.sh`:

```bash
# 2. Cập nhật mã nguồn từ Git
log_info "1/5. Kéo mã nguồn mới nhất từ Git origin/$BRANCH..."
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"
log_success "Đã cập nhật mã nguồn thành công."
```

with:

```bash
# 2. Cập nhật mã nguồn từ Git
# Trong monorepo, `git reset --hard` tác động lên TOÀN BỘ worktree bất kể cwd,
# nên phải chạy các lệnh git từ repository root để không reset nhầm frontend.
REPO_ROOT="$(git -C "$PROJECT_DIR" rev-parse --show-toplevel)"
log_info "1/5. Kéo mã nguồn mới nhất từ Git origin/$BRANCH..."
git -C "$REPO_ROOT" fetch origin "$BRANCH"
git -C "$REPO_ROOT" reset --hard "origin/$BRANCH"
log_success "Đã cập nhật mã nguồn thành công."
```

- [ ] **Step 9: Verify the fix is syntactically valid and behaviourally correct**

```bash
bash -n /d/Source/ponta/_migration/ponta-drive-monorepo/backend/deploy.sh && echo "SYNTAX OK"
grep -n 'git -C "$REPO_ROOT" reset --hard' /d/Source/ponta/_migration/ponta-drive-monorepo/backend/deploy.sh
```

Expected: `SYNTAX OK`, then a line showing the `git -C "$REPO_ROOT" reset --hard` command.

- [ ] **Step 10: Commit the root assets and the deploy fix**

```bash
cd /d/Source/ponta/_migration/ponta-drive-monorepo
git add README.md .gitattributes .gitignore .github docs run.bat backend/deploy.sh
git commit -m "chore(monorepo): add root assets, CI workflows, and repo-root-aware deploy"
```

Expected: commit created listing those paths.

- [ ] **Step 11: Verify the commit contains every expected path**

```bash
git -C /d/Source/ponta/_migration/ponta-drive-monorepo show --stat --oneline HEAD | head -20
```

Expected: the stat lists `README.md`, `.gitattributes`, `.gitignore`, `.github/workflows/backend.yml`, `.github/workflows/frontend.yml`, `run.bat`, `backend/deploy.sh`, and a `docs/...` entry.

---

### Task 7: Verify both components build from their subdirectories

**Files:**
- No repository file changes (build outputs are ignored: `backend/tmp/`, `frontend/node_modules/`, `frontend/dist/`).

**Interfaces:**
- Consumes: the scratch monorepo after Task 6.
- Produces: evidence that no hidden root-relative assumption broke; the gate that must pass before pushing.

- [ ] **Step 1: Build and vet the backend from inside `backend/`**

```bash
cd /d/Source/ponta/_migration/ponta-drive-monorepo/backend && go build ./... && go vet ./... && echo "BACKEND OK"
```

Expected: `BACKEND OK`. If it fails with a missing package, the module path or a relative path assumption broke — stop and investigate before continuing.

- [ ] **Step 2: Confirm the backend binary builds to the expected name**

```bash
cd /d/Source/ponta/_migration/ponta-drive-monorepo/backend && go build -o tmp/main.exe . && ls -la tmp/main.exe
```

Expected: a file listing for `tmp/main.exe` (this is exactly what `air` and `deploy.sh` produce).

- [ ] **Step 3: Install frontend dependencies**

```bash
cd /d/Source/ponta/_migration/ponta-drive-monorepo/frontend && bun install
```

Expected: install completes; `bun.lock` unchanged (`git status` shows no modification to it).

- [ ] **Step 4: Type-check and lint the frontend**

```bash
cd /d/Source/ponta/_migration/ponta-drive-monorepo/frontend && bun run type-check && bun run lint && echo "FRONTEND STATIC OK"
```

Expected: `FRONTEND STATIC OK`.

- [ ] **Step 5: Run the frontend test suite**

```bash
cd /d/Source/ponta/_migration/ponta-drive-monorepo/frontend && bun run test:run 2>&1 | tail -20
```

Expected: the suite reports all tests passing (the project history records 211 passing tests; any number ≥ 211 with 0 failures is acceptable — if the count differs, confirm 0 failures before proceeding).

- [ ] **Step 6: Build the frontend**

```bash
cd /d/Source/ponta/_migration/ponta-drive-monorepo/frontend && bun run build && ls dist/index.html
```

Expected: build succeeds; `dist/index.html` exists.

- [ ] **Step 7: Confirm the build left the working tree clean (no tracked file modified)**

```bash
git -C /d/Source/ponta/_migration/ponta-drive-monorepo status --porcelain
```

Expected: empty output (build outputs are gitignored; `bun install` did not change `bun.lock`).

- [ ] **Step 8: No commit needed** — this task is a verification gate; its deliverable is the green run of Steps 1–7.

---

### Task 8: Verify history integrity before pushing

**Files:**
- No file changes.

**Interfaces:**
- Consumes: the scratch monorepo after Task 7.
- Produces: a final history audit; the last checkpoint before the irreversible force-push.

- [ ] **Step 1: Verify total commit count equals the sum of both repos plus the merge and asset commits**

```bash
git -C /d/Source/ponta/_migration/ponta-drive-monorepo rev-list --all --count
```

Expected: `99 + 122 + 1 (merge) + 1 (root assets commit)` = `223`, plus the preserved branch is already counted in `--all`. Confirm the number is ≥ 223 and that `git log --all --oneline | wc -l` matches it.

- [ ] **Step 2: Verify both original first commits are present**

```bash
git -C /d/Source/ponta/_migration/ponta-drive-monorepo log --oneline --all -- frontend/ | tail -1
git -C /d/Source/ponta/_migration/ponta-drive-monorepo log --oneline --all -- backend/ | tail -1
```

Expected: two distinct root commits — the frontend `first commit` and the backend Goravel scaffold.

- [ ] **Step 3: Verify the working tree is clean**

```bash
git -C /d/Source/ponta/_migration/ponta-drive-monorepo status
```

Expected: `nothing to commit, working tree clean`.

- [ ] **Step 4: Verify no secrets are present in the new history**

```bash
git -C /d/Source/ponta/_migration/ponta-drive-monorepo log --all --pretty=format: --name-only \
  | sort -u | grep -iE '^\.env$|\.env\.(local|production)|secret|credential|\.pem$|id_rsa' || echo "NO SECRETS"
```

Expected: `NO SECRETS` (only `.env.example` files exist, which the pattern excludes).

- [ ] **Step 5: No commit needed** — verification gate.

---

### Task 9: Push to `ponta-drive` and preserve the branch

**Files:**
- Modify (remote): `ngotuananh101/ponta-drive` — `main` force-replaced, `backend/feat/cloud-account-id` added.

**Interfaces:**
- Consumes: the verified scratch monorepo from Task 8; `gh` authenticated as `ngotuananh101`.
- Produces: the remote monorepo; the source of truth for Tasks 10–11.

- [ ] **Step 1: Confirm the authenticated GitHub account**

```bash
gh auth status 2>&1 | grep -E 'Logged in|Active account'
```

Expected: `Logged in to github.com account ngotuananh101` and `Active account: true`.

- [ ] **Step 2: Point the scratch clone's `origin` at the real repo and push `main`**

```bash
cd /d/Source/ponta/_migration/ponta-drive-monorepo
git remote set-url origin https://github.com/ngotuananh101/ponta-drive.git
git push --force origin main
```

Expected: force-push succeeds. (The remote previously held only the frontend at root; it is intentionally replaced.)

- [ ] **Step 3: Push the preserved backend branch**

```bash
git -C /d/Source/ponta/_migration/ponta-drive-monorepo push origin backend/feat/cloud-account-id
```

Expected: new branch created on the remote.

- [ ] **Step 4: Verify the remote now has both trees**

```bash
gh api repos/ngotuananh101/ponta-drive/contents --jq '.[].name' | sort | tr '\n' ' '
```

Expected: output includes `backend`, `frontend`, `docs`, `README.md`, `.github`.

- [ ] **Step 5: Verify the remote branch list includes the preserved branch**

```bash
gh api repos/ngotuananh101/ponta-drive/branches --jq '.[].name' | sort
```

Expected: includes `backend/feat/cloud-account-id` and `main`.

- [ ] **Step 6: Verify the remote `main` tip matches the local tip**

```bash
LOCAL=$(git -C /d/Source/ponta/_migration/ponta-drive-monorepo rev-parse main)
REMOTE=$(gh api repos/ngotuananh101/ponta-drive/commits/main --jq '.sha')
echo "local=$LOCAL remote=$REMOTE"; [ "$LOCAL" = "$REMOTE" ] && echo "IN SYNC" || echo "MISMATCH"
```

Expected: `IN SYNC`.

- [ ] **Step 7: No commit needed** — this task's deliverable is the remote state; verified by Steps 4–6.

---

### Task 10: Archive `ponta-drive-api`

**Files:**
- Modify (remote settings): `ngotuananh101/ponta-drive-api` — archived.

**Interfaces:**
- Consumes: a successful Task 9 push (do not archive until the monorepo is confirmed live).
- Produces: a read-only backend source repo; the rollback path remains the `_backup/back-mirror.git` from Task 1.

- [ ] **Step 1: Archive the repository**

```bash
gh repo archive ngotuananh101/ponta-drive-api --yes
```

Expected: confirmation that the repository was archived.

- [ ] **Step 2: Verify the repository reports archived**

```bash
gh repo view ngotuananh101/ponta-drive-api --json isArchived,name
```

Expected: `{"isArchived":true,"name":"ponta-drive-api"}`.

- [ ] **Step 3: Verify the monorepo still contains the backend history (the archive lost nothing)**

```bash
gh api repos/ngotuananh101/ponta-drive/contents/backend --jq '.[].name' | head -5
```

Expected: lists backend top-level entries (`app`, `bootstrap`, `config`, ...).

- [ ] **Step 4: No commit needed** — remote settings change; verified by Steps 2–3.

---

### Task 11: Swap the local working copy to `ponta-drive`

**Files:**
- Create: `D:/Source/ponta/ponta-drive/` (clone of the remote monorepo)
- Preserve (restore into the clone): `backend/.env`, `frontend/.env`; optionally `.remember/`, `.claude/`

**Interfaces:**
- Consumes: the remote monorepo from Task 9.
- Produces: a working local clone at the new path that builds, with local-only files restored.

- [ ] **Step 1: Confirm the old directory is not in use**

Ensure no editor, terminal, or `run.bat` has `D:/Source/ponta/ponta_drive` as its cwd. The next step renames it.

- [ ] **Step 2: Rename the old directory out of the way**

```bash
mv /d/Source/ponta/ponta_drive /d/Source/ponta/ponta_drive_old
```

Expected: no error. (`ponta_drive_old` is the local backup of untracked state; it is removed in Step 8.)

- [ ] **Step 3: Clone the monorepo into the new path**

```bash
git clone https://github.com/ngotuananh101/ponta-drive.git /d/Source/ponta/ponta-drive
```

Expected: clone succeeds; `ls /d/Source/ponta/ponta-drive` shows `backend`, `frontend`, `docs`, `README.md`.

- [ ] **Step 4: Restore the local-only env files**

```bash
cp /d/Source/ponta/ponta_drive_old/backend/.env  /d/Source/ponta/ponta-drive/backend/.env
cp /d/Source/ponta/ponta_drive_old/frontend/.env /d/Source/ponta/ponta-drive/frontend/.env
```

- [ ] **Step 5: Verify the env files are restored and gitignored**

```bash
ls -la /d/Source/ponta/ponta-drive/backend/.env /d/Source/ponta/ponta-drive/frontend/.env
cd /d/Source/ponta/ponta-drive && git status --porcelain
```

Expected: both `.env` files listed, and `git status --porcelain` is empty (both are ignored).

- [ ] **Step 6: Optionally restore agent artifacts**

```bash
cp -r /d/Source/ponta/ponta_drive_old/.remember /d/Source/ponta/ponta-drive/.remember 2>/dev/null || true
cp -r /d/Source/ponta/ponta_drive_old/.claude   /d/Source/ponta/ponta-drive/.claude   2>/dev/null || true
cd /d/Source/ponta/ponta-drive && git status --porcelain
```

Expected: still empty (both are gitignored).

- [ ] **Step 7: Rebuild from the new path**

```bash
cd /d/Source/ponta/ponta-drive/backend && go build ./... && echo "BACKEND OK"
cd /d/Source/ponta/ponta-drive/frontend && bun install && bun run build && echo "FRONTEND OK"
```

Expected: `BACKEND OK` and `FRONTEND OK`.

- [ ] **Step 8: Remove the old directory once the new one is confirmed working**

```bash
rm -rf /d/Source/ponta/ponta_drive_old
```

Expected: no error. Do this only after Steps 5–7 passed.

---

### Task 12: User follow-up checklist (out of scope to execute)

**Files:**
- No repository files. These are external dashboards/servers the plan deliberately does not touch.

**Interfaces:**
- Consumes: the live monorepo from Task 9.
- Produces: production still deploying correctly from the new layout.

- [ ] **Step 1: Update the backend server clone**

On `drive-api.ponta.dev`: re-clone `https://github.com/ngotuananh101/ponta-drive.git`, then run `cd backend && ./deploy.sh`. (The repo now expects the clone root to be the monorepo, with `backend/` as the working directory.)

- [ ] **Step 2: Update the frontend build root**

In Cloudflare Pages/Worker (`drive.ponta.dev`, `ponta-drive.anhnt.workers.dev`) and Vercel, set the project **Root Directory** to `frontend/`. No file inside `frontend/` needs to change (`wrangler.jsonc` and `vercel.json` resolve relative to `frontend/`).

- [ ] **Step 3: Verify production after redeploy**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://drive-api.ponta.dev/ping
```

Expected: `200`.

- [ ] **Step 4: Confirm no stale clones remain**

Search local machines and the server for other clones of `ponta-drive-api` and re-point or remove them. `gh repo view ngotuananh101/ponta-drive-api` should show archived.

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| §3 target layout | Tasks 3, 4, 6 |
| §4.1 prerequisites / backups | Tasks 1, 2 |
| §4.2 procedure | Tasks 3, 4, 5 |
| §4.3 root additions | Task 6 |
| §5.1 `deploy.sh` fix | Task 6 (Steps 8–9) |
| §5.2 unchanged files | Global Constraints (explicit do-not-touch list) |
| §5.3 optional cleanups | Not planned (optional; backend README replacement deferred — non-blocking per spec) |
| §6 CI workflows | Task 6 (Steps 6–7) |
| §7 local swap + rename | Task 11 |
| §8 external systems | Tasks 9, 10, 12 |
| §9 risks | Task 1 (backups), Task 5 (branch), Task 8 (secrets/history), Task 6 (`deploy.sh`) |
| §10 execution order | Task order 1–12 matches |
| §9.5 CI/MariaDB open item | Task 6 CI runs build+vet only (recommended option); noted here as the accepted resolution |

No spec requirement is left without a task. The one deferred item (§5.3 optional README cleanup) is explicitly optional in the spec.

**Placeholder scan:** No "TBD"/"TODO"/"implement later"/"similar to Task N". Every code/content step shows the exact content to write.

**Type consistency:** Path variables `MONO`, `SRC`, `REPO_ROOT`, `PROJECT_DIR`, `LOCAL`, `REMOTE` are defined at first use in each step. Branch name `backend/feat/cloud-account-id` is spelled identically in Tasks 5, 9. Workflow filenames `backend.yml` / `frontend.yml` are consistent between Task 6 Step 6–7 and the verification in Step 11. `REPO_ROOT` in the `deploy.sh` fix matches the variable introduced in Task 6 Step 8.

**Review Focus:** Each of the five lines has an owning test — (1) Task 6 Step 9, (2) Task 4 Steps 5–7, (3) Task 5 Step 3, (4) Task 7 Steps 1/6, (5) Task 12.

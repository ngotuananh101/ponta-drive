# Multi-Arch Native Build (AMD64 + ARM64) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build native `linux/amd64` and `linux/arm64` container images using GitHub Actions native runners and merge them into a single multi-arch manifest list published to GHCR.

**Architecture:** Distributed matrix build jobs running on `ubuntu-24.04` (x86_64) and `ubuntu-24.04-arm` (AArch64) pushing by digest to GHCR, followed by a merge job that creates and pushes the multi-platform manifest list with `docker buildx imagetools create`.

**Tech Stack:** GitHub Actions, Docker Buildx, GitHub Container Registry (GHCR), Go 1.25, Bun 1.4, Alpine 3.20.

**Spec:** `docs/superpowers/specs/2026-10-17-multi-arch-native-build-design.md`

## Global Constraints

- Native runners only: `ubuntu-24.04` for amd64, `ubuntu-24.04-arm` for arm64. No QEMU emulation overhead.
- Cache isolation: Use separate BuildKit GHA cache scopes (`scope=${{ steps.platform-pair.outputs.tuple }}`) to prevent cache thrashing between architectures.
- Zero cleartext secrets: `DEPLOY_WEBHOOK` passed only via environment variable and checked with `[ -n "$DEPLOY_WEBHOOK_URL" ]`.
- Manifest inspection: `merge` job must run `docker buildx imagetools inspect` to prove both architectures are present in the final manifest index.

## Review Focus

- ARM64 Go compilation: `Dockerfile` must accept `ARG TARGETARCH` and set `GOARCH` properly without breaking local single-arch builds.
- Artifact collision: Matrix digest artifacts must have unique names (`digests-linux-amd64`, `digests-linux-arm64`) and merge without file overwrites.
- Quoting & spaces in tag expansion: `jq -cr '.tags | map("-t " + .) | join(" ")'` must properly format tags for `imagetools create`.
- Failure isolation: If one architecture build fails, `merge` job must not run and must not create a broken single-arch manifest.
- Webhook safety: Webhook must only be triggered in `merge` job after the multi-arch manifest has been verified.

---

### Task 1: Update Dockerfile for Target Architecture Support

**Files:**
- Modify: `Dockerfile:1-15`

**Interfaces:**
- Consumes: Built-in BuildKit `TARGETARCH` argument.
- Produces: Architecture-aware Go binary build step.

- [x] **Step 1: Inspect current Dockerfile backend build stage**

Verify current `backend-build` stage at `Dockerfile:1-12`.

- [x] **Step 2: Add `ARG TARGETARCH` and architecture flag to `go build`**

In `Dockerfile`, add `ARG TARGETARCH` inside `backend-build` stage and update the compile command to:
```dockerfile
ARG TARGETARCH
RUN if [ -n "$TARGETARCH" ]; then export GOARCH="$TARGETARCH"; fi && \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/ponta-api .
```

- [x] **Step 3: Verify local build syntax**

Run: `docker build -t ponta-drive:test-syntax --target backend-build .` (or test compilation in Go).
Expected: Successful compilation without syntax errors.

- [x] **Step 4: Commit Dockerfile update**

```bash
git add Dockerfile
git commit -m "feat(deploy): support TARGETARCH in backend build stage"
```

---

### Task 2: Implement Multi-Arch Native Build & Manifest Merge Workflow

**Files:**
- Modify: `.github/workflows/docker-publish.yml`

**Interfaces:**
- Consumes: GitHub Actions runner environments (`ubuntu-24.04`, `ubuntu-24.04-arm`), `secrets.GITHUB_TOKEN`, `secrets.DEPLOY_WEBHOOK`.
- Produces: Published multi-arch manifest list on `ghcr.io/ngotuananh101/ponta-drive` containing `linux/amd64` and `linux/arm64`.

- [x] **Step 1: Write matrix `build` job in `.github/workflows/docker-publish.yml`**

Configure `build` job:
- Matrix with `ubuntu-24.04` (`linux/amd64`) and `ubuntu-24.04-arm` (`linux/arm64`).
- Step `Normalize platform name for artifact` to generate tuple `linux-amd64` / `linux-arm64`.
- `docker/build-push-action@v6` with:
  - `platforms: ${{ matrix.platform }}`
  - `outputs: type=image,"name=ghcr.io/${{ github.repository }}",push-by-digest=true,name-canonical=true,push=true`
  - `cache-from: type=gha,scope=${{ steps.platform-pair.outputs.tuple }}`
  - `cache-to: type=gha,mode=max,scope=${{ steps.platform-pair.outputs.tuple }}`
- Export digest file to `/tmp/digests/<sha256>`.
- Upload artifact `digests-${{ steps.platform-pair.outputs.tuple }}` via `actions/upload-artifact@v4`.

- [x] **Step 2: Write `merge` job in `.github/workflows/docker-publish.yml`**

Configure `merge` job:
- `runs-on: ubuntu-latest`, `needs: build`.
- Download digests with `actions/download-artifact@v4` using `pattern: digests-*` and `merge-multiple: true`.
- Log in to `ghcr.io` and setup Buildx.
- Extract tags via `docker/metadata-action@v5`.
- Run `docker buildx imagetools create` with tags and digests.
- Run `docker buildx imagetools inspect` on the published tag.
- Trigger `DEPLOY_WEBHOOK` step if configured.

- [x] **Step 3: Validate YAML syntax of the workflow file**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/docker-publish.yml'))"` or equivalent validator.
Expected: Valid YAML with 0 parse errors.

- [x] **Step 4: Commit workflow update**

```bash
git add .github/workflows/docker-publish.yml
git commit -m "ci: add native multi-arch matrix build and manifest merge for amd64 and arm64"
```

---

### Task 3: Document Multi-Arch Support in README.md

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: Multi-arch image capabilities.
- Produces: Clear documentation for users running on ARM64 (Oracle Cloud Ampere A1, Raspberry Pi 4/5, AWS Graviton, Apple Silicon).

- [x] **Step 1: Update README section "Pre-built all-in-one image"**

Document that the pre-built GHCR image is a multi-platform image supporting both `linux/amd64` and `linux/arm64` (AArch64) natively.

- [x] **Step 2: Commit README update**

```bash
git add README.md
git commit -m "docs(deploy): document native multi-arch support for amd64 and arm64"
```

---

### Task 4: Push to Main & Verify CI/CD Live Execution

**Files:**
- Repository remote `origin/main`

**Interfaces:**
- Consumes: GitHub Actions runner dispatch.
- Produces: Live verified multi-platform image manifest on GHCR.

- [x] **Step 1: Push commits to `origin/main`**

Run: `git push origin main`
Expected: Push succeeds and triggers GitHub Actions workflow.

- [x] **Step 2: Monitor GitHub Actions run**

Run: `gh run list --workflow=docker-publish.yml -L 1` and `gh run watch <run-id>`.
Expected:
- `build (ubuntu-24.04, linux/amd64)`: SUCCESS
- `build (ubuntu-24.04-arm, linux/arm64)`: SUCCESS
- `merge`: SUCCESS
- `imagetools inspect` shows both `linux/amd64` and `linux/arm64` manifests.

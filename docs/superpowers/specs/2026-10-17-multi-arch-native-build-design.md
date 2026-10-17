# Ponta Drive — Multi-Arch Native Build (AMD64 + ARM64) & Manifest Merge Design

**Date:** 2026-10-17
**Status:** Approved by user
**Target repository:** https://github.com/ngotuananh101/ponta-drive

---

## 1. Goal

Enable automated, high-performance multi-architecture Docker image builds for Ponta Drive targeting both **linux/amd64** and **linux/arm64** (specifically supporting Oracle Cloud ARM Ampere A1 instances, Raspberry Pi, and other ARM64 servers alongside standard x86_64 machines).

To avoid slow QEMU emulation during compilation, the workflow uses GitHub Actions **native runners** for both architectures (`ubuntu-24.04` for amd64 and `ubuntu-24.04-arm` for arm64) to build and push individual platform images by digest, and then merges them into a single multi-arch manifest list using `docker buildx imagetools create`.

---

## 2. Requirements & Success Criteria

1. **Native Performance**: No QEMU emulation overhead. AMD64 compiles on native x86_64 runners; ARM64 compiles on native AArch64 runners (`ubuntu-24.04-arm`).
2. **Push by Digest**: Each architecture build pushes its image layer directly to GitHub Container Registry (`ghcr.io/ngotuananh101/ponta-drive`) by digest, storing the digest as a build artifact.
3. **Multi-Arch Manifest Merge**: A downstream `merge` job downloads all architecture digests and uses `docker buildx imagetools create` to assemble the multi-platform manifest list with appropriate tags (`latest`, `v*.*.*`, `sha-*`).
4. **Target Architecture Support in Dockerfile**: The Go build stage in `Dockerfile` declares `ARG TARGETARCH` and passes `${TARGETARCH:+GOARCH=$TARGETARCH}` to ensure explicit architecture targeting.
5. **Separated Cache Scopes**: BuildKit GHA caches use platform-specific scopes (`cache-from/to: type=gha,scope=...`) to prevent cache collisions between amd64 and arm64.
6. **Deploy Webhook**: Dispatches the POST deployment trigger from the `merge` job after the multi-arch manifest list has been published successfully.
7. **Verification**: The `merge` job executes `docker buildx imagetools inspect` on the published tag to visibly verify that both `linux/amd64` and `linux/arm64` platforms are listed in the manifest index.

---

## 3. Architecture & Data Flow

```
Trigger (Push main / tag / workflow_dispatch)
  │
  ├──► Job: build (matrix: linux/amd64 on ubuntu-24.04)
  │      - Native Go & Bun build
  │      - Buildx push by digest -> GHCR
  │      - Upload digest artifact (digests-linux-amd64)
  │
  ├──► Job: build (matrix: linux/arm64 on ubuntu-24.04-arm)
  │      - Native Go & Bun build
  │      - Buildx push by digest -> GHCR
  │      - Upload digest artifact (digests-linux-arm64)
  │
  └──► Job: merge (runs-on: ubuntu-latest, needs: [build])
         - Download all digest artifacts
         - Extract tags via docker/metadata-action
         - docker buildx imagetools create -t <tags...> <digests...>
         - docker buildx imagetools inspect <published_image>
         - Trigger DEPLOY_WEBHOOK (if secret set)
```

---

## 4. Components

### 4.1 Dockerfile Update
- Add `ARG TARGETARCH` in `backend-build` stage.
- Update `go build` command:
  ```dockerfile
  RUN CGO_ENABLED=0 GOOS=linux ${TARGETARCH:+GOARCH=$TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/ponta-api .
  ```

### 4.2 GitHub Actions Workflow (`.github/workflows/docker-publish.yml`)
- Two-stage pipeline:
  - `build` job with matrix:
    - `{ runner: ubuntu-24.04, platform: linux/amd64 }`
    - `{ runner: ubuntu-24.04-arm, platform: linux/arm64 }`
  - `merge` job:
    - `needs: build`
    - Gathers digests with `actions/download-artifact@v4` (`pattern: digests-*`, `merge-multiple: true`)
    - Assembles manifest list with `docker buildx imagetools create`
    - Validates with `docker buildx imagetools inspect`
    - Executes webhook if `DEPLOY_WEBHOOK` is configured.

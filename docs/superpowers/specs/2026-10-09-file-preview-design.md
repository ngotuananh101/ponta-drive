# File Preview — Design Spec

Date: 2026-10-09
Status: Approved design, pending implementation plan
Related research: `docs/superpowers/research/2026-10-08-vue-file-preview-research.md`

## 1. Goal

Let a user open a preview of any file in their drive. The preview must work for
as many file types as possible, avoid burning server bandwidth when it can, and
never leak internal system/driver/DB errors to the client.

Success criteria:

- A user can open a preview from the drive list (double-click) and from the item
  menu ("Preview").
- Images, video, audio, PDF, Office documents, text/code/markdown, zip, epub,
  font, CAD and the rest of the library's renderers are all reachable.
- Files that cannot be previewed still show a working download link and a clear
  message — never a blank screen or a raw error.
- Internal errors (S3 driver, DB, permissions) go to the file log only; the
  client sees a localized, user-facing message.

## 2. Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Direct tier | `direct` = public URL (if reachable) **or** presigned URL, **format-aware** |
| D2 | Preview scope | Full library (all renderers) |
| D3 | Trigger | Both double-click **and** menu item |
| D4 | Library language | Self-translated Vietnamese dictionary (`messages['vi']`) |
| D5 | Presentation | Dedicated route `/d/:cloudId/preview/:uuid` |
| D6 | CORS automation | Auto on cloud-account **create/edit** (option A) **plus** a manual button |

## 3. Verified facts (evidence, not assumptions)

These were confirmed by reading the code/docs during brainstorming; the design
depends on them.

- **F1 — Download is a presigned URL.** `DriveItemController.Download`
  (`app/http/controllers/drive_item_controller.go:396`) supports `mode=redirect`
  (default), `mode=json` (returns `{download_url, item}`) and `mode=stream`
  (proxies bytes). `mode=json` builds the URL via
  `CloudDriveService.GetPresignedDownloadURL` → `S3Driver.GetPresignedDownloadURL`
  → S3 `PresignGetObject`. A presigned URL carries its own signature in the
  query string and needs **no `Authorization` header**.
- **F2 — Presigned URL is an attachment.** The S3 presign sets
  `ResponseContentDisposition: attachment; filename="…"`. `<img>`, `<video>`,
  `<audio>` and pdf.js ignore this; a browser navigating directly to it would
  download. This is why the app uses the library's renderers rather than an
  `<iframe>`.
- **F3 — Public URL exists but is unused.** `S3Config.PublicURL` (a CDN/custom
  domain, per cloud account) is stored and editable, and `S3Driver.GetPublicURL()`
  exists, but **no caller uses it** today. This spec is the first consumer.
- **F4 — `mode=stream` has no `Range` and no size cap.** `S3Driver.Get` issues a
  plain `GetObject` (no range), and `Download` `io.Copy`s the whole object.
- **F5 — Library auth mechanics.** Media renderers (`<img>/<video>/<audio>`)
  cannot send request headers, so a header-based auth scheme requires
  `shouldFetchAsBlob` to fetch through the library's `fetcher` (which applies
  `requestInit`) into a `blob:` URL. Non-media renderers (pdf, office, zip…)
  fetch through the same `fetcher` and get `requestInit` automatically.
  Source: `packages/vue-file-preview/src/composables/useRequest.ts`,
  `FilePreviewContent.vue` (`useResolvedUrl`, `builtinRendererProps`).
- **F6 — Type-check depends on `skipLibCheck`.** `@vue/tsconfig/tsconfig.json`
  sets `skipLibCheck: true`; `tsconfig.dom.json` extends it; the app extends
  `tsconfig.dom.json`. The library's own types are not clean, so turning this off
  would break `vue-tsc`.
- **F7 — i18n is override-by-`messages`.** The library accepts a `locale` prop
  plus a `messages` prop that shallow-merges over the built-in dictionary
  (`createTranslator`, `file-preview-core/src/i18n`). A `vi` dictionary of the
  full key set is the supported way to get Vietnamese. Built-in: zh-CN, en-US.
- **F8 — CORS is a bucket-level API on all three providers.** AWS S3, Cloudflare
  R2 (`PutBucketCors`/`GetBucketCors` listed as implemented) and MinIO (`mc cors`
  / bucket CORS API) all support it. `S3Driver` already serves all three through
  one `s3.Client` (`aws-sdk-go-v2/service/s3 v1.79.0`), so one method covers all.
- **F9 — Frontend origin is configured.** `config/app.go:28` →
  `FRONTEND_URL` (default `http://localhost:5173`). Use this as the allowed
  origin; never `*`.
- **F10 — Errors never reach clients.** `failResponse`
  (`app/http/controllers/error_response.go:19`) logs the real error and returns
  only a localized key. Any new endpoint must follow this rule.

## 4. Architecture

Backend decides, frontend executes. The backend resolves a **strategy** for each
file and returns it; the frontend only wires the library according to that
strategy. This keeps the decision (which needs S3 credentials, size, CORS state
and a server-side reachability check) on the server.

```
DriveView (dblclick / menu)
      │  router.push /d/:cloudId/preview/:uuid
      ▼
PreviewView ── GET /v1/drive/items/{uuid}/preview?mode=json ──► backend
      │                                                          │
      │  { strategy, url, download_url, item, reason }           │ resolves:
      │                                                          │  media?      → direct
      │                                                          │  fetch-based?→ proxy (≤50MB)
      ▼                                                          │               else direct
 FilePreviewEmbed(locale="vi", messages=viDict,                 │               else fallback
                  requestInit?, shouldFetchAsBlob?)              │
```

## 5. Backend design

### 5.1 Strategy resolution

New endpoint: `GET /v1/drive/items/{uuid}/preview?mode=json` (JWT-protected,
same group as the other `drive/items` routes).

Classification (by MIME prefix and, when empty, extension):

- **media** = `image/*`, `video/*`, `audio/*`
- **fetch-based** = everything else that the library can render (pdf, office,
  zip, epub, code, markdown, json, font, cad, …)

Resolution table:

| Kind | First choice | Second choice | Else |
|------|--------------|---------------|------|
| media | `direct` — public URL if server HEAD succeeds, else presigned | — | — |
| fetch-based | `proxy` if `size ≤ 50MB` | `direct` — public URL only, if HEAD succeeds | `fallback` |

Rationale (F5): media renderers (`<img>/<video>/<audio>`) do not need CORS, so
`direct` works for them whether the URL is public or presigned. Fetch-based
renderers **do** need CORS, so `proxy` (same-origin) is the safe default; for
them `direct` is used only via a reachable **public** URL, which is CORS-enabled
by nature. Presigned is deliberately **not** used for fetch-based direct: we
cannot guarantee at decision time that the bucket's CORS is active (the auto
step in 5.3 is best-effort), so relying on it would make the preview fail at the
browser in exactly the case the proxy exists to cover.

Public-URL reachability is checked **server-side** (`HEAD`, ~3s timeout) to
avoid browser CORS false-negatives. If the account has no `PublicURL`, skip that
tier.

Response `200`:

```json
{
  "status": "ok",
  "data": {
    "strategy": "direct" | "proxy" | "fallback",
    "url": "https://… | /v1/drive/items/{uuid}/content | null",
    "download_url": "https://…",
    "item": { "…": "DriveItem.ToResponse()" },
    "reason": "too_large" | null
  }
}
```

- `strategy=direct` → `url` is the absolute public or presigned URL.
- `strategy=proxy` → `url` is the relative same-origin path
  `/v1/drive/items/{uuid}/content`.
- `strategy=fallback` → `url` is `null`, `reason="too_large"`.
- `download_url` is always present (presigned) for the download button and the
  fallback card.

### 5.2 Content proxy

New endpoint: `GET /v1/drive/items/{uuid}/content` (JWT-protected). Replaces the
existing `mode=stream` behaviour for preview use; `Download`'s `mode=stream` may
be kept for backward compatibility or folded into this — implementation plan to
decide, but the preview feature uses `/content`.

Requirements:

- **Size cap, enforced server-side.** If `item.Size > 50MB`, return `413` with a
  localized message (`drive.preview_too_large`) and log nothing sensitive. Do not
  trust the client to have respected the cap.
- **`Range` support.** Parse `Range: bytes=…`, pass it to `GetObject`
  (`Range` field), and respond `206 Partial Content` with `Content-Range`,
  `Accept-Ranges: bytes`, `Content-Length`. Invalid/unsatisfiable range → `416`.
  This is what lets video seek and lets pdf.js/others fetch incrementally.
- **Headers.** `Content-Type` from the item MIME (fallback
  `application/octet-stream`); `Content-Disposition: inline` (this is a preview,
  not a download); `Content-Length` when known.
- Requires a driver method that can read a range (see 5.5).

### 5.3 Automatic CORS on create/edit (D6, option A)

On successful cloud-account **Store** and **Update**, after credentials are
saved, ensure a CORS rule exists on the bucket:

1. `GetBucketCors` → take the existing `CORSRules` (or empty).
2. If a rule already allows our origin, do nothing (idempotent).
3. Otherwise append our rule and `PutBucketCors` with **existing ∪ new**.

Our rule (minimal, F9):

```
AllowedOrigins: [ FRONTEND_URL ]
AllowedMethods: [ GET, HEAD ]
AllowedHeaders: ["*"]
ExposeHeaders:  [ ETag, Content-Range, Content-Length ]
MaxAgeSeconds:  3000
```

**Best-effort, never blocking.** A failure (most likely `AccessDenied` because
the key is object-scoped, or a provider that rejects `PutBucketCors`) must:

- NOT fail the save — the account is still created/updated;
- log the real error to the file log with context (provider, bucket, origin);
- optionally record a non-fatal hint the UI can show.

This satisfies F10: the user never sees a driver/permission error from an
automatic step.

### 5.4 Manual CORS endpoint (D6, button)

New endpoint: `POST /v1/cloud-accounts/{id}/cors` (JWT-protected). Runs the same
ensure-CORS logic as 5.3, but **synchronously and with a real result**, because
the user explicitly asked for it.

- Success → `200 { "status": "ok", "message": "<localized>" }`.
- Failure → `4xx/5xx` with a **generic localized** message
  (`cloud.cors_failed`); the real error is logged only.

### 5.5 Driver additions

Add to the `CloudDriver` contract (`app/contracts/storage.go`) and implement in
`S3Driver` (covers S3, R2, MinIO):

- `GetBucketCors(ctx) ([]CORSRule, error)` → wraps `GetBucketCors`; treat
  `NoSuchCORSConfiguration` as an empty list.
- `PutBucketCors(ctx, rules []CORSRule) error` → wraps `PutBucketCors`.
- `GetRange(ctx, key string, offset, length int64) (io.ReadCloser, int64, error)`
  → wraps `GetObject` with `Range` and returns the body plus the total size
  (from `ContentRange`), so the handler can build `206` headers.

Types (`CORSRule` etc.) live in `app/contracts/storage.go`.

### 5.6 Error handling (F10)

- All new handlers return `failResponse`-style localized errors; the underlying
  error is logged, never serialized.
- The auto-CORS step logs directly (`facades.Log().Errorf`) and swallows.
- New language keys go in `lang/{en,vi}/drive.json` and
  `lang/{en,vi}/cloud.json`.

## 6. Frontend design

### 6.1 Route and view

- Route: `{ path: '/d/:cloudId/preview/:uuid', name: 'drive-preview',
  component: () => import('@/views/PreviewView.vue'), props: true,
  meta: { requiresAuth: true, titleKey: 'routes.preview' } }` in
  `src/router/index.ts`.
- `PreviewView.vue`:
  - reads `uuid` from route params;
  - calls a new `getDriveItemPreview(uuid)` in `src/api/driveItems.ts`
    (`GET /v1/drive/items/{uuid}/preview?mode=json`);
  - on `strategy=direct|proxy`, lazily imports the library and renders
    `FilePreviewEmbed` with `files=[{ url, name, type, size }]`, `locale="vi"`,
    `messages=viDict`;
  - on `strategy=fallback`, renders a small card with the item name, a localized
    message and the `download_url` as a download button — the library is not
    imported at all;
  - has loading and error states; errors use localized app strings.

### 6.2 Strategy → library wiring

- **direct**: `file.url` = absolute URL; no `requestInit`, no
  `shouldFetchAsBlob` (public/presigned needs no auth).
- **proxy**: `file.url` = `API_BASE_URL + url`; provide
  `requestInit` that adds `Authorization: Bearer <token>` (reuse the same token
  source as `src/api/client.ts`), and `shouldFetchAsBlob` returning `true` for
  media MIME types (`image/`, `video/`, `audio/`) so those renderers fetch
  through the authenticated fetcher into a blob URL (F5). Non-media renderers
  fetch through the fetcher directly and get the header automatically.

The library is imported via dynamic `import()` inside the view (bundle is
~31MB dist / ~2.5MB eager — never import at module top-level).

### 6.3 Triggers

- `DriveView.vue`: add `@dblclick` on the **file** card (list and grid) that
  pushes the preview route; folders keep their current open-folder behaviour.
- `DriveItemMenu.vue`: add a "Preview" item that emits `preview`, wired by
  `DriveView` to the same navigation. (The menu already has a Download action
  using `getDriveItemDownloadUrl` + `window.open`.)

### 6.4 Vietnamese dictionary

- New `src/lib/vfp-i18n.ts` exporting `viMessages: Messages` covering the
  library's full key set (from `file-preview-core/src/i18n/messages/en-US.ts`,
  ~116 keys), passed as `messages={{ vi: viMessages }}`.
- App-level keys added to `src/locales/vi.json` and `src/locales/en.json`:
  `drive.action_preview`, `drive.preview_title`, `drive.preview_loading`,
  `drive.preview_error`, `drive.preview_unsupported`, `drive.preview_too_large`,
  `drive.preview_download`, plus `routes.preview`.
- A test asserts the `vi` dictionary covers every key the `en-US` dictionary
  defines, so library additions surface as a failing test rather than English
  leaking into a Vietnamese UI.

### 6.5 Storage UI — manual CORS button

- `src/api/cloudAccounts.ts`: add `ensureCloudAccountCors(id)` →
  `POST /v1/cloud-accounts/{id}/cors`.
- `AddCloudDialog.vue` (used for both add and edit): add a "Enable CORS"
  action (available in edit mode) that calls the endpoint and shows a toast with
  the localized success/failure message. This is the manual escape hatch when
  the automatic step could not run (e.g. insufficient permissions).

## 7. Edge cases

- **Folder uuid** → preview endpoint rejects (folders are not previewable) with a
  localized error.
- **Item with empty MIME** → classify by extension (mirror the library's
  extension-first detection).
- **Public URL configured but bucket not actually public** → HEAD fails →
  fall through to the next tier.
- **`PublicURL` set to a path prefix** (not a full origin) → HEAD check fails →
  skip; never construct a broken URL.
- **Presigned URL expiry (15 min)** → the preview response is fetched per view
  load, so URLs are always fresh; a long-open tab is out of scope.
- **Proxy requested for a >50MB file directly** (defense-in-depth) → `413`.
- **CORS rule already present** → no-op; **other rules present** → preserved.

## 8. Testing

Backend (table-driven where possible):

- Strategy resolution: media→direct; fetch-based small→proxy; fetch-based
  large→fallback; public URL present+reachable→direct; public URL absent→skip.
- `/content`: no range → `200` + full body; `bytes=0-` → `206`; `bytes=N-M` →
  `206` with correct `Content-Range`; invalid → `416`; `>50MB` → `413`.
- CORS merge: empty existing → new only; existing rules → preserved ∪ new;
  idempotent when already present; `AccessDenied` on auto step → account save
  still succeeds and error is logged.

Frontend:

- `PreviewView` renders the embed for `direct` and `proxy`, and the fallback card
  for `fallback`.
- `driveItems.ts` parses the preview response.
- `DriveItemMenu` emits `preview`; `DriveView` double-click navigates.
- i18n completeness test (6.4).

## 9. Risks

| Level | Risk | Mitigation |
|-------|------|-----------|
| High | Library bundle ~31MB dist / ~2.5MB eager | Dynamic import; consider `manualChunks` |
| High | Library CSS (159KB, unscoped globals) collides with Tailwind v4 | Import scoped inside the view; visual test |
| Medium | 116-key Vietnamese dictionary | Completeness test; accept maintenance on library updates |
| Medium | `PutBucketCors` denied on object-scoped keys | Best-effort + manual button + proxy fallback |
| Medium | `PutBucketCors` overwrite | Get→merge→Put; idempotent |
| Low | `skipLibCheck` must stay on (F6) | Documented; do not remove |
| Low | R2 CORS propagation ~30s | Not fatal; preview falls back to proxy meanwhile |

## 10. Out of scope

- Google Drive / OneDrive providers (still unsupported in the backend).
- Thumbnails / gallery browsing of multiple files.
- Caching or CDN in front of the proxy.
- Editing or annotating files from the preview.
- The download action itself (already exists).

## 11. Notes for implementation

- `docs/` is not tracked by any git repository (the repo root is not a git repo),
  so this spec is not committed — it lives on disk only. The same is true of the
  prior specs in `docs/superpowers/`.
- Follow existing patterns: routes in `routes/web.go`, handlers in
  `app/http/controllers`, localized keys in `lang/{en,vi}`; frontend API in
  `src/api`, views in `src/views`, keys in `src/locales/{vi,en}.json`.

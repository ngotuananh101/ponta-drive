# UUID URLs and UUID-only API contract — Design

Date: 2026-10-04
Status: **SUPERSEDED (2026-10-07)** — the cloud-account segment is now the
numeric **id**, not a uuid. See the note at the top of §4 and §10.

> **Supersede note (2026-10-07).** This spec's §4/§5/§6 decisions were reversed
> for the cloud-account segment by a later decision: the drive URL and the API
> carry the cloud account's numeric **id** (`/d/<id>`, `cloud_account_id`), not
> a uuid, and the backend accepts **only** the id (a breaking contract change,
> no compatibility shim). The account uuid column stays in the DB but is no
> longer exposed. The drive **item** uuid is unchanged: items are still
> addressed by their own `uuid` (`/d/<id>/f/<folderUuid>`). The sections below
> are kept as the historical record of the original uuid design; where they
> conflict with the note above, the note wins.

## 1. Problem

Reloading the drive page (F5) loses the current folder: opening a folder only
mutates local component state (`folderStack`), so the URL never changes. The fix
is to make the URL the source of truth and reload into the same folder.

While specifying that, the URL scheme was set to `/c/<cloud-uuid>/f/<folder-uuid>`
and the rule "always use uuid, never the numeric id" was extended to the API.
`cloud_accounts` has no uuid today, and the API currently exposes numeric ids
(`cloud_account_id`, `parent_id`, `id`) everywhere. So the work is two coupled
changes: a uuid identity for cloud accounts, and a uuid-only external contract.

## 2. Goals / non-goals

Goals:
- F5 (and shared links, and back/forward) stay on the current folder.
- The external contract (URLs + API JSON + route params) uses uuids only.
- Cloud accounts gain a stable uuid.
- No numeric id is exposed in any API response or route.

Non-goals:
- Changing internal DB keys. `cloud_accounts.id` and `drive_items.id` remain the
  internal primary/foreign keys; all table joins keep using numeric ids.
- The service layer keeps its `uint` signatures (see §4 rationale).
- Changing the DriveItem uuid scheme (already exists).
- Adding a locale segment to URLs. The app's routes carry **no** locale today
  (`/login`, `/`, `/drive`); the locale is chosen from localStorage/browser in
  `src/i18n/index.ts`. The new URLs keep that convention: `/c/.../f/...`.

## 3. Evidence (what was verified)

- `models.CloudAccount` has **no** uuid column; `models.DriveItem` has
  `uuid` (`uniqueIndex`). `models.ActivityLog` has no uuid and stores
  `CloudAccountID *uint`.
- `models.UploadSession` keys by `SessionID` (uuid) but stores numeric
  `CloudAccountID` and `ParentID`.
- DriveItem uuids are generated in `CloudDriveService` (`uuid.New().String()`),
  not by a model hook.
- Goravel 1.18 has no `BeforeCreate` model method of its own; its lifecycle is
  via **Observers** (`contracts/database/orm/observer.go`), and this app
  registers **no** observers and has **no** `app/providers` directory.
  Separately, `Query().Create()` delegates to GORM's `DB.Create`
  (`framework/database/gorm/query.go` -> `create()`), which **does** fire the
  model's native GORM `BeforeCreate` hook — verified in the framework source.
- 93 occurrences of `cloud_account_id` / `parent_id` across 11 backend files,
  plus 6 frontend files.
- `frontend/src/router/index.ts` uses `createWebHistory`; `wrangler.jsonc`
  (`not_found_handling: single-page-application`) and `vercel.json` (rewrite
  `/(.*) -> /index.html`) already serve SPA fallback for any path, including
  `/c/.../f/...`. No server change is needed.
- The frontend never reads `user_id`; it is omitted from §5 responses as
  unnecessary.

## 4. Decision: uuid at the boundary, numeric id internally

> **Superseded for the cloud-account segment (2026-10-07).** The external
> contract now carries the cloud account's numeric **id**, not a uuid: the URL
> is `/d/<cloudId>` and requests send `cloud_account_id`. The service layer
> still takes `uint`, so the "translate once at the HTTP boundary" shape below
> survives; only the *direction* changed — the controller parses the numeric id
> (`strconv.ParseUint`) instead of resolving a uuid. The account `uuid` column
> remains in the DB but is no longer returned. The drive **item** uuid is
> unchanged. The original rationale is kept below for the record.

The user's rule has two parts that are easy to conflate:

- **External contract uses uuid.** Requests carry uuids; responses and route
  params carry uuids; no numeric id is returned.
- **Internal links use numeric id.** `cloud_accounts.id` / `drive_items.id`
  remain the keys; foreign keys and joins are unchanged.

The clean way to honor both is to translate uuid↔id exactly once, at the HTTP
boundary (controllers), and leave the service layer on `uint`. This avoids
touching ~55 service call sites and keeps the change reviewable. The trade-off
is explicit: the service still takes numeric ids, but it is an internal
interface that never crosses the API.

## 5. Backend design

### 5.1 Cloud account uuid

- New migration `add_uuid_to_cloud_accounts`:
  - add `uuid` varchar(36);
  - backfill existing rows with a generated uuid;
  - add a unique index on `uuid`.
- `models.CloudAccount` gains `UUID string` (gorm `column:uuid;size:36;uniqueIndex`).
- **Generation via a GORM `BeforeCreate` hook.** Goravel's `Query().Create()`
  delegates to GORM's `DB.Create` (verified in
  `framework/database/gorm/query.go` -> `create()`), which fires the model's
  native `BeforeCreate` hook. So a single hook on `CloudAccount`:
  - populates `UUID` on every create path — the controller, any future code,
    and all test fixtures that call `Create(&models.CloudAccount{...})`;
  - avoids a read-time backfill (a GET that writes is a smell) and avoids
    touching ~18 fixtures individually.
  - Goravel's own Observers are unrelated and still unused; this is GORM's hook,
    which the framework does not disable.
  - The hook sets a uuid only when empty, so a caller that supplies one keeps it.
- `ensureAccountUUID(account)` remains as a tiny guard for rows read with an
  empty uuid (e.g. inserted by raw SQL before the hook existed); it assigns a
  uuid in memory so the response is never blank. It does not write on read.

### 5.2 Response shape

- `CloudAccount.ToResponse()`: **remove** `id` and `user_id`; **add** `uuid`.
- `DriveItem.ToResponse()`: **remove** `id`, `user_id`, `cloud_account_id`,
  `parent_id`; **add** `cloud_account_uuid`.
  - **No `parent_uuid` field.** Nothing consumes a parent pointer: the drive
    list opens a folder by the folder's own `uuid`, and the breadcrumb comes
    from the breadcrumb endpoint's ordered chain. Adding `parent_uuid` would
    require an extra lookup per read path (the parent's uuid is not on the row)
    for no consumer, so it is deliberately omitted (YAGNI).
  - `cloud_account_uuid` is needed: the home page maps each suggested file to
    its account name, and the FE must not carry the numeric `cloud_account_id`.
    The controller/dashboard resolve it from data already in hand (see §5.3).
- `ActivityLog.ToResponse()` is **unchanged** (keeps `id` and `cloud_id`).
  `DashboardService` adds `cloud_account_uuid` to each activity map (it already
  holds the account list, so it can resolve id→uuid without an extra query).
  This is the one place a numeric id (`cloud_id`, `id`) remains in a response,
  by explicit decision.
- `DashboardService` builds `clouds` from `CloudAccount.ToResponse()` (picks up
  the change automatically), `suggested_files` from `DriveItem.ToResponse()`
  (with `cloud_account_uuid` filled), and the activity list from
  `ActivityLog.ToResponse()` enriched with `cloud_account_uuid`.

### 5.3 Filling `cloud_account_uuid` on items

`drive_items` stores `cloud_account_id` (numeric), not the account's uuid.
Resolution is cheap because the account is already loaded on every read path:

- **Drive list** (`DriveItemController.Index`): the request carries
  `cloud_account_uuid`; the controller resolves it to an id once (and holds the
  uuid), so every item in the page gets the same `cloud_account_uuid`.
- **Single item / folder create** (`Show`, `StoreFolder`, `Update`, `Star`,
  `Destroy`): the item's `CloudAccountID` → one account lookup (or the account
  already fetched) gives the uuid.
- **Breadcrumb**: same as single item.
- **Dashboard suggested files**: `DashboardService` already loads all of the
  user's accounts; build an `id -> uuid` map once and fill each item from it.

So no new service helper is needed: each read path fills the field from an
account it already has or fetches in one query.

### 5.4 Requests

- `CreateFolderRequest`, `UpdateDriveItemRequest`, `PresignedUploadRequest`,
  `InitMultipartUploadRequest`: numeric `cloud_account_id` / `parent_id` become
  string `cloud_account_uuid` / `parent_uuid`.
- Controllers resolve uuid→id via the service before calling the `uint` service
  methods. An unknown uuid yields the existing localized error (never the raw
  error), consistent with the standing log/error rule.

### 5.5 Routes

- `cloud-accounts`: `/{id}` → `/{uuid}` for Show / Update / Destroy / Sync.
  Controller reads `ctx.Request().Route("uuid")` and resolves it.
- `drive/items`: routes are already `/{uuid}`.
- `drive/upload/multipart` uses `session_id` (uuid) already.

### 5.6 Error handling

All new failure paths follow the existing rule: internal/driver/DB errors are
logged to `storage/logs/goravel-*.log` only; the client receives a localized
message (e.g. `cloud.not_found`, `drive.item_not_found`). A uuid that does not
resolve is a normal 404, not a leak.

## 6. Frontend design

### 6.1 URL scheme

- `/c/<cloudUuid>/f/<folderUuid>`.
- At the account root the folder segment is omitted: `/c/<cloudUuid>`.
- No locale segment (the app's existing routes have none; locale stays in
  localStorage). Two routes, `drive-root` (`/c/:cloudUuid`) and `drive-folder`
  (`/c/:cloudUuid/f/:folderUuid`), both render `DriveView` with route props
  `{ cloudUuid, folderUuid? }`.
- The old `/drive` route and the `?cloud=` query are removed entirely; there is
  no redirect. Navigation code that built `{ name: 'drive', query: { cloud } }`
  is updated to build the new path directly.

### 6.2 Folder state from the URL

- Remove the local `folderStack`. The URL is the source of truth.
- The list request's `parent_uuid` is the current folder's uuid taken straight
  from the route (or absent at the account root). No lookup is needed to list
  children, so the list loads immediately.
- The breadcrumb endpoint (`GET /v1/drive/items/{uuid}/breadcrumb`, already
  built) is called only to render the ancestor bar. It runs in parallel with
  the list, not before it.
- Opening a folder → `router.push` to `.../f/<folderUuid>` (URL changes; F5
  works).
- Breadcrumb click → `router.push` up to that ancestor's uuid.
- Back/forward → driven by the router; a watcher on the route re-resolves the
  list and the breadcrumb.

### 6.3 API client and types

- `CloudAccount`: drop `id`; add `uuid`.
- `DriveItem`: drop `id`, `cloud_account_id`, `parent_id`; add
  `cloud_account_uuid`.
- List query: `cloud_account_uuid`, `parent_uuid`.
- `SyncCloudButton` prop `accountId: number` → `accountUuid: string`; the
  cloudAccounts store keys on uuid (`isSyncing(uuid)`, `sync(uuid)`, ...).
- HomeView / DashboardLayout: key by `cloud.uuid`; drive navigation pushes the
  uuid path.

### 6.4 Navigation helper

A single helper builds the path from `(cloudUuid, folderUuid?)` so the sidebar,
home cards and drive breadcrumb all produce identical URLs. No numeric id is
ever placed in the URL.

## 7. Testing

Backend:
- Migration test: existing rows get a uuid; unique index holds.
- `ToResponse` tests updated for the new keys (no numeric id).
- Feature: account create/list/show/update/delete/sync by uuid; folder create
  and list by `cloud_account_uuid` / `parent_uuid`; unknown uuid → localized 404
  with no internal text (extends the existing leak tests).
- Items carry `cloud_account_uuid` and no numeric id.
- Dashboard payload: `clouds` and `suggested_files` expose uuids and no numeric
  ids; an activity exposes `cloud_account_uuid` (alongside the kept `cloud_id`).

Frontend:
- Router: `/c/:cloudUuid/f/:folderUuid` resolves with props; root form has no
  folder.
- Store: breadcrumb load/clear; list keyed by uuid.
- Navigation helper: open/up/back produce the expected paths.
- `SyncCloudButton` with a uuid prop.

## 8. Migration / rollout

- Backend deploy: run the migration (adds + backfills uuid) before the new
  code serves traffic. `deploy.sh` already migrates on release.
- The contract change is breaking and ships atomically: backend and frontend
  are deployed together. No compatibility shim (per the "đổi hẳn" decision).
- Existing accounts created before the migration are covered by the backfill;
  any row that slips through is healed by `ensureAccountUUID` on read.

## 9. Risks

- **parent_uuid resolution cost:** one extra bounded query per read page.
  Acceptable; it is a single `IN (...)` on an indexed column.
- **Missed id reference:** a forgotten numeric id in a response would violate
  the rule. Mitigation: the response tests assert the absence of numeric id
  keys, with `ActivityLog` (`id`, `cloud_id`) as the documented exception.
- **Two-repo atomic deploy:** backend and frontend must release together;
  a half-deploy breaks the drive page. Called out in §8.
- **Docs location:** this spec sits under the repo-root `docs/`, which is not a
  git repository (only `backend/` and `frontend/` are), so it is not committed.

## 10. Resolved decisions

- Old `/drive?cloud=<id>` links are **not** redirected; the route is removed and
  replaced by `/c/<cloudUuid>[/f/<folderUuid>]`.
- `ActivityLog.ToResponse()` keeps `id` and `cloud_id` and **adds**
  `cloud_account_uuid`; the activity list is the one place numeric ids remain in
  a response. The FE maps the cloud name by uuid.

No open questions remain.

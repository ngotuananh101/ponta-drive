# Folder-Structure Storage Keys — Design Spec

**Date:** 2026-10-13
**Status:** Draft — pending review
**Related:**
- `docs/superpowers/specs/2026-09-20-multi-cloud-s3-backend-design.md` (introduced the flat key scheme and `ScanBucket`)
- `docs/superpowers/specs/2026-10-06-move-item-design.md` (rename/move semantics this spec changes)
- Commit `cd9d756` (`fix(drive): recover uploaded file name when its DB row is gone`), which added legacy-key recovery in `ScanBucket`

## 1. Purpose

Today an uploaded file is stored on S3 at a **flat** key:

```
users/<userID>/items/<uuid>-<name>
```

The key carries no folder information: the folder tree lives only in the
database (`drive_items.parent_id`). Consequently, when the database is reset
while the bucket survives, a re-sync can only re-attach every uploaded file at
the **scan root** — the folder the user actually put it in is lost forever
(commit `cd9d756` recovered the *name* but not the *location*).

This spec changes the key scheme so the **key path mirrors the user's folder
hierarchy**. A sync after a database loss then reconstructs the full folder tree
and every file's location from the bucket alone.

## 2. Goals

- New uploads are stored under `users/<userID>/<folder-path>/<name>`, where
  `<folder-path>` is the item's folder chain joined by `/`.
- A sync reconstructs folders **and** file placement from these keys.
- Rename and move keep the S3 key in step with the database by **re-keying**
  the object(s) on S3.
- Re-keying is **asynchronous** (queue + polling) so a large folder move cannot
  time out the request.
- Objects larger than the S3 single-copy limit (5 GB) are re-keyed with a
  **multipart copy**, not a failure.
- A folder/file name is **unique within its parent**, because the key path is
  only unique under that condition.

## 3. Non-goals

- **Migrating existing objects.** Legacy flat keys stay on S3 untouched; they
  are still recognised on sync (see §6.3). Only new uploads use the new scheme.
- **Empty folders surviving a database reset.** An empty folder has no object,
  so no key can encode it. Accepted.
- **Fixing the dev compose queue mode.** `docker-compose.yml` keeps
  `QUEUE_CONNECTION=sync`; the async path is exercised by
  `docker-compose.full.yml` (`database`). See §10.
- **Concurrent-sync-during-move.** See §10 (known limitation).

## 4. Key scheme

| Case | Legacy key | New key |
|---|---|---|
| File at root | `users/1/items/<uuid>-a.docx` | `users/1/a.docx` |
| File in `Tài liệu/2026` | `users/1/items/<uuid>-a.docx` | `users/1/Tài liệu/2026/a.docx` |
| Folder named `items` at root, file `a.txt` inside | — | `users/1/items/a.txt` |

**No object is created for a folder.** Folders remain database rows, derived
from key path segments on sync — exactly as `ScanBucket` does today for external
objects.

### 4.1 Building the key (uploads)

A new helper derives the folder path by walking the `parent_id` chain upward:

```go
// folderPath returns the "/"-joined ancestor folder names for parentID,
// root-first and excluding the drive root. "" for the root itself.
func (s *CloudDriveService) folderPath(ctx context.Context, userID, cloudAccountID uint, parentID *uint) (string, error)
```

The upload key becomes:

```go
rest := fileName
if fp != "" {
    rest = fp + "/" + fileName
}
storageKey := fmt.Sprintf("users/%d/%s", userID, rest)
```

Both `InitiatePresignedUpload` (`cloud_drive_service.go:523`) and
`InitiateMultipartUpload` (`:621`) currently build the key inline with the flat
form; both switch to this helper.

### 4.2 Collision with the legacy prefix

A user-created folder named `items` at the root produces keys
`users/<uid>/items/<name>`, which share a prefix with legacy keys
`users/<uid>/items/<uuid>-<name>`. Detection therefore cannot rely on the prefix
alone — see §6.3.

## 5. Name uniqueness and validation

The key `users/<uid>/<folder-path>/<name>` is unique only if no two items in the
same folder share a name. Uniqueness is therefore enforced **at the application
layer** in every flow that can introduce or change a name:

- create folder (`CreateFolder`)
- initiate presigned upload (`InitiatePresignedUpload`)
- initiate multipart upload (`InitiateMultipartUpload`)
- rename and move (`ValidateMove`, §8.3)

### 5.1 Uniqueness rule

- Scope: same `user_id`, same `cloud_account_id`, same `parent_id` (root =
  `parent_id IS NULL`).
- Compared across **both** files and folders: a file `a/b` and a folder `a/b`
  would otherwise collide on the key.
- Comparison is **case-sensitive**, matching S3 key semantics.
- On rename/move, the item itself is excluded from the check.
- Failure returns a user-facing error (new locale key `drive.name_conflict`),
  never internal text.

A shared helper:

```go
// EnsureUniqueName errors when another item in the same parent already uses
// name. excludeID (0 for create) lets rename/move ignore the item itself.
func (s *CloudDriveService) EnsureUniqueName(ctx context.Context, userID, cloudAccountID uint, parentID *uint, name string, excludeID uint) error
```

### 5.2 Name validation

A name must not break the key path. Reject names containing `/` or `\`, any
control character, or equal to `.` / `..`. Empty/whitespace-only names are
already rejected by `required` on create; rename treats empty as "no change".

A shared helper, called from the same flows:

```go
// ValidateItemName rejects names that would corrupt the storage key path.
func ValidateItemName(name string) error
```

`max_len:255` stays in the request validators. The rule is enforced in the
service (one place) rather than duplicated as a Goravel custom rule.

### 5.3 Known limitation

At the drive root, `parent_id` is `NULL` and MySQL permits many `NULL`s in a
unique index, so a database-level unique constraint cannot cover the root.
Uniqueness is application-enforced there; a race between two simultaneous
uploads of the same name at the root is possible. Documented, not fixed.

## 6. Sync (`ScanBucket`)

`ScanBucket` (`cloud_drive_service.go:850`) currently branches on
`internalUploadPrefix(userID)`. It becomes a three-way branch on the key shape.

### 6.1 The three shapes

For a key (leading `/` stripped):

1. **Legacy** — starts with `users/<uid>/items/` **and** the basename matches
   `^[0-9a-fA-F]{8}-...-` (the uuid prefix). Recover the real name with the
   existing `internalUploadRealName`; never derive `items` as a folder.
2. **New** — starts with `users/<uid>/` (and is not legacy). Strip the
   `users/<uid>/` prefix; the remainder is the real path.
3. **External** — anything else. Derive from the whole key, as today.

### 6.2 Refactor: one path-materialiser

The folder-derivation loop in the `else` branch (lines ~973–1051) is extracted
into a helper taking a segment slice and a starting parent, so shapes 2 and 3
share it:

```go
// materializePath ensures every intermediate folder exists and upserts the
// trailing file, starting from parentID. It also handles a directory marker
// (a trailing "/" with no file name), creating folders only. This is the
// existing derivation loop from the ScanBucket else-branch, extracted.
func (s *CloudDriveService) materializePath(ctx context.Context, userID, cloudAccountID uint, parentID *uint, segments []string, obj contracts.ObjectMetadata) (created bool, err error)
```

Shape 2 calls it with `segments` from the stripped key; shape 3 with `segments`
from the whole key.

### 6.3 Why legacy detection needs the uuid pattern

Because of the `items` collision (§4.2), a key `users/1/items/a.txt` (new scheme,
folder literally named `items`) must **not** be treated as legacy. Requiring the
basename to match the uuid-prefix pattern distinguishes the two: a legacy key
always has `<uuid>-<name>`, a new-scheme key has a plain name.

Residual edge case: a **new-scheme** file whose own name starts with a uuid and
dash, inside a folder named `items` at the root, is misread as legacy. This is
vanishingly rare and documented, not handled.

### 6.4 Tracked rows remain authoritative

For a key whose `storage_path` is already tracked by a `drive_items` row, sync
refreshes only S3-owned metadata (size, etag, status) and keeps the row's
`parent_id` — unchanged from today. The path-derivation only runs for untracked
keys (post-reset recovery).

## 7. Copy engine

Re-keying needs a server-side copy. `contracts.CloudDriver` has none today.

### 7.1 New interface method

```go
// CopyObject copies srcKey to dstKey server-side. Objects larger than the S3
// single-copy limit (5 GiB) are copied with a multipart copy.
CopyObject(ctx context.Context, srcKey, dstKey string) error
```

The size decision lives **inside** the implementation (it heads the source),
keeping the interface one call and the caller free of thresholds.

### 7.2 S3 implementation (`s3_driver.go`)

```go
const (
    s3SingleCopyLimit = 5 * 1024 * 1024 * 1024   // 5 GiB, S3 CopyObject ceiling
    s3CopyPartSize    = 1 * 1024 * 1024 * 1024   // 1 GiB per multipart copy part
)

func (d *S3Driver) CopyObject(ctx context.Context, srcKey, dstKey string) error {
    meta, err := d.GetMetadata(ctx, srcKey)
    if err != nil {
        return err
    }
    if meta.Size <= s3SingleCopyLimit {
        _, err = d.client.CopyObject(ctx, &s3.CopyObjectInput{
            Bucket:     aws.String(d.bucket),
            Key:        aws.String(dstKey),
            CopySource: aws.String(encodeCopySource(d.bucket, srcKey)),
        })
        return err
    }
    return d.multipartCopy(ctx, srcKey, dstKey, meta.Size)
}
```

`CopySource` is not auto-encoded by the SDK, so keys containing spaces or
non-ASCII (e.g. `Tài liệu`) must be URL-encoded per segment — a small
`encodeCopySource(bucket, key)` helper splits on `/`, `url.PathEscape`s each
segment, and rejoins with `/` (a whole-string `PathEscape` would wrongly escape
the separators).

`multipartCopy` uses `CreateMultipartUpload` → `UploadPartCopy` (each part a
`CopySourceRange`, except the last) → `CompleteMultipartUpload`, aborting on any
part failure. Part size 1 GiB keeps a 5 TiB object under the 10 000-part cap and
satisfies the 5 MiB minimum.

## 8. Re-key on rename / move (asynchronous)

### 8.1 Decision: copy → update DB → delete old

Chosen over "update DB → copy → delete": if the copy fails, the database is
still untouched and still points at the old keys, so nothing is inconsistent.
The cost is that the item keeps its **old** name/location (with `status =
moving`) until the copy finishes — accepted.

### 8.2 New status

Add to `app/models/drive_item.go`:

```go
ItemStatusMoving = "moving"
```

`status` is `size:20`; `"moving"` fits. No migration needed.

### 8.3 Controller flow (`DriveItemController.Update`)

The validation currently baked into `UpdateItem` (`:269` — destination exists,
is a folder, same account, cycle guard) must run **synchronously**, before the
job is dispatched, so the user gets an immediate 4xx. `UpdateItem` today both
validates and writes; it is split:

```go
// ValidateMove resolves and checks the destination (exists, is a folder, same
// account, no cycle) and the new name (valid, unique). It writes nothing.
func (s *CloudDriveService) ValidateMove(ctx context.Context, userID uint, itemUUID string, newName string, newParentID *uint) (*models.DriveItem, error)

// ApplyMove performs the database-only part of a move (name, parent_id, status)
// after the object(s) have been re-keyed.
func (s *CloudDriveService) ApplyMove(ctx context.Context, userID uint, itemUUID string, newName string, newParentID *uint) (*models.DriveItem, error)
```

`UpdateItem` is retained as `ValidateMove` + `ApplyMove` for any caller that
still needs a synchronous, same-key update; the controller uses the two
directly.

Controller flow:

1. Validate the request (`UpdateDriveItemRequest`, unchanged).
2. Resolve the destination `parentID` from `parent_uuid` (unchanged).
3. `ValidateMove(...)` — destination checks, cycle guard, `ValidateItemName`,
   `EnsureUniqueName`. Any failure returns a 4xx immediately.
4. Reject if the item is already `moving` (a second move while one runs).
5. Set `status = moving`; dispatch `RekeyDriveItemJob{userID, itemUUID, newName,
   newParentID}`.
6. Return the item (now `moving`) with `200`.

With the `sync` driver the job runs inline and the response already carries the
settled state; with `database` it carries `moving` and the client polls.

### 8.4 Job (`app/jobs/rekey_drive_item_job.go`)

Registered in `bootstrap/jobs.go`. Args: `userID uint`, `itemUUID string`,
`newName string`, `newParentID *uint` (following the `SyncS3BucketJob` arg
pattern).

**File:**
1. Load the item (still holding old name/parent/`storage_path`).
2. Compute `newKey = users/<uid>/<newFolderPath>/<newName>`.
3. `CopyObject(oldKey, newKey)`.
4. Update the row: `name`, `parent_id`, `storage_path = newKey`, `status =
   ready`; save.
5. `Delete(oldKey)`.

**Folder:**
1. `CollectDescendantItems` (existing, `:444`) → all descendants + keys.
2. For every descendant **file**, compute its new key from its **own** name and
   its new folder path (the destination folder path plus the file's own ancestor
   folders *within* the moved subtree). It is **not** a prefix substitution on
   the old key: a descendant may still carry a legacy flat key
   (`users/<uid>/items/<uuid>-<name>`), which shares no prefix with its siblings
   under the new scheme.
3. `CopyObject` each.
4. Update every descendant file's `storage_path`; update the folder's own
   `name`/`parent_id`; set the folder and files to `ready`; save.
5. `DeleteObjects(oldKeys)` (existing batch delete) with the files' **old**
   keys.

**Side effect — incidental migration:** moving or renaming a file (or a folder
holding files) that still has a legacy flat key rewrites it to the new scheme.
This is correct and desirable — it is the only migration in this spec, and it
happens only for objects the user actively moves.

**Failure handling:** on any error, delete the new keys already copied (best
effort), leave the database row at its **old** location (old `name`,
`parent_id`, `storage_path` — all unchanged), set `status = failed`, log the
cause, and record a `move_failed` activity. The item is intact and still
downloadable at its old location.

**Idempotency:** a retry re-copies (overwrite is idempotent) and re-deletes
(idempotent). Partial copies from a crashed run are overwritten on retry.

### 8.5 Success/failure signal to the client

The item's `status` is the signal:

- `moving` — re-key in flight.
- `ready` — re-key succeeded; the row now holds the new name/location.
- `failed` — re-key failed; the row still holds the **old** name/location, so
  the item is safe and the client shows the failure toast.

This avoids needing to compare parents client-side (the API is UUID-only and the
item response carries no `parent_id`). A later successful move sets the status
back to `ready`. `ItemStatusFailed` already exists and is reused.

**Note on the dashboard:** `dashboard_service.go` selects suggested files with
`status = ready`, so an item left at `failed` is temporarily omitted from the
dashboard's starred/recent suggestions. It stays fully visible and downloadable
in the drive listing (`ListItems` does not filter by status), and a subsequent
successful move returns it to `ready`.

## 9. Frontend

### 9.1 API — `src/api/driveItems.ts`

Add the missing single-item fetch (the backend `Show` already exists):

```ts
export async function getDriveItem(uuid: string): Promise<ApiResponse<DriveItem>> {
  return fetchApi<ApiResponse<DriveItem>>(`/v1/drive/items/${encodeURIComponent(uuid)}`)
}
```

### 9.2 Store — `src/stores/driveItems.ts`

`rename` and `move` gain a bounded poll (reusing the pattern from
`stores/cloudAccounts.ts:pollUntilSettled`):

```ts
const MOVE_POLL_INTERVAL_MS = 2000
const MOVE_POLL_MAX_ATTEMPTS = 30   // ~60s bound
```

Flow for both: call the PATCH, then poll `getDriveItem(uuid)` until
`status !== 'moving'` or the attempt bound is hit; then reconcile the local list
and decide success from the settled `status` (§8.5): `ready` → success toast,
`failed` (or a bound hit) → failure toast. On the `sync` driver the first check
already sees the settled item.

`move` today unconditionally removes the item from the listed folder (the item
left this view). That stays correct **only on success**: on `failed` the item
never left its old folder, so it must remain in the list (with an error toast).
The store therefore removes it only when the settled `status` is `ready`.

### 9.3 Dialogs

`RenameDialog.vue` and `MoveDialog.vue` already `await` the store call; they now
await the poll. Show a pending/disabled state on the confirm button while the
move runs (the item may be a large folder), then the existing success toast, or
the failure toast on a non-settled/unchanged result.

### 9.4 i18n — `vi.json` / `en.json`

| key | vi | en |
|-----|----|----|
| `drive.name_conflict` | Tên đã tồn tại trong thư mục này. | A file or folder with this name already exists here. |
| `drive.name_invalid` | Tên không hợp lệ. | Invalid name. |
| `drive.moving` | Đang di chuyển... | Moving... |
| `drive.move_failed` | Di chuyển thất bại. Vui lòng thử lại. | Move failed. Please try again. |

## 10. Known limitations

- **Empty folders** do not survive a database reset (no object → no key).
- **Legacy objects** are never re-keyed; a reset restores them at the scan root
  with their recovered name.
- **Concurrent sync during a move:** `ScanBucket` can see the freshly copied new
  keys before the database is updated and materialise duplicate rows. Rare
  (a move must overlap a manual sync); documented, not fixed.
- **Root-level name uniqueness** is application-enforced only (§5.3).
- **Dev compose** (`QUEUE_CONNECTION=sync`) runs the job inline, so a large
  folder move can still block the dev request. Production
  (`docker-compose.full.yml`, `database`) does not.

## 11. Testing

**Backend unit** (`app/services/*_test.go`):
- `folderPath` builds `A/B/C` and `""` for root.
- key building for root and nested folders.
- legacy vs new vs external classification (§6.1), incl. the `items`-folder case.
- `ValidateItemName` rejects `/`, `\`, control chars, `.`, `..`.

**Backend feature** (`tests/feature/`):
- presigned + multipart upload write the new key shape.
- create folder with a duplicate name → 422; upload with a duplicate name → 422.
- rename re-keys the object (new key present, old key gone) and updates the row.
- move a file re-keys it; move a folder re-keys every descendant.
- `ScanBucket` after a DB reset reconstructs the **folder tree and placement**
  from new-scheme keys (extends `TestSyncRecoversUploadedNameAfterDatabaseReset`).
- legacy keys still recover the plain name and never materialise `items`.
- a new-scheme file inside a folder named `items` is placed under that folder,
  not treated as legacy.

**Frontend** (`driveItems.spec.ts`, dialog specs):
- `getDriveItem` GETs the item endpoint.
- `rename`/`move` poll until `status !== 'moving'` and resolve.
- dialogs show the pending state and the correct toast.

## 12. Global Constraints (inherited)

- Never touch `frontend/src/components/ui/*`.
- Never expose internal system/DB/SDK errors to clients; user-facing failures go
  through the localized `failResponse` path.
- UUID-only API contract.
- Technical writing (code, identifiers, commits) in English; user-facing strings
  localized in `vi.json` / `en.json`.
- No Docker on the development machine: Docker-dependent verification is
  static (registry/config inspection) and runtime checks are deferred.
- `backend/.env` holds real credentials and is never committed or printed.
- Backend checks: `go build ./...`, `go test ./...`. Frontend: `npm run
  test:run`, `npm run type-check`, `npx oxlint .`, `npx eslint .`.

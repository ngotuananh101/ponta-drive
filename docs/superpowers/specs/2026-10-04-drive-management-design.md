# Drive file & folder management — Design

Date: 2026-10-04
Status: Draft for review

## 1. Problem

The drive page lists items but does nothing with them. Every action in the UI is a
dead end:

- The header "Mới" menu and the sidebar "Mới" menu render `new_folder`,
  `upload_file`, `upload_folder` items with **no `@click` handler**
  (`DriveView.vue` lines 205-213, `DashboardLayout.vue` lines 227-239).
- The list row kebab renders download / share / star / rename / delete items with
  **no `@click` handler** (`DriveView.vue` lines 371-391).
- The grid kebab is a bare `<Button @click.stop>` with **no dropdown at all**
  (`DriveView.vue` lines 440-447 and 473-480).

The backend, by contrast, already exposes almost everything needed. So this work
is mostly frontend: wire the UI to endpoints that exist, and add the one backend
capability that is missing — deleting a folder together with its contents.

Scope for this round (confirmed with the user): **upload (file & folder), rename,
delete, star, download**. Share is explicitly **not** in this round.

## 2. Goals / non-goals

Goals:
- Create a folder.
- Upload one or more files, and a folder tree, into the current directory.
- Rename a file or folder.
- Delete a file or folder, **permanently** (no trash), deleting a folder's
  contents with it.
- Star / unstar an item.
- Download a file.
- The upload flow must let the **user choose the method** — direct (presigned,
  browser→S3) or via the server (multipart, browser→API→S3) — rather than
  choosing by file size behind the user's back.

Non-goals (this round):
- Share / permissions / public links.
- Move an item to another folder (the API supports it; no UI is built now).
- Trash / restore. Delete is permanent.
- Folder download (zip). Only single-file download is wired.
- Search, sort and paging behaviour are unchanged.

## 3. Evidence (what was verified)

Backend:
- Routes (`routes/web.go`): items `Index`, `StoreFolder`, `Show`, `Breadcrumb`,
  `Download`, `Update` (PATCH), `Star` (POST), `Destroy` (DELETE); upload
  `presigned`, `presigned/complete`, `multipart/{init,part,complete,abort}`.
- `CloudDriveService.DeleteItem` deletes **one** row: it optionally deletes the
  single S3 object for a file, then `ForceDelete`s the row. It does **not** touch
  children and does **not** decrement `used_storage`.
- Upload storage keys are **flat**:
  `fmt.Sprintf("users/%d/items/%s-%s", userID, uuid, fileName)` (both
  `InitiatePresignedUpload` and `InitiateMultipartUpload`). A child file is
  therefore **not** under its parent folder's key prefix, so a prefix-based S3
  delete would miss it. The only reliable tree is the DB `ParentID` chain.
- `contracts.CloudDriver` has no batch delete; `S3Driver.Delete` is a single
  `DeleteObject`. S3 `DeleteObjects` deletes up to **1000** keys per request.
- `used_storage` is **incremented** on `CompletePresignedUpload` and
  `CompleteMultipartUpload`, and **recomputed** on `ScanBucket`; nothing ever
  decrements it.
- `CreateFolderRequest` / `UpdateDriveItemRequest` already speak
  `cloud_account_uuid` / `parent_uuid`; the upload requests already speak uuids.
- `models.DriveItem` uses `orm.SoftDeletes`; `Destroy` reads
  `?permanent=` (default `false`).
- Errors already follow the standing rule: internal errors go to the log only;
  the client gets a localized message via `failResponse`.

Frontend:
- `src/api/driveItems.ts` has only `listDriveItems` + `getDriveItemBreadcrumb`.
- `src/api/client.ts` `fetchApi` hardcodes `Content-Type: application/json` and
  always `response.json()`. A `FormData` body cannot drop that header through the
  current `options.headers` spread, and raw bodies (direct S3 PUT) would be
  mislabelled. `fetch` also cannot report upload progress.
- `src/stores/driveItems.ts` owns `items` (with `requestId` + `AbortController`
  guards) and `breadcrumb`, but has **no** mutation actions.
- `drive.*` i18n keys for the five actions already exist; dialog and upload keys
  do not.
- The sidebar (`DashboardLayout.vue`) has the "Mới" menu but **no drive/folder
  context** (it only knows `route.name`), so it cannot itself open a dialog that
  needs the current account/folder uuids.

## 4. Decisions

1. **Recursive delete lives in the service, over the DB tree.** `DeleteItem`
   becomes recursive for folders: walk `ParentID`, collect every descendant
   file's `StoragePath` plus the folder rows, batch-delete the S3 objects, then
   `ForceDelete` the rows. Prefix-based S3 listing is rejected because upload
   keys are flat (see §3).
2. **Add `DeleteObjects(ctx, keys []string) error` to `CloudDriver`** (and
   `S3Driver`, using `s3.DeleteObjects`, chunked at 1000 keys). This is the only
   backend interface change.
3. **Permanent delete decrements `used_storage`** by the summed size of the
   deleted files (user approved). Soft delete (not used by the UI this round)
   leaves it alone.
4. **Upload method is a user choice**, presented as an explicit step in the
   upload dialog (user requirement). Direct = presigned PUT straight to S3;
   server = multipart streamed through the API. Neither is auto-selected by size.
5. **Sidebar wiring via a tiny `driveActions` store** (user approved). The
   sidebar only *requests* an intent (`new-folder` / `upload-file` /
   `upload-folder`); `DriveView`, which holds the account/folder context, watches
   the store and opens the matching dialog. This keeps the layout free of drive
   data while the "Mới" menu keeps working from the sidebar.
6. **Delete is always permanent** from the UI (`?permanent=true`); the
   confirmation says so and warns when the target is a folder.
7. **Share is removed from the row menu** for this round rather than left as a
   dead item.

## 5. Backend design

### 5.1 Batch delete on the driver

`contracts/storage.go`:
```go
DeleteObjects(ctx context.Context, keys []string) error
```

`s3_driver.go`: split `keys` into chunks of 1000 and issue one
`s3.DeleteObjects` per chunk (`Delete` → `Objects: []types.ObjectIdentifier`).
An empty slice is a no-op returning `nil`. S3's per-key `Errors` array in the
response is inspected: if any key failed, return an error naming the count (the
raw AWS error is logged, never returned to the client — §5.5).

### 5.2 Recursive delete in the service

`CloudDriveService.DeleteItem(ctx, userID, itemUUID, permanent)`:
- Load the item (ownership already enforced by `GetItemByUUID`).
- **File:** unchanged single-object path, plus (new) capture `item.Size` for the
  storage decrement.
- **Folder:** collect the subtree by BFS over `ParentID` scoped to the same
  `user_id` and `cloud_account_id`, bounded by a visited set (the same guard
  `GetBreadcrumb` uses, so a corrupt cycle cannot loop). Gather:
  - every descendant file's `StoragePath` (non-empty),
  - every row's id (for the delete),
  - the summed `Size` of descendant files.
- If `permanent`:
  - resolve the driver once and `DeleteObjects(ctx, keys)` for all collected
    keys (skipped when the key list is empty);
  - `ForceDelete` all collected rows in one statement
    (`Where("id IN (...)")`, folder row included);
  - decrement `account.UsedStorage` by the summed size, floored at 0.
- If not `permanent` (kept for API completeness; the UI never sends it):
  soft-delete the folder row only, as today. Recursive soft-delete is out of
  scope.

S3 failure on a permanent delete is logged and the row delete proceeds (the row
is the source of truth; an orphaned object is a smaller problem than a row that
cannot be removed and would be re-scanned). This mirrors the existing
`DeleteItem` behaviour of ignoring the driver error.

### 5.3 Storage key helper

Add a small `collectDescendantFiles` (or equivalent) helper so the recursive walk
is unit-testable without S3.

### 5.4 Controller

`DriveItemController.Destroy` is already correct; it keeps logging
`deleted` / `permanently_deleted`. No change beyond what the service now does.

### 5.5 Error handling

Unchanged rule: driver/DB errors are logged to `storage/logs/goravel-*.log` only;
the client receives a localized message (`drive.delete_failed`,
`drive.create_failed`, `upload.*`). A batch-delete failure surfaces to the client
as `drive.delete_failed`, never as an AWS error string.

### 5.6 Testing (backend)

- `DeleteObjects` chunking: 0 keys → no call; 1001 keys → 2 calls (fake client).
- Recursive delete: a folder with nested folders and files removes every row and
  calls `DeleteObjects` with every file's key.
- A file-only delete still removes exactly one object and one row.
- `used_storage` drops by the summed file sizes and never goes below 0.
- Deleting a folder in account A does not touch a same-named folder in account B
  or another user's tree.
- Unknown uuid → localized 404, no internal text (extends the existing leak
  tests).

## 6. Frontend design

### 6.1 API layer

`src/api/driveItems.ts` gains:
- `createDriveFolder({ cloudAccountUuid, parentUuid, name })` →
  `POST /v1/drive/items/folders`.
- `renameDriveItem(uuid, name)` → `PATCH /v1/drive/items/{uuid}`.
- `deleteDriveItem(uuid, permanent)` →
  `DELETE /v1/drive/items/{uuid}?permanent=<bool>`.
- `toggleStarDriveItem(uuid)` → `POST /v1/drive/items/{uuid}/star`.
- `getDriveItemDownloadUrl(uuid)` →
  `GET /v1/drive/items/{uuid}/download?mode=json` (returns `download_url`).

A new `src/api/upload.ts` owns the two upload flows and a raw request helper:
- `presignUpload(...)`, `completePresignedUpload(itemUuid)`.
- `initMultipart(...)`, `uploadPart(sessionId, partNumber, blob)`,
  `completeMultipart(sessionId)`, `abortMultipart(sessionId)`.
- Because `fetchApi` cannot carry `FormData` or report progress, uploads use a
  small `XMLHttpRequest`-based helper that sets only the auth + locale headers
  (letting the browser set the multipart boundary) and emits `progress` events.
  Non-upload JSON calls keep using `fetchApi`.

### 6.2 Store mutations

`src/stores/driveItems.ts` gains actions that mutate `items` in place so the UI
updates without a full reload:
- `createFolder(query, name)` → insert the returned folder at the front (the list
  is folders-first).
- `rename(uuid, name)` → replace the row.
- `remove(uuid, permanent)` → drop the row (descendants are never in the current
  page, since the list is per-folder).
- `toggleStar(uuid)` → replace the row with the server's response.
- `insertItem(item)` → used by the upload flow to add a finished upload.

The `requestId` / abort guards are untouched; mutations are plain optimistic
updates applied only on success.

### 6.3 Dialogs and the shared row menu

New components under `src/components/drive/`:
- `NewFolderDialog.vue` — name input, create/cancel.
- `RenameDialog.vue` — name input prefilled with the current name.
- `DeleteDriveItemDialog.vue` — confirmation; always permanent; shows an extra
  warning line when the target is a folder ("contents will also be deleted").
- `UploadDialog.vue` — the upload surface (see §6.4).
- `DriveItemMenu.vue` — one dropdown used by **both** list and grid rows, with
  four actions: download, star/unstar, rename, delete. Download and star are
  performed inline through the store; rename and delete are emitted so the view
  can open the matching dialog (dialogs need view-owned state). Share is omitted
  (§4.7).

`DriveView.vue` renders `DriveItemMenu` in the list rows and in **both** grid
sections (folders and files), replacing the current dead menu / bare button, and
owns the dialog instances plus the `NewFolderDialog` / `RenameDialog` /
`DeleteDriveItemDialog` open state.

### 6.4 Upload flow (method is a user choice)

`UploadDialog.vue` is a small state machine:
1. **Select** — files are chosen via a file input, a folder input
   (`webkitdirectory`), or drag-and-drop onto the list area. Dropped/chosen
   `File` objects are captured with their `webkitRelativePath` (empty for a flat
   selection).
2. **Method** — a segmented choice the user must make before uploading:
   - *Direct (browser → S3)*: presign, then `PUT` the file to the returned URL
     with the returned headers.
   - *Via server (browser → API → S3)*: init multipart, upload chunks, complete.
   No size-based auto-selection.
3. **Progress** — one row per file with a percentage (from the XHR `progress`
   event) and a cancel that aborts the request and, for multipart, calls
   `abortMultipart`.
4. **Done** — finished items are inserted into the store; the account store is
   refreshed so the sidebar storage figure moves.

`useUpload.ts` (composable) holds the per-file upload logic for both methods and
is independent of the dialog, so it can be unit-tested with a mocked XHR.

**Folder upload:** for a selection with `webkitRelativePath`, the directories are
created first (`createFolder`, reusing an existing same-named folder in the
current parent when present, tracking newly created uuids for nesting), then each
file is uploaded into its target folder.

### 6.5 Sidebar wiring (`driveActions` store)

`src/stores/driveActions.ts`:
- `pending: ref<{ type: 'new-folder' | 'upload-file' | 'upload-folder'; nonce: number } | null>`
- `request(type)` sets `pending` (with a fresh nonce so repeating the same action
  re-triggers the watcher) and `consume()` clears it.

`DashboardLayout.vue`'s "Mới" menu items call `driveActions.request(...)`.
`DriveView.vue` watches `pending`; on a new intent it opens the matching dialog
(`new-folder` → `NewFolderDialog`, `upload-file` → `UploadDialog` in file mode,
`upload-folder` → `UploadDialog` in folder mode) and calls `consume()`.

### 6.6 i18n

Add `drive.*` keys for: dialog titles and labels (`new_folder_title`,
`rename_title`, `delete_item_title`, `delete_item_message`, `delete_folder_warning`,
`delete_permanent_note`), upload (`upload_title`, `upload_method_label`,
`upload_method_direct`, `upload_method_direct_hint`, `upload_method_server`,
`upload_method_server_hint`, `upload_select_files`, `upload_drop_hint`,
`upload_progress`, `upload_cancel`, `upload_start`, `upload_failed`), and toast
strings (`created_folder`, `renamed`, `deleted`, `starred`, `unstarred`,
`uploaded`). Reuse `common.cancel` / `common.retry` where they exist. Both `vi`
and `en` are updated.

### 6.7 Testing (frontend)

- API builders: query/path shapes for each new call.
- Store mutations: create inserts folders-first, rename replaces, remove drops,
  star replaces.
- `useUpload`: direct flow issues presign → PUT → complete; server flow issues
  init → parts → complete; a failing part aborts; progress events update state.
- `DriveItemMenu`: renders the four actions; star/download call the store; rename
  and delete emit.
- `DeleteDriveItemDialog`: names the item; folder shows the extra warning; confirm
  calls `deleteDriveItem(uuid, true)`.
- `NewFolderDialog` / `RenameDialog`: validation, submit, and prefill (rename).
- `driveActions`: sidebar `request()` causes `DriveView` to open the matching
  dialog.
- `UploadDialog`: the method step is required before upload starts.

## 7. Migration / rollout

- Backend and frontend deploy together (the frontend depends on the new delete
  semantics only for folders; the new endpoints are additive).
- No DB migration: the recursive delete uses existing columns; `used_storage` is
  an existing column.
- **Bucket CORS**: direct (presigned) uploads require the bucket to allow `PUT`
  from `https://drive.ponta.dev` (and the dev origin). Without it the direct
  method fails with a browser CORS error; the server method is unaffected. This
  is a configuration step, not a code change, and is called out here so it is not
  forgotten.

## 8. Risks

- **Orphaned S3 objects on a failed batch delete.** Mitigated by logging and
  proceeding with the row delete; `ScanBucket` would re-surface an object that
  still exists, which is acceptable and visible.
- **Stale `uploading` rows.** The presigned flow creates a row before the PUT; an
  abandoned upload leaves an `uploading` row. Not cleaned up this round (noted,
  not solved) — a later sweep can delete stale `uploading` rows.
- **Progress without `fetch`.** Upload progress needs XHR; the helper is isolated
  in `src/api/upload.ts` so the JSON path stays on `fetch`.
- **Large folder delete.** One folder with many files issues one `DeleteObjects`
  per 1000 keys; acceptable, and bounded by the tree size.
- **Docs location.** This spec sits under the repo-root `docs/`, which is not a
  git repository (only `backend/` and `frontend/` are), so it is not committed.

## 9. Resolved decisions

- Delete is permanent from the UI; soft delete stays available on the API but is
  unused.
- Folder delete is recursive and decrements `used_storage` by the summed file
  sizes (user approved).
- Upload method is an explicit user choice, never size-based (user requirement).
- Sidebar "Mới" wiring goes through a small `driveActions` store (user approved).
- Share is dropped from the row menu this round.
- Direct upload needs a bucket CORS rule for `PUT` (documented in §7).

No open questions remain.

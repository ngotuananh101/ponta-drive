# Move File & Folder — Design Spec

**Date:** 2026-10-06
**Status:** Approved (bounded scope, extension of the drive-management feature)
**Related:** `docs/superpowers/specs/2026-10-04-drive-management-design.md` (which explicitly listed "Move an item to another folder" as a non-goal: *"the API supports it; no UI is built now"*). This spec closes that gap.

## 1. Purpose

Add the ability to move a file or folder to another folder in the drive, from the UI. The backend `PATCH /v1/drive/items/{uuid}` endpoint already accepts a `parent_uuid`, but (a) the frontend exposes no way to send it and (b) the backend `UpdateItem` service has two correctness gaps that make it unsafe as a move primitive.

## 2. Goals

- A "Move" action in the item context menu (`DriveItemMenu.vue`) for both files and folders.
- A `MoveDialog.vue` that lets the user pick a destination folder by browsing the folder tree.
- A `moveDriveItem` frontend API function sending `parent_uuid` via PATCH.
- A `move` action in the `driveItems` store.
- Backend `UpdateItem` hardened with two guards: **cycle prevention** and **same-account destination**.
- Tests at every layer (backend feature tests, frontend API/store/component/menu).

## 3. Non-goals

- Drag-and-drop move. (Menu + dialog only.)
- Multi-select move. (Single item at a time.)
- Moving to "My Drive" root is in scope (destination = root, i.e. `parent_uuid` empty/null).
- Share, trash, folder download — unchanged from the prior spec.

## 4. Backend

### 4.1 Reused surface

`DriveItemController.Update` (`app/http/controllers/drive_item_controller.go:290`) already:
- validates via `UpdateDriveItemRequest` (`name` max 255, `parent_uuid` max 36),
- resolves `parent_uuid` → numeric id via `ResolveDriveItemID`,
- calls `CloudDriveService.UpdateItem(ctx, userID, itemUUID, name, parentID)`.

No new route, controller method, or request struct is needed.

### 4.2 Guard 1 — cycle prevention

Moving a folder into itself or into one of its own descendants would create a cycle in the `parent_id` tree, corrupting listing, breadcrumb, and recursive delete.

`UpdateItem` must, before saving, walk **up** from the destination (`newParentID`) through `parent_id`; if the item's own id is encountered, reject with an error. The walk is guarded by a visited set against any pre-existing cycle and capped by a max-depth bound. The check applies whenever the destination differs from the item's current parent; moving to root (`newParentID == nil`) can never cycle.

Existing guard `*newParentID == item.ID` (self-parent) is kept; the ancestor walk subsumes it but the explicit check is a cheaper first rejection.

### 4.3 Guard 2 — destination must belong to the same cloud account

Today the parent lookup filters only `user_id`. A `parent_uuid` from a *different* cloud account of the same user would be accepted, producing an item whose parent lives in another account. Add `Where("cloud_account_id", item.CloudAccountID)` to the parent lookup so the destination must be in the same account as the item being moved.

### 4.4 Error handling

All guard failures return a Go `error` from `UpdateItem`; the controller routes them through `failResponse(ctx, http.StatusBadRequest, "drive.update_failed", err)` — the raw error is logged server-side only and the client sees the localized `drive.update_failed` message. **No internal error text reaches the client.**

New localized keys (optional, for clarity) are NOT required — `drive.update_failed` already covers all move failures. (The service error strings stay English/internal.)

## 5. Frontend

### 5.1 API — `src/api/driveItems.ts`

```ts
export async function moveDriveItem(
  uuid: string,
  parentUuid: string | null,
): Promise<ApiResponse<DriveItem>> {
  return fetchApi<ApiResponse<DriveItem>>(`/v1/drive/items/${encodeURIComponent(uuid)}`, {
    method: 'PATCH',
    body: JSON.stringify({ parent_uuid: parentUuid ?? '' }),
  })
}
```

An empty string means "move to root" (matches the backend's `req.ParentUUID != ""` check).

### 5.2 Store — `src/stores/driveItems.ts`

```ts
async function move(uuid: string, parentUuid: string | null): Promise<DriveItem> {
  const res = await moveDriveItem(uuid, parentUuid)
  const updated = res.data as DriveItem
  // The item left the folder currently being listed.
  items.value = items.value.filter((i) => i.uuid !== uuid)
  return updated
}
```

Rationale: the listing shows the *current* folder. After a move the item no longer belongs here, so it is removed locally (the server response cannot be re-inserted without knowing the view's parent). This mirrors `remove`.

### 5.3 Menu — `src/components/drive/DriveItemMenu.vue`

- Add a "Move" item (lucide `FolderInput`) between rename and the separator.
- New emit: `move: [item: DriveItem]`.
- No download for folders (unchanged); move is available for both files and folders.

### 5.4 `MoveDialog.vue` (new)

- Props: `item: DriveItem | null`; `v-model:open`.
- Emits: `moved: [item: DriveItem]`.
- **Tree browser:** starts at the account root, lazily loads each folder's children via `listDriveItems({ cloudAccountUuid, parentUuid })`. Folders-only nodes (files are not valid destinations).
- **Disabled destinations:** the item itself and every descendant of it (when the item is a folder) cannot be selected — prevents the user from picking a cycle. Root ("My Drive") is always selectable.
- **Confirm:** calls `store.move(item.uuid, selectedParentUuid)`; on success `toast.success(t('drive.toast_moved'))`, close, emit `moved`. On failure use the established pattern: `console.error(e)` then `error.value = e instanceof ApiError ? e.message : t('drive.action_failed')`.
- Uses only existing shadcn-vue primitives (`Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `Button`). **`src/components/ui/*` is never edited.**

### 5.5 Wiring — `src/views/DriveView.vue`

- Import + mount `<MoveDialog v-model:open="isMoveOpen" :item="activeItem" />`.
- Add `isMoveOpen` ref and `openMove(item)` handler.
- Pass `@move="openMove"` to all three `<DriveItemMenu>` sites.

### 5.6 i18n — `vi.json` / `en.json`

New keys under `drive`:

| key | vi | en |
|-----|----|----|
| `action_move` | Di chuyển | Move |
| `move_title` | Di chuyển | Move |
| `move_select_destination` | Chọn thư mục đích | Choose destination folder |
| `move_here` | Di chuyển đến đây | Move here |
| `move_root` | Drive của tôi | My Drive |
| `move_empty` | Không có thư mục con | No subfolders |
| `toast_moved` | Đã di chuyển thành công. | Moved successfully. |

(`cancel_button` and `action_failed` already exist and are reused.)

## 6. Testing

- **Backend feature** (`tests/feature/drive_item_api_test.go`):
  - move a file into a folder → 200, item's parent updated (verified via listing).
  - move a folder into another folder → 200.
  - move a folder into its own descendant → 400, localized message, no raw error text.
  - move an item into a folder from a different cloud account → 400.
- **Frontend API** (`driveItems.spec.ts`): `moveDriveItem` PATCHes with `parent_uuid`; `null` → empty string.
- **Store** (`driveItems.spec.ts`): `move` calls the API and removes the item from `items`.
- **Menu** (`DriveItemMenu.spec.ts`): renders "Move"; emits `move` with the item.
- **Dialog** (`MoveDialog.spec.ts`): renders root; lazy-loads children; disables the item + descendants; confirm calls `store.move` and emits `moved`; non-`ApiError` → `drive.action_failed`; `ApiError` → backend message.

## 7. Global Constraints (inherited)

- Never touch `src/components/ui/*`.
- Never expose internal system/DB/SDK errors to clients.
- UUID-only API contract.
- Backend test DB: MariaDB `ponta_drive` on `localhost:3306`, user `ponta_drive`/`123123`.
- Frontend checks: `npm run test:run`, `npm run type-check`, `npx oxlint .` (exit 0), `npx eslint .` (only the 11 pre-existing errors).

# Upload selection preview and persistent progress panel — Design

Date: 2026-10-07
Status: Draft for review

## 1. Problem

The upload dialog (`src/components/drive/UploadDialog.vue`) has two usability
gaps, and the fix for the second one changes where upload state lives:

1. **No preview of the chosen files.** After picking files the dialog only shows
   a hardcoded English line `{{ selectedFiles.length }} file(s) selected`. The
   file names appear only *after* the user presses "Start upload", when the
   dialog swaps to a progress list. The user cannot confirm what they selected
   before committing.
2. **Progress is trapped in the dialog.** The upload queue lives in a
   component-local composable instance (`useUpload()` → `queue = ref([])` at
   `src/composables/useUpload.ts:37`). The dialog is mounted inside `DriveView`,
   so the queue is destroyed when the dialog unmounts, and the dialog never
   closes on Start anyway (`handleStart` at `UploadDialog.vue:80` does not set
   `open`). The user asked for Google-Drive behaviour: pressing Start closes the
   dialog, the upload continues in the background, and a progress panel stays
   pinned to the bottom-right across every screen.

## 2. Goals / non-goals

Goals:
- Show the selected files (name + size, removable) in the dialog before upload.
- Pressing "Start upload" closes the dialog immediately; the upload runs on.
- A floating progress panel at the bottom-right, mounted globally so it survives
  route navigation, showing per-file progress with cancel.
- A second upload batch appends to the panel instead of replacing the first.

Non-goals:
- No change to the upload API, the two upload methods, or the folder-tree
  recreation logic (the bodies of `uploadDirect` / `uploadServerMultipart` /
  the directory walk in `startUpload` are moved, not rewritten).
- No persistence across a full page reload (a browser refresh drops the queue,
  as it does today; the upload itself is server-side and completes regardless).
- No per-file retry button (out of scope; failures still surface in the panel).

## 3. Evidence (verified in this codebase)

- `src/composables/useUpload.ts:37` — `const queue = ref([])` is created **per
  call**; `useUpload()` is called only at `src/components/drive/UploadDialog.vue:44`
  (grep: one non-test call site). The dialog is rendered inside `DriveView`
  (`src/views/DriveView.vue:585`), so the queue dies with the dialog.
- `src/composables/useUpload.ts:151` — `queue.value = options.files.map(...)`
  **replaces** the queue on every `startUpload`; a second call orphans the first
  batch's items in the UI while it keeps running. `isUploading` is toggled
  independently per call (`:148`, `:233`).
- `src/components/drive/UploadDialog.vue:80-91` — `handleStart` awaits
  `startUpload` and emits `completed`; it never sets `open = false`. The only
  close path is Cancel (`:256`) guarded by `if (!isUploading.value)` (`:94`).
- `src/App.vue:8-9` — `<Toaster position="top-right" richColors />` then
  `<RouterView />`. This is the only global overlay mount and the only component
  that wraps **every** route (auth routes use `AuthLayout`, not
  `DashboardLayout`). `DashboardLayout` is a per-view wrapper
  (`HomeView.vue:306`, `DriveView.vue:245`), not a router layout, so a widget
  mounted there would vanish on the auth screens.
- `src/stores/driveItems.ts:104` — `insertItem(item)` already places a freshly
  created item into the current listing (folders first), called by
  `useUpload.ts:83`/`:133` on completion. The panel therefore does not need to
  refresh the listing.
- `src/components/drive/UploadDialog.vue:53-63` — the `open` watcher calls
  `clearQueue()` on open. Once the queue is global this would wipe a running
  background upload, so it must be removed.
- Store conventions: `src/stores/driveSearch.ts` and `src/stores/driveActions.ts`
  are setup-stores (`defineStore(name, () => { const x = ref(); ... return {...} })`)
  used as cross-component bridges — the exact shape this feature needs.
- Test setup: `vite.config.ts` uses `environment: 'happy-dom'`, `globals: true`,
  `setupFiles: ['./src/test/setup.ts']` (clears `localStorage` per test). No
  separate `vitest.config.ts`. Component specs use `createI18n` + `viLocale`.

## 4. Design

### 4.1 State moves to a Pinia store

New `src/stores/upload.ts` (`defineStore('upload', …)`) owns the queue and the
orchestration:

```
uploadQueue: Ref<UploadQueueItem[]>
isUploading: ComputedRef<boolean>   // derived, not a ref
startUpload(options: StartUploadOptions): Promise<DriveItem[]>
cancelItem(id: string): void
clearQueue(): void                   // removes every item from the panel
```

- `isUploading` becomes **derived**: `uploadQueue.some(i => i.status === 'pending' || i.status === 'uploading')`.
  This is what makes two batches safe — a naive `isUploading = false` at the end
  of batch A would wrongly clear the flag while batch B runs.
- `startUpload` **appends** the new batch's items (unique ids) instead of
  reassigning `queue.value`, and iterates only the batch's own items (capture the
  batch array locally; never `for (const q of queue.value)`).
- The directory-tree walk and both upload methods move verbatim from the
  composable; they keep reading `options.cloudAccountId` / `options.parentUuid`.
- `src/composables/useUpload.ts` is **deleted** (single call site, so no
  compatibility shim). `UploadQueueItem`, `UploadMethod`, `StartUploadOptions`
  move to the store module (re-exported for tests).

### 4.2 Dialog: preview the selection, close on Start

`src/components/drive/UploadDialog.vue`:

- When `selectedFiles.length > 0`, render a scrollable list (`max-h-40
  overflow-y-auto`) under the drop zone: each row is icon · name (`truncate`) ·
  `humanizeBytes(file.size)` · a ✕ button removing that one file. A small header
  reads "Đã chọn N tệp" with a "Xoá hết" button. This replaces the hardcoded
  `file(s) selected` line.
- `handleStart`: set `open.value = false` first, then `await store.startUpload({...})`
  — the dialog closes at once and the store keeps the upload alive after the
  component unmounts. `emit('completed')` is dropped (nothing consumed it; the
  panel is the feedback now).
- Remove the in-dialog progress block (current lines 217-252) and the
  queue-conditional footer button — the dialog is now only a picker.
- Remove `clearQueue()` from the `open` watcher (keep `selectedFiles.value = []`);
  clearing the global queue on open would kill a background upload.
- Remove `isUploading` usage from the dialog; Cancel closes unconditionally.

### 4.3 Global progress panel

New `src/components/upload/UploadProgressPanel.vue`, mounted in `src/App.vue`
right after `<Toaster>` (so it renders on every route, auth included).

- Fixed `bottom-6 right-6 z-50`, width ~`w-80`, card styling consistent with the
  existing surfaces. Hidden (`v-if`) when `uploadQueue.length === 0`.
- Header: upload icon, title "Đang tải lên", an "N/M" counter, a collapse
  chevron, and a close ✕ that is disabled while any item is still
  pending/uploading.
- Body (collapsible): one row per item — file icon, `truncate` name, a progress
  bar (`item.progress`%), the percent, and a status icon (spinner / check /
  alert) or a cancel ✕ while uploading — reusing the markup currently in the
  dialog's queue block (`UploadDialog.vue:219-251`).
- A "Xoá hết"/clear action once every item is settled.

### 4.4 Data flow

```
UploadDialog  --startUpload(files, method, cloudAccountId, parentUuid)-->  upload store
                                                                            |
   upload store (global)  --insertItem-->  driveItems store (existing listing update)
                          --fetch-->       cloudAccounts store (storage figures)
                                                                            |
UploadProgressPanel (mounted in App.vue)  <--reads uploadQueue / isUploading--
```

## 5. i18n

Add to `src/locales/vi.json` and `src/locales/en.json` under `drive`:

- `upload_selected_title` — "Đã chọn {count} tệp" / "Selected {count} file(s)"
- `upload_clear_files` — "Xoá hết" / "Clear all"
- `upload_remove_file` — aria-label "Xoá tệp" / "Remove file"
- `upload_panel_title` — "Đang tải lên" / "Uploading"
- `upload_panel_minimize` / `upload_panel_expand` — aria-labels
- `upload_panel_close` — "Đóng" / "Close"
- `upload_panel_items_count` — "{done}/{total}"
- `upload_panel_clear` — "Xoá hết" / "Clear all"

(Existing `upload_status_uploading/completed/failed` are reused.)

## 6. Testing

- `src/stores/__tests__/upload.spec.ts` (new, replacing `useUpload.spec.ts`):
  a second `startUpload` **appends** rather than replaces; `isUploading` is true
  while any item runs and false when all settle; the folder-tree test (moved
  verbatim) still passes; `cancelItem` aborts an in-flight item.
- `src/components/upload/__tests__/UploadProgressPanel.spec.ts` (new): mounts
  with a real Pinia; mixed-status items render the right icon/bar; cancel calls
  the store; the panel is absent when the queue is empty.
- `src/__tests__/App.spec.ts` (new): `App.vue` renders the panel at the global
  level with a stubbed `RouterView`.
- `src/components/drive/__tests__/UploadDialog.spec.ts` (updated): selecting
  files shows their names; removing one / clearing all updates the list; pressing
  Start flips `open` to false and calls the store; the dialog no longer clears
  the store queue on open.

## 7. Risks

- **Two batches racing on `isUploading`:** handled by deriving it from the queue,
  not toggling a ref — called out in §4.1 and pinned by a store test.
- **Queue cleared on dialog open:** the current watcher does this; removing it is
  required and easy to regress — pinned by a dialog test.
- **Panel on auth screens:** mounting in `App.vue` means it also renders on
  login/forgot/reset. It is hidden when the queue is empty, and a queue cannot
  exist before login, so this is benign.
- **Reload drops the panel:** accepted (non-goal); the server-side upload still
  finishes.

## 8. Rollout

Frontend-only, one repo. No API change, no migration. The composable is deleted
outright (single call site), so there is no dead code path.

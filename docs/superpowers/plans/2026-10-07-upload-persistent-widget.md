# Upload Selection Preview and Persistent Progress Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the chosen files inside the upload dialog before uploading, close the dialog the moment Start is pressed, and keep the upload running in a floating bottom-right panel that survives navigation.

**Architecture:** Upload state (queue + orchestration) moves out of the per-dialog composable into a Pinia setup-store (`src/stores/upload.ts`), so a globally-mounted panel can read it after the dialog unmounts. `isUploading` becomes a computed derived from the queue (not a toggled ref), and `startUpload` appends a batch instead of replacing the queue. A new `UploadProgressPanel.vue` is mounted in `App.vue` beside the existing `<Toaster>`, the only component that wraps every route.

**Tech Stack:** Vue 3.5, Pinia, vue-router, vue-i18n, shadcn-vue / reka-ui, Tailwind CSS v4, Vitest + happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-07-upload-persistent-widget-design.md`

## Global Constraints

- Frontend repo only: `D:\Source\ponta\ponta_drive\frontend`. Work on a feature branch off `main` (create `feat/upload-persistent-panel`).
- **Never modify** files under `src/components/ui/*` (shadcn-vue auto-generated).
- `noUncheckedIndexedAccess` is ON: an index access is `T | undefined` — write `arr[0]?.field`, never `arr[0].field`.
- Every user-facing string goes through `t('drive.…')`; add every new key to **both** `src/locales/vi.json` and `src/locales/en.json` under the `drive` object.
- Tests: Vitest + happy-dom, `globals: true`, setup file `src/test/setup.ts` clears `localStorage` per test. No separate `vitest.config.ts`.
- Pinia store style: setup-store — `defineStore('name', () => { const x = ref(); ...; return { x, ... } })` (see `src/stores/driveSearch.ts`).
- Commit messages in English; reply to the user in Vietnamese.
- Source code identifiers and comments in English.

## Review Focus

These are the failure modes the spec implies but no single happy-path test covers. Each is pinned by a test in the task named.

1. A second upload batch started while the first is still running must not clear `isUploading` nor drop the first batch's items (Task 1).
2. Opening the upload dialog while a background upload is running must NOT clear the running queue (Task 2).
3. The panel must render nothing when the queue is empty, so it stays invisible on auth screens (Task 3).
4. Cancelling an in-flight item from the panel must abort it and stop it completing (Task 1 + Task 3).
5. Pressing Start with nothing selected must be a no-op and must not close the dialog (Task 2).

---

### Task 1: Move upload state into a Pinia store

Move the queue and orchestration out of `src/composables/useUpload.ts` into a global store so the state outlives the dialog. Change `startUpload` to append, and derive `isUploading` from the queue.

**Files:**
- Create: `src/stores/upload.ts`
- Create: `src/stores/__tests__/upload.spec.ts`
- Delete: `src/composables/useUpload.ts`
- Delete: `src/composables/__tests__/useUpload.spec.ts`

**Interfaces:**
- Consumes: `@/api/upload`, `@/api/driveItems` (`createDriveFolder`), `@/stores/driveItems`, `@/stores/cloudAccounts` (all unchanged).
- Produces:
  - `export type UploadMethod = 'direct' | 'server'`
  - `export interface UploadQueueItem { id: string; file: File; relativePath?: string; progress: number; status: 'pending' | 'uploading' | 'completed' | 'failed' | 'aborted'; error?: string; abortController?: AbortController }`
  - `export interface StartUploadOptions { cloudAccountId: number; parentUuid?: string | null; files: File[]; method: UploadMethod; onItemCompleted?: (item: DriveItem) => void }`
  - `export const useUploadStore` exposing `uploadQueue: Ref<UploadQueueItem[]>`, `isUploading: ComputedRef<boolean>`, `startUpload(options: StartUploadOptions): Promise<DriveItem[]>`, `cancelItem(id: string): void`, `clearQueue(): void`.

- [ ] **Step 1: Write the failing test**

Create `src/stores/__tests__/upload.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUploadStore } from '../upload'
import * as uploadApi from '@/api/upload'
import * as driveItemsApi from '@/api/driveItems'
import { useDriveItemsStore } from '@/stores/driveItems'
import type { DriveItem } from '@/api/driveItems'

const mockItem: DriveItem = {
  uuid: 'uploaded-1',
  name: 'file.txt',
  type: 'file',
  mime_type: 'text/plain',
  size: 100,
  extension: 'txt',
  cloud_account_id: 1,
  is_starred: false,
  status: 'ready',
  updated_at: '2026-10-04 00:00:00',
}

function mockPresignedInit() {
  return vi.spyOn(uploadApi, 'initiatePresignedUpload').mockResolvedValue({
    status: 'ok',
    data: {
      item_uuid: 'item-1',
      upload_url: 'https://s3.example.com/put',
      method: 'PUT',
      headers: {},
      expires_at: '',
      item: mockItem,
    },
  })
}

describe('upload store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('runs the direct upload flow', async () => {
    const initSpy = mockPresignedInit()
    const directSpy = vi.spyOn(uploadApi, 'uploadDirectToS3').mockResolvedValue()
    const compSpy = vi.spyOn(uploadApi, 'completePresignedUpload').mockResolvedValue({
      status: 'ok',
      data: mockItem,
    })

    const store = useUploadStore()
    const file = new File(['content'], 'test.txt', { type: 'text/plain' })

    const res = await store.startUpload({
      cloudAccountId: 1,
      parentUuid: null,
      files: [file],
      method: 'direct',
    })

    expect(initSpy).toHaveBeenCalled()
    expect(directSpy).toHaveBeenCalled()
    expect(compSpy).toHaveBeenCalledWith('item-1')
    expect(res).toHaveLength(1)
    expect(store.uploadQueue[0]?.status).toBe('completed')
    expect(store.uploadQueue[0]?.progress).toBe(100)
  })

  it('runs the server multipart upload flow', async () => {
    const initSpy = vi.spyOn(uploadApi, 'initiateMultipartUpload').mockResolvedValue({
      status: 'ok',
      data: {
        session_id: 'session-1',
        upload_id: 'upload-1',
        total_parts: 1,
        chunk_size: 5 * 1024 * 1024,
        storage_path: 'path/to/file',
      },
    })
    const chunkSpy = vi.spyOn(uploadApi, 'uploadMultipartChunk').mockResolvedValue()
    const compSpy = vi.spyOn(uploadApi, 'completeMultipartUpload').mockResolvedValue({
      status: 'ok',
      data: mockItem,
    })
    vi.spyOn(uploadApi, 'abortMultipartUpload').mockResolvedValue({ status: 'ok' })

    const store = useUploadStore()
    const file = new File(['content'], 'test.txt', { type: 'text/plain' })

    const res = await store.startUpload({
      cloudAccountId: 1,
      parentUuid: null,
      files: [file],
      method: 'server',
    })

    expect(initSpy).toHaveBeenCalled()
    expect(chunkSpy).toHaveBeenCalledTimes(1)
    expect(compSpy).toHaveBeenCalledWith('session-1')
    expect(res).toHaveLength(1)
    expect(store.uploadQueue[0]?.status).toBe('completed')
  })

  it('aborts a server multipart upload mid-chunk and calls abortMultipartUpload', async () => {
    const initSpy = vi.spyOn(uploadApi, 'initiateMultipartUpload').mockResolvedValue({
      status: 'ok',
      data: {
        session_id: 'session-1',
        upload_id: 'upload-1',
        total_parts: 3,
        chunk_size: 5 * 1024 * 1024,
        storage_path: 'path/to/file',
      },
    })
    const abortSpy = vi.spyOn(uploadApi, 'abortMultipartUpload').mockResolvedValue({ status: 'ok' })
    const chunkSpy = vi
      .spyOn(uploadApi, 'uploadMultipartChunk')
      .mockRejectedValue(new DOMException('Upload aborted', 'AbortError'))
    const compSpy = vi.spyOn(uploadApi, 'completeMultipartUpload').mockResolvedValue({ status: 'ok', data: mockItem })

    const store = useUploadStore()
    const file = new File(['a'.repeat(20)], 'test.txt', { type: 'text/plain' })

    const promise = store.startUpload({
      cloudAccountId: 1,
      parentUuid: null,
      files: [file],
      method: 'server',
    })

    await Promise.resolve()
    const item = store.uploadQueue[0]
    expect(item?.status).toBe('uploading')
    store.cancelItem(item!.id)

    const res = await promise

    expect(initSpy).toHaveBeenCalled()
    expect(abortSpy).toHaveBeenCalledWith('session-1')
    expect(res).toHaveLength(0)
    expect(store.uploadQueue[0]?.status).toBe('aborted')
    expect(compSpy).not.toHaveBeenCalled()
    expect(chunkSpy).toHaveBeenCalled()
  })

  it('marks a failed multipart upload as failed with an error', async () => {
    vi.spyOn(uploadApi, 'initiateMultipartUpload').mockResolvedValue({
      status: 'ok',
      data: {
        session_id: 'session-1',
        upload_id: 'upload-1',
        total_parts: 1,
        chunk_size: 5 * 1024 * 1024,
        storage_path: 'path/to/file',
      },
    })
    vi.spyOn(uploadApi, 'uploadMultipartChunk').mockRejectedValue(
      new Error('Network error during multipart part upload'),
    )
    vi.spyOn(uploadApi, 'completeMultipartUpload').mockResolvedValue({ status: 'ok', data: mockItem })
    vi.spyOn(uploadApi, 'abortMultipartUpload').mockResolvedValue({ status: 'ok' })

    const store = useUploadStore()
    const file = new File(['content'], 'test.txt', { type: 'text/plain' })

    const res = await store.startUpload({
      cloudAccountId: 1,
      parentUuid: null,
      files: [file],
      method: 'server',
    })

    expect(res).toHaveLength(0)
    expect(store.uploadQueue[0]?.status).toBe('failed')
    expect(store.uploadQueue[0]?.error).toContain('Network error')
  })

  it('cancels a direct upload via abortController', async () => {
    const initSpy = mockPresignedInit()
    const directSpy = vi
      .spyOn(uploadApi, 'uploadDirectToS3')
      .mockRejectedValue(new DOMException('Upload aborted', 'AbortError'))
    vi.spyOn(uploadApi, 'completePresignedUpload').mockResolvedValue({ status: 'ok', data: mockItem })

    const store = useUploadStore()
    const file = new File(['content'], 'test.txt', { type: 'text/plain' })

    const promise = store.startUpload({
      cloudAccountId: 1,
      parentUuid: null,
      files: [file],
      method: 'direct',
    })

    await Promise.resolve()
    const item = store.uploadQueue[0]
    store.cancelItem(item!.id)

    const res = await promise

    expect(initSpy).toHaveBeenCalled()
    expect(directSpy).toHaveBeenCalled()
    expect(res).toHaveLength(0)
    expect(store.uploadQueue[0]?.status).toBe('aborted')
  })

  it('clearQueue empties the upload queue', async () => {
    mockPresignedInit()
    vi.spyOn(uploadApi, 'uploadDirectToS3').mockResolvedValue()
    vi.spyOn(uploadApi, 'completePresignedUpload').mockResolvedValue({ status: 'ok', data: mockItem })

    const store = useUploadStore()
    const file = new File(['content'], 'test.txt', { type: 'text/plain' })

    await store.startUpload({
      cloudAccountId: 1,
      parentUuid: null,
      files: [file],
      method: 'direct',
    })

    expect(store.uploadQueue).toHaveLength(1)

    store.clearQueue()
    expect(store.uploadQueue).toHaveLength(0)
  })

  it('preserves the directory tree for a folder upload', async () => {
    const initSpy = mockPresignedInit()
    vi.spyOn(uploadApi, 'uploadDirectToS3').mockResolvedValue()
    vi.spyOn(uploadApi, 'completePresignedUpload').mockResolvedValue({ status: 'ok', data: mockItem })

    const photosFolder: DriveItem = {
      uuid: 'folder-photos',
      name: 'photos',
      type: 'folder',
      mime_type: 'application/vnd.folder',
      size: 0,
      extension: '',
      cloud_account_id: 1,
      is_starred: false,
      status: 'ready',
      updated_at: '2026-10-04 00:00:00',
    }
    const year2024Folder: DriveItem = {
      uuid: 'folder-2024',
      name: '2024',
      type: 'folder',
      mime_type: 'application/vnd.folder',
      size: 0,
      extension: '',
      cloud_account_id: 1,
      is_starred: false,
      status: 'ready',
      updated_at: '2026-10-04 00:00:00',
    }

    const createFolderSpy = vi
      .spyOn(driveItemsApi, 'createDriveFolder')
      .mockImplementation(async ({ name }) => {
        const folder = name === 'photos' ? photosFolder : year2024Folder
        return { status: 'ok', data: folder }
      })

    const store = useUploadStore()

    const file = new File(['content'], 'a.jpg', { type: 'image/jpeg' })
    Object.defineProperty(file, 'webkitRelativePath', { value: 'photos/2024/a.jpg' })

    const res = await store.startUpload({
      cloudAccountId: 1,
      parentUuid: 'root-parent',
      files: [file],
      method: 'direct',
    })

    expect(createFolderSpy).toHaveBeenCalledWith({
      cloudAccountId: 1,
      parentUuid: 'root-parent',
      name: 'photos',
    })
    expect(createFolderSpy).toHaveBeenCalledWith({
      cloudAccountId: 1,
      parentUuid: photosFolder.uuid,
      name: '2024',
    })
    expect(createFolderSpy).toHaveBeenCalledTimes(2)

    expect(initSpy).toHaveBeenCalledTimes(1)
    expect(initSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        parentUuid: year2024Folder.uuid,
        fileName: 'a.jpg',
      }),
    )

    expect(res).toHaveLength(1)
    expect(store.uploadQueue[0]?.status).toBe('completed')
    expect(initSpy.mock.calls[0]?.[0].parentUuid).toBe('folder-2024')
  })

  it('reuses an existing top-level folder instead of creating a duplicate', async () => {
    const initSpy = mockPresignedInit()
    vi.spyOn(uploadApi, 'uploadDirectToS3').mockResolvedValue()
    vi.spyOn(uploadApi, 'completePresignedUpload').mockResolvedValue({ status: 'ok', data: mockItem })

    const existingPhotosFolder: DriveItem = {
      uuid: 'folder-existing-photos',
      name: 'photos',
      type: 'folder',
      mime_type: 'application/vnd.folder',
      size: 0,
      extension: '',
      cloud_account_id: 1,
      is_starred: false,
      status: 'ready',
      updated_at: '2026-10-04 00:00:00',
    }

    const createFolderSpy = vi
      .spyOn(driveItemsApi, 'createDriveFolder')
      .mockResolvedValue({ status: 'ok', data: { uuid: 'folder-nested', name: '2024', type: 'folder' } as DriveItem })

    const store = useDriveItemsStore()
    store.items = [existingPhotosFolder]
    const storeCreateSpy = vi.spyOn(store, 'createFolder').mockResolvedValue(existingPhotosFolder)

    const upload = useUploadStore()

    const file = new File(['content'], 'a.jpg', { type: 'image/jpeg' })
    Object.defineProperty(file, 'webkitRelativePath', { value: 'photos/2024/a.jpg' })

    await upload.startUpload({
      cloudAccountId: 1,
      parentUuid: 'root-parent',
      files: [file],
      method: 'direct',
    })

    expect(storeCreateSpy).not.toHaveBeenCalled()
    expect(createFolderSpy).toHaveBeenCalledTimes(1)
    expect(createFolderSpy).toHaveBeenCalledWith({
      cloudAccountId: 1,
      parentUuid: existingPhotosFolder.uuid,
      name: '2024',
    })
    expect(initSpy).toHaveBeenCalledWith(
      expect.objectContaining({ parentUuid: 'folder-nested', fileName: 'a.jpg' }),
    )
  })

  it('does not create folders for a flat file selection', async () => {
    const initSpy = mockPresignedInit()
    vi.spyOn(uploadApi, 'uploadDirectToS3').mockResolvedValue()
    vi.spyOn(uploadApi, 'completePresignedUpload').mockResolvedValue({ status: 'ok', data: mockItem })

    const createFolderSpy = vi
      .spyOn(driveItemsApi, 'createDriveFolder')
      .mockResolvedValue({ status: 'ok', data: mockItem })

    const store = useDriveItemsStore()
    const storeCreateSpy = vi.spyOn(store, 'createFolder').mockResolvedValue(mockItem)

    const upload = useUploadStore()
    const file = new File(['content'], 'flat.txt', { type: 'text/plain' })

    await upload.startUpload({
      cloudAccountId: 1,
      parentUuid: 'p',
      files: [file],
      method: 'direct',
    })

    expect(createFolderSpy).not.toHaveBeenCalled()
    expect(storeCreateSpy).not.toHaveBeenCalled()
    expect(initSpy).toHaveBeenCalledWith(expect.objectContaining({ parentUuid: 'p' }))
  })

  // Review focus #1: a second batch must not replace the first.
  it('appends a second batch instead of replacing the first', async () => {
    mockPresignedInit()
    vi.spyOn(uploadApi, 'uploadDirectToS3').mockResolvedValue()
    vi.spyOn(uploadApi, 'completePresignedUpload').mockResolvedValue({ status: 'ok', data: mockItem })

    const store = useUploadStore()

    await store.startUpload({
      cloudAccountId: 1,
      parentUuid: null,
      files: [new File(['a'], 'a.txt')],
      method: 'direct',
    })
    await store.startUpload({
      cloudAccountId: 1,
      parentUuid: null,
      files: [new File(['b'], 'b.txt')],
      method: 'direct',
    })

    expect(store.uploadQueue).toHaveLength(2)
    expect(store.uploadQueue.map((i) => i.file.name)).toEqual(['a.txt', 'b.txt'])
  })

  // Review focus #1: isUploading is derived from the queue, not a toggled ref.
  it('derives isUploading from the queue', async () => {
    mockPresignedInit()
    vi.spyOn(uploadApi, 'uploadDirectToS3').mockResolvedValue()
    vi.spyOn(uploadApi, 'completePresignedUpload').mockResolvedValue({ status: 'ok', data: mockItem })

    const store = useUploadStore()
    expect(store.isUploading).toBe(false)

    const promise = store.startUpload({
      cloudAccountId: 1,
      parentUuid: null,
      files: [new File(['c'], 'c.txt')],
      method: 'direct',
    })
    expect(store.isUploading).toBe(true)

    await promise
    expect(store.isUploading).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd D:\Source\ponta\ponta_drive\frontend && npx vitest run src/stores/__tests__/upload.spec.ts`
Expected: FAIL — cannot resolve `../upload` (module does not exist).

- [ ] **Step 3: Create the store**

Create `src/stores/upload.ts`:

```ts
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  initiatePresignedUpload,
  completePresignedUpload,
  initiateMultipartUpload,
  uploadMultipartChunk,
  completeMultipartUpload,
  abortMultipartUpload,
  uploadDirectToS3,
} from '@/api/upload'
import type { DriveItem } from '@/api/driveItems'
import { createDriveFolder } from '@/api/driveItems'
import { useDriveItemsStore } from '@/stores/driveItems'
import { useCloudAccountsStore } from '@/stores/cloudAccounts'

export type UploadMethod = 'direct' | 'server'

export interface UploadQueueItem {
  id: string
  file: File
  relativePath?: string
  progress: number
  status: 'pending' | 'uploading' | 'completed' | 'failed' | 'aborted'
  error?: string
  abortController?: AbortController
}

export interface StartUploadOptions {
  cloudAccountId: number
  parentUuid?: string | null
  files: File[]
  method: UploadMethod
  onItemCompleted?: (item: DriveItem) => void
}

// Monotonic per-batch item id. A counter (not Date.now()) guarantees unique ids
// even when two batches start in the same millisecond, so appending never
// collides on a `:key`.
let uploadSeq = 0

/**
 * Global upload state.
 *
 * Lives in a store rather than a per-component composable because the progress
 * panel is mounted at the app shell (App.vue) and must keep reading the queue
 * after the upload dialog that started the batch has unmounted.
 */
export const useUploadStore = defineStore('upload', () => {
  const uploadQueue = ref<UploadQueueItem[]>([])

  // Derived, never assigned: with two batches running, a `false` written at the
  // end of batch A must not clear the flag while batch B is still in flight.
  const isUploading = computed(() =>
    uploadQueue.value.some((i) => i.status === 'pending' || i.status === 'uploading'),
  )

  const driveStore = useDriveItemsStore()
  const cloudStore = useCloudAccountsStore()

  function cancelItem(itemId: string): void {
    const item = uploadQueue.value.find((i) => i.id === itemId)
    if (item && item.status === 'uploading') {
      item.abortController?.abort()
      item.status = 'aborted'
    }
  }

  function clearQueue(): void {
    uploadQueue.value = []
  }

  async function uploadDirect(
    queueItem: UploadQueueItem,
    cloudAccountId: number,
    parentUuid: string | null | undefined,
  ): Promise<DriveItem> {
    const controller = new AbortController()
    queueItem.abortController = controller
    queueItem.status = 'uploading'

    const initRes = await initiatePresignedUpload({
      cloudAccountId,
      parentUuid,
      fileName: queueItem.file.name,
      size: queueItem.file.size,
      mimeType: queueItem.file.type || 'application/octet-stream',
    })

    const data = initRes.data!
    await uploadDirectToS3(data.upload_url, data.method, data.headers, queueItem.file, {
      signal: controller.signal,
      onProgress: (percent) => {
        queueItem.progress = percent
      },
    })

    const compRes = await completePresignedUpload(data.item_uuid)
    const finalized = compRes.data!
    queueItem.status = 'completed'
    queueItem.progress = 100
    driveStore.insertItem(finalized)
    return finalized
  }

  async function uploadServerMultipart(
    queueItem: UploadQueueItem,
    cloudAccountId: number,
    parentUuid: string | null | undefined,
  ): Promise<DriveItem> {
    const controller = new AbortController()
    queueItem.abortController = controller
    queueItem.status = 'uploading'

    const chunkSize = 5 * 1024 * 1024 // 5MB
    const initRes = await initiateMultipartUpload({
      cloudAccountId,
      parentUuid,
      fileName: queueItem.file.name,
      size: queueItem.file.size,
      mimeType: queueItem.file.type || 'application/octet-stream',
      chunkSize,
    })

    const session = initRes.data!
    const totalParts = session.total_parts
    let uploadedBytes = 0

    try {
      for (let part = 1; part <= totalParts; part++) {
        if (controller.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError')
        }
        const start = (part - 1) * chunkSize
        const end = Math.min(queueItem.file.size, start + chunkSize)
        const chunk = queueItem.file.slice(start, end)

        await uploadMultipartChunk(session.session_id, part, chunk, {
          signal: controller.signal,
          onProgress: (_p, loaded) => {
            const overall = Math.round(((uploadedBytes + loaded) / queueItem.file.size) * 100)
            queueItem.progress = Math.min(99, overall)
          },
        })
        uploadedBytes += chunk.size
      }

      const compRes = await completeMultipartUpload(session.session_id)
      const finalized = compRes.data!
      queueItem.status = 'completed'
      queueItem.progress = 100
      driveStore.insertItem(finalized)
      return finalized
    } catch (e) {
      if (controller.signal.aborted) {
        await abortMultipartUpload(session.session_id).catch(() => {})
        queueItem.status = 'aborted'
      } else {
        queueItem.status = 'failed'
        queueItem.error = e instanceof Error ? e.message : String(e)
      }
      throw e
    }
  }

  async function startUpload(options: StartUploadOptions): Promise<DriveItem[]> {
    const completedItems: DriveItem[] = []

    // Append this batch instead of replacing the queue, so a second upload runs
    // alongside a first that is still in flight.
    const batch: UploadQueueItem[] = options.files.map((file) => ({
      id: `up-${++uploadSeq}`,
      file,
      relativePath: (file as unknown as { webkitRelativePath?: string }).webkitRelativePath || '',
      progress: 0,
      status: 'pending' as const,
    }))
    uploadQueue.value = [...uploadQueue.value, ...batch]

    // Folder upload: recreate the directory tree before uploading files so a
    // picked folder tree preserves its nested structure instead of flattening
    // into the current directory.
    const hasTree = batch.some((q) => q.relativePath !== '')
    const dirUuidByPath: Record<string, string | null> = { '': options.parentUuid ?? null }

    if (hasTree) {
      const dirPaths = new Set<string>()
      for (const q of batch) {
        const relPath = q.relativePath ?? ''
        const parts = relPath.split('/')
        for (let i = 0; i < parts.length - 1; i++) {
          dirPaths.add(parts.slice(0, i + 1).join('/'))
        }
      }
      const sortedDirs = [...dirPaths].sort((a, b) => a.split('/').length - b.split('/').length)

      for (const dirPath of sortedDirs) {
        const parts = dirPath.split('/')
        const name = parts[parts.length - 1]!
        const parentPath = parts.slice(0, -1).join('/')
        const parentUuid: string | null = dirUuidByPath[parentPath] ?? options.parentUuid ?? null

        let uuid: string
        if (parentPath === '') {
          const existing = driveStore.items.find((i) => i.type === 'folder' && i.name === name)
          if (existing) {
            uuid = existing.uuid
          } else {
            const created = await driveStore.createFolder(options.cloudAccountId, parentUuid, name)
            uuid = created.uuid
          }
        } else {
          const res = await createDriveFolder({ cloudAccountId: options.cloudAccountId, parentUuid, name })
          uuid = (res.data as DriveItem).uuid
        }
        dirUuidByPath[dirPath] = uuid
      }
    }

    for (const qItem of batch) {
      try {
        const relPath = qItem.relativePath ?? ''
        const targetParent: string | null = hasTree
          ? (dirUuidByPath[relPath.replace(/\/[^/]*$/, '')] ?? options.parentUuid ?? null)
          : options.parentUuid ?? null
        let item: DriveItem
        if (options.method === 'direct') {
          item = await uploadDirect(qItem, options.cloudAccountId, targetParent)
        } else {
          item = await uploadServerMultipart(qItem, options.cloudAccountId, targetParent)
        }
        completedItems.push(item)
        options.onItemCompleted?.(item)
      } catch (e) {
        if (qItem.status !== 'aborted') {
          qItem.status = 'failed'
          qItem.error = e instanceof Error ? e.message : String(e)
        }
      }
    }

    // Refresh cloud accounts store so storage figures move
    void cloudStore.fetch()

    return completedItems
  }

  return {
    uploadQueue,
    isUploading,
    startUpload,
    cancelItem,
    clearQueue,
  }
})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd D:\Source\ponta\ponta_drive\frontend && npx vitest run src/stores/__tests__/upload.spec.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Delete the old composable and its spec**

Run:
```bash
cd D:\Source\ponta\ponta_drive\frontend
git rm src/composables/useUpload.ts src/composables/__tests__/useUpload.spec.ts
```

- [ ] **Step 6: Type-check**

Run: `cd D:\Source\ponta\ponta_drive\frontend && npm run type-check`
Expected: errors only in `src/components/drive/UploadDialog.vue` (it still imports the deleted composable). Task 2 fixes that; if the only errors are in that file, continue.

- [ ] **Step 7: Commit**

```bash
cd D:\Source\ponta\ponta_drive\frontend
git add src/stores/upload.ts src/stores/__tests__/upload.spec.ts
git commit -m "refactor(upload): move upload state into a global store"
```

---

### Task 2: Upload dialog previews the selection and closes on Start

Show the chosen files (name + size + per-file remove) inside the dialog, and make Start close the dialog immediately instead of waiting. The dialog no longer renders or owns progress.

**Files:**
- Modify: `src/components/drive/UploadDialog.vue`
- Modify: `src/components/drive/__tests__/UploadDialog.spec.ts`
- Modify: `src/locales/vi.json` (add 3 keys under `drive`)
- Modify: `src/locales/en.json` (add 3 keys under `drive`)

**Interfaces:**
- Consumes: `useUploadStore`, `UploadMethod` (Task 1); `humanizeBytes` from `@/lib/format`.
- Produces: no new exports. The dialog still exposes `v-model:open` and props `{ cloudAccountId: number; parentUuid?: string | null; initialMode?: 'file' | 'folder' }`. It no longer declares a `completed` emit.

- [ ] **Step 1: Write the failing test**

Replace `src/components/drive/__tests__/UploadDialog.spec.ts` entirely:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import UploadDialog from '../UploadDialog.vue'
import { useUploadStore, type UploadQueueItem } from '@/stores/upload'
import viLocale from '@/locales/vi.json'

function mountDialog(initialMode: 'file' | 'folder' = 'file', open = true) {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(UploadDialog, {
    props: { open, cloudAccountId: 1, parentUuid: null, initialMode },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

async function selectFiles(names: string[]) {
  const files = names.map((n) => new File(['content'], n, { type: 'text/plain' }))
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  Object.defineProperty(input, 'files', { value: files })
  await input.dispatchEvent(new Event('change'))
  return files
}

function clickButton(label: string) {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label))!
  button.click()
}

describe('UploadDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('renders upload method selection step', async () => {
    mountDialog()
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))
    expect(document.body.textContent).toContain(viLocale.drive.upload_method_direct)
    expect(document.body.textContent).toContain(viLocale.drive.upload_method_server)
  })

  it('shows the selected file name before upload', async () => {
    mountDialog('file')
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))

    await selectFiles(['report.pdf'])

    expect(document.body.textContent).toContain('report.pdf')
    expect(document.body.textContent).toContain(viLocale.drive.upload_selected_title.replace('{count}', '1'))
  })

  it('removes a single selected file', async () => {
    const wrapper = mountDialog('file')
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))

    await selectFiles(['a.txt', 'b.txt'])
    expect(document.body.textContent).toContain('a.txt')
    expect(document.body.textContent).toContain('b.txt')

    const removeButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('aria-label') === viLocale.drive.upload_remove_file,
    )!
    removeButton.click()
    await wrapper.vm.$nextTick()

    expect(document.body.textContent).not.toContain('a.txt')
    expect(document.body.textContent).toContain('b.txt')
  })

  it('clears every selected file', async () => {
    const wrapper = mountDialog('file')
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))

    await selectFiles(['a.txt', 'b.txt'])
    clickButton(viLocale.drive.upload_clear_files)
    await wrapper.vm.$nextTick()

    expect(document.body.textContent).not.toContain('a.txt')
    expect(document.body.textContent).not.toContain('b.txt')
  })

  it('closes the dialog and starts the upload when Start is pressed', async () => {
    const store = useUploadStore()
    const startSpy = vi.spyOn(store, 'startUpload').mockResolvedValue([])

    const wrapper = mountDialog('file')
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))

    const files = await selectFiles(['sample.txt'])
    clickButton(viLocale.drive.upload_start)

    await vi.waitFor(() =>
      expect(startSpy).toHaveBeenCalledWith(
        expect.objectContaining({ cloudAccountId: 1, files, method: 'direct' }),
      ),
    )
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
  })

  it('selects the server method card and threads it into startUpload', async () => {
    const store = useUploadStore()
    const startSpy = vi.spyOn(store, 'startUpload').mockResolvedValue([])

    mountDialog('file')
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))

    await selectFiles(['sample.txt'])

    const serverCard = [...document.querySelectorAll<HTMLDivElement>('div')].find(
      (el) =>
        el.className.includes('cursor-pointer') &&
        el.textContent?.includes(viLocale.drive.upload_method_server),
    )!
    serverCard.click()

    clickButton(viLocale.drive.upload_start)

    await vi.waitFor(() =>
      expect(startSpy).toHaveBeenCalledWith(expect.objectContaining({ method: 'server' })),
    )
  })

  it('does NOT close or start when nothing is selected', async () => {
    const store = useUploadStore()
    const startSpy = vi.spyOn(store, 'startUpload').mockResolvedValue([])

    const wrapper = mountDialog('file')
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))

    clickButton(viLocale.drive.upload_start)
    await wrapper.vm.$nextTick()

    expect(startSpy).not.toHaveBeenCalled()
    expect(wrapper.emitted('update:open')).toBeFalsy()
  })

  it('auto-opens the folder picker when initialMode is "folder"', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')

    const wrapper = mountDialog('folder', false)
    await wrapper.setProps({ open: true })
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))
    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalled())

    clickSpy.mockRestore()
  })

  it('does NOT auto-open the folder picker when initialMode is "file"', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')

    const wrapper = mountDialog('file', false)
    await wrapper.setProps({ open: true })
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))
    await wrapper.vm.$nextTick()

    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  // Review focus #2: opening the dialog must not wipe a background upload.
  it('does not clear a running upload queue when reopened', async () => {
    const store = useUploadStore()
    const queued: UploadQueueItem = {
      id: 'up-1',
      file: new File(['x'], 'x.txt'),
      progress: 0,
      status: 'uploading',
    }
    store.uploadQueue = [queued]

    const wrapper = mountDialog('file', false)
    await wrapper.setProps({ open: true })
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))

    expect(store.uploadQueue).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd D:\Source\ponta\ponta_drive\frontend && npx vitest run src/components/drive/__tests__/UploadDialog.spec.ts`
Expected: FAIL — `upload_selected_title` is undefined; the dialog still imports the deleted composable.

- [ ] **Step 3: Add the i18n keys**

In `src/locales/vi.json`, inside the `drive` object, immediately after the `"upload_status_failed"` line, add:

```json
    "upload_selected_title": "Đã chọn {count} tệp",
    "upload_clear_files": "Xoá hết",
    "upload_remove_file": "Xoá tệp",
```

In `src/locales/en.json`, inside the `drive` object, immediately after the `"upload_status_failed"` line, add:

```json
    "upload_selected_title": "Selected {count} file(s)",
    "upload_clear_files": "Clear all",
    "upload_remove_file": "Remove file",
```

- [ ] **Step 4: Rewrite the dialog**

Replace `src/components/drive/UploadDialog.vue` entirely:

```vue
<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { Upload, FolderUp, FileText, X, HardDrive, Server } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { humanizeBytes } from '@/lib/format'
import { useUploadStore, type UploadMethod } from '@/stores/upload'

const open = defineModel<boolean>('open', { required: true })

const props = withDefaults(
  defineProps<{
    cloudAccountId: number
    parentUuid?: string | null
    initialMode?: 'file' | 'folder'
  }>(),
  {
    initialMode: 'file',
  },
)

const { t } = useI18n()
const uploadStore = useUploadStore()

const selectedFiles = ref<File[]>([])
const uploadMethod = ref<UploadMethod>('direct')
const isDragging = ref(false)

const fileInput = ref<HTMLInputElement | null>(null)
const folderInput = ref<HTMLInputElement | null>(null)

watch(open, async (isOpen) => {
  if (isOpen) {
    // Only the local selection resets. The global upload queue is left alone so
    // reopening the dialog never cancels an upload already running.
    selectedFiles.value = []
    // When opening in "folder" mode, auto-launch the folder picker so the
    // user can pick a directory tree without an extra click.
    if (props.initialMode === 'folder') {
      await nextTick()
      folderInput.value?.click()
    }
  }
})

function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement
  if (target.files && target.files.length > 0) {
    selectedFiles.value = Array.from(target.files)
  }
}

function handleDrop(event: DragEvent) {
  isDragging.value = false
  if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
    selectedFiles.value = Array.from(event.dataTransfer.files)
  }
}

function removeFile(index: number) {
  selectedFiles.value = selectedFiles.value.filter((_, i) => i !== index)
}

function handleStart() {
  if (selectedFiles.value.length === 0 || !props.cloudAccountId) return

  // Close first so the dialog disappears at once; the store keeps the upload
  // alive and the global panel shows its progress.
  open.value = false
  void uploadStore.startUpload({
    cloudAccountId: props.cloudAccountId,
    parentUuid: props.parentUuid,
    files: selectedFiles.value,
    method: uploadMethod.value,
  })
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-xl">
      <DialogHeader>
        <div class="flex items-center gap-3">
          <div class="h-9 w-9 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0">
            <Upload class="h-5 w-5" />
          </div>
          <DialogTitle>{{ t('drive.upload_title') }}</DialogTitle>
        </div>
        <DialogDescription class="sr-only">
          {{ t('drive.upload_title') }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <!-- Hidden Inputs -->
        <input
          ref="fileInput"
          type="file"
          multiple
          class="hidden"
          :aria-label="t('drive.upload_select_files')"
          @change="handleFileSelect"
        />
        <input
          ref="folderInput"
          type="file"
          webkitdirectory
          directory
          multiple
          class="hidden"
          :aria-label="t('drive.upload_select_folder')"
          @change="handleFileSelect"
        />

        <!-- Method Selection Step -->
        <div class="space-y-2">
          <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {{ t('drive.upload_method_title') }}
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div
              class="border rounded-xl p-3 cursor-pointer transition-all flex flex-col gap-1.5"
              :class="[
                uploadMethod === 'direct'
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:bg-muted/40',
              ]"
              role="button"
              tabindex="0"
              @click="uploadMethod = 'direct'"
              @keydown.enter="uploadMethod = 'direct'"
              @keydown.space.prevent="uploadMethod = 'direct'"
            >
              <div class="flex items-center gap-2">
                <HardDrive class="h-4 w-4 text-primary" />
                <span class="text-sm font-semibold text-foreground">{{ t('drive.upload_method_direct') }}</span>
              </div>
              <p class="text-xs text-muted-foreground leading-relaxed">
                {{ t('drive.upload_method_direct_desc') }}
              </p>
            </div>

            <div
              class="border rounded-xl p-3 cursor-pointer transition-all flex flex-col gap-1.5"
              :class="[
                uploadMethod === 'server'
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:bg-muted/40',
              ]"
              role="button"
              tabindex="0"
              @click="uploadMethod = 'server'"
              @keydown.enter="uploadMethod = 'server'"
              @keydown.space.prevent="uploadMethod = 'server'"
            >
              <div class="flex items-center gap-2">
                <Server class="h-4 w-4 text-emerald-500" />
                <span class="text-sm font-semibold text-foreground">{{ t('drive.upload_method_server') }}</span>
              </div>
              <p class="text-xs text-muted-foreground leading-relaxed">
                {{ t('drive.upload_method_server_desc') }}
              </p>
            </div>
          </div>
        </div>

        <!-- Drop target / file selection -->
        <div
          class="border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center gap-3 transition-colors"
          :class="[isDragging ? 'border-primary bg-primary/5' : 'border-border bg-card/40']"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="handleDrop"
        >
          <div class="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
            <Upload class="h-5 w-5" />
          </div>
          <div class="flex gap-2">
            <Button variant="outline" size="sm" @click="fileInput?.click()">
              <Upload class="h-3.5 w-3.5 mr-1" />
              {{ t('drive.upload_select_files') }}
            </Button>
            <Button variant="outline" size="sm" @click="folderInput?.click()">
              <FolderUp class="h-3.5 w-3.5 mr-1" />
              {{ t('drive.upload_select_folder') }}
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">{{ t('drive.upload_drop_hint') }}</p>
        </div>

        <!-- Selected files preview -->
        <div v-if="selectedFiles.length > 0" class="space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-muted-foreground">
              {{ t('drive.upload_selected_title', { count: selectedFiles.length }) }}
            </span>
            <Button
              variant="ghost"
              size="sm"
              class="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
              @click="selectedFiles = []"
            >
              {{ t('drive.upload_clear_files') }}
            </Button>
          </div>
          <ul class="max-h-40 overflow-y-auto space-y-1 pr-1">
            <li
              v-for="(file, index) in selectedFiles"
              :key="`${file.name}-${index}`"
              class="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs"
            >
              <FileText class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span class="truncate flex-1 text-foreground">{{ file.name }}</span>
              <span class="text-muted-foreground font-mono shrink-0">{{ humanizeBytes(file.size) }}</span>
              <Button
                variant="ghost"
                size="icon"
                class="h-5 w-5 text-muted-foreground hover:text-destructive"
                :aria-label="t('drive.upload_remove_file')"
                @click="removeFile(index)"
              >
                <X class="h-3 w-3" />
              </Button>
            </li>
          </ul>
        </div>
      </div>

      <DialogFooter class="gap-2 pt-2">
        <Button variant="outline" @click="open = false">
          {{ t('drive.cancel_button') }}
        </Button>
        <Button :disabled="selectedFiles.length === 0" @click="handleStart">
          {{ t('drive.upload_start') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd D:\Source\ponta\ponta_drive\frontend && npx vitest run src/components/drive/__tests__/UploadDialog.spec.ts`
Expected: PASS — 9 tests.

- [ ] **Step 6: Type-check**

Run: `cd D:\Source\ponta\ponta_drive\frontend && npm run type-check`
Expected: PASS (no more errors).

- [ ] **Step 7: Commit**

```bash
cd D:\Source\ponta\ponta_drive\frontend
git add src/components/drive/UploadDialog.vue src/components/drive/__tests__/UploadDialog.spec.ts src/locales/vi.json src/locales/en.json
git commit -m "feat(upload): preview selected files and close the dialog on start"
```

---

### Task 3: The floating progress panel component

A self-contained component that reads the upload store and renders the queue in a fixed bottom-right card. Mounting is Task 4.

**Files:**
- Create: `src/components/upload/UploadProgressPanel.vue`
- Create: `src/components/upload/__tests__/UploadProgressPanel.spec.ts`
- Modify: `src/locales/vi.json` (add 6 keys under `drive`)
- Modify: `src/locales/en.json` (add 6 keys under `drive`)

**Interfaces:**
- Consumes: `useUploadStore` (Task 1) — reads `uploadQueue`, `isUploading`, calls `cancelItem`, `clearQueue`.
- Produces: default-exported SFC `UploadProgressPanel.vue` (no props). Later tasks mount it with no props.

- [ ] **Step 1: Write the failing test**

Create `src/components/upload/__tests__/UploadProgressPanel.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import UploadProgressPanel from '../UploadProgressPanel.vue'
import { useUploadStore, type UploadQueueItem } from '@/stores/upload'
import viLocale from '@/locales/vi.json'

function mountPanel() {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(UploadProgressPanel, { global: { plugins: [i18n] }, attachTo: document.body })
}

function item(partial: Partial<UploadQueueItem>): UploadQueueItem {
  return {
    id: 'up-1',
    file: new File(['x'], 'x.txt'),
    progress: 0,
    status: 'pending',
    ...partial,
  }
}

describe('UploadProgressPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  // Review focus #3: nothing renders while the queue is empty.
  it('renders nothing when the queue is empty', () => {
    const wrapper = mountPanel()
    expect(wrapper.find('.fixed').exists()).toBe(false)
  })

  it('renders a row per queued file with its name and percent', async () => {
    const store = useUploadStore()
    store.uploadQueue = [
      item({ id: 'up-1', file: new File(['a'], 'alpha.png'), progress: 42, status: 'uploading' }),
      item({ id: 'up-2', file: new File(['b'], 'beta.zip'), progress: 100, status: 'completed' }),
    ]

    const wrapper = mountPanel()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('alpha.png')
    expect(wrapper.text()).toContain('beta.zip')
    expect(wrapper.text()).toContain('42%')
    expect(wrapper.text()).toContain('100%')
  })

  // Review focus #4: the per-item cancel reaches the store.
  it('cancels an in-flight item through the store', async () => {
    const store = useUploadStore()
    store.uploadQueue = [item({ id: 'up-9', status: 'uploading', progress: 10 })]
    const cancelSpy = vi.spyOn(store, 'cancelItem')

    const wrapper = mountPanel()
    await wrapper.vm.$nextTick()

    const cancelButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('aria-label') === viLocale.drive.upload_panel_cancel,
    )!
    cancelButton.click()

    expect(cancelSpy).toHaveBeenCalledWith('up-9')
  })

  it('disables the close button while an upload is running', async () => {
    const store = useUploadStore()
    store.uploadQueue = [item({ id: 'up-3', status: 'uploading', progress: 5 })]

    const wrapper = mountPanel()
    await wrapper.vm.$nextTick()

    const closeButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('aria-label') === viLocale.drive.upload_panel_close,
    ) as HTMLButtonElement
    expect(closeButton.disabled).toBe(true)
  })

  it('clears the queue when close is pressed after everything settles', async () => {
    const store = useUploadStore()
    store.uploadQueue = [item({ id: 'up-4', status: 'completed', progress: 100 })]

    const wrapper = mountPanel()
    await wrapper.vm.$nextTick()

    const closeButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('aria-label') === viLocale.drive.upload_panel_close,
    ) as HTMLButtonElement
    expect(closeButton.disabled).toBe(false)
    closeButton.click()

    expect(store.uploadQueue).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd D:\Source\ponta\ponta_drive\frontend && npx vitest run src/components/upload/__tests__/UploadProgressPanel.spec.ts`
Expected: FAIL — cannot resolve `../UploadProgressPanel.vue`.

- [ ] **Step 3: Add the i18n keys**

In `src/locales/vi.json`, inside the `drive` object, immediately after the three keys added in Task 2, add:

```json
    "upload_panel_title": "Đang tải lên",
    "upload_panel_minimize": "Thu gọn",
    "upload_panel_expand": "Mở rộng",
    "upload_panel_close": "Đóng",
    "upload_panel_cancel": "Huỷ tải lên",
    "upload_panel_items_count": "{done}/{total}",
```

In `src/locales/en.json`, inside the `drive` object, immediately after the three keys added in Task 2, add:

```json
    "upload_panel_title": "Uploading",
    "upload_panel_minimize": "Minimize",
    "upload_panel_expand": "Expand",
    "upload_panel_close": "Close",
    "upload_panel_cancel": "Cancel upload",
    "upload_panel_items_count": "{done}/{total}",
```

- [ ] **Step 4: Create the component**

Create `src/components/upload/UploadProgressPanel.vue`:

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Upload, ChevronDown, ChevronUp, X, FileText, CheckCircle2, AlertCircle } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { useUploadStore } from '@/stores/upload'

const { t } = useI18n()
const uploadStore = useUploadStore()

const collapsed = ref(false)

const completedCount = computed(
  () => uploadStore.uploadQueue.filter((i) => i.status === 'completed').length,
)
</script>

<template>
  <div
    v-if="uploadStore.uploadQueue.length > 0"
    class="fixed bottom-6 right-6 z-50 w-80 rounded-xl border border-border bg-card shadow-lg"
  >
    <div class="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
      <div class="flex items-center gap-2 min-w-0">
        <Upload class="h-4 w-4 text-primary shrink-0" />
        <span class="text-sm font-semibold text-foreground truncate">
          {{ t('drive.upload_panel_title') }}
        </span>
        <span class="text-xs text-muted-foreground font-mono shrink-0">
          {{ t('drive.upload_panel_items_count', { done: completedCount, total: uploadStore.uploadQueue.length }) }}
        </span>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          class="h-6 w-6 text-muted-foreground"
          :aria-label="collapsed ? t('drive.upload_panel_expand') : t('drive.upload_panel_minimize')"
          @click="collapsed = !collapsed"
        >
          <ChevronUp v-if="collapsed" class="h-3.5 w-3.5" />
          <ChevronDown v-else class="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-6 w-6 text-muted-foreground hover:text-destructive"
          :disabled="uploadStore.isUploading"
          :aria-label="t('drive.upload_panel_close')"
          @click="uploadStore.clearQueue()"
        >
          <X class="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>

    <div v-if="!collapsed" class="max-h-60 overflow-y-auto p-2 space-y-1.5">
      <div
        v-for="item in uploadStore.uploadQueue"
        :key="item.id"
        class="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs"
      >
        <div class="flex items-center gap-2 min-w-0 flex-1">
          <FileText class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium text-foreground">{{ item.file.name }}</p>
            <div class="w-full bg-muted h-1.5 rounded-full overflow-hidden mt-1">
              <div
                class="h-full bg-primary transition-all duration-200"
                :style="{ width: `${item.progress}%` }"
              />
            </div>
          </div>
        </div>

        <div class="flex items-center gap-1.5 shrink-0">
          <span class="text-muted-foreground font-mono">{{ item.progress }}%</span>
          <CheckCircle2 v-if="item.status === 'completed'" class="h-3.5 w-3.5 text-emerald-500" />
          <AlertCircle v-else-if="item.status === 'failed'" class="h-3.5 w-3.5 text-destructive" />
          <Button
            v-else-if="item.status === 'uploading'"
            variant="ghost"
            size="icon"
            class="h-5 w-5 text-muted-foreground hover:text-destructive"
            :aria-label="t('drive.upload_panel_cancel')"
            @click="uploadStore.cancelItem(item.id)"
          >
            <X class="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd D:\Source\ponta\ponta_drive\frontend && npx vitest run src/components/upload/__tests__/UploadProgressPanel.spec.ts`
Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```bash
cd D:\Source\ponta\ponta_drive\frontend
git add src/components/upload/UploadProgressPanel.vue src/components/upload/__tests__/UploadProgressPanel.spec.ts src/locales/vi.json src/locales/en.json
git commit -m "feat(upload): add the floating progress panel component"
```

---

### Task 4: Mount the panel globally

Mount `UploadProgressPanel` in `App.vue` so it renders on every route (including auth), and pin that with a test.

**Files:**
- Modify: `src/App.vue`
- Create: `src/__tests__/App.spec.ts`

**Interfaces:**
- Consumes: `UploadProgressPanel.vue` (Task 3), `useUploadStore` (Task 1).
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/App.spec.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import App from '../App.vue'
import UploadProgressPanel from '@/components/upload/UploadProgressPanel.vue'
import { useUploadStore } from '@/stores/upload'
import viLocale from '@/locales/vi.json'

function mountApp() {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(App, {
    global: {
      plugins: [i18n],
      stubs: { RouterView: true, Toaster: true },
    },
  })
}

describe('App', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  it('mounts the global upload progress panel', async () => {
    const wrapper = mountApp()
    expect(wrapper.findComponent(UploadProgressPanel).exists()).toBe(true)

    // Seeding the store makes the (otherwise hidden) panel visible.
    const store = useUploadStore()
    store.uploadQueue = [
      { id: 'up-1', file: new File(['x'], 'x.txt'), progress: 0, status: 'uploading' },
    ]
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('x.txt')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd D:\Source\ponta\ponta_drive\frontend && npx vitest run src/__tests__/App.spec.ts`
Expected: FAIL — `App.vue` does not render `UploadProgressPanel`.

- [ ] **Step 3: Mount the panel in App.vue**

Replace `src/App.vue` entirely:

```vue
<script setup lang="ts">
import { RouterView } from 'vue-router'
import { Toaster } from '@/components/ui/sonner'
import UploadProgressPanel from '@/components/upload/UploadProgressPanel.vue'
import 'vue-sonner/style.css'
</script>

<template>
  <Toaster position="top-right" richColors />
  <RouterView />
  <UploadProgressPanel />
</template>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd D:\Source\ponta\ponta_drive\frontend && npx vitest run src/__tests__/App.spec.ts`
Expected: PASS — 1 test.

- [ ] **Step 5: Run the whole suite and type-check**

Run: `cd D:\Source\ponta\ponta_drive\frontend && npm run test:run && npm run type-check`
Expected: all tests PASS (the old `useUpload.spec.ts` is gone; its cases now live in `src/stores/__tests__/upload.spec.ts`), type-check clean.

- [ ] **Step 6: Commit**

```bash
cd D:\Source\ponta\ponta_drive\frontend
git add src/App.vue src/__tests__/App.spec.ts
git commit -m "feat(upload): mount the progress panel at the app shell"
```

---

## Self-Review

- **Spec coverage:** §4.1 store → Task 1; §4.2 dialog preview + close-on-start + remove in-dialog queue → Task 2; §4.3 panel → Task 3; §4.4 mount in App.vue → Task 4; §5 i18n → Tasks 2 and 3; §6 testing → every task's tests. All covered.
- **Placeholder scan:** no TBD/TODO; every code step carries full code.
- **Type consistency:** `UploadQueueItem`, `UploadMethod`, `StartUploadOptions`, `useUploadStore`, `uploadQueue`, `isUploading`, `startUpload`, `cancelItem`, `clearQueue` are used with the same names and shapes across all four tasks. `humanizeBytes` is imported from `@/lib/format` (verified it exists). `upload_panel_cancel` is used in both Task 3's component and its test.
- **Review focus:** five failure modes, each pinned — #1 in Task 1 (`appends a second batch…`, `derives isUploading…`), #2 in Task 2 (`does not clear a running upload queue when reopened`), #3 in Task 3 (`renders nothing when the queue is empty`), #4 in Task 1 (cancel tests) and Task 3 (`cancels an in-flight item through the store`), #5 in Task 2 (`does NOT close or start when nothing is selected`).

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
    // Hold reactive references to the newly appended items: `batch` contains
    // plain objects, and mutating them directly bypasses Vue's reactivity
    // tracking (the computed `isUploading` would never see the status change).
    // The slice returns the same proxy objects that live in the ref, so writes
    // through them — `status`, `progress`, `abortController` — stay reactive.
    const reactiveBatch = uploadQueue.value.slice(uploadQueue.value.length - batch.length)

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

    for (const qItem of reactiveBatch) {
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

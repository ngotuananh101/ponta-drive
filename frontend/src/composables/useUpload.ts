import { ref } from 'vue'
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
  cloudAccountUuid: string
  parentUuid?: string | null
  files: File[]
  method: UploadMethod
  onItemCompleted?: (item: DriveItem) => void
}

export function useUpload() {
  const queue = ref<UploadQueueItem[]>([])
  const isUploading = ref(false)
  const driveStore = useDriveItemsStore()
  const cloudStore = useCloudAccountsStore()

  function cancelItem(itemId: string) {
    const item = queue.value.find((i) => i.id === itemId)
    if (item && item.status === 'uploading') {
      item.abortController?.abort()
      item.status = 'aborted'
    }
  }

  function clearQueue() {
    queue.value = []
  }

  async function uploadDirect(
    queueItem: UploadQueueItem,
    cloudAccountUuid: string,
    parentUuid: string | null | undefined,
  ): Promise<DriveItem> {
    const controller = new AbortController()
    queueItem.abortController = controller
    queueItem.status = 'uploading'

    const initRes = await initiatePresignedUpload({
      cloudAccountUuid,
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
    cloudAccountUuid: string,
    parentUuid: string | null | undefined,
  ): Promise<DriveItem> {
    const controller = new AbortController()
    queueItem.abortController = controller
    queueItem.status = 'uploading'

    const chunkSize = 5 * 1024 * 1024 // 5MB
    const initRes = await initiateMultipartUpload({
      cloudAccountUuid,
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
    isUploading.value = true
    const completedItems: DriveItem[] = []

    queue.value = options.files.map((file, idx) => ({
      id: `${Date.now()}-${idx}-${file.name}`,
      file,
      relativePath: (file as unknown as { webkitRelativePath?: string }).webkitRelativePath || '',
      progress: 0,
      status: 'pending' as const,
    }))

    // Folder upload: recreate the directory tree before uploading files so a
    // picked folder tree preserves its nested structure instead of flattening
    // into the current directory. See spec §6.4.
    const hasTree = queue.value.some((q) => q.relativePath !== '')
    // Map from directory path (without trailing slash; '' = parent) -> folder uuid.
    const dirUuidByPath: Record<string, string | null> = { '': options.parentUuid ?? null }

    if (hasTree) {
      // Collect every directory path implied by a file's relativePath, then sort
      // by depth ascending so parents are created before children.
      const dirPaths = new Set<string>()
      for (const q of queue.value) {
        const relPath = q.relativePath ?? ''
        const parts = relPath.split('/')
        // parts[last] is the filename; accumulate every ancestor directory.
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
          // Top-level directory: reuse an existing same-named folder in the
          // current listing, otherwise create (and insert) a new one.
          const existing = driveStore.items.find(
            (i) => i.type === 'folder' && i.name === name,
          )
          if (existing) {
            uuid = existing.uuid
          } else {
            const created = await driveStore.createFolder(options.cloudAccountUuid, parentUuid, name)
            uuid = created.uuid
          }
        } else {
          // Nested directory: create via the raw API (do NOT insert into the
          // current listing, which would misplace the sub-folder).
          const res = await createDriveFolder({ cloudAccountUuid: options.cloudAccountUuid, parentUuid, name })
          uuid = (res.data as DriveItem).uuid
        }
        dirUuidByPath[dirPath] = uuid
      }
    }

    for (const qItem of queue.value) {
      try {
        // Resolve the target parent folder for this file. Flat selections
        // (empty relativePath) upload into the original parent.
        const relPath = qItem.relativePath ?? ''
        const targetParent: string | null = hasTree
          ? (dirUuidByPath[relPath.replace(/\/[^/]*$/, '')] ?? options.parentUuid ?? null)
          : options.parentUuid ?? null
        let item: DriveItem
        if (options.method === 'direct') {
          item = await uploadDirect(qItem, options.cloudAccountUuid, targetParent)
        } else {
          item = await uploadServerMultipart(qItem, options.cloudAccountUuid, targetParent)
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

    isUploading.value = false
    // Refresh cloud accounts store so storage figures move
    void cloudStore.fetch()

    return completedItems
  }

  return {
    uploadQueue: queue,
    isUploading,
    startUpload,
    cancelItem,
    clearQueue,
  }
}

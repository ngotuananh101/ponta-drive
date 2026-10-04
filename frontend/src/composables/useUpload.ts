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

    for (const qItem of queue.value) {
      try {
        let item: DriveItem
        if (options.method === 'direct') {
          item = await uploadDirect(qItem, options.cloudAccountUuid, options.parentUuid)
        } else {
          item = await uploadServerMultipart(qItem, options.cloudAccountUuid, options.parentUuid)
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

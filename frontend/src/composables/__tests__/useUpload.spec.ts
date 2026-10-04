import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUpload } from '../useUpload'
import * as uploadApi from '@/api/upload'
import type { DriveItem } from '@/api/driveItems'

const mockItem: DriveItem = {
  uuid: 'uploaded-1',
  name: 'file.txt',
  type: 'file',
  mime_type: 'text/plain',
  size: 100,
  extension: 'txt',
  cloud_account_uuid: 'cloud-1',
  is_starred: false,
  status: 'ready',
  updated_at: '2026-10-04 00:00:00',
}

describe('useUpload composable', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('runs direct upload flow', async () => {
    const initSpy = vi.spyOn(uploadApi, 'initiatePresignedUpload').mockResolvedValue({
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
    const directSpy = vi.spyOn(uploadApi, 'uploadDirectToS3').mockResolvedValue()
    const compSpy = vi.spyOn(uploadApi, 'completePresignedUpload').mockResolvedValue({
      status: 'ok',
      data: mockItem,
    })

    const { uploadQueue, startUpload } = useUpload()
    const file = new File(['content'], 'test.txt', { type: 'text/plain' })

    const res = await startUpload({
      cloudAccountUuid: 'cloud-1',
      parentUuid: null,
      files: [file],
      method: 'direct',
    })

    expect(initSpy).toHaveBeenCalled()
    expect(directSpy).toHaveBeenCalled()
    expect(compSpy).toHaveBeenCalledWith('item-1')
    expect(res).toHaveLength(1)
    expect(uploadQueue.value[0].status).toBe('completed')
    expect(uploadQueue.value[0].progress).toBe(100)
  })

  it('runs server multipart upload flow', async () => {
    const initSpy = vi
      .spyOn(uploadApi, 'initiateMultipartUpload')
      .mockResolvedValue({
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

    const { uploadQueue, startUpload } = useUpload()
    const file = new File(['content'], 'test.txt', { type: 'text/plain' })

    const res = await startUpload({
      cloudAccountUuid: 'cloud-1',
      parentUuid: null,
      files: [file],
      method: 'server',
    })

    expect(initSpy).toHaveBeenCalled()
    expect(chunkSpy).toHaveBeenCalledTimes(1)
    expect(compSpy).toHaveBeenCalledWith('session-1')
    expect(res).toHaveLength(1)
    expect(uploadQueue.value[0].status).toBe('completed')
  })

  it('aborts a server multipart upload mid-chunk and calls abortMultipartUpload', async () => {
    const initSpy = vi
      .spyOn(uploadApi, 'initiateMultipartUpload')
      .mockResolvedValue({
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

    // Each chunk upload rejects with an AbortError so the loop stops mid-flight.
    const chunkSpy = vi
      .spyOn(uploadApi, 'uploadMultipartChunk')
      .mockRejectedValue(new DOMException('Upload aborted', 'AbortError'))
    const compSpy = vi.spyOn(uploadApi, 'completeMultipartUpload').mockResolvedValue({ status: 'ok', data: mockItem })

    const { uploadQueue, startUpload, cancelItem } = useUpload()
    const file = new File(['a'.repeat(20)], 'test.txt', { type: 'text/plain' })

    const promise = startUpload({
      cloudAccountUuid: 'cloud-1',
      parentUuid: null,
      files: [file],
      method: 'server',
    })

    // Start the upload (synchronous kickoff), then cancel the in-flight item.
    await Promise.resolve()
    const item = uploadQueue.value[0]
    expect(item.status).toBe('uploading')
    cancelItem(item.id)

    const res = await promise

    expect(initSpy).toHaveBeenCalled()
    expect(abortSpy).toHaveBeenCalledWith('session-1')
    expect(res).toHaveLength(0)
    expect(uploadQueue.value[0].status).toBe('aborted')
    // completeMultipartUpload should never have been called because the upload was aborted.
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

    const { uploadQueue, startUpload } = useUpload()
    const file = new File(['content'], 'test.txt', { type: 'text/plain' })

    const res = await startUpload({
      cloudAccountUuid: 'cloud-1',
      parentUuid: null,
      files: [file],
      method: 'server',
    })

    expect(res).toHaveLength(0)
    expect(uploadQueue.value[0].status).toBe('failed')
    expect(uploadQueue.value[0].error).toContain('Network error')
  })

  it('cancels a direct upload via abortController', async () => {
    const initSpy = vi.spyOn(uploadApi, 'initiatePresignedUpload').mockResolvedValue({
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
    const directSpy = vi
      .spyOn(uploadApi, 'uploadDirectToS3')
      .mockRejectedValue(new DOMException('Upload aborted', 'AbortError'))
    vi.spyOn(uploadApi, 'completePresignedUpload').mockResolvedValue({ status: 'ok', data: mockItem })

    const { uploadQueue, startUpload, cancelItem } = useUpload()
    const file = new File(['content'], 'test.txt', { type: 'text/plain' })

    const promise = startUpload({
      cloudAccountUuid: 'cloud-1',
      parentUuid: null,
      files: [file],
      method: 'direct',
    })

    await Promise.resolve()
    const item = uploadQueue.value[0]
    cancelItem(item.id)

    const res = await promise

    expect(initSpy).toHaveBeenCalled()
    expect(directSpy).toHaveBeenCalled()
    expect(res).toHaveLength(0)
    expect(uploadQueue.value[0].status).toBe('aborted')
  })

  it('clearQueue empties the upload queue', async () => {
    vi.spyOn(uploadApi, 'initiatePresignedUpload').mockResolvedValue({
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
    vi.spyOn(uploadApi, 'uploadDirectToS3').mockResolvedValue()
    vi.spyOn(uploadApi, 'completePresignedUpload').mockResolvedValue({ status: 'ok', data: mockItem })

    const { uploadQueue, startUpload, clearQueue } = useUpload()
    const file = new File(['content'], 'test.txt', { type: 'text/plain' })

    await startUpload({
      cloudAccountUuid: 'cloud-1',
      parentUuid: null,
      files: [file],
      method: 'direct',
    })

    expect(uploadQueue.value).toHaveLength(1)

    clearQueue()
    expect(uploadQueue.value).toHaveLength(0)
  })
})

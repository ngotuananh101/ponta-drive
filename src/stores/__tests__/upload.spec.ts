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

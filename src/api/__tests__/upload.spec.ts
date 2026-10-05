import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as client from '../client'
import {
  initiatePresignedUpload,
  completePresignedUpload,
  initiateMultipartUpload,
  completeMultipartUpload,
  abortMultipartUpload,
  uploadDirectToS3,
  uploadMultipartChunk,
  uploadMultipartPart,
} from '../upload'

describe('upload API endpoints', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('initiatePresignedUpload posts correct payload', async () => {
    const spy = vi.spyOn(client, 'fetchApi').mockResolvedValue({ status: 'ok' })
    await initiatePresignedUpload({
      cloudAccountUuid: 'c-1',
      fileName: 'photo.jpg',
      size: 2048,
      mimeType: 'image/jpeg',
    })

    expect(spy).toHaveBeenCalledWith('/v1/drive/upload/presigned', {
      method: 'POST',
      body: JSON.stringify({
        cloud_account_uuid: 'c-1',
        file_name: 'photo.jpg',
        size: 2048,
        mime_type: 'image/jpeg',
      }),
    })
  })

  it('completePresignedUpload posts item_uuid', async () => {
    const spy = vi.spyOn(client, 'fetchApi').mockResolvedValue({ status: 'ok' })
    await completePresignedUpload('item-abc')

    expect(spy).toHaveBeenCalledWith('/v1/drive/upload/presigned/complete', {
      method: 'POST',
      body: JSON.stringify({ item_uuid: 'item-abc' }),
    })
  })

  it('multipart lifecycle endpoints make expected calls', async () => {
    const spy = vi.spyOn(client, 'fetchApi').mockResolvedValue({ status: 'ok' })

    await initiateMultipartUpload({
      cloudAccountUuid: 'c-1',
      fileName: 'video.mp4',
      size: 10485760,
      mimeType: 'video/mp4',
      chunkSize: 5242880,
    })
    expect(spy).toHaveBeenCalledWith('/v1/drive/upload/multipart/init', expect.objectContaining({ method: 'POST' }))

    await completeMultipartUpload('sess-1')
    expect(spy).toHaveBeenCalledWith('/v1/drive/upload/multipart/complete', {
      method: 'POST',
      body: JSON.stringify({ session_id: 'sess-1' }),
    })

    await abortMultipartUpload('sess-1')
    expect(spy).toHaveBeenCalledWith('/v1/drive/upload/multipart/abort', {
      method: 'POST',
      body: JSON.stringify({ session_id: 'sess-1' }),
    })
  })
})

interface ProgressLike {
  lengthComputable: boolean
  loaded: number
  total: number
}

interface MockXhrUpload {
  onprogress: ((e: ProgressLike) => void) | null
}

/**
 * Creates a mock XHR instance with controllable event triggers.
 * The instance is stored in `mockXhrInstance` so the test can drive it.
 */
let mockXhrInstance: MockXhr

/**
 * Captures the freshly constructed instance. Storing `this` on a module
 * variable inside the constructor trips oxlint's `no-this-alias`; routing it
 * through a free function keeps the capture explicit and lint-clean.
 */
function captureXhr(instance: MockXhr) {
  mockXhrInstance = instance
}

class MockXhr {
  open = vi.fn()
  setRequestHeader = vi.fn()
  send = vi.fn()
  abort = vi.fn(() => {
    this.onabort?.({} as Event)
  })
  status = 200

  upload: MockXhrUpload = {
    onprogress: null,
  }

  onload: ((e: Event) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  onabort: ((e: Event) => void) | null = null

  constructor() {
    captureXhr(this)
  }

  _triggerLoad = () => this.onload?.({} as Event)
  _triggerError = () => this.onerror?.({} as Event)
  _triggerProgress = (e: ProgressLike) => this.upload.onprogress?.(e)
  _setStatus = (s: number) => {
    this.status = s
  }
}

describe('XHR upload helpers', () => {
  let originalXMLHttpRequest: typeof XMLHttpRequest
  let originalFormData: typeof FormData

  beforeEach(() => {
    vi.restoreAllMocks()
    originalXMLHttpRequest = globalThis.XMLHttpRequest
    originalFormData = globalThis.FormData

    globalThis.XMLHttpRequest = MockXhr as unknown as typeof XMLHttpRequest
  })

  afterEach(() => {
    globalThis.XMLHttpRequest = originalXMLHttpRequest
    globalThis.FormData = originalFormData
  })

  it('uploadDirectToS3 sends PUT with headers and resolves on 200', async () => {
    const file = new Blob(['content'], { type: 'image/jpeg' })

    const promise = uploadDirectToS3('https://s3.example.com/upload', 'PUT', {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    }, file)

    // Let the Promise constructor run and create the mock XHR
    await new Promise((r) => setTimeout(r, 0))

    mockXhrInstance._setStatus(200)
    mockXhrInstance._triggerLoad()

    await expect(promise).resolves.toBeUndefined()
    expect(mockXhrInstance.open).toHaveBeenCalledWith('PUT', 'https://s3.example.com/upload', true)
    expect(mockXhrInstance.setRequestHeader).toHaveBeenCalledWith('X-Amz-Algorithm', 'AWS4-HMAC-SHA256')
    expect(mockXhrInstance.send).toHaveBeenCalledWith(file)
  })

  it('uploadDirectToS3 rejects on non-2xx status', async () => {
    const file = new Blob(['content'])

    const promise = uploadDirectToS3('https://s3.example.com/upload', 'PUT', {}, file)

    await new Promise((r) => setTimeout(r, 0))

    mockXhrInstance._setStatus(403)
    mockXhrInstance._triggerLoad()

    await expect(promise).rejects.toThrow('Direct S3 upload failed with status 403')
  })

  it('uploadDirectToS3 reports progress via callback', async () => {
    const onProgress = vi.fn()
    const file = new Blob(['content'])

    const promise = uploadDirectToS3('url', 'PUT', {}, file, onProgress)

    await new Promise((r) => setTimeout(r, 0))

    mockXhrInstance._setStatus(200)
    mockXhrInstance._triggerProgress({ lengthComputable: true, loaded: 50, total: 100 })
    mockXhrInstance._triggerLoad()

    await promise
    expect(onProgress).toHaveBeenCalledWith(50, 50, 100)
  })

  it('uploadDirectToS3 supports AbortSignal', async () => {
    const controller = new AbortController()
    const file = new Blob(['content'])

    const promise = uploadDirectToS3('url', 'PUT', {}, file, { signal: controller.signal })

    await new Promise((r) => setTimeout(r, 0))

    controller.abort()

    await expect(promise).rejects.toThrow('Upload aborted')
    expect(mockXhrInstance.abort).toHaveBeenCalled()
  })

  it('uploadDirectToS3 resolves immediately if signal already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const file = new Blob(['content'])
    const promise = uploadDirectToS3('url', 'PUT', {}, file, { signal: controller.signal })

    await expect(promise).rejects.toThrow('Upload aborted')
  })

  it('uploadMultipartChunk sends POST with FormData and resolves on 200', async () => {
    vi.spyOn(globalThis, 'FormData').mockImplementation(function (this: {
      entries: ReturnType<typeof vi.fn>
      append: ReturnType<typeof vi.fn>
      get: ReturnType<typeof vi.fn>
    }) {
      this.entries = vi.fn().mockReturnValue([])
      this.append = vi.fn()
      this.get = vi.fn()
    } as unknown as typeof FormData)

    mockXhrInstance._setStatus(200)
    localStorage.setItem('token', 'test-token')

    const chunk = new Blob(['chunk-data'], { type: 'video/mp4' })
    const promise = uploadMultipartChunk('sess-1', 1, chunk)

    await new Promise((r) => setTimeout(r, 0))

    mockXhrInstance._triggerLoad()
    await expect(promise).resolves.toBeUndefined()
    expect(mockXhrInstance.open).toHaveBeenCalledWith('POST', expect.stringContaining('/v1/drive/upload/multipart/part'), true)
    expect(mockXhrInstance.setRequestHeader).toHaveBeenCalledWith('Authorization', 'Bearer test-token')
    expect(mockXhrInstance.setRequestHeader).toHaveBeenCalledWith('Accept', 'application/json')
    expect(mockXhrInstance.send).toHaveBeenCalled()
  })

  it('uploadMultipartChunk rejects on network error', async () => {
    const chunk = new Blob(['chunk-data'])
    const promise = uploadMultipartChunk('sess-1', 1, chunk)

    await new Promise((r) => setTimeout(r, 0))

    mockXhrInstance._triggerError()
    await expect(promise).rejects.toThrow('Network error during multipart part upload')
  })

  it('uploadMultipartPart is an alias for uploadMultipartChunk', () => {
    expect(uploadMultipartPart).toBe(uploadMultipartChunk)
  })

  it('uploadMultipartChunk reports progress and supports AbortSignal', async () => {
    const onProgress = vi.fn()
    const controller = new AbortController()

    mockXhrInstance._setStatus(200)

    const chunk = new Blob(['chunk-data'])
    const promise = uploadMultipartChunk('sess-1', 2, chunk, { onProgress, signal: controller.signal })

    await new Promise((r) => setTimeout(r, 0))

    mockXhrInstance._triggerProgress({ lengthComputable: true, loaded: 25, total: 100 })
    mockXhrInstance._triggerLoad()

    await promise
    expect(onProgress).toHaveBeenCalledWith(25, 25, 100)
    controller.abort()
  })
})

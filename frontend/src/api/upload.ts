import { fetchApi, type ApiResponse } from './client'
import type { DriveItem } from './driveItems'

export interface PresignedUploadInitPayload {
  cloudAccountUuid: string
  parentUuid?: string | null
  fileName: string
  size: number
  mimeType: string
}

export interface PresignedUploadInitResponse {
  item_uuid: string
  upload_url: string
  method: string
  headers: Record<string, string>
  expires_at: string
  item: DriveItem
}

export async function initiatePresignedUpload(
  payload: PresignedUploadInitPayload,
): Promise<ApiResponse<PresignedUploadInitResponse>> {
  const body: Record<string, unknown> = {
    cloud_account_uuid: payload.cloudAccountUuid,
    file_name: payload.fileName,
    size: payload.size,
    mime_type: payload.mimeType,
  }
  if (payload.parentUuid) body.parent_uuid = payload.parentUuid

  return fetchApi<ApiResponse<PresignedUploadInitResponse>>('/v1/drive/upload/presigned', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function completePresignedUpload(
  itemUuid: string,
): Promise<ApiResponse<DriveItem>> {
  return fetchApi<ApiResponse<DriveItem>>('/v1/drive/upload/presigned/complete', {
    method: 'POST',
    body: JSON.stringify({ item_uuid: itemUuid }),
  })
}

export interface MultipartUploadInitPayload {
  cloudAccountUuid: string
  parentUuid?: string | null
  fileName: string
  size: number
  mimeType: string
  chunkSize?: number
}

export interface MultipartUploadInitResponse {
  session_id: string
  upload_id: string
  total_parts: number
  chunk_size: number
  storage_path: string
}

export async function initiateMultipartUpload(
  payload: MultipartUploadInitPayload,
): Promise<ApiResponse<MultipartUploadInitResponse>> {
  const body: Record<string, unknown> = {
    cloud_account_uuid: payload.cloudAccountUuid,
    file_name: payload.fileName,
    size: payload.size,
    mime_type: payload.mimeType,
  }
  if (payload.parentUuid) body.parent_uuid = payload.parentUuid
  if (payload.chunkSize) body.chunk_size = payload.chunkSize

  return fetchApi<ApiResponse<MultipartUploadInitResponse>>('/v1/drive/upload/multipart/init', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function completeMultipartUpload(
  sessionId: string,
): Promise<ApiResponse<DriveItem>> {
  return fetchApi<ApiResponse<DriveItem>>('/v1/drive/upload/multipart/complete', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId }),
  })
}

export async function abortMultipartUpload(sessionId: string): Promise<ApiResponse> {
  return fetchApi<ApiResponse>('/v1/drive/upload/multipart/abort', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId }),
  })
}

export type ProgressCallback = (percent: number, loaded: number, total: number) => void

export interface XhrUploadOptions {
  onProgress?: ProgressCallback
  signal?: AbortSignal
}

/**
 * Accepts either an options object or a plain progress callback.
 */
type UploadOptionsParameter = XhrUploadOptions | ProgressCallback

/**
 * Normalises the `options` argument into a consistent shape: an `XhrUploadOptions`
 * object. If a plain callback function was passed, it is wrapped as `onProgress`.
 */
function normalizeUploadOptions(options?: UploadOptionsParameter): XhrUploadOptions {
  if (typeof options === 'function') {
    return { onProgress: options }
  }
  return options ?? {}
}

/**
 * Uploads a file directly to S3 via presigned PUT using XMLHttpRequest for progress events.
 */
export function uploadDirectToS3(
  url: string,
  method: string,
  headers: Record<string, string>,
  file: Blob,
  options?: UploadOptionsParameter,
): Promise<void> {
  const opts = normalizeUploadOptions(options)

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method || 'PUT', url, true)

    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v)
    }

    if (opts.onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100)
          opts.onProgress?.(percent, e.loaded, e.total)
        }
      }
    }

    const onAbort = () => {
      xhr.abort()
      if (opts.signal) {
        opts.signal.removeEventListener('abort', onAbort)
      }
    }

    xhr.onload = () => {
      if (opts.signal) {
        opts.signal.removeEventListener('abort', onAbort)
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(`Direct S3 upload failed with status ${xhr.status}`))
      }
    }

    xhr.onerror = () => {
      if (opts.signal) {
        opts.signal.removeEventListener('abort', onAbort)
      }
      reject(new Error('Network error during direct S3 upload'))
    }

    xhr.onabort = () => {
      if (opts.signal) {
        opts.signal.removeEventListener('abort', onAbort)
      }
      reject(new DOMException('Upload aborted', 'AbortError'))
    }

    if (opts.signal?.aborted) {
      xhr.abort()
      return
    }

    if (opts.signal) {
      opts.signal.addEventListener('abort', onAbort, { once: true })
    }

    xhr.send(file)
  })
}

/**
 * Uploads a chunk part to the backend multipart part endpoint using FormData.
 */
export function uploadMultipartChunk(
  sessionId: string,
  partNumber: number,
  chunk: Blob,
  options?: UploadOptionsParameter,
): Promise<void> {
  const opts = normalizeUploadOptions(options)

  return new Promise((resolve, reject) => {
    const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')
    const url = `${API_BASE_URL}/v1/drive/upload/multipart/part`

    const xhr = new XMLHttpRequest()
    xhr.open('POST', url, true)

    const token = localStorage.getItem('token')
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('Accept', 'application/json')

    const formData = new FormData()
    formData.append('session_id', sessionId)
    formData.append('part_number', String(partNumber))
    formData.append('file', chunk)

    if (opts.onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100)
          opts.onProgress?.(percent, e.loaded, e.total)
        }
      }
    }

    const onAbort = () => {
      xhr.abort()
      if (opts.signal) {
        opts.signal.removeEventListener('abort', onAbort)
      }
    }

    xhr.onload = () => {
      if (opts.signal) {
        opts.signal.removeEventListener('abort', onAbort)
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(`Part upload failed with status ${xhr.status}`))
      }
    }

    xhr.onerror = () => {
      if (opts.signal) {
        opts.signal.removeEventListener('abort', onAbort)
      }
      reject(new Error('Network error during multipart part upload'))
    }

    xhr.onabort = () => {
      if (opts.signal) {
        opts.signal.removeEventListener('abort', onAbort)
      }
      reject(new DOMException('Upload aborted', 'AbortError'))
    }

    if (opts.signal?.aborted) {
      xhr.abort()
      return
    }

    if (opts.signal) {
      opts.signal.addEventListener('abort', onAbort, { once: true })
    }

    xhr.send(formData)
  })
}

/**
 * Alias for `uploadMultipartChunk` to match the brief's naming convention
 * (used by Task 9's `useUpload.ts`).
 */
export const uploadMultipartPart = uploadMultipartChunk

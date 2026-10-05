import { fetchApi, type ApiResponse } from './client'

export interface DriveItem {
  /** Stable public identifier, used for keys and selection in the UI. */
  uuid: string
  name: string
  type: 'file' | 'folder'
  mime_type: string
  size: number
  extension: string
  cloud_account_uuid: string
  is_starred: boolean
  status: string
  updated_at: string
}

export interface DriveListMeta {
  has_more: boolean
  next_cursor: string
}

export interface DriveListResponse extends ApiResponse<DriveItem[]> {
  meta?: DriveListMeta
}

export interface DriveListParams {
  cloudAccountUuid: string
  parentUuid?: string | null
  search?: string
  type?: string
  sort?: string
  order?: string
  cursor?: string
  limit?: number
}

/**
 * Builds the query string for the list endpoint.
 *
 * Split out from `listDriveItems` so the parameter names can be tested without
 * mocking `fetch`. A dropped or misspelled parameter is invisible in the UI:
 * the list simply ignores the sort the user picked and keeps the old order.
 */
export function buildDriveItemsQuery(params: DriveListParams): string {
  const query = new URLSearchParams()
  query.set('cloud_account_uuid', params.cloudAccountUuid)
  if (params.parentUuid) query.set('parent_uuid', params.parentUuid)
  if (params.search) query.set('search', params.search)
  if (params.type) query.set('type', params.type)
  if (params.sort) query.set('sort', params.sort)
  if (params.order) query.set('order', params.order)
  if (params.cursor) query.set('cursor', params.cursor)
  if (params.limit) query.set('limit', String(params.limit))
  return query.toString()
}

/**
 * Lists one page of drive items.
 *
 * The cursor is opaque: it encodes the sort position, so the client must not
 * build or modify one. It also means a cursor is only valid for the exact
 * filter and sort it was produced under, which is why the caller resets the
 * list whenever any of those change.
 */
export async function listDriveItems(
  params: DriveListParams,
  signal?: AbortSignal,
): Promise<DriveListResponse> {
  return fetchApi<DriveListResponse>(`/v1/drive/items?${buildDriveItemsQuery(params)}`, { signal })
}

/**
 * Resolves a folder's ancestor chain, root first and ending with the folder
 * itself. The drive URL carries only the current folder's uuid, so this is what
 * turns that uuid back into a full breadcrumb after a reload or a shared link.
 */
export async function getDriveItemBreadcrumb(
  uuid: string,
  signal?: AbortSignal,
): Promise<ApiResponse<DriveItem[]>> {
  return fetchApi<ApiResponse<DriveItem[]>>(
    `/v1/drive/items/${encodeURIComponent(uuid)}/breadcrumb`,
    { signal },
  )
}

export interface CreateFolderPayload {
  cloudAccountUuid: string
  parentUuid?: string | null
  name: string
}

export async function createDriveFolder(
  payload: CreateFolderPayload,
): Promise<ApiResponse<DriveItem>> {
  const body: Record<string, string> = {
    cloud_account_uuid: payload.cloudAccountUuid,
  }
  if (payload.parentUuid) {
    body.parent_uuid = payload.parentUuid
  }
  body.name = payload.name.trim()
  return fetchApi<ApiResponse<DriveItem>>('/v1/drive/items/folders', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function renameDriveItem(
  uuid: string,
  name: string,
): Promise<ApiResponse<DriveItem>> {
  return fetchApi<ApiResponse<DriveItem>>(`/v1/drive/items/${encodeURIComponent(uuid)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: name.trim() }),
  })
}

/**
 * Moves an item to another folder. An empty `parent_uuid` moves it to the root,
 * matching the backend's `req.ParentUUID != ""` check.
 */
export async function moveDriveItem(
  uuid: string,
  parentUuid: string | null,
): Promise<ApiResponse<DriveItem>> {
  return fetchApi<ApiResponse<DriveItem>>(`/v1/drive/items/${encodeURIComponent(uuid)}`, {
    method: 'PATCH',
    body: JSON.stringify({ parent_uuid: parentUuid ?? '' }),
  })
}

export async function deleteDriveItem(
  uuid: string,
  permanent = true,
): Promise<ApiResponse> {
  const query = permanent ? '?permanent=true' : ''
  return fetchApi<ApiResponse>(`/v1/drive/items/${encodeURIComponent(uuid)}${query}`, {
    method: 'DELETE',
  })
}

export async function toggleStarDriveItem(uuid: string): Promise<ApiResponse<DriveItem>> {
  return fetchApi<ApiResponse<DriveItem>>(`/v1/drive/items/${encodeURIComponent(uuid)}/star`, {
    method: 'POST',
  })
}

export interface DownloadUrlResponse {
  download_url: string
  item: DriveItem
}

export async function getDriveItemDownloadUrl(
  uuid: string,
): Promise<ApiResponse<DownloadUrlResponse>> {
  return fetchApi<ApiResponse<DownloadUrlResponse>>(
    `/v1/drive/items/${encodeURIComponent(uuid)}/download?mode=json`,
  )
}

import { fetchApi, type ApiResponse } from './client'

export interface DriveItem {
  /** Numeric primary key. This is what `parent_id` refers to. */
  id: number
  /** Stable public identifier, used for keys and selection in the UI. */
  uuid: string
  name: string
  type: 'file' | 'folder'
  mime_type: string
  size: number
  extension: string
  cloud_account_id: number
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
  cloudAccountId: number
  parentId?: number | null
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
  query.set('cloud_account_id', String(params.cloudAccountId))
  if (params.parentId) query.set('parent_id', String(params.parentId))
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

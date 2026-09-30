import { fetchApi, type ApiResponse } from './client'

/**
 * Credentials as the API returns them. `secret_access_key` is deliberately
 * absent: the backend never sends it back, and a type that promised it would
 * invite code that reads it.
 */
export interface CloudAccountCredentials {
  endpoint: string
  bucket: string
  region: string
  access_key_id: string
  use_path_style: boolean
  public_url: string
}

export interface CloudAccount {
  id: number
  name: string
  provider: string
  credentials: CloudAccountCredentials | null
  sync_status: 'idle' | 'syncing' | 'error'
  total_storage: number
  used_storage: number
  last_synced_at: string | null
  is_default: boolean
  is_active: boolean
}

/** Credentials as the client sends them, including the secret. */
export interface CloudAccountPayload {
  name: string
  provider: string
  endpoint: string
  bucket: string
  region: string
  access_key_id: string
  secret_access_key: string
  use_path_style: boolean
  public_url: string
  is_default?: boolean
}

export async function listCloudAccounts(): Promise<ApiResponse<CloudAccount[]>> {
  return fetchApi<ApiResponse<CloudAccount[]>>('/v1/cloud-accounts')
}

/** Validates credentials against the real bucket without persisting anything. */
export async function testCloudAccount(payload: CloudAccountPayload): Promise<ApiResponse> {
  return fetchApi<ApiResponse>('/v1/cloud-accounts/test', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function createCloudAccount(
  payload: CloudAccountPayload,
): Promise<ApiResponse<CloudAccount>> {
  return fetchApi<ApiResponse<CloudAccount>>('/v1/cloud-accounts', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function getCloudAccount(id: number): Promise<ApiResponse<CloudAccount>> {
  return fetchApi<ApiResponse<CloudAccount>>(`/v1/cloud-accounts/${id}`)
}

/**
 * `provider` is intentionally not part of the update payload: the backend's
 * UpdateCloudAccountRequest has no such field, so a provider cannot be changed
 * after creation. Leaving out `secret_access_key` keeps the stored one.
 */
export async function updateCloudAccount(
  id: number,
  payload: Partial<CloudAccountPayload>,
): Promise<ApiResponse<CloudAccount>> {
  return fetchApi<ApiResponse<CloudAccount>>(`/v1/cloud-accounts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function deleteCloudAccount(id: number): Promise<ApiResponse> {
  return fetchApi<ApiResponse>(`/v1/cloud-accounts/${id}`, { method: 'DELETE' })
}

export async function syncCloudAccount(id: number): Promise<ApiResponse> {
  return fetchApi<ApiResponse>(`/v1/cloud-accounts/${id}/sync`, { method: 'POST' })
}

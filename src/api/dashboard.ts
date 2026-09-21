import { fetchApi, type ApiResponse } from './client'

export interface CloudAccount {
  id: number
  name: string
  provider: string
  sync_status: 'idle' | 'syncing' | 'error'
  total_storage: number
  used_storage: number
  last_synced_at: string | null
  is_default: boolean
  is_active: boolean
}

export interface DriveItem {
  uuid: string
  name: string
  type: 'file' | 'folder'
  mime_type: string
  size: number
  cloud_account_id: number
  updated_at: string
  is_starred: boolean
}

export interface Activity {
  id: number
  action: string
  target_name: string
  target_uuid: string | null
  cloud_id: number | null
  ip_address: string
  user_agent: string
  created_at: string
}

export interface StorageSummary {
  used_bytes: number
  total_bytes: number
  used_human: string
  total_human: string
  percent: number
}

export interface DashboardSummary {
  clouds: CloudAccount[]
  suggested_files: DriveItem[]
  recent_activities: Activity[]
  total_storage: StorageSummary
}

export async function fetchDashboardSummary(): Promise<ApiResponse<DashboardSummary>> {
  return fetchApi<ApiResponse<DashboardSummary>>('/v1/dashboard/summary')
}

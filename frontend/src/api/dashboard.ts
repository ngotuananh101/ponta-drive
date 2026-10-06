import { fetchApi, type ApiResponse } from './client'
import { type CloudAccount } from './cloudAccounts'
import { type DriveItem } from './driveItems'

export type { CloudAccount }
export type { DriveItem }

export interface Activity {
  id: number
  action: string
  target_name: string
  target_uuid: string | null
  /** Numeric id of the cloud account the action touched, null when absent. */
  cloud_account_id: number | null
  ip_address: string
  user_agent: string
  /** Action-specific payload (e.g. `{ items_count: 12 }`), null when absent. */
  metadata: Record<string, unknown> | null
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

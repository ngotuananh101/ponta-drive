import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import { useCloudAccountsStore } from '@/stores/cloudAccounts'

/**
 * The "sync this account" behavior, shared by `SyncCloudButton` (the toolbar /
 * card control) and the sidebar's three-dot menu. It owns what every call site
 * would otherwise repeat: the success / failure toast.
 *
 * The store still tracks the in-flight state (`isSyncing`) — this composable
 * only wraps the request and its user-facing feedback.
 */
export function useCloudSync() {
  const { t } = useI18n()
  const store = useCloudAccountsStore()

  async function sync(uuid: string): Promise<void> {
    try {
      await store.sync(uuid)
      toast.success(t('cloud.sync_started'))
    } catch {
      toast.error(t('cloud.sync_failed'))
    }
  }

  return { sync }
}

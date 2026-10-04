import { defineStore } from 'pinia'
import { ref } from 'vue'

import {
  listCloudAccounts,
  createCloudAccount,
  updateCloudAccount,
  deleteCloudAccount,
  syncCloudAccount,
  type CloudAccount,
  type CloudAccountPayload,
} from '@/api/cloudAccounts'

/**
 * How long to wait between polls while a queued sync runs, and how many times
 * to poll before giving up. A full bucket scan can take minutes, so the loop is
 * bounded rather than waiting forever; the account's own `sync_status` is the
 * source of truth and the list refetch picks up the final state.
 */
const SYNC_POLL_INTERVAL_MS = 3000
const SYNC_POLL_MAX_ATTEMPTS = 10

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Holds the account list for the whole app.
 *
 * The sidebar, the home page and the drive view all render the same list. A
 * store keeps them from drifting apart - without one, adding an account leaves
 * the sidebar showing a stale copy.
 */
export const useCloudAccountsStore = defineStore('cloudAccounts', () => {
  const accounts = ref<CloudAccount[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  /**
   * Ids with a sync request in flight. The account's `sync_status` also goes to
   * "syncing", but that field is only as fresh as the last refetch; this set is
   * set the instant the button is pressed, so the spinner appears immediately
   * and every view can disable its button without waiting for a round trip.
   */
  const syncingIds = ref<Set<string>>(new Set())

  function isSyncing(uuid: string): boolean {
    return syncingIds.value.has(uuid)
  }

  function setSyncing(uuid: string, on: boolean): void {
    const next = new Set(syncingIds.value)
    if (on) {
      next.add(uuid)
    } else {
      next.delete(uuid)
    }
    // A Set is mutated in place; assigning a new one is what triggers Vue's
    // reactivity for `syncingIds`.
    syncingIds.value = next
  }

  async function fetch(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const res = await listCloudAccounts()
      accounts.value = res.data ?? []
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  async function create(payload: CloudAccountPayload): Promise<CloudAccount> {
    const res = await createCloudAccount(payload)
    const created = res.data as CloudAccount
    accounts.value = [...accounts.value, created]
    return created
  }

  async function update(uuid: string, payload: Partial<CloudAccountPayload>): Promise<void> {
    const res = await updateCloudAccount(uuid, payload)
    const updated = res.data as CloudAccount
    accounts.value = accounts.value.map((a) => (a.uuid === uuid ? updated : a))
  }

  async function remove(uuid: string): Promise<void> {
    await deleteCloudAccount(uuid)
    accounts.value = accounts.value.filter((a) => a.uuid !== uuid)
  }

  /**
   * Marks one account as the default. The backend clears `is_default` on the
   * user's other accounts in the same update, so the local list is updated the
   * same way rather than refetching to discover it.
   */
  async function setDefault(uuid: string): Promise<void> {
    const res = await updateCloudAccount(uuid, { is_default: true })
    const updated = res.data as CloudAccount
    accounts.value = accounts.value.map((a) =>
      a.uuid === uuid ? updated : { ...a, is_default: false },
    )
  }

  /**
   * Polls the account list until the given account leaves the "syncing" state,
   * then stops. Bounded by SYNC_POLL_MAX_ATTEMPTS so a scan that never finishes
   * (or a worker that died) cannot leave the UI spinning forever.
   *
   * The first check happens immediately: with the "sync" queue driver the scan
   * already finished by the time the request returned, so waiting a full
   * interval before the first fetch would show a needless spinner.
   */
  async function pollUntilSettled(uuid: string): Promise<void> {
    for (let attempt = 0; attempt < SYNC_POLL_MAX_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        await sleep(SYNC_POLL_INTERVAL_MS)
      }
      try {
        await fetch()
      } catch {
        // `fetch` records the error itself; keep polling, a transient failure
        // should not strand the account in the "syncing" state.
      }
      // Only a *confirmed* non-syncing status ends the loop. A missing account
      // means the refetch failed (the list is stale or empty), not that the
      // sync finished, so keep polling - the attempt bound stops it either way.
      const current = accounts.value.find((a) => a.uuid === uuid)
      if (current && current.sync_status !== 'syncing') {
        break
      }
    }
    setSyncing(uuid, false)
  }

  /**
   * Triggers a bucket sync and tracks it to completion. The request itself
   * returns as soon as the job is queued (or, with the sync driver, once the
   * scan finishes), so the account is shown as syncing and the list is polled
   * until `sync_status` settles.
   */
  async function sync(uuid: string): Promise<void> {
    setSyncing(uuid, true)
    // Reflect the queued state immediately so a view that reads the account
    // rather than `isSyncing(uuid)` shows the spinner too.
    accounts.value = accounts.value.map((a) =>
      a.uuid === uuid ? { ...a, sync_status: 'syncing' as const } : a,
    )
    try {
      await syncCloudAccount(uuid)
    } catch (e) {
      setSyncing(uuid, false)
      throw e
    }
    await pollUntilSettled(uuid)
  }

  return {
    accounts,
    loading,
    error,
    syncingIds,
    isSyncing,
    fetch,
    create,
    update,
    remove,
    setDefault,
    sync,
  }
})

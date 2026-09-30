import { defineStore } from 'pinia'
import { ref } from 'vue'

import {
  listCloudAccounts,
  createCloudAccount,
  updateCloudAccount,
  deleteCloudAccount,
  type CloudAccount,
  type CloudAccountPayload,
} from '@/api/cloudAccounts'

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

  async function update(id: number, payload: Partial<CloudAccountPayload>): Promise<void> {
    const res = await updateCloudAccount(id, payload)
    const updated = res.data as CloudAccount
    accounts.value = accounts.value.map((a) => (a.id === id ? updated : a))
  }

  async function remove(id: number): Promise<void> {
    await deleteCloudAccount(id)
    accounts.value = accounts.value.filter((a) => a.id !== id)
  }

  /**
   * Marks one account as the default. The backend clears `is_default` on the
   * user's other accounts in the same update, so the local list is updated the
   * same way rather than refetching to discover it.
   */
  async function setDefault(id: number): Promise<void> {
    const res = await updateCloudAccount(id, { is_default: true })
    const updated = res.data as CloudAccount
    accounts.value = accounts.value.map((a) =>
      a.id === id ? updated : { ...a, is_default: false },
    )
  }

  return { accounts, loading, error, fetch, create, update, remove, setDefault }
})

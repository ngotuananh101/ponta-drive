import { defineStore } from 'pinia'
import { ref } from 'vue'

import { listDriveItems, getDriveItemBreadcrumb, type DriveItem, type DriveListParams } from '@/api/driveItems'

export type DriveListQuery = Omit<DriveListParams, 'cursor' | 'limit'>

/**
 * Whether a rejection is this store's own `abort()` rather than a real failure.
 *
 * Matched on `name` rather than `instanceof DOMException`: the error crosses
 * realms (happy-dom's DOMException is not the test runner's global one) and
 * `fetch` implementations differ on which class they reject with.
 */
function isAbortError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError'
}

/**
 * Page state for the drive listing.
 *
 * Two mechanisms guard against out-of-order responses, and both are needed:
 *
 *  - `requestId` decides which response may write. Every load bumps it and
 *    captures the value locally; a response is applied only if its id is still
 *    the newest. Without it, a slow request issued before a search would land
 *    after the search's own response and repaint the list with stale rows.
 *  - `AbortController` stops the request at the network. The id check alone
 *    would still let every superseded request run to completion and parse its
 *    body; aborting frees the connection and, on a fast scroll, is what keeps
 *    a burst of page requests from queueing up.
 */
export const useDriveItemsStore = defineStore('driveItems', () => {
  const items = ref<DriveItem[]>([])
  const cursor = ref('')
  const hasMore = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const breadcrumb = ref<DriveItem[]>([])

  let requestId = 0
  let inFlight: AbortController | null = null
  let lastQuery: DriveListQuery = { cloudAccountUuid: '' }

  function reset(): void {
    // Abort whatever is in flight, then bump the id so any response that
    // already resolved cannot append to the list that is about to be replaced.
    inFlight?.abort()
    inFlight = null
    requestId += 1
    items.value = []
    cursor.value = ''
    hasMore.value = false
    loading.value = false
    error.value = null
  }

  async function loadBreadcrumb(uuid: string): Promise<void> {
    if (!uuid) {
      breadcrumb.value = []
      return
    }
    try {
      const res = await getDriveItemBreadcrumb(uuid)
      breadcrumb.value = res.data ?? []
    } catch {
      // The bar is decorative: a failure leaves it empty rather than breaking
      // the listing, which loads independently.
      breadcrumb.value = []
    }
  }

  function clearBreadcrumb(): void {
    breadcrumb.value = []
  }

  function appendPage(page: DriveItem[]): void {
    const seen = new Set(items.value.map((i) => i.uuid))
    const fresh = page.filter((i) => !seen.has(i.uuid))
    items.value = [...items.value, ...fresh]
  }

  async function loadFirstPage(query: DriveListQuery): Promise<void> {
    reset()
    await load(query, '')
  }

  async function loadNextPage(): Promise<void> {
    if (!hasMore.value || loading.value) return
    await load(lastQuery, cursor.value)
  }

  async function load(query: DriveListQuery, from: string): Promise<void> {
    if (!query.cloudAccountUuid) return

    lastQuery = query
    const id = ++requestId
    // Supersede the previous request: it can no longer be wanted, and letting
    // it finish would only burn bandwidth and delay this one.
    inFlight?.abort()
    const controller = new AbortController()
    inFlight = controller

    loading.value = true
    error.value = null

    try {
      const res = await listDriveItems({ ...query, cursor: from }, controller.signal)
      if (id !== requestId) return

      appendPage(res.data ?? [])
      cursor.value = res.meta?.next_cursor ?? ''
      hasMore.value = res.meta?.has_more ?? false
    } catch (e) {
      // An abort is this store's own doing, not a failure worth showing. The id
      // check below would also drop it (the aborting request is always newer),
      // but naming the case keeps the intent readable and keeps this correct if
      // the abort is ever triggered from somewhere other than a newer load.
      if (isAbortError(e)) return
      if (id !== requestId) return
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      if (id === requestId) {
        loading.value = false
        inFlight = null
      }
    }
  }

  return { items, cursor, hasMore, loading, error, breadcrumb, clearBreadcrumb, loadBreadcrumb, reset, loadFirstPage, loadNextPage }
})

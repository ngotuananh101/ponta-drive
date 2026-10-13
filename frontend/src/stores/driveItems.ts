import { defineStore } from 'pinia'
import { ref } from 'vue'

import {
  listDriveItems,
  getDriveItemBreadcrumb,
  getDriveItem,
  createDriveFolder,
  renameDriveItem,
  moveDriveItem,
  deleteDriveItem,
  toggleStarDriveItem,
  type DriveItem,
  type DriveListParams,
} from '@/api/driveItems'

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
 * How long to wait between polls while a re-key runs, and how many times to
 * poll before giving up. A large folder move can take a while, so the loop is
 * bounded rather than waiting forever.
 */
export const MOVE_POLL_INTERVAL_MS = 2000
export const MOVE_POLL_MAX_ATTEMPTS = 30

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Thrown when a rename/move did not settle at `ready` — the backend re-key
 * failed, or the poll hit its attempt bound. Carries no message: the dialogs
 * map it to a localized string.
 */
export class MoveNotSettledError extends Error {
  constructor() {
    super('move did not settle')
    this.name = 'MoveNotSettledError'
  }
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
  let lastQuery: DriveListQuery = { cloudAccountId: 0 }

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

  function insertItem(item: DriveItem): void {
    const exists = items.value.some((i) => i.uuid === item.uuid)
    if (!exists) {
      if (item.type === 'folder') {
        items.value = [item, ...items.value]
      } else {
        // Folders first: find first non-folder index
        const firstFileIndex = items.value.findIndex((i) => i.type !== 'folder')
        if (firstFileIndex === -1) {
          items.value = [...items.value, item]
        } else {
          items.value.splice(firstFileIndex, 0, item)
        }
      }
    }
  }

  async function createFolder(
    cloudAccountId: number,
    parentUuid: string | null,
    name: string,
  ): Promise<DriveItem> {
    const res = await createDriveFolder({ cloudAccountId, parentUuid, name })
    const created = res.data as DriveItem
    insertItem(created)
    return created
  }

  /**
   * Waits for a rename/move to settle. The PATCH response is the first check:
   * with the "sync" queue driver the re-key already ran, so it is already
   * settled and no request is wasted. While it still reports `moving`, the
   * single item is polled until it leaves that state or the bound is hit.
   * Returns the settled item, or null if it never settled.
   */
  async function awaitMoveSettled(uuid: string, patched: DriveItem): Promise<DriveItem | null> {
    let current = patched
    for (let attempt = 0; attempt < MOVE_POLL_MAX_ATTEMPTS; attempt += 1) {
      if (current.status !== 'moving') {
        return current
      }
      await sleep(MOVE_POLL_INTERVAL_MS)
      try {
        const res = await getDriveItem(uuid)
        current = res.data as DriveItem
      } catch {
        // A transient poll failure should not strand the UI; keep polling
        // until the item settles or the bound stops the loop.
      }
    }
    return current.status !== 'moving' ? current : null
  }

  async function rename(uuid: string, newName: string): Promise<DriveItem> {
    const res = await renameDriveItem(uuid, newName)
    const patched = res.data as DriveItem
    const settled = await awaitMoveSettled(uuid, patched)
    if (!settled || settled.status !== 'ready') {
      throw new MoveNotSettledError()
    }
    items.value = items.value.map((i) => (i.uuid === uuid ? settled : i))
    return settled
  }

  async function move(uuid: string, parentUuid: string | null): Promise<DriveItem> {
    const res = await moveDriveItem(uuid, parentUuid)
    const patched = res.data as DriveItem
    const settled = await awaitMoveSettled(uuid, patched)
    if (!settled || settled.status !== 'ready') {
      // The move did not happen, so the item never left its folder: leave the
      // listing untouched and let the dialog report the failure.
      throw new MoveNotSettledError()
    }
    // Only now does the item truly belong to another folder.
    items.value = items.value.filter((i) => i.uuid !== uuid)
    return settled
  }

  async function remove(uuid: string, permanent = true): Promise<void> {
    await deleteDriveItem(uuid, permanent)
    items.value = items.value.filter((i) => i.uuid !== uuid)
  }

  async function toggleStar(uuid: string): Promise<DriveItem> {
    const res = await toggleStarDriveItem(uuid)
    const updated = res.data as DriveItem
    items.value = items.value.map((i) => (i.uuid === uuid ? updated : i))
    return updated
  }

  async function load(query: DriveListQuery, from: string): Promise<void> {
    if (!query.cloudAccountId) return

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

  return {
    items,
    cursor,
    hasMore,
    loading,
    error,
    breadcrumb,
    clearBreadcrumb,
    loadBreadcrumb,
    reset,
    loadFirstPage,
    loadNextPage,
    insertItem,
    createFolder,
    rename,
    move,
    remove,
    toggleStar,
  }
})

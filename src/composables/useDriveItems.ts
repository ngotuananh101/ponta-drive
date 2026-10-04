import { onScopeDispose, watch } from 'vue'
import { storeToRefs } from 'pinia'

import { useDriveItemsStore, type DriveListQuery } from '@/stores/driveItems'

/**
 * Binds the drive list store to a reactive query.
 *
 * Whenever any part of the query changes - account, folder, search, sort - the
 * list is reloaded from the first page. Reusing a cursor across a changed
 * query would resume at a position that no longer means anything, so the store
 * resets first.
 */
export function useDriveItems(query: () => DriveListQuery, debounceMs = 250) {
  const store = useDriveItemsStore()
  const { items, loading, error, hasMore } = storeToRefs(store)

  let timer: ReturnType<typeof setTimeout> | null = null

  watch(
    () => JSON.stringify(query()),
    () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void store.loadFirstPage(query())
      }, debounceMs)
    },
    { immediate: true },
  )

  function loadMore(): void {
    void store.loadNextPage()
  }

  function reload(): void {
    void store.loadFirstPage(query())
  }

  onScopeDispose(() => {
    if (timer) clearTimeout(timer)
  })

  return { items, loading, error, hasMore, loadMore, reload }
}

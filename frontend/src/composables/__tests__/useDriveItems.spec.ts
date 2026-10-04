import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

import { useDriveItemsStore } from '@/stores/driveItems'
import * as api from '@/api/driveItems'
import type { DriveItem } from '@/api/driveItems'

function item(uuid: string, name = uuid): DriveItem {
  return {
    id: 1,
    uuid,
    name,
    type: 'file',
    mime_type: 'text/plain',
    size: 1,
    extension: 'txt',
    cloud_account_id: 1,
    is_starred: false,
    status: 'ready',
    updated_at: '2026-10-01 00:00:00',
  }
}

/** A promise whose settlement is controlled by the test. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('driveItems store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('loads the first page and records the cursor', async () => {
    vi.spyOn(api, 'listDriveItems').mockResolvedValue({
      status: 'ok',
      data: [item('a'), item('b')],
      meta: { has_more: true, next_cursor: 'c1' },
    })

    const store = useDriveItemsStore()
    await store.loadFirstPage({ cloudAccountId: 1 })

    expect(store.items.map((i) => i.uuid)).toEqual(['a', 'b'])
    expect(store.cursor).toBe('c1')
    expect(store.hasMore).toBe(true)
  })

  it('appends the next page and drops duplicates', async () => {
    vi.spyOn(api, 'listDriveItems')
      .mockResolvedValueOnce({
        status: 'ok',
        data: [item('a'), item('b')],
        meta: { has_more: true, next_cursor: 'c1' },
      })
      .mockResolvedValueOnce({
        status: 'ok',
        data: [item('b'), item('c')],
        meta: { has_more: false, next_cursor: '' },
      })

    const store = useDriveItemsStore()
    await store.loadFirstPage({ cloudAccountId: 1 })
    await store.loadNextPage()

    expect(store.items.map((i) => i.uuid)).toEqual(['a', 'b', 'c'])
    expect(store.hasMore).toBe(false)
  })

  it('stops issuing requests once has_more is false', async () => {
    const spy = vi.spyOn(api, 'listDriveItems').mockResolvedValue({
      status: 'ok',
      data: [item('a')],
      meta: { has_more: false, next_cursor: '' },
    })

    const store = useDriveItemsStore()
    await store.loadFirstPage({ cloudAccountId: 1 })
    await store.loadNextPage()

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('clears items and cursor on reset', async () => {
    vi.spyOn(api, 'listDriveItems').mockResolvedValue({
      status: 'ok',
      data: [item('a')],
      meta: { has_more: true, next_cursor: 'c1' },
    })

    const store = useDriveItemsStore()
    await store.loadFirstPage({ cloudAccountId: 1 })
    store.reset()

    expect(store.items).toEqual([])
    expect(store.cursor).toBe('')
    expect(store.hasMore).toBe(false)
  })

  it('keeps already-loaded items when a page fails', async () => {
    vi.spyOn(api, 'listDriveItems')
      .mockResolvedValueOnce({
        status: 'ok',
        data: [item('a')],
        meta: { has_more: true, next_cursor: 'c1' },
      })
      .mockRejectedValueOnce(new Error('network down'))

    const store = useDriveItemsStore()
    await store.loadFirstPage({ cloudAccountId: 1 })
    await store.loadNextPage()

    expect(store.items.map((i) => i.uuid)).toEqual(['a'])
    expect(store.error).toBe('network down')
  })

  // The important one. A slow first request must not land after a newer one
  // and overwrite it - that is what makes the list jump back to an old page.
  it('ignores a stale response that resolves after a newer request', async () => {
    const first = deferred<api.DriveListResponse>()
    const second = deferred<api.DriveListResponse>()

    vi.spyOn(api, 'listDriveItems')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const store = useDriveItemsStore()

    const p1 = store.loadFirstPage({ cloudAccountId: 1, search: 'old' })
    const p2 = store.loadFirstPage({ cloudAccountId: 1, search: 'new' })

    // The newer request settles first, then the older one straggles in.
    second.resolve({ status: 'ok', data: [item('new')], meta: { has_more: false, next_cursor: '' } })
    await p2
    first.resolve({ status: 'ok', data: [item('old')], meta: { has_more: false, next_cursor: '' } })
    await p1

    expect(store.items.map((i) => i.uuid)).toEqual(['new'])
  })

  it('aborts the in-flight request when a newer load starts', async () => {
    const first = deferred<api.DriveListResponse>()
    const spy = vi
      .spyOn(api, 'listDriveItems')
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({
        status: 'ok',
        data: [item('new')],
        meta: { has_more: false, next_cursor: '' },
      })

    const store = useDriveItemsStore()
    const p1 = store.loadFirstPage({ cloudAccountId: 1, search: 'old' })
    const signal = spy.mock.calls[0]?.[1]
    expect(signal?.aborted).toBe(false)

    const p2 = store.loadFirstPage({ cloudAccountId: 1, search: 'new' })
    // The older request must be cancelled at the network, not merely ignored
    // when it returns.
    expect(signal?.aborted).toBe(true)

    first.reject(new DOMException('aborted', 'AbortError'))
    await p1
    await p2

    expect(store.items.map((i) => i.uuid)).toEqual(['new'])
    expect(store.error).toBe(null)
  })

  it('does not surface an abort as an error', async () => {
    const first = deferred<api.DriveListResponse>()
    vi.spyOn(api, 'listDriveItems')
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({
        status: 'ok',
        data: [item('a')],
        meta: { has_more: false, next_cursor: '' },
      })

    const store = useDriveItemsStore()
    const p1 = store.loadFirstPage({ cloudAccountId: 1, search: 'old' })
    const p2 = store.loadFirstPage({ cloudAccountId: 1, search: 'new' })

    // A plain object, not a DOMException: the store matches on `name`, so this
    // proves the check does not depend on the runtime's DOMException class.
    first.reject({ name: 'AbortError', message: 'aborted' })
    await p1
    await p2

    // A cancelled request is this store's own doing; showing "aborted" to the
    // user would look like the drive is broken.
    expect(store.error).toBe(null)
    expect(store.loading).toBe(false)
  })

  it('resets before loading when the search changes', async () => {
    vi.spyOn(api, 'listDriveItems').mockResolvedValue({
      status: 'ok',
      data: [item('a')],
      meta: { has_more: false, next_cursor: '' },
    })

    const store = useDriveItemsStore()
    await store.loadFirstPage({ cloudAccountId: 1, search: '' })
    await store.loadFirstPage({ cloudAccountId: 1, search: 'report' })

    expect(store.items.map((i) => i.uuid)).toEqual(['a'])
    expect(store.error).toBe(null)
  })
})

// The sort the user picks only reaches the backend if it survives the query
// string. A dropped parameter is invisible: the list silently keeps the old
// order and looks like the click did nothing.
describe('buildDriveItemsQuery', () => {
  it('sends the sort field and direction the UI picked', () => {
    const query = api.buildDriveItemsQuery({
      cloudAccountId: 3,
      sort: 'size',
      order: 'desc',
    })

    expect(query).toContain('sort=size')
    expect(query).toContain('order=desc')
  })

  it('omits the cursor on the first page', () => {
    const query = api.buildDriveItemsQuery({ cloudAccountId: 3 })

    expect(query).not.toContain('cursor=')
  })

  it('sends the cursor and limit when paging', () => {
    const query = api.buildDriveItemsQuery({
      cloudAccountId: 3,
      cursor: 'eyJ0IjoiZmlsZSJ9',
      limit: 50,
    })

    expect(query).toContain('cursor=eyJ0IjoiZmlsZSJ9')
    expect(query).toContain('limit=50')
  })
})

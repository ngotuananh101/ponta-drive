import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useDriveItemsStore } from '@/stores/driveItems'
import * as api from '@/api/driveItems'
import type { DriveItem, DriveListResponse } from '@/api/driveItems'

function item(uuid: string, name = uuid): DriveItem {
  return {
    uuid,
    name,
    type: 'file',
    mime_type: 'text/plain',
    size: 1,
    extension: 'txt',
    cloud_account_uuid: 'acc-uuid',
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
    await store.loadFirstPage({ cloudAccountUuid: 'acc-uuid' })

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
    await store.loadFirstPage({ cloudAccountUuid: 'acc-uuid' })
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
    await store.loadFirstPage({ cloudAccountUuid: 'acc-uuid' })
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
    await store.loadFirstPage({ cloudAccountUuid: 'acc-uuid' })
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
    await store.loadFirstPage({ cloudAccountUuid: 'acc-uuid' })
    await store.loadNextPage()

    expect(store.items.map((i) => i.uuid)).toEqual(['a'])
    expect(store.error).toBe('network down')
  })

  // The important one. A slow first request must not land after a newer one
  // and overwrite it - that is what makes the list jump back to an old page.
  it('ignores a stale response that resolves after a newer request', async () => {
    const first = deferred<DriveListResponse>()
    const second = deferred<DriveListResponse>()

    vi.spyOn(api, 'listDriveItems')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const store = useDriveItemsStore()

    const p1 = store.loadFirstPage({ cloudAccountUuid: 'acc-uuid', search: 'old' })
    const p2 = store.loadFirstPage({ cloudAccountUuid: 'acc-uuid', search: 'new' })

    // The newer request settles first, then the older one straggles in.
    second.resolve({ status: 'ok', data: [item('new')], meta: { has_more: false, next_cursor: '' } })
    await p2
    first.resolve({ status: 'ok', data: [item('old')], meta: { has_more: false, next_cursor: '' } })
    await p1

    expect(store.items.map((i) => i.uuid)).toEqual(['new'])
  })

  it('aborts the in-flight request when a newer load starts', async () => {
    const first = deferred<DriveListResponse>()
    const spy = vi
      .spyOn(api, 'listDriveItems')
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({
        status: 'ok',
        data: [item('new')],
        meta: { has_more: false, next_cursor: '' },
      })

    const store = useDriveItemsStore()
    const p1 = store.loadFirstPage({ cloudAccountUuid: 'acc-uuid', search: 'old' })
    const signal = spy.mock.calls[0]?.[1]
    expect(signal?.aborted).toBe(false)

    const p2 = store.loadFirstPage({ cloudAccountUuid: 'acc-uuid', search: 'new' })
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
    const first = deferred<DriveListResponse>()
    vi.spyOn(api, 'listDriveItems')
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({
        status: 'ok',
        data: [item('a')],
        meta: { has_more: false, next_cursor: '' },
      })

    const store = useDriveItemsStore()
    const p1 = store.loadFirstPage({ cloudAccountUuid: 'acc-uuid', search: 'old' })
    const p2 = store.loadFirstPage({ cloudAccountUuid: 'acc-uuid', search: 'new' })

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

  it('loads and clears the breadcrumb', async () => {
    vi.spyOn(api, 'getDriveItemBreadcrumb').mockResolvedValue({
      status: 'ok',
      data: [item('root'), item('sub')],
    })

    const store = useDriveItemsStore()
    await store.loadBreadcrumb('sub')
    expect(store.breadcrumb.map((i) => i.uuid)).toEqual(['root', 'sub'])

    store.clearBreadcrumb()
    expect(store.breadcrumb).toEqual([])
  })

  it('leaves the breadcrumb empty when the request fails', async () => {
    vi.spyOn(api, 'getDriveItemBreadcrumb').mockRejectedValue(new Error('nope'))
    const store = useDriveItemsStore()
    await store.loadBreadcrumb('missing')
    expect(store.breadcrumb).toEqual([])
  })

  it('resets before loading when the search changes', async () => {
    vi.spyOn(api, 'listDriveItems').mockResolvedValue({
      status: 'ok',
      data: [item('a')],
      meta: { has_more: false, next_cursor: '' },
    })

    const store = useDriveItemsStore()
    await store.loadFirstPage({ cloudAccountUuid: 'acc-uuid', search: '' })
    await store.loadFirstPage({ cloudAccountUuid: 'acc-uuid', search: 'report' })

    expect(store.items.map((i) => i.uuid)).toEqual(['a'])
    expect(store.error).toBe(null)
  })

  it('createFolder prepends the new folder to items', async () => {
    const newFolder = item('f-new', 'New Folder')
    newFolder.type = 'folder'
    vi.spyOn(api, 'createDriveFolder').mockResolvedValue({ status: 'ok', data: newFolder })

    const store = useDriveItemsStore()
    store.items = [item('a')]

    const res = await store.createFolder('acc-uuid', null, 'New Folder')
    expect(res.uuid).toBe('f-new')
    expect(store.items[0]?.uuid).toBe('f-new')
    expect(store.items).toHaveLength(2)
  })

  it('rename updates the target item in place', async () => {
    const updated = item('a', 'Renamed A')
    vi.spyOn(api, 'renameDriveItem').mockResolvedValue({ status: 'ok', data: updated })

    const store = useDriveItemsStore()
    store.items = [item('a', 'Old A'), item('b')]

    await store.rename('a', 'Renamed A')
    expect(store.items[0]?.name).toBe('Renamed A')
  })

  it('remove deletes the item from items list', async () => {
    vi.spyOn(api, 'deleteDriveItem').mockResolvedValue({ status: 'ok' })

    const store = useDriveItemsStore()
    store.items = [item('a'), item('b')]

    await store.remove('a', true)
    expect(store.items.map((i) => i.uuid)).toEqual(['b'])
  })

  it('toggleStar replaces item with response', async () => {
    const starred = { ...item('a'), is_starred: true }
    vi.spyOn(api, 'toggleStarDriveItem').mockResolvedValue({ status: 'ok', data: starred })

    const store = useDriveItemsStore()
    store.items = [item('a')]

    await store.toggleStar('a')
    expect(store.items[0]?.is_starred).toBe(true)
  })

  it('insertItem adds item if not already present', () => {
    const store = useDriveItemsStore()
    store.items = [item('a')]

    store.insertItem(item('b'))
    expect(store.items.map((i) => i.uuid)).toEqual(['b', 'a'])

    // duplicate is ignored
    store.insertItem(item('b'))
    expect(store.items).toHaveLength(2)
  })
})

// The sort the user picks only reaches the backend if it survives the query
// string. A dropped or misspelled parameter is invisible in the UI: the list
// silently keeps the old order and looks like the click did nothing.
describe('buildDriveItemsQuery', () => {
  it('sends the account and parent uuids', () => {
    const query = api.buildDriveItemsQuery({
      cloudAccountUuid: 'acc-uuid',
      parentUuid: 'folder-uuid',
    })

    expect(query).toContain('cloud_account_uuid=acc-uuid')
    expect(query).toContain('parent_uuid=folder-uuid')
    expect(query).not.toContain('cloud_account_id')
  })

  it('omits the parent at the account root', () => {
    const query = api.buildDriveItemsQuery({ cloudAccountUuid: 'acc-uuid' })
    expect(query).not.toContain('parent_uuid')
  })
})

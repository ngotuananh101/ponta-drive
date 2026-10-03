import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, ref, effectScope } from 'vue'

import { useDriveItems } from '@/composables/useDriveItems'
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

describe('useDriveItems composable', () => {
  let scope: ReturnType<typeof effectScope>

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('fetches the first page immediately on mount (no debounce)', async () => {
    const spy = vi.spyOn(api, 'listDriveItems').mockResolvedValue({
      status: 'ok',
      data: [item('a')],
      meta: { has_more: false, next_cursor: '' },
    })

    let result: ReturnType<typeof useDriveItems>
    scope = effectScope()
    scope.run(() => {
      result = useDriveItems(() => ({ cloudAccountId: 1 }))
    })

    // Initial fetch is synchronous (no debounce on mount).
    expect(spy).toHaveBeenCalledTimes(1)

    await nextTick()
    await Promise.resolve()
    expect(result!.items.value.map((i) => i.uuid)).toEqual(['a'])

    scope.stop()
  })

  it('debounces subsequent query changes with vi.useFakeTimers', async () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(api, 'listDriveItems').mockResolvedValue({
      status: 'ok',
      data: [],
      meta: { has_more: false, next_cursor: '' },
    })

    const search = ref('')
    let result: ReturnType<typeof useDriveItems>
    scope = effectScope()
    scope.run(() => {
      result = useDriveItems(() => ({ cloudAccountId: 1, search: search.value }), 250)
    })

    // Flush the initial fetch microtask.
    await vi.advanceTimersByTimeAsync(0)

    expect(spy).toHaveBeenCalledTimes(1)

    search.value = 'report'
    await vi.advanceTimersByTimeAsync(200)

    // Still the initial fetch only; debounce window not elapsed.
    expect(spy).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(50)

    // Debounce expired; second fetch fired.
    expect(spy).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
    scope.stop()
  })

  it('triggers loadFirstPage when the query reactive value changes', async () => {
    vi.useFakeTimers()
    const spy = vi
      .spyOn(api, 'listDriveItems')
      .mockResolvedValue({ status: 'ok', data: [], meta: { has_more: false, next_cursor: '' } })

    const cloudAccountId = ref(1)
    let result: ReturnType<typeof useDriveItems>
    scope = effectScope()
    scope.run(() => {
      result = useDriveItems(() => ({ cloudAccountId: cloudAccountId.value }), 0)
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(spy).toHaveBeenCalledTimes(1)

    cloudAccountId.value = 2
    await vi.advanceTimersByTimeAsync(0)

    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy.mock.calls[1][0].cloudAccountId).toBe(2)

    vi.useRealTimers()
    scope.stop()
  })

  it('loadMore delegates to the store next page', async () => {
    const spy = vi
      .spyOn(api, 'listDriveItems')
      .mockResolvedValueOnce({
        status: 'ok',
        data: [item('a')],
        meta: { has_more: true, next_cursor: 'c1' },
      })
      .mockResolvedValueOnce({
        status: 'ok',
        data: [item('b')],
        meta: { has_more: false, next_cursor: '' },
      })

    let result: ReturnType<typeof useDriveItems>
    scope = effectScope()
    scope.run(() => {
      result = useDriveItems(() => ({ cloudAccountId: 1 }), 0)
    })

    await nextTick()
    await Promise.resolve()

    expect(result!.hasMore.value).toBe(true)

    result!.loadMore()
    await nextTick()
    await Promise.resolve()

    expect(result!.items.value.map((i) => i.uuid)).toEqual(['a', 'b'])
    expect(result!.hasMore.value).toBe(false)

    scope.stop()
  })

  it('reload triggers a fresh first-page load', async () => {
    vi.spyOn(api, 'listDriveItems')
      .mockResolvedValueOnce({
        status: 'ok',
        data: [item('old')],
        meta: { has_more: false, next_cursor: '' },
      })
      .mockResolvedValueOnce({
        status: 'ok',
        data: [item('new')],
        meta: { has_more: false, next_cursor: '' },
      })

    let result: ReturnType<typeof useDriveItems>
    scope = effectScope()
    scope.run(() => {
      result = useDriveItems(() => ({ cloudAccountId: 1 }), 0)
    })

    await nextTick()
    await Promise.resolve()
    expect(result!.items.value.map((i) => i.uuid)).toEqual(['old'])

    result!.reload()
    await nextTick()
    await Promise.resolve()
    expect(result!.items.value.map((i) => i.uuid)).toEqual(['new'])

    scope.stop()
  })

  it('exposes loading, error, and hasMore from the store', async () => {
    vi.spyOn(api, 'listDriveItems').mockResolvedValue({
      status: 'ok',
      data: [item('a')],
      meta: { has_more: false, next_cursor: '' },
    })

    let result: ReturnType<typeof useDriveItems>
    scope = effectScope()
    scope.run(() => {
      result = useDriveItems(() => ({ cloudAccountId: 1 }), 0)
    })

    await nextTick()
    await Promise.resolve()

    expect(result!.loading.value).toBe(false)
    expect(result!.error.value).toBe(null)
    expect(result!.hasMore.value).toBe(false)

    scope.stop()
  })
})

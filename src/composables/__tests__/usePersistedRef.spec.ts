import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'

import { usePersistedRef } from '@/composables/usePersistedRef'

type ViewMode = 'list' | 'grid'
const isViewMode = (value: unknown): value is ViewMode => value === 'list' || value === 'grid'
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'

describe('usePersistedRef', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns the fallback when nothing is stored', () => {
    const value = usePersistedRef<ViewMode>('k', 'grid', isViewMode)
    expect(value.value).toBe('grid')
  })

  it('reads the stored value on init', () => {
    localStorage.setItem('k', JSON.stringify('list'))
    const value = usePersistedRef<ViewMode>('k', 'grid', isViewMode)
    expect(value.value).toBe('list')
  })

  it('ignores a stored value that fails validation', () => {
    localStorage.setItem('k', JSON.stringify('sideways'))
    const value = usePersistedRef<ViewMode>('k', 'grid', isViewMode)
    expect(value.value).toBe('grid')
  })

  it('ignores a stored value that is not valid JSON', () => {
    localStorage.setItem('k', 'not-json{')
    const value = usePersistedRef<ViewMode>('k', 'grid', isViewMode)
    expect(value.value).toBe('grid')
  })

  it('writes changes back to localStorage', async () => {
    const scope = effectScope()
    const value = scope.run(() => usePersistedRef<boolean>('flag', false, isBoolean))
    expect(value).toBeDefined()

    value!.value = true
    await nextTick()

    expect(localStorage.getItem('flag')).toBe('true')
    scope.stop()
  })

  it('degrades to the in-memory value when localStorage throws', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })

    const value = usePersistedRef<ViewMode>('k', 'grid', isViewMode)
    expect(value.value).toBe('grid')

    getItem.mockRestore()
  })
})

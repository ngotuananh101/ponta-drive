import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useDriveSearchStore } from '@/stores/driveSearch'

describe('driveSearch store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts empty', () => {
    const store = useDriveSearchStore()
    expect(store.query).toBe('')
  })

  it('holds the typed query', () => {
    const store = useDriveSearchStore()
    store.setQuery('report')
    expect(store.query).toBe('report')
  })

  it('clears back to empty', () => {
    const store = useDriveSearchStore()
    store.setQuery('report')
    store.clear()
    expect(store.query).toBe('')
  })
})

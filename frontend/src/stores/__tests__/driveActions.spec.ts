import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useDriveActionsStore } from '@/stores/driveActions'

describe('driveActions store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('requests an action with an incrementing nonce', () => {
    const store = useDriveActionsStore()
    expect(store.pending).toBeNull()

    store.request('new-folder')
    expect(store.pending).toEqual({ type: 'new-folder', nonce: 1 })

    store.request('new-folder')
    expect(store.pending).toEqual({ type: 'new-folder', nonce: 2 })
  })

  it('consume resets pending to null', () => {
    const store = useDriveActionsStore()
    store.request('upload-file')
    expect(store.pending?.type).toBe('upload-file')

    store.consume()
    expect(store.pending).toBeNull()
  })
})

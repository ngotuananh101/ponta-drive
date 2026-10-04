import { describe, expect, it } from 'vitest'

import vi from '@/locales/vi.json'
import en from '@/locales/en.json'

describe('cloud locale namespace', () => {
  it('defines the namespace in both locales', () => {
    expect(vi.cloud).toBeTruthy()
    expect(en.cloud).toBeTruthy()
  })

  // A key present in one locale but not the other shows the raw key string to
  // half the users, and the default locale is vi so a missing en key never
  // shows up in ordinary manual testing.
  it('has exactly the same keys in both locales', () => {
    const viKeys = Object.keys(vi.cloud).sort()
    const enKeys = Object.keys(en.cloud).sort()
    expect(enKeys).toEqual(viKeys)
  })

  it('has no empty translations', () => {
    for (const [key, value] of Object.entries(vi.cloud)) {
      expect(value, `vi.cloud.${key}`).toBeTruthy()
    }
    for (const [key, value] of Object.entries(en.cloud)) {
      expect(value, `en.cloud.${key}`).toBeTruthy()
    }
  })

  // The sidebar's retry button is the first consumer of this key. A key that
  // resolves to nothing renders as an empty button.
  it('defines the shared retry label in both locales', () => {
    expect(vi.common.retry).toBeTruthy()
    expect(en.common.retry).toBeTruthy()
  })
})

import { describe, expect, it } from 'vitest'
import { ref } from 'vue'

describe('vitest infrastructure', () => {
  it('runs a test and resolves the @ alias', async () => {
    const value = ref(1)
    expect(value.value).toBe(1)

    const utils = await import('@/lib/utils')
    expect(typeof utils.cn).toBe('function')
  })
})

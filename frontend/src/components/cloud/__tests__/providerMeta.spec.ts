import { describe, expect, it } from 'vitest'

import { PROVIDERS, providerMeta } from '@/components/cloud/providerMeta'

describe('providerMeta', () => {
  it('offers only the providers the backend can actually build', () => {
    expect(PROVIDERS.map((p) => p.value).sort()).toEqual(['cloudflare_r2', 'minio', 's3'])
  })

  it('never offers google_drive or onedrive', () => {
    const values = PROVIDERS.map((p) => p.value)
    expect(values).not.toContain('google_drive')
    expect(values).not.toContain('onedrive')
  })

  it('prefills a path-style endpoint for the self-hosted providers', () => {
    expect(PROVIDERS.find((p) => p.value === 'minio')?.prefill.use_path_style).toBe(true)
    expect(PROVIDERS.find((p) => p.value === 'cloudflare_r2')?.prefill.use_path_style).toBe(true)
    expect(PROVIDERS.find((p) => p.value === 's3')?.prefill.use_path_style).toBe(false)
  })

  it('falls back to a neutral entry for an unknown provider', () => {
    expect(providerMeta('something_else').label).toBeTruthy()
  })
})

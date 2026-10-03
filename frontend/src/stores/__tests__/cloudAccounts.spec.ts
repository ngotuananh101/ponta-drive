import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useCloudAccountsStore } from '@/stores/cloudAccounts'
import { ApiError } from '@/api/client'
import * as api from '@/api/cloudAccounts'
import type { CloudAccount } from '@/api/cloudAccounts'

function account(overrides: Partial<CloudAccount> = {}): CloudAccount {
  return {
    id: 1,
    name: 'MinIO Local',
    provider: 'minio',
    credentials: null,
    sync_status: 'idle',
    total_storage: 0,
    used_storage: 0,
    last_synced_at: null,
    is_default: false,
    is_active: true,
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.restoreAllMocks()
})

describe('cloudAccounts store', () => {
  it('loads the account list', async () => {
    vi.spyOn(api, 'listCloudAccounts').mockResolvedValue({
      status: 'ok',
      data: [account()],
    })

    const store = useCloudAccountsStore()
    await store.fetch()

    expect(store.accounts).toHaveLength(1)
    // `?.` because `noUncheckedIndexedAccess` types an index access as possibly
    // undefined; if the length assertion above fails, this then reports the
    // missing account rather than a TypeError.
    expect(store.accounts[0]?.name).toBe('MinIO Local')
    expect(store.loading).toBe(false)
  })

  it('records the error and clears loading when the list request fails', async () => {
    vi.spyOn(api, 'listCloudAccounts').mockRejectedValue(new Error('boom'))

    const store = useCloudAccountsStore()
    await store.fetch()

    expect(store.error).toBe('boom')
    expect(store.loading).toBe(false)
  })

  it('appends a created account without refetching', async () => {
    vi.spyOn(api, 'createCloudAccount').mockResolvedValue({
      status: 'ok',
      data: account({ id: 9, name: 'New Cloud' }),
    })

    const store = useCloudAccountsStore()
    await store.create({
      name: 'New Cloud',
      provider: 's3',
      endpoint: '',
      bucket: 'b',
      region: 'us-east-1',
      access_key_id: 'k',
      secret_access_key: 's',
      use_path_style: false,
      public_url: '',
    })

    expect(store.accounts.map((a) => a.id)).toEqual([9])
  })

  it('replaces the edited account in place', async () => {
    vi.spyOn(api, 'listCloudAccounts').mockResolvedValue({
      status: 'ok',
      data: [account({ id: 1, name: 'Before' }), account({ id: 2, name: 'Other' })],
    })
    vi.spyOn(api, 'updateCloudAccount').mockResolvedValue({
      status: 'ok',
      data: account({ id: 1, name: 'After' }),
    })

    const store = useCloudAccountsStore()
    await store.fetch()
    await store.update(1, { name: 'After' })

    // The order must survive: replacing the list with the single returned
    // account would silently drop every other row from the sidebar.
    expect(store.accounts.map((a) => [a.id, a.name])).toEqual([
      [1, 'After'],
      [2, 'Other'],
    ])
  })

  it('drops a removed account from the list', async () => {
    vi.spyOn(api, 'listCloudAccounts').mockResolvedValue({
      status: 'ok',
      data: [account({ id: 1 }), account({ id: 2 })],
    })
    vi.spyOn(api, 'deleteCloudAccount').mockResolvedValue({ status: 'ok' })

    const store = useCloudAccountsStore()
    await store.fetch()
    await store.remove(1)

    expect(store.accounts.map((a) => a.id)).toEqual([2])
  })

  // The backend clears is_default on every other account when one is marked
  // default, so mirroring that locally avoids a refetch just to see the change.
  it('moves the default flag to the chosen account and off the others', async () => {
    vi.spyOn(api, 'listCloudAccounts').mockResolvedValue({
      status: 'ok',
      data: [account({ id: 1, is_default: true }), account({ id: 2, is_default: false })],
    })
    vi.spyOn(api, 'updateCloudAccount').mockResolvedValue({
      status: 'ok',
      data: account({ id: 2, is_default: true }),
    })

    const store = useCloudAccountsStore()
    await store.fetch()
    await store.setDefault(2)

    expect(store.accounts.map((a) => [a.id, a.is_default])).toEqual([
      [1, false],
      [2, true],
    ])
  })
})

// A 422 carries a per-field map. Discarding it - which fetchApi did - leaves
// the form with one generic line and no way to mark the offending input.
describe('ApiError', () => {
  it('keeps the status and exposes the first message for a field', () => {
    const err = new ApiError('The bucket field is required.', 422, {
      bucket: ['The bucket field is required.'],
      name: ['The name field is required.'],
    })

    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('The bucket field is required.')
    expect(err.status).toBe(422)
    expect(err.fieldError('name')).toBe('The name field is required.')
    expect(err.fieldError('region')).toBeUndefined()
  })

  it('defaults to an empty map when the response carried no field errors', () => {
    const err = new ApiError('Server exploded', 500)

    expect(err.errors).toEqual({})
    expect(err.fieldError('anything')).toBeUndefined()
    expect(err.fieldMessages()).toEqual({})
  })

  // The backend sends a list per field; the form binds one string per input.
  it('flattens each field to its first message and drops empty lists', () => {
    const err = new ApiError('Validation failed', 422, {
      bucket: ['The bucket field is required.', 'A second message we ignore.'],
      name: [],
    })

    expect(err.fieldMessages()).toEqual({ bucket: 'The bucket field is required.' })
  })

  // Spec success criterion 4: no secret may reach client state. The backend
  // strips it in `ToResponse()`, so the thing to pin here is that the store
  // keeps what the *server* returned rather than echoing back the payload it
  // sent. A store that stored the request body would put the secret in memory
  // and into every later `accounts` read.
  it('stores the sanitized response, not the payload it sent', async () => {
    const created = account({ id: 7, name: 'R2 Prod' })
    vi.spyOn(api, 'createCloudAccount').mockResolvedValue({ status: 'ok', data: created })

    const store = useCloudAccountsStore()
    const payload = {
      name: 'R2 Prod',
      provider: 'cloudflare_r2',
      endpoint: 'https://example.r2.cloudflarestorage.com',
      bucket: 'media',
      region: 'auto',
      access_key_id: 'AKIAEXAMPLE',
      secret_access_key: 'super-secret-value',
      use_path_style: true,
      public_url: '',
    }

    await store.create(payload)

    // The mock's return value has no secret field, so this passes only if the
    // store used the response.
    expect(store.accounts).toEqual([created])
    expect(JSON.stringify(store.accounts)).not.toContain('super-secret-value')
  })
})

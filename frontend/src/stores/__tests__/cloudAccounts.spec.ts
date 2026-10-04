import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useCloudAccountsStore } from '@/stores/cloudAccounts'
import { ApiError } from '@/api/client'
import * as api from '@/api/cloudAccounts'
import type { CloudAccount } from '@/api/cloudAccounts'

function account(overrides: Partial<CloudAccount> = {}): CloudAccount {
  return {
    uuid: 'acc-1',
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
  vi.useRealTimers()
})

afterEach(() => {
  vi.useRealTimers()
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
      data: account({ uuid: 'acc-9', name: 'New Cloud' }),
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

    expect(store.accounts.map((a) => a.uuid)).toEqual(['acc-9'])
  })

  it('replaces the edited account in place', async () => {
    vi.spyOn(api, 'listCloudAccounts').mockResolvedValue({
      status: 'ok',
      data: [account({ uuid: 'acc-1', name: 'Before' }), account({ uuid: 'acc-2', name: 'Other' })],
    })
    vi.spyOn(api, 'updateCloudAccount').mockResolvedValue({
      status: 'ok',
      data: account({ uuid: 'acc-1', name: 'After' }),
    })

    const store = useCloudAccountsStore()
    await store.fetch()
    await store.update('acc-1', { name: 'After' })

    // The order must survive: replacing the list with the single returned
    // account would silently drop every other row from the sidebar.
    expect(store.accounts.map((a) => [a.uuid, a.name])).toEqual([
      ['acc-1', 'After'],
      ['acc-2', 'Other'],
    ])
  })

  it('drops a removed account from the list', async () => {
    vi.spyOn(api, 'listCloudAccounts').mockResolvedValue({
      status: 'ok',
      data: [account({ uuid: 'acc-1' }), account({ uuid: 'acc-2' })],
    })
    vi.spyOn(api, 'deleteCloudAccount').mockResolvedValue({ status: 'ok' })

    const store = useCloudAccountsStore()
    await store.fetch()
    await store.remove('acc-1')

    expect(store.accounts.map((a) => a.uuid)).toEqual(['acc-2'])
  })

  // The backend clears is_default on every other account when one is marked
  // default, so mirroring that locally avoids a refetch just to see the change.
  it('moves the default flag to the chosen account and off the others', async () => {
    vi.spyOn(api, 'listCloudAccounts').mockResolvedValue({
      status: 'ok',
      data: [account({ uuid: 'acc-1', is_default: true }), account({ uuid: 'acc-2', is_default: false })],
    })
    vi.spyOn(api, 'updateCloudAccount').mockResolvedValue({
      status: 'ok',
      data: account({ uuid: 'acc-2', is_default: true }),
    })

    const store = useCloudAccountsStore()
    await store.fetch()
    await store.setDefault('acc-2')

    expect(store.accounts.map((a) => [a.uuid, a.is_default])).toEqual([
      ['acc-1', false],
      ['acc-2', true],
    ])
  })
})

describe('cloudAccounts store sync', () => {
  it('flags the account as syncing for the duration of the request', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(api, 'syncCloudAccount').mockReturnValue(pending)
    vi.spyOn(api, 'listCloudAccounts').mockResolvedValue({
      status: 'ok',
      data: [account({ uuid: 'acc-3', sync_status: 'idle' })],
    })

    const store = useCloudAccountsStore()
    const done = store.sync('acc-3')

    // The button must show the spinner the instant it is pressed, before the
    // request resolves - that is the whole point of the local flag.
    expect(store.isSyncing('acc-3')).toBe(true)

    release()
    await done

    expect(store.isSyncing('acc-3')).toBe(false)
  })

  it('refetches until the account leaves the syncing state', async () => {
    vi.spyOn(api, 'syncCloudAccount').mockResolvedValue({ status: 'ok' })
    vi.spyOn(api, 'listCloudAccounts')
      .mockResolvedValueOnce({ status: 'ok', data: [account({ uuid: 'acc-4', sync_status: 'syncing' })] })
      .mockResolvedValueOnce({ status: 'ok', data: [account({ uuid: 'acc-4', sync_status: 'idle' })] })

    vi.useFakeTimers()
    const store = useCloudAccountsStore()
    const done = store.sync('acc-4')

    // First check is immediate (the sync driver may have finished already),
    // sees "syncing", then waits an interval before the next poll.
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(3000)
    await done

    expect(store.isSyncing('acc-4')).toBe(false)
    expect(store.accounts[0]?.sync_status).toBe('idle')
  })

  it('stops polling after the bounded number of attempts', async () => {
    vi.spyOn(api, 'syncCloudAccount').mockResolvedValue({ status: 'ok' })
    // Never settles: a worker that died must not spin the UI forever.
    const listSpy = vi.spyOn(api, 'listCloudAccounts').mockResolvedValue({
      status: 'ok',
      data: [account({ uuid: 'acc-5', sync_status: 'syncing' })],
    })

    vi.useFakeTimers()
    const store = useCloudAccountsStore()
    const done = store.sync('acc-5')

    await vi.advanceTimersByTimeAsync(3000 * 10 + 100)
    await done

    expect(listSpy.mock.calls.length).toBeLessThanOrEqual(10)
    expect(store.isSyncing('acc-5')).toBe(false)
  })

  it('clears the syncing flag and rethrows when the sync request fails', async () => {
    vi.spyOn(api, 'syncCloudAccount').mockRejectedValue(new Error('boom'))

    const store = useCloudAccountsStore()
    await expect(store.sync('acc-6')).rejects.toThrow('boom')

    expect(store.isSyncing('acc-6')).toBe(false)
  })

  // A transient list failure mid-poll must not strand the account: the loop
  // keeps trying rather than giving up on the first blip.
  it('keeps polling when a refetch fails transiently', async () => {
    vi.spyOn(api, 'syncCloudAccount').mockResolvedValue({ status: 'ok' })
    vi.spyOn(api, 'listCloudAccounts')
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce({ status: 'ok', data: [account({ uuid: 'acc-7', sync_status: 'idle' })] })

    vi.useFakeTimers()
    const store = useCloudAccountsStore()
    const done = store.sync('acc-7')

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(3000)
    await done

    expect(store.isSyncing('acc-7')).toBe(false)
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
    const created = account({ uuid: 'acc-7', name: 'R2 Prod' })
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

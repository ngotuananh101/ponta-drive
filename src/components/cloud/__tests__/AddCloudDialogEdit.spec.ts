import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import AddCloudDialog from '@/components/cloud/AddCloudDialog.vue'
import { useCloudAccountsStore } from '@/stores/cloudAccounts'
import * as api from '@/api/cloudAccounts'
import type { CloudAccount } from '@/api/cloudAccounts'
import viLocale from '@/locales/vi.json'

function account(partial: Partial<CloudAccount>): CloudAccount {
  return {
    uuid: 'acc-1',
    name: 'My Bucket',
    provider: 'minio',
    credentials: {
      endpoint: 'https://minio.local',
      bucket: 'photos',
      region: 'us-east-1',
      access_key_id: 'AKIAEXAMPLE',
      use_path_style: true,
      public_url: '',
    },
    sync_status: 'idle',
    total_storage: 0,
    used_storage: 0,
    last_synced_at: null,
    is_default: false,
    is_active: true,
    ...partial,
  }
}

function mountDialog(props: { editUuid?: string | null } = {}) {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(AddCloudDialog, {
    props: { open: true, ...props },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('AddCloudDialog edit mode', () => {
  it('prefills the form from the account being edited', async () => {
    const store = useCloudAccountsStore()
    store.accounts = [account({ uuid: 'acc-9', name: 'Bucket Nine' })]

    mountDialog({ editUuid: 'acc-9' })
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.cloud.edit_title))

    const name = document.querySelector<HTMLInputElement>('#cloud-name')!
    const bucket = document.querySelector<HTMLInputElement>('#cloud-bucket')!
    expect(name.value).toBe('Bucket Nine')
    expect(bucket.value).toBe('photos')
  })

  it('saves via update and omits an empty secret', async () => {
    const store = useCloudAccountsStore()
    store.accounts = [account({ uuid: 'acc-9', name: 'Bucket Nine' })]
    const updateSpy = vi
      .spyOn(api, 'updateCloudAccount')
      .mockResolvedValue({ status: 'ok', data: account({ uuid: 'acc-9', name: 'Bucket Nine' }) })

    const wrapper = mountDialog({ editUuid: 'acc-9' })
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.cloud.edit_title))

    // Edit mode saves from the credential step directly (no test gate).
    const saveButton = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(viLocale.cloud.save),
    )!
    saveButton.click()
    await wrapper.vm.$nextTick()

    await vi.waitFor(() => expect(updateSpy).toHaveBeenCalled())
    expect(updateSpy.mock.calls[0]?.[0]).toBe('acc-9')
    expect(updateSpy.mock.calls[0]?.[1]).not.toHaveProperty('secret_access_key')
    expect(updateSpy.mock.calls[0]?.[1]).not.toHaveProperty('provider')
  })

  it('sends a new secret when the user enters one', async () => {
    const store = useCloudAccountsStore()
    store.accounts = [account({ uuid: 'acc-9', name: 'Bucket Nine' })]
    const updateSpy = vi
      .spyOn(api, 'updateCloudAccount')
      .mockResolvedValue({ status: 'ok', data: account({ uuid: 'acc-9', name: 'Bucket Nine' }) })

    const wrapper = mountDialog({ editUuid: 'acc-9' })
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.cloud.edit_title))

    const secret = document.querySelector<HTMLInputElement>('#cloud-secret')!
    secret.value = 'new-secret'
    secret.dispatchEvent(new Event('input'))
    await wrapper.vm.$nextTick()

    const saveButton = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(viLocale.cloud.save),
    )!
    saveButton.click()

    await vi.waitFor(() => expect(updateSpy).toHaveBeenCalled())
    expect(updateSpy.mock.calls[0]?.[1]).toMatchObject({ secret_access_key: 'new-secret' })
  })
})

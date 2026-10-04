import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import SyncCloudButton from '@/components/cloud/SyncCloudButton.vue'
import * as api from '@/api/cloudAccounts'
import type { CloudAccount } from '@/api/cloudAccounts'
import viLocale from '@/locales/vi.json'

function account(uuid: string, syncStatus: CloudAccount['sync_status'] = 'idle'): CloudAccount {
  return {
    uuid,
    name: 'Account',
    provider: 'minio',
    credentials: null,
    sync_status: syncStatus,
    total_storage: 0,
    used_storage: 0,
    last_synced_at: null,
    is_default: false,
    is_active: true,
  }
}

// The component calls `useI18n()` and `toast`; both are module-level singletons
// the real app provides. A fresh i18n instance per test keeps a missing key
// from silently falling back to another test's locale.
function mountButton(props: { accountUuid: string; labeled?: boolean }) {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(SyncCloudButton, { props, global: { plugins: [i18n] } })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.restoreAllMocks()
})

describe('SyncCloudButton', () => {
  it('triggers a sync for its account when clicked', async () => {
    const syncSpy = vi.spyOn(api, 'syncCloudAccount').mockResolvedValue({ status: 'ok' })
    // The post-request poll breaks on the first check once the account is no
    // longer "syncing", so the list returns an idle account and no timer waits.
    vi.spyOn(api, 'listCloudAccounts').mockResolvedValue({
      status: 'ok',
      data: [account('acc-12')],
    })

    const wrapper = mountButton({ accountUuid: 'acc-12' })
    await wrapper.trigger('click')
    await vi.waitFor(() => expect(syncSpy).toHaveBeenCalledWith('acc-12'))
  })

  it('disables itself while the sync is running', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(api, 'syncCloudAccount').mockReturnValue(pending)
    vi.spyOn(api, 'listCloudAccounts').mockResolvedValue({ status: 'ok', data: [account('acc-3')] })

    const wrapper = mountButton({ accountUuid: 'acc-3' })
    const button = wrapper.get('button')

    expect(button.attributes('disabled')).toBeUndefined()

    await button.trigger('click')
    await wrapper.vm.$nextTick()

    expect(button.attributes('disabled')).toBeDefined()

    release()
  })

  it('emits `synced` so the parent can refresh its own data', async () => {
    vi.spyOn(api, 'syncCloudAccount').mockResolvedValue({ status: 'ok' })
    vi.spyOn(api, 'listCloudAccounts').mockResolvedValue({ status: 'ok', data: [account('acc-8')] })

    const wrapper = mountButton({ accountUuid: 'acc-8' })
    await wrapper.trigger('click')

    await vi.waitFor(() => expect(wrapper.emitted('synced')).toBeTruthy())
  })

  it('renders a visible label in the toolbar variant', () => {
    const wrapper = mountButton({ accountUuid: 'acc-1', labeled: true })

    expect(wrapper.text()).toContain(viLocale.cloud.sync)
  })
})

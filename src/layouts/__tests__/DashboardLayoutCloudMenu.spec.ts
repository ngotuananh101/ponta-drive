import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'

import DashboardLayout from '@/layouts/DashboardLayout.vue'
import * as cloudApi from '@/api/cloudAccounts'
import type { CloudAccount } from '@/api/cloudAccounts'
import { humanizeBytes } from '@/lib/format'
import viLocale from '@/locales/vi.json'

function account(partial: Partial<CloudAccount>): CloudAccount {
  return {
    uuid: 'acc-1',
    name: 'Account',
    provider: 's3',
    credentials: null,
    sync_status: 'idle',
    total_storage: 0,
    used_storage: 0,
    last_synced_at: null,
    is_default: false,
    is_active: true,
    ...partial,
  }
}

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/d/:cloudUuid', name: 'drive', component: { template: '<div/>' } },
      { path: '/d/:cloudUuid/f/:folderUuid', name: 'drive-folder', component: { template: '<div/>' } },
    ],
  })
}

async function mountLayout(accounts: CloudAccount[], path = '/') {
  vi.spyOn(cloudApi, 'listCloudAccounts').mockResolvedValue({ status: 'ok', data: accounts })

  const router = makeRouter()
  await router.push(path)
  await router.isReady()

  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  const wrapper = mount(DashboardLayout, {
    global: {
      plugins: [router, i18n],
      stubs: { AddCloudDialog: true, RouterView: true },
    },
    attachTo: document.body,
    slots: { default: '<div/>' },
  })
  const firstName = accounts[0]?.name ?? ''
  await vi.waitFor(() => expect(wrapper.text()).toContain(firstName))
  return { wrapper, router }
}

/** The kebab trigger for the account row, found by its accessible title. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function kebab(wrapper: any) {
  return wrapper.get(`[title="${viLocale.cloud.menu_actions}"]`)
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  localStorage.setItem('token', 'test-token')
})

describe('DashboardLayout account actions menu', () => {
  it('opens a menu with sync, edit, set-default and delete', async () => {
    const { wrapper } = await mountLayout([account({ uuid: 'acc-1', name: 'Account' })])

    await kebab(wrapper).trigger('click')
    await wrapper.vm.$nextTick()

    const text = document.body.textContent ?? ''
    expect(text).toContain(viLocale.cloud.sync)
    expect(text).toContain(viLocale.cloud.menu_edit)
    expect(text).toContain(viLocale.cloud.menu_set_default)
    expect(text).toContain(viLocale.cloud.menu_delete)
  })

  it('syncs the account from the menu', async () => {
    const syncSpy = vi.spyOn(cloudApi, 'syncCloudAccount').mockResolvedValue({ status: 'ok' })
    const { wrapper } = await mountLayout([account({ uuid: 'acc-1', name: 'Account' })])

    await kebab(wrapper).trigger('click')
    await wrapper.vm.$nextTick()
    const item = [...document.body.querySelectorAll('[role="menuitem"]')].find((el) =>
      el.textContent?.includes(viLocale.cloud.sync),
    ) as HTMLElement
    item.click()
    await wrapper.vm.$nextTick()

    await vi.waitFor(() => expect(syncSpy).toHaveBeenCalledWith('acc-1'))
  })

  it('marks the account as default from the menu', async () => {
    const updateSpy = vi
      .spyOn(cloudApi, 'updateCloudAccount')
      .mockResolvedValue({ status: 'ok', data: account({ uuid: 'acc-1', name: 'Account', is_default: true }) })
    const { wrapper } = await mountLayout([account({ uuid: 'acc-1', name: 'Account' })])

    await kebab(wrapper).trigger('click')
    await wrapper.vm.$nextTick()
    const item = [...document.body.querySelectorAll('[role="menuitem"]')].find((el) =>
      el.textContent?.includes(viLocale.cloud.menu_set_default),
    ) as HTMLElement
    item.click()

    await vi.waitFor(() => expect(updateSpy).toHaveBeenCalled())
    expect(updateSpy.mock.calls[0]?.[0]).toBe('acc-1')
    expect(updateSpy.mock.calls[0]?.[1]).toEqual({ is_default: true })
  })
})

describe('DashboardLayout storage footer', () => {
  it('shows the viewed account’s real figures, not hardcoded values', async () => {
    const used = 3 * 1024 ** 3
    const total = 2 * 1024 ** 4
    const { wrapper } = await mountLayout(
      [account({ uuid: 'acc-1', name: 'Account', used_storage: used, total_storage: total })],
      '/d/acc-1',
    )

    const expected = viLocale.drive.storage_used
      .replace('{used}', humanizeBytes(used))
      .replace('{total}', humanizeBytes(total))
    expect(wrapper.text()).toContain(expected)
    // The old placeholder values must be gone.
    expect(wrapper.text()).not.toContain('733.43 GB')
    expect(wrapper.text()).not.toContain('5 TB')
  })

  it('reads as zero for an unknown account rather than a placeholder', async () => {
    const { wrapper } = await mountLayout([account({ uuid: 'acc-1', name: 'Account' })], '/d/other')

    const expected = viLocale.drive.storage_used
      .replace('{used}', humanizeBytes(0))
      .replace('{total}', humanizeBytes(0))
    expect(wrapper.text()).toContain(expected)
  })
})

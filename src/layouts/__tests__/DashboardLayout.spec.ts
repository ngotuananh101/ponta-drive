import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import DashboardLayout from '@/layouts/DashboardLayout.vue'
import { makeDriveRouter } from '@/test/driveRoutes'
import * as cloudApi from '@/api/cloudAccounts'
import type { CloudAccount } from '@/api/cloudAccounts'
import viLocale from '@/locales/vi.json'

function account(partial: Partial<CloudAccount>): CloudAccount {
  return {
    id: 1,
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

async function mountLayout(accounts: CloudAccount[]) {
  vi.spyOn(cloudApi, 'listCloudAccounts').mockResolvedValue({ status: 'ok', data: accounts })

  const router = makeDriveRouter()
  await router.push('/')
  await router.isReady()

  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  const wrapper = mount(DashboardLayout, {
    global: {
      plugins: [router, i18n],
      stubs: { AddCloudDialog: true, SyncCloudButton: true, RouterView: true },
    },
    slots: { default: '<div/>' },
  })
  // The store fetch runs in onMounted; wait until the first row's name renders.
  const firstName = accounts[0]?.name ?? ''
  await vi.waitFor(() => expect(wrapper.text()).toContain(firstName))
  return { wrapper, router }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.restoreAllMocks()
  localStorage.setItem('token', 'test-token')
})

describe('DashboardLayout sidebar navigation', () => {
  it('opens the drive for an account row', async () => {
    const { wrapper, router } = await mountLayout([account({ id: 1, name: 'Account' })])
    const row = wrapper.findAll('button').find((b) => b.text().includes('Account'))!
    await row.trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('drive'))
    expect(router.currentRoute.value.params.cloudId).toBe('1')
  })

  it('does not throw and stays on home when an account has no id', async () => {
    const { wrapper, router } = await mountLayout([account({ id: 0, name: 'Account' })])
    const row = wrapper.findAll('button').find((b) => b.text().includes('Account'))!
    await row.trigger('click')
    await wrapper.vm.$nextTick()
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('uses the first account that has an id for the "My Drive" entry', async () => {
    const { wrapper, router } = await mountLayout([
      account({ id: 0, name: 'No ID' }),
      account({ id: 2, name: 'Has ID' }),
    ])
    const myDrive = wrapper.findAll('button').find((b) => b.text().trim() === viLocale.drive.nav_my_drive)!
    await myDrive.trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('drive'))
    expect(router.currentRoute.value.params.cloudId).toBe('2')
  })

  it('routes "My Drive" to home when no account has an id', async () => {
    const { wrapper, router } = await mountLayout([account({ id: 0, name: 'No ID' })])
    const myDrive = wrapper.findAll('button').find((b) => b.text().trim() === viLocale.drive.nav_my_drive)!
    await myDrive.trigger('click')
    await wrapper.vm.$nextTick()
    expect(router.currentRoute.value.name).toBe('home')
  })
})

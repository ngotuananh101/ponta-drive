import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'

import DashboardLayout from '@/layouts/DashboardLayout.vue'
import * as cloudApi from '@/api/cloudAccounts'
import type { CloudAccount } from '@/api/cloudAccounts'
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
      { path: '/c/:cloudUuid', name: 'drive', component: { template: '<div/>' } },
      { path: '/c/:cloudUuid/f/:folderUuid', name: 'drive-folder', component: { template: '<div/>' } },
    ],
  })
}

async function mountLayout(accounts: CloudAccount[]) {
  vi.spyOn(cloudApi, 'listCloudAccounts').mockResolvedValue({ status: 'ok', data: accounts })

  const router = makeRouter()
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
    const { wrapper, router } = await mountLayout([account({ uuid: 'acc-1', name: 'Account' })])
    const row = wrapper.findAll('button').find((b) => b.text().includes('Account'))!
    await row.trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('drive'))
    expect(router.currentRoute.value.params.cloudUuid).toBe('acc-1')
  })

  it('does not throw and stays on home when an account has no uuid', async () => {
    const { wrapper, router } = await mountLayout([account({ uuid: '', name: 'Account' })])
    const row = wrapper.findAll('button').find((b) => b.text().includes('Account'))!
    await row.trigger('click')
    await wrapper.vm.$nextTick()
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('uses the first account that has a uuid for the "My Drive" entry', async () => {
    const { wrapper, router } = await mountLayout([
      account({ uuid: '', name: 'No UUID' }),
      account({ uuid: 'acc-2', name: 'Has UUID' }),
    ])
    const myDrive = wrapper.findAll('button').find((b) => b.text().trim() === viLocale.drive.nav_my_drive)!
    await myDrive.trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('drive'))
    expect(router.currentRoute.value.params.cloudUuid).toBe('acc-2')
  })

  it('routes "My Drive" to home when no account has a uuid', async () => {
    const { wrapper, router } = await mountLayout([account({ uuid: '', name: 'No UUID' })])
    const myDrive = wrapper.findAll('button').find((b) => b.text().trim() === viLocale.drive.nav_my_drive)!
    await myDrive.trigger('click')
    await wrapper.vm.$nextTick()
    expect(router.currentRoute.value.name).toBe('home')
  })
})

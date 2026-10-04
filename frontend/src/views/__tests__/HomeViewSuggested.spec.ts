import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { toast } from 'vue-sonner'

import HomeView from '@/views/HomeView.vue'
import * as dashboardApi from '@/api/dashboard'
import * as cloudApi from '@/api/cloudAccounts'
import type { CloudAccount } from '@/api/cloudAccounts'
import type { DriveItem } from '@/api/driveItems'
import viLocale from '@/locales/vi.json'

const CLOUD: CloudAccount = {
  uuid: 'acc-uuid-1',
  name: 'My S3',
  provider: 's3',
  credentials: null,
  sync_status: 'idle',
  total_storage: 0,
  used_storage: 0,
  last_synced_at: null,
  is_default: false,
  is_active: true,
}

function driveItem(partial: Partial<DriveItem>): DriveItem {
  return {
    uuid: 'item-1',
    name: 'item',
    type: 'file',
    mime_type: 'image/png',
    size: 1024,
    extension: 'png',
    cloud_account_uuid: CLOUD.uuid,
    is_starred: false,
    status: 'ready',
    updated_at: '2026-10-01 00:00:00',
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

async function mountHome(files: DriveItem[]) {
  vi.spyOn(dashboardApi, 'fetchDashboardSummary').mockResolvedValue({
    status: 'ok',
    data: {
      clouds: [CLOUD],
      suggested_files: files,
      recent_activities: [],
      total_storage: { used_bytes: 0, total_bytes: 0, used_human: '0 B', total_human: '0 B', percent: 0 },
    },
  })
  vi.spyOn(cloudApi, 'listCloudAccounts').mockResolvedValue({ status: 'ok', data: [CLOUD] })

  const router = makeRouter()
  await router.push('/')
  await router.isReady()

  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  const wrapper = mount(HomeView, {
    global: {
      plugins: [router, i18n],
      stubs: { DashboardLayout: { template: '<div><slot /></div>' }, AddCloudDialog: true },
    },
  })
  await vi.waitFor(() => expect(wrapper.text()).toContain('My S3'))
  return { wrapper, router }
}

/** The suggested-file card is the clickable element whose text holds the name. */
function cardFor(wrapper: ReturnType<typeof mount>, name: string) {
  return wrapper
    .findAll('div')
    .find((d) => d.classes().includes('cursor-pointer') && d.text().includes(name))
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.restoreAllMocks()
  localStorage.setItem('token', 'test-token')
})

describe('HomeView suggested files', () => {
  it('opens the folder view when a suggested folder is clicked', async () => {
    const { wrapper, router } = await mountHome([
      driveItem({ uuid: 'folder-9', name: 'Photos', type: 'folder', mime_type: '' }),
    ])

    await cardFor(wrapper, 'Photos')!.trigger('click')

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('drive-folder'))
    expect(router.currentRoute.value.params).toMatchObject({
      cloudUuid: 'acc-uuid-1',
      folderUuid: 'folder-9',
    })
  })

  it('shows a coming-soon notice instead of navigating for a suggested file', async () => {
    const infoSpy = vi.spyOn(toast, 'info').mockReturnValue('id')
    const { wrapper, router } = await mountHome([driveItem({ uuid: 'file-3', name: 'trip.png' })])

    await cardFor(wrapper, 'trip.png')!.trigger('click')
    await wrapper.vm.$nextTick()

    expect(infoSpy).toHaveBeenCalledWith(viLocale.home.preview_coming_soon)
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('falls back to home for a folder whose account uuid is missing', async () => {
    const { wrapper, router } = await mountHome([
      driveItem({ uuid: 'folder-9', name: 'Orphan', type: 'folder', mime_type: '', cloud_account_uuid: '' }),
    ])

    await cardFor(wrapper, 'Orphan')!.trigger('click')
    await wrapper.vm.$nextTick()

    expect(router.currentRoute.value.name).toBe('home')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'

import DriveView from '@/views/DriveView.vue'
import * as cloudApi from '@/api/cloudAccounts'
import * as driveApi from '@/api/driveItems'
import type { CloudAccount } from '@/api/cloudAccounts'
import type { DriveItem } from '@/api/driveItems'
import { useAuthStore } from '@/stores/auth'
import viLocale from '@/locales/vi.json'

const CLOUD: CloudAccount = {
  uuid: 'acc-1',
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
    type: 'folder',
    mime_type: '',
    size: 0,
    extension: '',
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
      { path: '/c/:cloudUuid', name: 'drive', component: DriveView, props: true },
      {
        path: '/c/:cloudUuid/f/:folderUuid',
        name: 'drive-folder',
        component: DriveView,
        props: true,
      },
    ],
  })
}

async function mountDrive(path: string, breadcrumb: DriveItem[]) {
  vi.spyOn(cloudApi, 'listCloudAccounts').mockResolvedValue({ status: 'ok', data: [CLOUD] })
  vi.spyOn(driveApi, 'listDriveItems').mockResolvedValue({
    status: 'ok',
    data: [],
    meta: { has_more: false, next_cursor: '' },
  })
  vi.spyOn(driveApi, 'getDriveItemBreadcrumb').mockResolvedValue({ status: 'ok', data: breadcrumb })

  // Skip the network round-trip in `fetchUser`: a user is already present.
  const auth = useAuthStore()
  auth.user = {
    id: 1,
    uuid: 'u-1',
    name: 'Anh',
    username: 'anh',
    email: 'anh@example.com',
    avatar: '',
  }

  const router = makeRouter()
  await router.push(path)
  await router.isReady()

  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  const wrapper = mount(DriveView, {
    global: {
      plugins: [router, i18n],
      stubs: { DashboardLayout: { template: '<div><slot /></div>' }, SyncCloudButton: true },
    },
    props: router.currentRoute.value.params as { cloudUuid: string; folderUuid?: string },
  })
  return { wrapper, router }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.restoreAllMocks()
  localStorage.setItem('token', 'test-token')
  document.title = ''
})

describe('DriveView document title', () => {
  it('uses the drive name at the root', async () => {
    await mountDrive('/c/acc-1', [])
    await vi.waitFor(() => expect(document.title).toContain('My S3'))
    expect(document.title).toBe('My S3 - Ponta Drive')
  })

  it('uses the current folder name inside a folder', async () => {
    await mountDrive('/c/acc-1/f/folder-9', [
      driveItem({ uuid: 'folder-9', name: 'Photos' }),
    ])
    await vi.waitFor(() => expect(document.title).toContain('Photos'))
    expect(document.title).toBe('Photos - Ponta Drive')
  })
})

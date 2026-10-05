import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createRouter, createMemoryHistory } from 'vue-router'

import DriveView from '../DriveView.vue'
import { useDriveActionsStore } from '@/stores/driveActions'
import { useAuthStore } from '@/stores/auth'
import * as cloudApi from '@/api/cloudAccounts'
import * as driveApi from '@/api/driveItems'
import viLocale from '@/locales/vi.json'

const CLOUD = {
  uuid: 'c-1',
  name: 'Storage Cloud',
  provider: 's3',
  credentials: null,
  sync_status: 'idle' as const,
  total_storage: 10000,
  used_storage: 2000,
  last_synced_at: null,
  is_default: true,
  is_active: true,
}

describe('DriveView action wiring', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('opens NewFolderDialog when driveActions requests new-folder', async () => {
    vi.spyOn(cloudApi, 'listCloudAccounts').mockResolvedValue({ status: 'ok', data: [CLOUD] })
    vi.spyOn(driveApi, 'listDriveItems').mockResolvedValue({
      status: 'ok',
      data: [],
      meta: { has_more: false, next_cursor: '' },
    })
    vi.spyOn(driveApi, 'getDriveItemBreadcrumb').mockResolvedValue({ status: 'ok', data: [] })

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

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/c/:cloudUuid', name: 'drive', component: DriveView, props: true }],
    })
    await router.push('/c/c-1')
    await router.isReady()

    const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
    const wrapper = mount(DriveView, {
      global: {
        plugins: [router, i18n],
        stubs: { DashboardLayout: { template: '<div><slot /></div>' }, SyncCloudButton: true },
      },
      props: { cloudUuid: 'c-1' },
      attachTo: document.body,
    })

    const actionsStore = useDriveActionsStore()
    actionsStore.request('new-folder')
    await wrapper.vm.$nextTick()

    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.new_folder_title))
  })
})

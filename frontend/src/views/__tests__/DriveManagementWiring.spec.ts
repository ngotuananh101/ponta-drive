import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import DriveView from '../DriveView.vue'
import { makeDriveRouter } from '@/test/driveRoutes'
import { useDriveActionsStore } from '@/stores/driveActions'
import { useDriveSearchStore } from '@/stores/driveSearch'
import { useAuthStore } from '@/stores/auth'
import * as cloudApi from '@/api/cloudAccounts'
import * as driveApi from '@/api/driveItems'
import type { DriveItem } from '@/api/driveItems'
import viLocale from '@/locales/vi.json'

const CLOUD = {
  id: 1,
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

const ITEM: DriveItem = {
  uuid: 'f-1',
  name: 'document.pdf',
  type: 'file',
  mime_type: 'application/pdf',
  size: 1000,
  extension: 'pdf',
  cloud_account_id: 1,
  is_starred: false,
  status: 'ready',
  updated_at: '2026-10-04 00:00:00',
}

/** Mocks the APIs DriveView fetches on mount and mounts it at `/d/1`. */
async function mountDriveView(items: DriveItem[] = []) {
  vi.spyOn(cloudApi, 'listCloudAccounts').mockResolvedValue({ status: 'ok', data: [CLOUD] })
  vi.spyOn(driveApi, 'listDriveItems').mockResolvedValue({
    status: 'ok',
    data: items,
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

  const router = makeDriveRouter(DriveView)
  await router.push('/d/1')
  await router.isReady()

  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(DriveView, {
    global: {
      plugins: [router, i18n],
      stubs: { DashboardLayout: { template: '<div><slot /></div>' }, SyncCloudButton: true },
    },
    props: { cloudId: '1' },
    attachTo: document.body,
  })
}

describe('DriveView action wiring', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('opens NewFolderDialog when driveActions requests new-folder', async () => {
    const wrapper = await mountDriveView()

    const actionsStore = useDriveActionsStore()
    actionsStore.request('new-folder')
    await wrapper.vm.$nextTick()

    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.new_folder_title))
  })

  it('opens MoveDialog when the menu move action is clicked', async () => {
    const wrapper = await mountDriveView([ITEM])

    // Wait for the list row to render a menu trigger, then open the item's
    // action menu via its aria-labelled "Thao tác" button.
    await vi.waitFor(() => {
      expect(
        Array.from(document.querySelectorAll('button')).some((b) => b.textContent?.includes('Thao tác')),
      ).toBe(true)
    })

    const trigger = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Thao tác'),
    ) as HTMLElement
    trigger.click()
    await wrapper.vm.$nextTick()

    // Click the "Di chuyển" (move) menu item that appeared in the dropdown.
    const moveItem = [...document.querySelectorAll('[role="menuitem"]')].find((el) =>
      el.textContent?.includes(viLocale.drive.action_move),
    ) as HTMLElement
    moveItem.click()
    await wrapper.vm.$nextTick()

    // The MoveDialog renders its title when open.
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.move_title))
  })

  it('opens the in-place preview overlay from the menu without leaving the list', async () => {
    vi.spyOn(driveApi, 'getDriveItemPreview').mockResolvedValue({
      status: 'ok',
      data: {
        strategy: 'fallback',
        url: '',
        download_url: 'https://cdn.example/f-1',
        item: ITEM,
        reason: 'unsupported',
      },
    })
    const wrapper = await mountDriveView([ITEM])

    await vi.waitFor(() => {
      expect(
        Array.from(document.querySelectorAll('button')).some((b) => b.textContent?.includes('Thao tác')),
      ).toBe(true)
    })

    const trigger = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Thao tác'),
    ) as HTMLElement
    trigger.click()
    await wrapper.vm.$nextTick()

    const previewItem = [...document.querySelectorAll('[role="menuitem"]')].find((el) =>
      el.textContent?.includes(viLocale.drive.action_preview),
    ) as HTMLElement
    previewItem.click()
    await wrapper.vm.$nextTick()

    // The dialog appears over the still-mounted list (the grid heading stays).
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())
    expect(document.body.textContent).toContain(viLocale.drive.type_folder)
  })

  it('reloads the list with the search term set in the store', async () => {
    const listSpy = vi.spyOn(driveApi, 'listDriveItems')
    await mountDriveView([ITEM])
    listSpy.mockClear()

    const searchStore = useDriveSearchStore()
    searchStore.setQuery('report')

    // The composable debounces query changes before refetching.
    await vi.waitFor(() =>
      expect(listSpy).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'report' }),
        expect.anything(),
      ),
    )
  })

  it('starts in grid mode and opens the details panel from persisted state', async () => {
    localStorage.setItem('ponta-drive-view-mode', JSON.stringify('grid'))
    localStorage.setItem('ponta-drive-show-details', JSON.stringify(true))

    const wrapper = await mountDriveView([ITEM])
    await wrapper.vm.$nextTick()

    // Grid mode renders section headings; list mode renders a table header.
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.type_folder))
    expect(document.body.textContent).not.toContain(viLocale.drive.table_name)

    // Details panel renders its "no selection" prompt when open.
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(viLocale.drive.detail_select_prompt),
    )
  })

  it('defaults to grid mode and closed details with nothing persisted', async () => {
    const wrapper = await mountDriveView([ITEM])
    await wrapper.vm.$nextTick()

    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.type_folder))
    expect(document.body.textContent).not.toContain(viLocale.drive.table_name)
    expect(document.body.textContent).not.toContain(viLocale.drive.detail_select_prompt)
  })

  it('starts in list mode when that is what is persisted', async () => {
    localStorage.setItem('ponta-drive-view-mode', JSON.stringify('list'))

    const wrapper = await mountDriveView([ITEM])
    await wrapper.vm.$nextTick()

    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.table_name))
    expect(document.body.textContent).not.toContain(viLocale.drive.detail_select_prompt)
  })
})

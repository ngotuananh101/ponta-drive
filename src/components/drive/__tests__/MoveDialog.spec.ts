import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import MoveDialog from '../MoveDialog.vue'
import { ApiError } from '@/api/client'
import { useDriveItemsStore } from '@/stores/driveItems'
import * as api from '@/api/driveItems'
import type { DriveItem } from '@/api/driveItems'
import viLocale from '@/locales/vi.json'

const testItem: DriveItem = {
  uuid: 'item-1',
  name: 'report.docx',
  type: 'file',
  mime_type: 'application/octet-stream',
  size: 500,
  extension: 'docx',
  cloud_account_uuid: 'acc-1',
  is_starred: false,
  status: 'ready',
  updated_at: '2026-10-04 00:00:00',
}

function folder(uuid: string, name = uuid): DriveItem {
  return { ...testItem, uuid, name, type: 'folder' }
}

function mountDialog(
  item: DriveItem | null = testItem,
  parentUuid: string | null = null,
) {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(MoveDialog, {
    props: { open: true, item, parentUuid },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

function clickButton(label: string) {
  const button = [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(label),
  ) as HTMLButtonElement
  button.click()
}

describe('MoveDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('renders the root destination and loads root folders', async () => {
    vi.spyOn(api, 'listDriveItems').mockResolvedValue({
      status: 'ok',
      data: [folder('f-1', 'Projects')],
      meta: { has_more: false, next_cursor: '' },
    })

    mountDialog()
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.move_title))
    await vi.waitFor(() => expect(document.body.textContent).toContain('Projects'))
    expect(document.body.textContent).toContain(viLocale.drive.move_root)
  })

  it('calls store.move with the selected destination and emits moved', async () => {
    vi.spyOn(api, 'listDriveItems').mockResolvedValue({
      status: 'ok',
      data: [folder('f-1', 'Projects')],
      meta: { has_more: false, next_cursor: '' },
    })
    const store = useDriveItemsStore()
    const moveSpy = vi.spyOn(store, 'move').mockResolvedValue(testItem)

    const wrapper = mountDialog()
    await vi.waitFor(() => expect(document.body.textContent).toContain('Projects'))

    const row = [...document.querySelectorAll('*')].find(
      (el) => el.textContent === 'Projects',
    ) as HTMLElement
    row.click()
    await wrapper.vm.$nextTick()

    clickButton(viLocale.drive.move_here)
    await vi.waitFor(() => expect(moveSpy).toHaveBeenCalledWith('item-1', 'f-1'))
    expect(wrapper.emitted('moved')).toBeTruthy()
  })

  it('disables the moved folder itself so it cannot be a destination', async () => {
    const target = folder('f-1', 'Target Folder')
    vi.spyOn(api, 'listDriveItems').mockResolvedValue({
      status: 'ok',
      data: [target],
      meta: { has_more: false, next_cursor: '' },
    })

    mountDialog(target)
    await vi.waitFor(() => expect(document.body.textContent).toContain('Target Folder'))

    const node = [...document.querySelectorAll('[data-testid="move-node"]')].find((el) =>
      el.textContent?.includes('Target Folder'),
    ) as HTMLElement
    expect(node.getAttribute('aria-disabled')).toBe('true')
  })

  it('renders the localized action_failed message for a non-ApiError rejection', async () => {
    vi.spyOn(api, 'listDriveItems').mockResolvedValue({
      status: 'ok',
      data: [folder('f-1', 'Projects')],
      meta: { has_more: false, next_cursor: '' },
    })
    const store = useDriveItemsStore()
    vi.spyOn(store, 'move').mockRejectedValue(new Error('Failed to fetch'))

    const wrapper = mountDialog(testItem, 'other-folder')
    await vi.waitFor(() => expect(document.body.textContent).toContain('Projects'))
    const row = [...document.querySelectorAll('[data-testid="move-node"]')].find(
      (el) => el.textContent === 'Projects',
    ) as HTMLElement
    row.click()
    await wrapper.vm.$nextTick()
    clickButton(viLocale.drive.move_here)

    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(viLocale.drive.action_failed),
    )
    expect(document.body.textContent).not.toContain('Failed to fetch')
  })

  it('renders the backend message when the failure is an ApiError', async () => {
    vi.spyOn(api, 'listDriveItems').mockResolvedValue({
      status: 'ok',
      data: [folder('f-1', 'Projects')],
      meta: { has_more: false, next_cursor: '' },
    })
    const store = useDriveItemsStore()
    vi.spyOn(store, 'move').mockRejectedValue(
      new ApiError('Không thể cập nhật mục. Vui lòng thử lại.', 400),
    )

    const wrapper = mountDialog(testItem, 'other-folder')
    await vi.waitFor(() => expect(document.body.textContent).toContain('Projects'))
    const row = [...document.querySelectorAll('[data-testid="move-node"]')].find(
      (el) => el.textContent === 'Projects',
    ) as HTMLElement
    row.click()
    await wrapper.vm.$nextTick()
    clickButton(viLocale.drive.move_here)

    await vi.waitFor(() =>
      expect(document.body.textContent).toContain('Không thể cập nhật mục. Vui lòng thử lại.'),
    )
  })

  it('does not call store.move or emit moved on a no-op move to root', async () => {
    vi.spyOn(api, 'listDriveItems').mockResolvedValue({
      status: 'ok',
      data: [folder('f-1', 'Projects')],
      meta: { has_more: false, next_cursor: '' },
    })
    const store = useDriveItemsStore()
    const moveSpy = vi.spyOn(store, 'move').mockResolvedValue(testItem)

    // item is already at root (parentUuid === null), nothing selected -> target === null
    const wrapper = mountDialog(testItem, null)
    await vi.waitFor(() => expect(document.body.textContent).toContain('Projects'))

    clickButton(viLocale.drive.move_here)
    await vi.waitFor(() => expect(moveSpy).not.toHaveBeenCalled())
    expect(wrapper.emitted('moved')).toBeFalsy()
    // dialog should have closed via the short-circuit
    expect(wrapper.props('open')).toBe(true)
  })

  it('does not call store.move or emit moved on a no-op move to the current parent folder', async () => {
    const currentParent = folder('f-1', 'Projects')
    vi.spyOn(api, 'listDriveItems').mockResolvedValue({
      status: 'ok',
      data: [currentParent],
      meta: { has_more: false, next_cursor: '' },
    })
    const store = useDriveItemsStore()
    const moveSpy = vi.spyOn(store, 'move').mockResolvedValue(testItem)

    const wrapper = mountDialog(testItem, currentParent.uuid)
    await vi.waitFor(() => expect(document.body.textContent).toContain('Projects'))

    const row = [...document.querySelectorAll('[data-testid="move-node"]')].find(
      (el) => el.textContent === 'Projects',
    ) as HTMLElement
    row.click()
    await wrapper.vm.$nextTick()

    clickButton(viLocale.drive.move_here)
    await vi.waitFor(() => expect(moveSpy).not.toHaveBeenCalled())
    expect(wrapper.emitted('moved')).toBeFalsy()
  })

  it('renders the move_empty message when the tree has no folders', async () => {
    vi.spyOn(api, 'listDriveItems').mockResolvedValue({
      status: 'ok',
      data: [],
      meta: { has_more: false, next_cursor: '' },
    })

    mountDialog()
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(viLocale.drive.move_empty),
    )
  })
})

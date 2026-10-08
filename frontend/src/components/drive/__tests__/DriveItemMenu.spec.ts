import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import DriveItemMenu from '../DriveItemMenu.vue'
import { useDriveItemsStore } from '@/stores/driveItems'
import type { DriveItem } from '@/api/driveItems'
import viLocale from '@/locales/vi.json'

const testItem: DriveItem = {
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

function mountMenu(item: DriveItem = testItem) {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(DriveItemMenu, {
    props: { item },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

/** Opens the menu and clicks the item whose label matches, on a fresh mount. */
async function clickMenuItem(label: string) {
  const wrapper = mountMenu()
  await wrapper.find('button').trigger('click')
  await wrapper.vm.$nextTick()

  const item = [...document.querySelectorAll('[role="menuitem"]')].find((el) =>
    el.textContent?.includes(label),
  ) as HTMLElement
  item.click()
  await wrapper.vm.$nextTick()
  return wrapper
}

describe('DriveItemMenu', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('renders menu items: download, star, rename, delete', async () => {
    const wrapper = mountMenu()
    const trigger = wrapper.find('button')
    await trigger.trigger('click')
    await wrapper.vm.$nextTick()

    const text = document.body.textContent ?? ''
    expect(text).toContain(viLocale.drive.action_download)
    expect(text).toContain(viLocale.drive.action_star)
    expect(text).toContain(viLocale.drive.action_rename)
    expect(text).toContain(viLocale.drive.action_move)
    expect(text).toContain(viLocale.drive.action_delete)
  })

  it('toggles star via store', async () => {
    const store = useDriveItemsStore()
    const starSpy = vi.spyOn(store, 'toggleStar').mockResolvedValue({ ...testItem, is_starred: true })

    await clickMenuItem(viLocale.drive.action_star)

    await vi.waitFor(() => expect(starSpy).toHaveBeenCalledWith('f-1'))
  })

  it('emits rename event when rename is clicked', async () => {
    const wrapper = await clickMenuItem(viLocale.drive.action_rename)
    expect(wrapper.emitted('rename')?.[0]?.[0]).toEqual(testItem)
  })

  it('emits delete event when delete is clicked', async () => {
    const wrapper = await clickMenuItem(viLocale.drive.action_delete)
    expect(wrapper.emitted('delete')?.[0]?.[0]).toEqual(testItem)
  })

  it('emits move event when move is clicked', async () => {
    const wrapper = await clickMenuItem(viLocale.drive.action_move)
    expect(wrapper.emitted('move')?.[0]?.[0]).toEqual(testItem)
  })

  it('offers a Preview action and emits preview with the item', async () => {
    const wrapper = await clickMenuItem(viLocale.drive.action_preview)
    expect(wrapper.emitted('preview')?.[0]?.[0]).toEqual(testItem)
  })

  it('shows the Preview action for a file, not for a folder', async () => {
    const wrapper = mountMenu()
    await wrapper.find('button').trigger('click')
    await wrapper.vm.$nextTick()
    expect(document.body.textContent).toContain(viLocale.drive.action_preview)
    wrapper.unmount()

    document.body.innerHTML = ''
    const folderWrapper = mountMenu({ ...testItem, type: 'folder' })
    await folderWrapper.find('button').trigger('click')
    await folderWrapper.vm.$nextTick()
    expect(document.body.textContent).not.toContain(viLocale.drive.action_preview)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import RenameDialog from '../RenameDialog.vue'
import { useDriveItemsStore } from '@/stores/driveItems'
import type { DriveItem } from '@/api/driveItems'
import viLocale from '@/locales/vi.json'

const testItem: DriveItem = {
  uuid: 'item-1',
  name: 'Old Name.pdf',
  type: 'file',
  mime_type: 'application/pdf',
  size: 500,
  extension: 'pdf',
  cloud_account_uuid: 'c-1',
  is_starred: false,
  status: 'ready',
  updated_at: '2026-10-04 00:00:00',
}

function mountDialog(item: DriveItem | null) {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(RenameDialog, {
    props: { open: true, item },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

describe('RenameDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  it('prefills input with the item current name', async () => {
    mountDialog(testItem)
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.rename_title))

    const input = document.querySelector<HTMLInputElement>('input')!
    expect(input.value).toBe('Old Name.pdf')
  })

  it('calls rename on store and emits renamed event', async () => {
    const store = useDriveItemsStore()
    const renameSpy = vi.spyOn(store, 'rename').mockResolvedValue({
      ...testItem,
      name: 'New Name.pdf',
    })

    const wrapper = mountDialog(testItem)
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.rename_title))

    const input = document.querySelector<HTMLInputElement>('input')!
    input.value = 'New Name.pdf'
    input.dispatchEvent(new Event('input'))
    await wrapper.vm.$nextTick()

    const button = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(viLocale.drive.rename_save),
    )!
    button.click()

    await vi.waitFor(() => expect(renameSpy).toHaveBeenCalledWith('item-1', 'New Name.pdf'))
    expect(wrapper.emitted('renamed')).toBeTruthy()
  })
})

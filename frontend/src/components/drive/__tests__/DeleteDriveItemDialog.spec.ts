import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import DeleteDriveItemDialog from '../DeleteDriveItemDialog.vue'
import { ApiError } from '@/api/client'
import { useDriveItemsStore } from '@/stores/driveItems'
import type { DriveItem } from '@/api/driveItems'
import viLocale from '@/locales/vi.json'

const testFile: DriveItem = {
  uuid: 'f-1',
  name: 'report.docx',
  type: 'file',
  mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  size: 500,
  extension: 'docx',
  cloud_account_id: 1,
  is_starred: false,
  status: 'ready',
  updated_at: '2026-10-04 00:00:00',
}

const testFolder: DriveItem = {
  ...testFile,
  uuid: 'f-2',
  name: 'Client Folder',
  type: 'folder',
}

function mountDialog(item: DriveItem | null) {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(DeleteDriveItemDialog, {
    props: { open: true, item },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

describe('DeleteDriveItemDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  it('renders confirmation message naming the file', async () => {
    mountDialog(testFile)
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.delete_item_title))
    expect(document.body.textContent).toContain('report.docx')
    expect(document.body.textContent).not.toContain(viLocale.drive.delete_folder_warning)
  })

  it('renders extra warning message when item is a folder', async () => {
    mountDialog(testFolder)
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.delete_folder_warning))
  })

  it('calls permanent delete through store on confirm', async () => {
    const store = useDriveItemsStore()
    const deleteSpy = vi.spyOn(store, 'remove').mockResolvedValue()

    const wrapper = mountDialog(testFile)
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.delete_item_title))

    const button = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(viLocale.drive.delete_button),
    )!
    button.click()

    await vi.waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('f-1', true))
    expect(wrapper.emitted('deleted')).toBeTruthy()
  })

  it('renders the localized action_failed message for a non-ApiError rejection', async () => {
    const store = useDriveItemsStore()
    vi.spyOn(store, 'remove').mockRejectedValue(new Error('Failed to fetch'))

    mountDialog(testFile)
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.delete_item_title))

    const button = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(viLocale.drive.delete_button),
    )!
    button.click()

    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(viLocale.drive.action_failed),
    )
    expect(document.body.textContent).not.toContain('Failed to fetch')
  })

  it('renders the backend message when the failure is an ApiError', async () => {
    const store = useDriveItemsStore()
    vi.spyOn(store, 'remove').mockRejectedValue(new ApiError('Không thể xóa mục. Vui lòng thử lại.', 400))

    mountDialog(testFile)
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.delete_item_title))

    const button = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(viLocale.drive.delete_button),
    )!
    button.click()

    await vi.waitFor(() =>
      expect(document.body.textContent).toContain('Không thể xóa mục. Vui lòng thử lại.'),
    )
  })
})

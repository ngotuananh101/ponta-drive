import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import NewFolderDialog from '../NewFolderDialog.vue'
import { useDriveItemsStore } from '@/stores/driveItems'
import viLocale from '@/locales/vi.json'

function mountDialog(props: { cloudAccountUuid: string; parentUuid?: string | null }) {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(NewFolderDialog, {
    props: { open: true, ...props },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

describe('NewFolderDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  it('renders dialog title and input', async () => {
    mountDialog({ cloudAccountUuid: 'cloud-1' })
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.new_folder_title))
    const input = document.querySelector<HTMLInputElement>('input')
    expect(input).not.toBeNull()
  })

  it('creates folder via store and emits created event', async () => {
    const store = useDriveItemsStore()
    const createSpy = vi.spyOn(store, 'createFolder').mockResolvedValue({
      uuid: 'new-f',
      name: 'Project Photos',
      type: 'folder',
      mime_type: '',
      size: 0,
      extension: '',
      cloud_account_uuid: 'cloud-1',
      is_starred: false,
      status: 'ready',
      updated_at: '2026-10-04 00:00:00',
    })

    const wrapper = mountDialog({ cloudAccountUuid: 'cloud-1', parentUuid: null })
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.new_folder_title))

    const input = document.querySelector<HTMLInputElement>('input')!
    input.value = 'Project Photos'
    input.dispatchEvent(new Event('input'))
    await wrapper.vm.$nextTick()

    const button = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(viLocale.drive.new_folder_create),
    )!
    button.click()

    await vi.waitFor(() => expect(createSpy).toHaveBeenCalledWith('cloud-1', null, 'Project Photos'))
    expect(wrapper.emitted('created')).toBeTruthy()
  })

  it('renders the localized action_failed message for a non-ApiError rejection', async () => {
    const store = useDriveItemsStore()
    vi.spyOn(store, 'createFolder').mockRejectedValue(new Error('Failed to fetch'))

    mountDialog({ cloudAccountUuid: 'cloud-1', parentUuid: null })
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.new_folder_title))

    const input = document.querySelector<HTMLInputElement>('input')!
    input.value = 'Some Folder'
    input.dispatchEvent(new Event('input'))
    await vi.waitFor(() => expect(true).toBe(true))

    const button = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(viLocale.drive.new_folder_create),
    )!
    button.click()

    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(viLocale.drive.action_failed),
    )
    expect(document.body.textContent).not.toContain('Failed to fetch')
  })
})

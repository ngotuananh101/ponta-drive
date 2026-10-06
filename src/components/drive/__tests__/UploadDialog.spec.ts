import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { ref } from 'vue'
import UploadDialog from '../UploadDialog.vue'
import * as useUploadModule from '@/composables/useUpload'
import viLocale from '@/locales/vi.json'

type UseUploadReturn = ReturnType<typeof useUploadModule.useUpload>

function mockUseUpload(startUploadMock: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue([])) {
  const mock: UseUploadReturn = {
    uploadQueue: ref([]),
    isUploading: ref(false),
    startUpload: startUploadMock,
    cancelItem: vi.fn(),
    clearQueue: vi.fn(),
  }
  vi.spyOn(useUploadModule, 'useUpload').mockReturnValue(mock)
  return mock
}

function mountDialog(initialMode: 'file' | 'folder' = 'file') {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(UploadDialog, {
    props: { open: true, cloudAccountId: 1, parentUuid: null, initialMode },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

function mountClosedDialog(initialMode: 'file' | 'folder' = 'file') {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(UploadDialog, {
    props: { open: false, cloudAccountId: 1, parentUuid: null, initialMode },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

async function selectFile(name = 'sample.txt') {
  const file = new File(['content'], name, { type: 'text/plain' })
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  Object.defineProperty(input, 'files', { value: [file] })
  await input.dispatchEvent(new Event('change'))
  return file
}

function clickButton(label: string) {
  const button = [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(label),
  )!
  button.click()
}

describe('UploadDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('renders upload method selection step', async () => {
    mountDialog()
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))
    expect(document.body.textContent).toContain(viLocale.drive.upload_method_direct)
    expect(document.body.textContent).toContain(viLocale.drive.upload_method_server)
  })

  it('selects files and calls startUpload on submit', async () => {
    const { startUpload } = mockUseUpload()

    mountDialog('file')
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))

    const file = await selectFile()
    clickButton(viLocale.drive.upload_start)

    await vi.waitFor(() =>
      expect(startUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          cloudAccountId: 1,
          files: [file],
          method: 'direct',
        }),
      ),
    )
  })

  it('selects server method card and threads it into startUpload', async () => {
    const { startUpload } = mockUseUpload()

    mountDialog('file')
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))

    const file = await selectFile()

    const serverCard = [...document.querySelectorAll<HTMLDivElement>('div')].find(
      (el) =>
        el.className.includes('cursor-pointer') &&
        el.textContent?.includes(viLocale.drive.upload_method_server),
    )!
    serverCard.click()

    clickButton(viLocale.drive.upload_start)

    await vi.waitFor(() =>
      expect(startUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          cloudAccountId: 1,
          files: [file],
          method: 'server',
        }),
      ),
    )
  })

  it('auto-opens the folder picker when initialMode is "folder"', async () => {
    mockUseUpload()
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')

    const wrapper = mountClosedDialog('folder')

    // Toggle open to trigger the watch (Vue watch does not fire for the initial value).
    await wrapper.setProps({ open: true })
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))
    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalled())

    clickSpy.mockRestore()
  })

  it('does NOT auto-open the folder picker when initialMode is "file"', async () => {
    mockUseUpload()
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')

    const wrapper = mountClosedDialog('file')

    // Toggle open to trigger the watch (Vue watch does not fire for the initial value).
    await wrapper.setProps({ open: true })
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))
    await wrapper.vm.$nextTick()

    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })
})

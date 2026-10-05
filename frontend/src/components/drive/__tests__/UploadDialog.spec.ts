import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { ref } from 'vue'
import UploadDialog from '../UploadDialog.vue'
import * as useUploadModule from '@/composables/useUpload'
import viLocale from '@/locales/vi.json'

function mountDialog(initialMode: 'file' | 'folder' = 'file') {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(UploadDialog, {
    props: { open: true, cloudAccountUuid: 'cloud-1', parentUuid: null, initialMode },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
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
    const startUploadMock = vi.fn().mockResolvedValue([])
    vi.spyOn(useUploadModule, 'useUpload').mockReturnValue({
      uploadQueue: ref([]),
      isUploading: ref(false),
      startUpload: startUploadMock,
      cancelItem: vi.fn(),
      clearQueue: vi.fn(),
    })

    mountDialog('file')
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))

    const file = new File(['content'], 'sample.txt', { type: 'text/plain' })
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    Object.defineProperty(input, 'files', { value: [file] })
    await input.dispatchEvent(new Event('change'))

    const startBtn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(viLocale.drive.upload_start),
    )!
    startBtn.click()

    await vi.waitFor(() =>
      expect(startUploadMock).toHaveBeenCalledWith(
        expect.objectContaining({
          cloudAccountUuid: 'cloud-1',
          files: [file],
        }),
      ),
    )
  })
})

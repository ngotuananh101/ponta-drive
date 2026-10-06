import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import UploadDialog from '../UploadDialog.vue'
import { useUploadStore, type UploadQueueItem } from '@/stores/upload'
import viLocale from '@/locales/vi.json'

function mountDialog(initialMode: 'file' | 'folder' = 'file', open = true) {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(UploadDialog, {
    props: { open, cloudAccountId: 1, parentUuid: null, initialMode },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

async function selectFiles(names: string[]) {
  const files = names.map((n) => new File(['content'], n, { type: 'text/plain' }))
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  Object.defineProperty(input, 'files', { value: files })
  await input.dispatchEvent(new Event('change'))
  return files
}

function clickButton(label: string) {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label))!
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

  it('shows the selected file name before upload', async () => {
    mountDialog('file')
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))

    await selectFiles(['report.pdf'])

    expect(document.body.textContent).toContain('report.pdf')
    expect(document.body.textContent).toContain(viLocale.drive.upload_selected_title.replace('{count}', '1'))
  })

  it('removes a single selected file', async () => {
    const wrapper = mountDialog('file')
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))

    await selectFiles(['a.txt', 'b.txt'])
    expect(document.body.textContent).toContain('a.txt')
    expect(document.body.textContent).toContain('b.txt')

    const removeButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('aria-label') === viLocale.drive.upload_remove_file,
    )!
    removeButton.click()
    await wrapper.vm.$nextTick()

    expect(document.body.textContent).not.toContain('a.txt')
    expect(document.body.textContent).toContain('b.txt')
  })

  it('clears every selected file', async () => {
    const wrapper = mountDialog('file')
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))

    await selectFiles(['a.txt', 'b.txt'])
    clickButton(viLocale.drive.upload_clear_files)
    await wrapper.vm.$nextTick()

    expect(document.body.textContent).not.toContain('a.txt')
    expect(document.body.textContent).not.toContain('b.txt')
  })

  it('closes the dialog and starts the upload when Start is pressed', async () => {
    const store = useUploadStore()
    const startSpy = vi.spyOn(store, 'startUpload').mockResolvedValue([])

    const wrapper = mountDialog('file')
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))

    const files = await selectFiles(['sample.txt'])
    clickButton(viLocale.drive.upload_start)

    await vi.waitFor(() =>
      expect(startSpy).toHaveBeenCalledWith(
        expect.objectContaining({ cloudAccountId: 1, files, method: 'direct' }),
      ),
    )
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
  })

  it('selects the server method card and threads it into startUpload', async () => {
    const store = useUploadStore()
    const startSpy = vi.spyOn(store, 'startUpload').mockResolvedValue([])

    mountDialog('file')
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))

    await selectFiles(['sample.txt'])

    const serverCard = [...document.querySelectorAll<HTMLDivElement>('div')].find(
      (el) =>
        el.className.includes('cursor-pointer') &&
        el.textContent?.includes(viLocale.drive.upload_method_server),
    )!
    serverCard.click()

    clickButton(viLocale.drive.upload_start)

    await vi.waitFor(() =>
      expect(startSpy).toHaveBeenCalledWith(expect.objectContaining({ method: 'server' })),
    )
  })

  it('does NOT close or start when nothing is selected', async () => {
    const store = useUploadStore()
    const startSpy = vi.spyOn(store, 'startUpload').mockResolvedValue([])

    const wrapper = mountDialog('file')
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))

    clickButton(viLocale.drive.upload_start)
    await wrapper.vm.$nextTick()

    expect(startSpy).not.toHaveBeenCalled()
    expect(wrapper.emitted('update:open')).toBeFalsy()
  })

  it('auto-opens the folder picker when initialMode is "folder"', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')

    const wrapper = mountDialog('folder', false)
    await wrapper.setProps({ open: true })
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))
    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalled())

    clickSpy.mockRestore()
  })

  it('does NOT auto-open the folder picker when initialMode is "file"', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')

    const wrapper = mountDialog('file', false)
    await wrapper.setProps({ open: true })
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))
    await wrapper.vm.$nextTick()

    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  // Review focus #2: opening the dialog must not wipe a background upload.
  it('does not clear a running upload queue when reopened', async () => {
    const store = useUploadStore()
    const queued: UploadQueueItem = {
      id: 'up-1',
      file: new File(['x'], 'x.txt'),
      progress: 0,
      status: 'uploading',
    }
    store.uploadQueue = [queued]

    const wrapper = mountDialog('file', false)
    await wrapper.setProps({ open: true })
    await vi.waitFor(() => expect(document.body.textContent).toContain(viLocale.drive.upload_title))

    expect(store.uploadQueue).toHaveLength(1)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import UploadProgressPanel from '../UploadProgressPanel.vue'
import { useUploadStore, type UploadQueueItem } from '@/stores/upload'
import viLocale from '@/locales/vi.json'

function mountPanel() {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(UploadProgressPanel, { global: { plugins: [i18n] }, attachTo: document.body })
}

function item(partial: Partial<UploadQueueItem>): UploadQueueItem {
  return {
    id: 'up-1',
    file: new File(['x'], 'x.txt'),
    progress: 0,
    status: 'pending',
    ...partial,
  }
}

describe('UploadProgressPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  // Review focus #3: nothing renders while the queue is empty.
  it('renders nothing when the queue is empty', () => {
    const wrapper = mountPanel()
    expect(wrapper.find('.fixed').exists()).toBe(false)
  })

  it('renders a row per queued file with its name and percent', async () => {
    const store = useUploadStore()
    store.uploadQueue = [
      item({ id: 'up-1', file: new File(['a'], 'alpha.png'), progress: 42, status: 'uploading' }),
      item({ id: 'up-2', file: new File(['b'], 'beta.zip'), progress: 100, status: 'completed' }),
    ]

    const wrapper = mountPanel()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('alpha.png')
    expect(wrapper.text()).toContain('beta.zip')
    expect(wrapper.text()).toContain('42%')
    expect(wrapper.text()).toContain('100%')
  })

  // Review focus #4: the per-item cancel reaches the store.
  it('cancels an in-flight item through the store', async () => {
    const store = useUploadStore()
    store.uploadQueue = [item({ id: 'up-9', status: 'uploading', progress: 10 })]
    const cancelSpy = vi.spyOn(store, 'cancelItem')

    const wrapper = mountPanel()
    await wrapper.vm.$nextTick()

    const cancelButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('aria-label') === viLocale.drive.upload_panel_cancel,
    )!
    cancelButton.click()

    expect(cancelSpy).toHaveBeenCalledWith('up-9')
  })

  it('disables the close button while an upload is running', async () => {
    const store = useUploadStore()
    store.uploadQueue = [item({ id: 'up-3', status: 'uploading', progress: 5 })]

    const wrapper = mountPanel()
    await wrapper.vm.$nextTick()

    const closeButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('aria-label') === viLocale.drive.upload_panel_close,
    ) as HTMLButtonElement
    expect(closeButton.disabled).toBe(true)
  })

  it('clears the queue when close is pressed after everything settles', async () => {
    const store = useUploadStore()
    store.uploadQueue = [item({ id: 'up-4', status: 'completed', progress: 100 })]

    const wrapper = mountPanel()
    await wrapper.vm.$nextTick()

    const closeButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('aria-label') === viLocale.drive.upload_panel_close,
    ) as HTMLButtonElement
    expect(closeButton.disabled).toBe(false)
    closeButton.click()

    expect(store.uploadQueue).toHaveLength(0)
  })
})

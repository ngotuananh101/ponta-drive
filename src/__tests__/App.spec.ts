import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import App from '../App.vue'
import UploadProgressPanel from '@/components/upload/UploadProgressPanel.vue'
import { useUploadStore } from '@/stores/upload'
import viLocale from '@/locales/vi.json'

function mountApp() {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(App, {
    global: {
      plugins: [i18n],
      stubs: { RouterView: true, Toaster: true },
    },
  })
}

describe('App', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  it('mounts the global upload progress panel', async () => {
    const wrapper = mountApp()
    expect(wrapper.findComponent(UploadProgressPanel).exists()).toBe(true)

    // Seeding the store makes the (otherwise hidden) panel visible.
    const store = useUploadStore()
    store.uploadQueue = [
      { id: 'up-1', file: new File(['x'], 'x.txt'), progress: 0, status: 'uploading' },
    ]
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('x.txt')
  })
})

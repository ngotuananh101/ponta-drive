import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import FilePreviewOverlay from '@/components/drive/FilePreviewOverlay.vue'
import viLocale from '@/locales/vi.json'

// The overlay's own responsibility is the dialog shell: the backdrop, the
// Escape key, and forwarding the content's events. The content component is
// covered by FilePreviewContent.spec.ts, so it is stubbed here.
const ContentStub = {
  name: 'FilePreviewContent',
  props: ['uuid', 'openStandalone'],
  emits: ['close', 'open-standalone'],
  template: '<div data-test="preview-content" />',
}

function mountOverlay() {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(FilePreviewOverlay, {
    props: { uuid: 'abc' },
    global: {
      plugins: [i18n],
      stubs: { FilePreviewContent: ContentStub },
    },
    attachTo: document.body,
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  document.body.style.overflow = ''
})

describe('FilePreviewOverlay', () => {
  it('closes on the Escape key', async () => {
    const wrapper = mountOverlay()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('forwards close from the content and locks body scroll while open', async () => {
    const wrapper = mountOverlay()
    expect(document.body.style.overflow).toBe('hidden')

    wrapper.findComponent(ContentStub).vm.$emit('close')
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('allows opening the file in a standalone route and releases scroll on unmount', async () => {
    const wrapper = mountOverlay()
    wrapper.findComponent(ContentStub).vm.$emit('open-standalone')
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('open-standalone')).toHaveLength(1)

    wrapper.unmount()
    expect(document.body.style.overflow).not.toBe('hidden')
  })
})

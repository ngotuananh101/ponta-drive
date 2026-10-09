import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createRouter, createMemoryHistory } from 'vue-router'

import PreviewView from '@/views/PreviewView.vue'
import * as api from '@/api/driveItems'
import viLocale from '@/locales/vi.json'

vi.mock('@eternalheart/vue-file-preview', () => ({
  FilePreviewEmbed: {
    name: 'FilePreviewEmbed',
    props: ['files', 'locale', 'messages', 'theme', 'requestInit', 'shouldFetchAsBlob'],
    template: '<div data-test="preview-embed" />',
  },
}))

const item = {
  uuid: 'abc',
  name: 'photo.png',
  type: 'file' as const,
  mime_type: 'image/png',
  size: 1024,
  extension: 'png',
  cloud_account_id: 1,
  is_starred: false,
  status: 'ready',
  updated_at: '2026-10-01 00:00:00',
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/d/:cloudId/preview/:uuid', name: 'drive-preview', component: PreviewView, props: true },
      { path: '/d/:cloudId', name: 'drive', component: { template: '<div />' } },
    ],
  })
}

/**
 * Mounts the standalone preview route. The content component owns the fetch
 * and the embed wiring (covered in FilePreviewContent.spec.ts); this spec only
 * pins the route shell: no app chrome, and a close action that leaves.
 */
async function mountAt(cloudId: string, uuid: string) {
  const router = makeRouter()
  await router.push(`/d/${cloudId}/preview/${uuid}`)
  await router.isReady()
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  const wrapper = mount(PreviewView, {
    global: { plugins: [router, i18n] },
    // Mounted directly (not through RouterView), so route props are passed in.
    props: router.currentRoute.value.params as { cloudId: string; uuid: string },
    attachTo: document.body,
  })
  return { wrapper, router }
}

beforeEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  vi.spyOn(api, 'getDriveItemPreview').mockResolvedValue({
    status: 'ok',
    data: {
      strategy: 'direct',
      url: 'https://cdn.example/abc.png',
      download_url: 'https://cdn.example/abc.png',
      item,
      reason: '',
    },
  })
})

describe('PreviewView', () => {
  it('renders the preview fullscreen with no dashboard layout', async () => {
    const { wrapper } = await mountAt('1', 'abc')
    await flushPromises()

    // The route shell is a fixed fullscreen surface; the app chrome is absent.
    expect(wrapper.find('.fixed.inset-0').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'DashboardLayout' }).exists()).toBe(false)
    expect(wrapper.find('[data-test="preview-embed"]').exists()).toBe(true)
  })

  it('navigates back to the drive when the close button is clicked', async () => {
    const { wrapper, router } = await mountAt('1', 'abc')
    await flushPromises()

    await wrapper.get('[data-test="preview-close"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('drive')
    expect(router.currentRoute.value.params.cloudId).toBe('1')
  })
})

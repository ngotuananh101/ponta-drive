import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createRouter, createMemoryHistory } from 'vue-router'

import PreviewView from '@/views/PreviewView.vue'
import * as api from '@/api/driveItems'
import { apiUrl } from '@/api/client'
import viLocale from '@/locales/vi.json'

vi.mock('@eternalheart/vue-file-preview', () => ({
  FilePreviewEmbed: {
    name: 'FilePreviewEmbed',
    props: ['files', 'locale', 'messages', 'theme', 'requestInit', 'shouldFetchAsBlob'],
    template: '<div data-test="preview-embed" />',
  },
}))

const item = {
  uuid: 'abc', name: 'photo.png', type: 'file' as const, mime_type: 'image/png',
  size: 1024, extension: 'png', cloud_account_id: 1, is_starred: false,
  status: 'ready', updated_at: '2026-10-01 00:00:00',
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

async function mountAt(cloudId: string, uuid: string) {
  const router = makeRouter()
  await router.push(`/d/${cloudId}/preview/${uuid}`)
  await router.isReady()
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(PreviewView, {
    global: {
      plugins: [router, i18n],
      // The layout pulls in the sidebar, the cloud-account store and a
      // network fetch; it is irrelevant to what this spec asserts.
      stubs: { DashboardLayout: { template: '<div><slot /></div>' } },
    },
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('PreviewView', () => {
  it('shows the fallback card with a download link when the strategy is fallback', async () => {
    vi.spyOn(api, 'getDriveItemPreview').mockResolvedValue({
      status: 'ok',
      data: {
        strategy: 'fallback',
        url: '',
        download_url: 'https://cdn.example/abc',
        item,
        reason: 'too_large',
      },
    })

    const wrapper = await mountAt('1', 'abc')
    await flushPromises()

    // The download link is offered and the library is not loaded.
    const link = wrapper.find('[data-test="preview-download"]')
    expect(link.exists()).toBe(true)
    expect(link.attributes('href')).toBe('https://cdn.example/abc')
    expect(wrapper.text()).toContain(viLocale.drive.preview_too_large)
  })

  it('shows an error message when the request fails', async () => {
    vi.spyOn(api, 'getDriveItemPreview').mockRejectedValue(new Error('boom'))

    const wrapper = await mountAt('1', 'abc')
    await flushPromises()

    expect(wrapper.text()).toContain(viLocale.drive.preview_error)
  })

  it('renders the embed for a direct strategy without attaching a request init', async () => {
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

    const wrapper = await mountAt('1', 'abc')
    await flushPromises()

    const embed = wrapper.findComponent({ name: 'FilePreviewEmbed' })
    expect(embed.exists()).toBe(true)
    // A direct URL is cross-origin: no Authorization header, or the browser
    // would preflight and fail.
    expect(embed.props('requestInit')).toBeUndefined()
    // The file name is passed so the library can detect the type by extension
    // when the MIME is empty or generic (Review Focus #1).
    const files = embed.props('files') as Array<{ name: string; url: string }>
    expect(files[0].name).toBe(item.name)
    expect(files[0].url).toBe('https://cdn.example/abc.png')
  })

  it('renders the embed for a proxy strategy and attaches the bearer request init', async () => {
    localStorage.setItem('token', 'tok-123')
    vi.spyOn(api, 'getDriveItemPreview').mockResolvedValue({
      status: 'ok',
      data: {
        strategy: 'proxy',
        url: '/v1/drive/items/abc/content',
        download_url: 'https://cdn.example/abc',
        item,
        reason: '',
      },
    })

    const wrapper = await mountAt('1', 'abc')
    await flushPromises()

    const embed = wrapper.findComponent({ name: 'FilePreviewEmbed' })
    expect(embed.exists()).toBe(true)
    // The proxy is same-origin and needs the bearer token; the URL is absolute
    // so the library fetches through the app's API base.
    const requestInit = embed.props('requestInit') as
      | (() => { headers: { Authorization: string } })
      | undefined
    expect(typeof requestInit).toBe('function')
    expect(requestInit!().headers.Authorization).toBe('Bearer tok-123')
    const files = embed.props('files') as Array<{ url: string }>
    expect(files[0].url).toBe(apiUrl('/v1/drive/items/abc/content'))
  })
})

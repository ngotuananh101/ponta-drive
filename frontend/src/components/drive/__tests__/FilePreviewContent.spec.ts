import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import FilePreviewContent from '@/components/drive/FilePreviewContent.vue'
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

function mountContent(props: Record<string, unknown> = {}) {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(FilePreviewContent, {
    props: { uuid: 'abc', ...props },
    global: { plugins: [i18n] },
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('FilePreviewContent', () => {
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

    const wrapper = mountContent()
    await flushPromises()

    const link = wrapper.find('[data-test="preview-download"]')
    expect(link.exists()).toBe(true)
    expect(link.attributes('href')).toBe('https://cdn.example/abc')
    expect(wrapper.text()).toContain(viLocale.drive.preview_too_large)
  })

  it('shows an error message when the request fails', async () => {
    vi.spyOn(api, 'getDriveItemPreview').mockRejectedValue(new Error('boom'))

    const wrapper = mountContent()
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

    const wrapper = mountContent()
    await flushPromises()

    const embed = wrapper.findComponent({ name: 'FilePreviewEmbed' })
    expect(embed.exists()).toBe(true)
    expect(embed.props('requestInit')).toBeUndefined()
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

    const wrapper = mountContent()
    await flushPromises()

    const embed = wrapper.findComponent({ name: 'FilePreviewEmbed' })
    expect(embed.exists()).toBe(true)
    const requestInit = embed.props('requestInit') as
      | (() => { headers: { Authorization: string } })
      | undefined
    expect(typeof requestInit).toBe('function')
    expect(requestInit!().headers.Authorization).toBe('Bearer tok-123')
    const files = embed.props('files') as Array<{ url: string }>
    expect(files[0].url).toBe(apiUrl('/v1/drive/items/abc/content'))
  })

  it('emits close when the close button is clicked', async () => {
    vi.spyOn(api, 'getDriveItemPreview').mockResolvedValue({
      status: 'ok',
      data: {
        strategy: 'fallback',
        url: '',
        download_url: 'https://cdn.example/abc',
        item,
        reason: 'unsupported',
      },
    })

    const wrapper = mountContent()
    await flushPromises()

    await wrapper.get('[data-test="preview-close"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('offers an open-in-new-tab action only when standalone is allowed', async () => {
    vi.spyOn(api, 'getDriveItemPreview').mockResolvedValue({
      status: 'ok',
      data: {
        strategy: 'fallback',
        url: '',
        download_url: 'https://cdn.example/abc',
        item,
        reason: 'unsupported',
      },
    })

    const withTab = mountContent({ openStandalone: true })
    await flushPromises()
    await withTab.get('[data-test="preview-open-tab"]').trigger('click')
    expect(withTab.emitted('open-standalone')).toHaveLength(1)

    const withoutTab = mountContent()
    await flushPromises()
    expect(withoutTab.find('[data-test="preview-open-tab"]').exists()).toBe(false)
  })
})

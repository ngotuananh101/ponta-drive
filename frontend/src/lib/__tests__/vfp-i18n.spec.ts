import { describe, expect, it } from 'vitest'
import { viMessages } from '@/lib/vfp-i18n'

// The library's full built-in key set (mirrors
// @eternalheart/file-preview-core/src/i18n/messages/en-US.ts, v1.6.10). Pinned
// here so a library update that adds a key fails this test instead of leaking
// English (or Chinese) into the Vietnamese UI.
const LIBRARY_KEYS = [
  'common.download',
  'common.close',
  'common.loading',
  'common.unknown_error',
  'common.unsupported_preview',
  'common.retry',
  'accessibility.previousFile',
  'accessibility.nextFile',
  'accessibility.closePreview',
  'accessibility.downloadFile',
  'toolbar.zoom_in',
  'toolbar.zoom_out',
  'toolbar.rotate_left',
  'toolbar.rotate_right',
  'toolbar.reset',
  'toolbar.fit_to_window',
  'toolbar.original_size',
  'toolbar.toc',
  'toolbar.outline',
  'toolbar.prev_page',
  'toolbar.next_page',
  'toolbar.full_width',
  'toolbar.normal_width',
  'toolbar.wrap_on',
  'toolbar.wrap_off',
  'toolbar.source',
  'toolbar.preview',
  'image.load_failed',
  'image.decode_failed',
  'pdf.load_failed',
  'docx.parse_failed',
  'doc.parse_failed',
  'doc.loading',
  'ppt.parse_failed',
  'ppt.loading',
  'xlsx.loading',
  'xlsx.load_failed',
  'xlsx.parse_failed',
  'xlsx.not_found',
  'xls.parse_failed',
  'xls.loading',
  'pptx.loading',
  'pptx.load_failed',
  'pptx.parse_failed',
  'pptx.not_found',
  'pptx.invalid_format',
  'pptx.no_pages',
  'pptx.timeout',
  'msg.parse_failed',
  'msg.parse_failed_short',
  'msg.empty_body',
  'epub.load_failed',
  'mobi.load_failed',
  'video.loading',
  'video.load_failed',
  'video.load_failed_with_error',
  'video.format_not_supported',
  'video.unsupported_title',
  'video.unsupported_detail',
  'video.codec_not_supported_detail',
  'audio.aria.play',
  'audio.aria.pause',
  'audio.aria.forward_10',
  'audio.aria.backward_10',
  'audio.aria.mute',
  'audio.aria.unmute',
  'audio.aria.loop_on',
  'audio.aria.loop_off',
  'audio.aria.progress',
  'audio.aria.volume',
  'markdown.load_failed',
  'markdown.copy_code',
  'markdown.copied',
  'json.load_failed',
  'json.items',
  'json.keys',
  'csv.loading',
  'csv.load_failed',
  'csv.parse_failed',
  'xml.load_failed',
  'subtitle.load_failed',
  'subtitle.parse_failed',
  'subtitle.lines',
  'subtitle.cues',
  'subtitle.meta.title',
  'subtitle.meta.artist',
  'subtitle.meta.album',
  'subtitle.meta.author',
  'subtitle.meta.by',
  'subtitle.meta.length',
  'subtitle.meta.offset',
  'subtitle.meta.editor',
  'subtitle.meta.version',
  'zip.load_failed',
  'zip.parse_failed',
  'text.load_failed',
  'font.loading',
  'font.load_failed',
  'font.parse_failed',
  'font.metadata_loading',
  'font.metadata_unavailable',
  'font.meta.family',
  'font.meta.subfamily',
  'font.meta.version',
  'font.meta.designer',
  'font.meta.glyphs',
  'font.meta.format',
  'font.sample_text_placeholder',
  'cad.loading',
  'cad.load_failed',
  'cad.parse_failed',
  'cad.wireframe',
  'cad.solid',
  'cad.grid',
  'cad.axes',
]

describe('viMessages', () => {
  it('covers every library key', () => {
    const missing = LIBRARY_KEYS.filter((key) => !(key in viMessages))
    expect(missing).toEqual([])
  })

  it('has no empty translations', () => {
    const empty = Object.entries(viMessages)
      .filter(([, value]) => value.trim() === '')
      .map(([key]) => key)
    expect(empty).toEqual([])
  })

  it('keeps the interpolation placeholders the library substitutes', () => {
    expect(viMessages['common.unsupported_preview']).toContain('{type}')
    expect(viMessages['video.load_failed_with_error']).toContain('{error}')
    expect(viMessages['video.format_not_supported']).toContain('{format}')
    expect(viMessages['video.unsupported_detail']).toContain('{format}')
    expect(viMessages['video.codec_not_supported_detail']).toContain('{codecs}')
  })
})

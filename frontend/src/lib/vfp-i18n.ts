/**
 * Vietnamese dictionary for @eternalheart/vue-file-preview.
 *
 * The library ships only zh-CN and en-US, and falls back to zh-CN for an
 * unknown locale, so an incomplete dictionary would show Chinese in a
 * Vietnamese UI. `src/lib/__tests__/vfp-i18n.spec.ts` asserts this covers the
 * library's full key set.
 *
 * Passed as `messages={{ vi: viMessages }}` with `locale="vi"`.
 */
export const viMessages: Record<string, string> = {
  // common
  'common.download': 'Tải xuống',
  'common.close': 'Đóng',
  'common.loading': 'Đang tải',
  'common.unknown_error': 'Lỗi không xác định',
  'common.unsupported_preview': 'Không hỗ trợ xem trước định dạng tệp này ({type})',
  'common.retry': 'Thử lại',

  // accessibility
  'accessibility.previousFile': 'Tệp trước',
  'accessibility.nextFile': 'Tệp tiếp theo',
  'accessibility.closePreview': 'Đóng xem trước',
  'accessibility.downloadFile': 'Tải tệp xuống',

  // toolbar
  'toolbar.zoom_in': 'Phóng to',
  'toolbar.zoom_out': 'Thu nhỏ',
  'toolbar.rotate_left': 'Xoay trái',
  'toolbar.rotate_right': 'Xoay phải',
  'toolbar.reset': 'Đặt lại',
  'toolbar.fit_to_window': 'Vừa cửa sổ',
  'toolbar.original_size': 'Kích thước gốc',
  'toolbar.toc': 'Mục lục',
  'toolbar.outline': 'Dàn ý',
  'toolbar.prev_page': 'Trang trước',
  'toolbar.next_page': 'Trang sau',
  'toolbar.full_width': 'Toàn chiều rộng',
  'toolbar.normal_width': 'Chiều rộng thường',
  'toolbar.wrap_on': 'Tự động xuống dòng',
  'toolbar.wrap_off': 'Không xuống dòng',
  'toolbar.source': 'Mã nguồn',
  'toolbar.preview': 'Xem trước',

  // image
  'image.load_failed': 'Không tải được hình ảnh',
  'image.decode_failed': 'Không giải mã được hình ảnh',

  // pdf
  'pdf.load_failed': 'Không tải được PDF',

  // docx
  'docx.parse_failed': 'Không phân tích được tài liệu Word',

  // doc
  'doc.parse_failed': 'Không phân tích được tài liệu Word (định dạng cũ)',
  'doc.loading': 'Đang tải tài liệu Word...',

  // ppt
  'ppt.parse_failed': 'Không phân tích được PowerPoint (định dạng cũ)',
  'ppt.loading': 'Đang tải PPT...',

  // xlsx
  'xlsx.loading': 'Đang tải Excel...',
  'xlsx.load_failed': 'Không tải được Excel',
  'xlsx.parse_failed': 'Không phân tích được tệp Excel',
  'xlsx.not_found': 'Không tìm thấy tệp Excel',

  // xls
  'xls.parse_failed': 'Không phân tích được Excel (định dạng cũ)',
  'xls.loading': 'Đang tải Excel...',

  // pptx
  'pptx.loading': 'Đang tải PPT...',
  'pptx.load_failed': 'Không tải được PPT',
  'pptx.parse_failed': 'Không phân tích được tệp PPT',
  'pptx.not_found': 'Không tìm thấy tệp PPT',
  'pptx.invalid_format': 'Định dạng tệp PPT không hợp lệ hoặc đã hỏng',
  'pptx.no_pages': 'Tệp PPT không có trang hợp lệ',
  'pptx.timeout': 'Tải quá lâu, vui lòng kiểm tra mạng và thử lại',

  // msg
  'msg.parse_failed': 'Không phân tích được thư Outlook',
  'msg.parse_failed_short': 'Không phân tích được thư',
  'msg.empty_body': '(Không có nội dung thư)',

  // epub
  'epub.load_failed': 'Không tải được EPUB',

  // mobi
  'mobi.load_failed': 'Không tải được sách điện tử — tệp có thể đã hỏng hoặc có DRM',

  // video
  'video.loading': 'Đang tải video...',
  'video.load_failed': 'Không tải được video',
  'video.load_failed_with_error': 'Không tải được video: {error}',
  'video.format_not_supported':
    'Trình duyệt không hỗ trợ định dạng {format}. Vui lòng chuyển sang MP4/WebM',
  'video.unsupported_title': 'Không thể phát định dạng video này trên trình duyệt',
  'video.unsupported_detail':
    '{format} là định dạng mà trình duyệt không hỗ trợ sẵn (thường gặp ở AVI / WMV / FLV và một số tệp MKV). Vui lòng tải xuống để phát bằng trình phát trên máy, hoặc chuyển sang MP4 (H.264 + AAC).',
  'video.codec_not_supported_detail':
    'Trình duyệt không giải mã được codec video hoặc âm thanh ({codecs}). Vui lòng chuyển sang MP4 (H.264 + AAC) trước khi xem trước.',

  // audio
  'audio.aria.play': 'Phát',
  'audio.aria.pause': 'Tạm dừng',
  'audio.aria.forward_10': 'Tua tới 10 giây',
  'audio.aria.backward_10': 'Tua lại 10 giây',
  'audio.aria.mute': 'Tắt tiếng',
  'audio.aria.unmute': 'Bật tiếng',
  'audio.aria.loop_on': 'Bật lặp lại',
  'audio.aria.loop_off': 'Tắt lặp lại',
  'audio.aria.progress': 'Tiến trình phát',
  'audio.aria.volume': 'Âm lượng',

  // markdown
  'markdown.load_failed': 'Không tải được Markdown',
  'markdown.copy_code': 'Sao chép mã',
  'markdown.copied': 'Đã sao chép',

  // json
  'json.load_failed': 'Không tải được JSON',
  'json.items': 'mục',
  'json.keys': 'khóa',

  // csv
  'csv.loading': 'Đang tải CSV...',
  'csv.load_failed': 'Không tải được CSV',
  'csv.parse_failed': 'Không phân tích được CSV',

  // xml
  'xml.load_failed': 'Không tải được XML',

  // subtitle
  'subtitle.load_failed': 'Không tải được phụ đề',
  'subtitle.parse_failed': 'Không phân tích được phụ đề',
  'subtitle.lines': 'dòng',
  'subtitle.cues': 'lượt phụ đề',
  'subtitle.meta.title': 'Tiêu đề',
  'subtitle.meta.artist': 'Nghệ sĩ',
  'subtitle.meta.album': 'Album',
  'subtitle.meta.author': 'Tác giả',
  'subtitle.meta.by': 'Bởi',
  'subtitle.meta.length': 'Thời lượng',
  'subtitle.meta.offset': 'Độ lệch',
  'subtitle.meta.editor': 'Biên tập',
  'subtitle.meta.version': 'Phiên bản',

  // zip
  'zip.load_failed': 'Không tải được ZIP',
  'zip.parse_failed': 'Không phân tích được ZIP',

  // text
  'text.load_failed': 'Không tải được tệp văn bản',

  // font
  'font.loading': 'Đang tải phông chữ...',
  'font.load_failed': 'Không tải được phông chữ',
  'font.parse_failed': 'Không phân tích được phông chữ',
  'font.metadata_loading': 'Đang phân tích thông tin...',
  'font.metadata_unavailable': 'Không có thông tin',
  'font.meta.family': 'Họ',
  'font.meta.subfamily': 'Phân họ',
  'font.meta.version': 'Phiên bản',
  'font.meta.designer': 'Nhà thiết kế',
  'font.meta.glyphs': 'Số ký tự',
  'font.meta.format': 'Định dạng',
  'font.sample_text_placeholder': 'Nhập văn bản mẫu...',

  // cad
  'cad.loading': 'Đang tải tệp CAD...',
  'cad.load_failed': 'Không tải được tệp CAD',
  'cad.parse_failed': 'Không phân tích được tệp CAD',
  'cad.wireframe': 'Khung dây',
  'cad.solid': 'Đặc',
  'cad.grid': 'Lưới',
  'cad.axes': 'Trục',
}

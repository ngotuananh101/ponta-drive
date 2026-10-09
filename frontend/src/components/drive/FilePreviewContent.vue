<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, type Component } from 'vue'
import '@eternalheart/vue-file-preview/style.css'
import { useI18n } from 'vue-i18n'
import { Download, ExternalLink, X } from 'lucide-vue-next'
import DriveItemIcon from '@/components/drive/DriveItemIcon.vue'
import { apiUrl } from '@/api/client'
import { getDriveItemPreview, type DriveItemPreview } from '@/api/driveItems'
import { viMessages } from '@/lib/vfp-i18n'

const props = withDefaults(
  defineProps<{
    uuid: string
    /** Show the "open in a new tab" action, which promotes the dialog to the
     *  standalone route. Only the in-list overlay offers it. */
    openStandalone?: boolean
  }>(),
  { openStandalone: false },
)

const emit = defineEmits<{
  close: []
  'open-standalone': []
}>()

const { t } = useI18n()

const loading = ref(true)
const error = ref<string | null>(null)
const preview = shallowRef<DriveItemPreview | null>(null)
// The library is heavy (~31MB dist); it is imported only when a real preview is
// rendered, so the fallback card never pays for it.
const Embed = shallowRef<Component | null>(null)

/** The library file descriptor: absolute URL plus the name/type it detects by. */
const previewFiles = computed(() => {
  const data = preview.value
  if (!data || !data.url) return []
  const url = data.strategy === 'proxy' ? apiUrl(data.url) : data.url
  return [
    {
      url,
      name: data.item.name,
      type: data.item.mime_type || 'application/octet-stream',
      size: data.item.size,
    },
  ]
})

/**
 * Only the proxy is same-origin and needs the bearer token. Attaching it to a
 * direct (cross-origin) request would trigger a CORS preflight and fail.
 */
const requestInit = computed(() =>
  preview.value?.strategy === 'proxy'
    ? () => ({
        headers: { Authorization: `Bearer ${localStorage.getItem('token') ?? ''}` },
      })
    : undefined,
)

/**
 * Every proxied file must be fetched as a blob, because that is the only path
 * that runs through the library's `fetcher`, where `requestInit` (the bearer
 * token) is merged in. The alternative — letting a renderer take the raw URL —
 * bypasses the fetcher, so the request goes out unauthenticated and the proxy
 * answers 401. That is not media-only: PDFs and office documents are proxied
 * too, and their renderers fetch the URL themselves. Direct (cross-origin)
 * files must NOT be fetched as a blob: the fetcher would send no token anyway,
 * and pdf.js and the media elements load the URL fine without one.
 */
const shouldFetchAsBlob = computed(() =>
  preview.value?.strategy === 'proxy' ? () => true : undefined,
)

const fallbackMessage = computed(() =>
  preview.value?.reason === 'unsupported'
    ? t('drive.preview_unsupported')
    : t('drive.preview_too_large'),
)

const title = computed(() => preview.value?.item.name ?? t('routes.preview'))

async function load() {
  loading.value = true
  error.value = null
  try {
    const res = await getDriveItemPreview(props.uuid)
    preview.value = res.data ?? null
    if (preview.value && preview.value.strategy !== 'fallback') {
      const mod = await import('@eternalheart/vue-file-preview')
      Embed.value = mod.FilePreviewEmbed
    }
  } catch {
    error.value = t('drive.preview_error')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="flex h-full w-full flex-col">
    <!-- Toolbar: mirrors Google Drive's preview header (close, name, actions). -->
    <header class="flex h-14 shrink-0 items-center gap-3 px-3 text-neutral-100">
      <button
        type="button"
        data-test="preview-close"
        class="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-white/10"
        :title="t('drive.preview_close')"
        @click="emit('close')"
      >
        <X class="h-5 w-5" />
        <span class="sr-only">{{ t('drive.preview_close') }}</span>
      </button>

      <DriveItemIcon v-if="preview" :item="preview.item" size-class="h-5 w-5" />
      <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ title }}</span>

      <a
        v-if="preview"
        data-test="preview-download"
        :href="preview.download_url"
        target="_blank"
        rel="noopener"
        class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/10"
        :title="t('drive.preview_download')"
      >
        <Download class="h-5 w-5" />
        <span class="sr-only">{{ t('drive.preview_download') }}</span>
      </a>

      <button
        v-if="openStandalone"
        type="button"
        data-test="preview-open-tab"
        class="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-white/10"
        :title="t('drive.preview_open_tab')"
        @click="emit('open-standalone')"
      >
        <ExternalLink class="h-5 w-5" />
        <span class="sr-only">{{ t('drive.preview_open_tab') }}</span>
      </button>
    </header>

    <div class="relative min-h-0 flex-1">
      <div
        v-if="loading"
        class="absolute inset-0 flex items-center justify-center text-sm text-neutral-300"
      >
        {{ t('drive.preview_loading') }}
      </div>

      <div
        v-else-if="error"
        class="absolute inset-0 flex items-center justify-center text-sm text-destructive"
      >
        {{ error }}
      </div>

      <div
        v-else-if="preview && preview.strategy === 'fallback'"
        class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-neutral-300"
      >
        <p>{{ fallbackMessage }}</p>
        <a
          :href="preview.download_url"
          target="_blank"
          rel="noopener"
          class="inline-flex items-center rounded-md border border-white/20 px-3 py-1.5 text-neutral-100 transition-colors hover:bg-white/10"
        >
          {{ t('drive.preview_download') }}
        </a>
      </div>

      <div v-else-if="preview && Embed" class="absolute inset-0">
        <component
          :is="Embed"
          :files="previewFiles"
          locale="vi"
          :messages="{ vi: viMessages }"
          :request-init="requestInit"
          :should-fetch-as-blob="shouldFetchAsBlob"
          theme="auto"
        />
      </div>
    </div>
  </div>
</template>

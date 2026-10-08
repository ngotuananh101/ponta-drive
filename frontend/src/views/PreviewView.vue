<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, type Component } from 'vue'
import '@eternalheart/vue-file-preview/style.css'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import DashboardLayout from '@/layouts/DashboardLayout.vue'
import { Button } from '@/components/ui/button'
import { apiUrl } from '@/api/client'
import { getDriveItemPreview, type DriveItemPreview } from '@/api/driveItems'
import { viMessages } from '@/lib/vfp-i18n'

const props = defineProps<{
  cloudId: string
  uuid: string
}>()

const { t } = useI18n()
const router = useRouter()

const loading = ref(true)
const error = ref<string | null>(null)
const preview = shallowRef<DriveItemPreview | null>(null)
// The library is heavy (~31MB dist); it is imported only when a real preview is
// rendered, so the fallback card never pays for it.
const Embed = shallowRef<Component | null>(null)

const isMedia = (mime: string) =>
  mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/')

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

const shouldFetchAsBlob = computed(() =>
  preview.value?.strategy === 'proxy' ? (file: { type: string }) => isMedia(file.type) : undefined,
)

const fallbackMessage = computed(() =>
  preview.value?.reason === 'unsupported'
    ? t('drive.preview_unsupported')
    : t('drive.preview_too_large'),
)

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

function goBack() {
  router.push({ name: 'drive', params: { cloudId: props.cloudId } })
}

onMounted(load)
</script>

<template>
  <DashboardLayout>
    <div class="h-[calc(100vh-4rem)] flex flex-col">
      <div class="flex items-center justify-between px-4 py-2 border-b border-border">
        <span class="text-sm font-medium truncate">{{ preview?.item.name ?? t('routes.preview') }}</span>
        <Button variant="outline" size="sm" @click="goBack">{{ t('drive.preview_back') }}</Button>
      </div>

      <div class="flex-1 min-h-0">
        <div v-if="loading" class="h-full flex items-center justify-center text-sm text-muted-foreground">
          {{ t('drive.preview_loading') }}
        </div>

        <div v-else-if="error" class="h-full flex items-center justify-center text-sm text-destructive">
          {{ error }}
        </div>

        <div
          v-else-if="preview && preview.strategy === 'fallback'"
          class="h-full flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground"
        >
          <p>{{ fallbackMessage }}</p>
          <a
            data-test="preview-download"
            :href="preview.download_url"
            target="_blank"
            rel="noopener"
            class="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-foreground hover:bg-accent/40"
          >
            {{ t('drive.preview_download') }}
          </a>
        </div>

        <component
          :is="Embed"
          v-else-if="preview && Embed"
          :files="previewFiles"
          locale="vi"
          :messages="{ vi: viMessages }"
          :request-init="requestInit"
          :should-fetch-as-blob="shouldFetchAsBlob"
          theme="auto"
        />
      </div>
    </div>
  </DashboardLayout>
</template>

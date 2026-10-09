<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Upload, ChevronDown, ChevronUp, X, FileText, CheckCircle2, AlertCircle } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useUploadStore } from '@/stores/upload'

const { t } = useI18n()
const uploadStore = useUploadStore()

const collapsed = ref(false)

const completedCount = computed(
  () => uploadStore.uploadQueue.filter((i) => i.status === 'completed').length,
)
</script>

<template>
  <div
    v-if="uploadStore.uploadQueue.length > 0"
    class="fixed bottom-6 right-6 z-50 w-80 rounded-xl border border-border bg-card shadow-lg"
  >
    <div class="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
      <div class="flex items-center gap-2 min-w-0">
        <Upload class="h-4 w-4 text-primary shrink-0" />
        <span class="text-sm font-semibold text-foreground truncate">
          {{ t('drive.upload_panel_title') }}
        </span>
        <span class="text-xs text-muted-foreground font-mono shrink-0">
          {{ t('drive.upload_panel_items_count', { done: completedCount, total: uploadStore.uploadQueue.length }) }}
        </span>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          class="h-6 w-6 text-muted-foreground"
          :aria-label="collapsed ? t('drive.upload_panel_expand') : t('drive.upload_panel_minimize')"
          @click="collapsed = !collapsed"
        >
          <ChevronUp v-if="collapsed" class="h-3.5 w-3.5" />
          <ChevronDown v-else class="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-6 w-6 text-muted-foreground hover:text-destructive"
          :disabled="uploadStore.isUploading"
          :aria-label="t('drive.upload_panel_close')"
          @click="uploadStore.clearQueue()"
        >
          <X class="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>

    <ScrollArea v-if="!collapsed" class="max-h-60">
      <div class="p-2 space-y-1.5">
      <div
        v-for="item in uploadStore.uploadQueue"
        :key="item.id"
        class="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs"
      >
        <div class="flex items-center gap-2 min-w-0 flex-1">
          <FileText class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium text-foreground">{{ item.file.name }}</p>
            <div class="w-full bg-muted h-1.5 rounded-full overflow-hidden mt-1">
              <div
                class="h-full bg-primary transition-all duration-200"
                :style="{ width: `${item.progress}%` }"
              />
            </div>
          </div>
        </div>

        <div class="flex items-center gap-1.5 shrink-0">
          <span class="text-muted-foreground font-mono">{{ item.progress }}%</span>
          <CheckCircle2 v-if="item.status === 'completed'" class="h-3.5 w-3.5 text-emerald-500" />
          <AlertCircle v-else-if="item.status === 'failed'" class="h-3.5 w-3.5 text-destructive" />
          <Button
            v-else-if="item.status === 'uploading'"
            variant="ghost"
            size="icon"
            class="h-5 w-5 text-muted-foreground hover:text-destructive"
            :aria-label="t('drive.upload_panel_cancel')"
            @click="uploadStore.cancelItem(item.id)"
          >
            <X class="h-3 w-3" />
          </Button>
        </div>
      </div>
      </div>
    </ScrollArea>
  </div>
</template>

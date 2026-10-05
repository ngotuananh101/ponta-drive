<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Upload,
  FolderUp,
  FileText,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2,
  HardDrive,
  Server,
} from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useUpload, type UploadMethod, type UploadQueueItem } from '@/composables/useUpload'

const open = defineModel<boolean>('open', { required: true })

const props = withDefaults(
  defineProps<{
    cloudAccountUuid: string
    parentUuid?: string | null
    initialMode?: 'file' | 'folder'
  }>(),
  {
    initialMode: 'file',
  },
)

const emit = defineEmits<{
  completed: []
}>()

const { t } = useI18n()
const { uploadQueue, isUploading, startUpload, cancelItem, clearQueue } = useUpload()

const selectedFiles = ref<File[]>([])
const uploadMethod = ref<UploadMethod>('direct')
const isDragging = ref(false)

const fileInput = ref<HTMLInputElement | null>(null)
const folderInput = ref<HTMLInputElement | null>(null)

watch(open, async (isOpen) => {
  if (isOpen) {
    selectedFiles.value = []
    clearQueue()
    // When opening in "folder" mode, auto-launch the folder picker so the
    // user can pick a directory tree without an extra click.
    if (props.initialMode === 'folder') {
      await nextTick()
      folderInput.value?.click()
    }
  }
})

function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement
  if (target.files && target.files.length > 0) {
    selectedFiles.value = Array.from(target.files)
  }
}

function handleDrop(event: DragEvent) {
  isDragging.value = false
  if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
    selectedFiles.value = Array.from(event.dataTransfer.files)
  }
}

async function handleStart() {
  if (selectedFiles.value.length === 0 || !props.cloudAccountUuid) return

  await startUpload({
    cloudAccountUuid: props.cloudAccountUuid,
    parentUuid: props.parentUuid,
    files: selectedFiles.value,
    method: uploadMethod.value,
  })

  emit('completed')
}

function close() {
  if (!isUploading.value) {
    open.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-xl">
      <DialogHeader>
        <div class="flex items-center gap-3">
          <div class="h-9 w-9 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0">
            <Upload class="h-5 w-5" />
          </div>
          <DialogTitle>{{ t('drive.upload_title') }}</DialogTitle>
        </div>
        <DialogDescription class="sr-only">
          {{ t('drive.upload_title') }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <!-- Hidden Inputs -->
        <input
          ref="fileInput"
          type="file"
          multiple
          class="hidden"
          @change="handleFileSelect"
        />
        <input
          ref="folderInput"
          type="file"
          webkitdirectory
          directory
          multiple
          class="hidden"
          @change="handleFileSelect"
        />

        <!-- Method Selection Step -->
        <div class="space-y-2">
          <label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {{ t('drive.upload_method_title') }}
          </label>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div
              class="border rounded-xl p-3 cursor-pointer transition-all flex flex-col gap-1.5"
              :class="[
                uploadMethod === 'direct'
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:bg-muted/40',
              ]"
              @click="uploadMethod = 'direct'"
            >
              <div class="flex items-center gap-2">
                <HardDrive class="h-4 w-4 text-primary" />
                <span class="text-sm font-semibold text-foreground">{{ t('drive.upload_method_direct') }}</span>
              </div>
              <p class="text-xs text-muted-foreground leading-relaxed">
                {{ t('drive.upload_method_direct_desc') }}
              </p>
            </div>

            <div
              class="border rounded-xl p-3 cursor-pointer transition-all flex flex-col gap-1.5"
              :class="[
                uploadMethod === 'server'
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:bg-muted/40',
              ]"
              @click="uploadMethod = 'server'"
            >
              <div class="flex items-center gap-2">
                <Server class="h-4 w-4 text-emerald-500" />
                <span class="text-sm font-semibold text-foreground">{{ t('drive.upload_method_server') }}</span>
              </div>
              <p class="text-xs text-muted-foreground leading-relaxed">
                {{ t('drive.upload_method_server_desc') }}
              </p>
            </div>
          </div>
        </div>

        <!-- Drop target / file selection -->
        <div
          v-if="!isUploading && uploadQueue.length === 0"
          class="border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center gap-3 transition-colors"
          :class="[isDragging ? 'border-primary bg-primary/5' : 'border-border bg-card/40']"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="handleDrop"
        >
          <div class="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
            <Upload class="h-5 w-5" />
          </div>
          <div class="flex gap-2">
            <Button variant="outline" size="sm" @click="fileInput?.click()">
              <Upload class="h-3.5 w-3.5 mr-1" />
              {{ t('drive.upload_select_files') }}
            </Button>
            <Button variant="outline" size="sm" @click="folderInput?.click()">
              <FolderUp class="h-3.5 w-3.5 mr-1" />
              {{ t('drive.upload_select_folder') }}
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">{{ t('drive.upload_drop_hint') }}</p>

          <p v-if="selectedFiles.length > 0" class="text-xs font-medium text-primary mt-1">
            {{ selectedFiles.length }} file(s) selected
          </p>
        </div>

        <!-- Upload Progress Queue -->
        <div v-else class="space-y-2 max-h-60 overflow-y-auto pr-1">
          <div
            v-for="item in uploadQueue as UploadQueueItem[]"
            :key="item.id"
            class="flex items-center justify-between p-2.5 rounded-xl border border-border bg-card text-xs gap-3"
          >
            <div class="flex items-center gap-2 min-w-0 flex-1">
              <FileText class="h-4 w-4 text-muted-foreground shrink-0" />
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium text-foreground">{{ item.file.name }}</p>
                <div class="w-full bg-muted h-1.5 rounded-full overflow-hidden mt-1.5">
                  <div
                    class="h-full bg-primary transition-all duration-200"
                    :style="{ width: `${item.progress}%` }"
                  />
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <span class="text-muted-foreground font-mono">{{ item.progress }}%</span>
              <CheckCircle2 v-if="item.status === 'completed'" class="h-4 w-4 text-emerald-500" />
              <AlertCircle v-else-if="item.status === 'failed'" class="h-4 w-4 text-destructive" />
              <Button
                v-else-if="item.status === 'uploading'"
                variant="ghost"
                size="icon"
                class="h-6 w-6 text-muted-foreground hover:text-destructive"
                @click="cancelItem(item.id)"
              >
                <X class="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <DialogFooter class="gap-2 pt-2">
        <Button variant="outline" :disabled="isUploading" @click="close">
          {{ t('drive.cancel_button') }}
        </Button>
        <Button
          v-if="uploadQueue.length === 0"
          :disabled="selectedFiles.length === 0 || isUploading"
          @click="handleStart"
        >
          <Loader2 v-if="isUploading" class="h-4 w-4 animate-spin mr-1" />
          {{ t('drive.upload_start') }}
        </Button>
        <Button
          v-else
          :disabled="isUploading"
          @click="open = false"
        >
          {{ t('cloud.next') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

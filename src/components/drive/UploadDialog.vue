<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { Upload, FolderUp, FileText, X, HardDrive, Server } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { humanizeBytes } from '@/lib/format'
import { useUploadStore, type UploadMethod } from '@/stores/upload'

const open = defineModel<boolean>('open', { required: true })

const props = withDefaults(
  defineProps<{
    cloudAccountId: number
    parentUuid?: string | null
    initialMode?: 'file' | 'folder'
  }>(),
  {
    initialMode: 'file',
  },
)

const { t } = useI18n()
const uploadStore = useUploadStore()

const selectedFiles = ref<File[]>([])
const uploadMethod = ref<UploadMethod>('direct')
const isDragging = ref(false)

const fileInput = ref<HTMLInputElement | null>(null)
const folderInput = ref<HTMLInputElement | null>(null)

watch(open, async (isOpen) => {
  if (isOpen) {
    // Only the local selection resets. The global upload queue is left alone so
    // reopening the dialog never cancels an upload already running.
    selectedFiles.value = []
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

function removeFile(index: number) {
  selectedFiles.value = selectedFiles.value.filter((_, i) => i !== index)
}

function handleStart() {
  if (selectedFiles.value.length === 0 || !props.cloudAccountId) return

  // Close first so the dialog disappears at once; the store keeps the upload
  // alive and the global panel shows its progress.
  open.value = false
  void uploadStore.startUpload({
    cloudAccountId: props.cloudAccountId,
    parentUuid: props.parentUuid,
    files: selectedFiles.value,
    method: uploadMethod.value,
  })
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
          :aria-label="t('drive.upload_select_files')"
          @change="handleFileSelect"
        />
        <input
          ref="folderInput"
          type="file"
          webkitdirectory
          directory
          multiple
          class="hidden"
          :aria-label="t('drive.upload_select_folder')"
          @change="handleFileSelect"
        />

        <!-- Method Selection Step -->
        <div class="space-y-2">
          <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {{ t('drive.upload_method_title') }}
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div
              class="border rounded-xl p-3 cursor-pointer transition-all flex flex-col gap-1.5"
              :class="[
                uploadMethod === 'direct'
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:bg-muted/40',
              ]"
              role="button"
              tabindex="0"
              @click="uploadMethod = 'direct'"
              @keydown.enter="uploadMethod = 'direct'"
              @keydown.space.prevent="uploadMethod = 'direct'"
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
              role="button"
              tabindex="0"
              @click="uploadMethod = 'server'"
              @keydown.enter="uploadMethod = 'server'"
              @keydown.space.prevent="uploadMethod = 'server'"
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
        </div>

        <!-- Selected files preview -->
        <div v-if="selectedFiles.length > 0" class="space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-muted-foreground">
              {{ t('drive.upload_selected_title', { count: selectedFiles.length }) }}
            </span>
            <Button
              variant="ghost"
              size="sm"
              class="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
              @click="selectedFiles = []"
            >
              {{ t('drive.upload_clear_files') }}
            </Button>
          </div>
          <ul class="max-h-40 overflow-y-auto space-y-1 pr-1">
            <li
              v-for="(file, index) in selectedFiles"
              :key="`${file.name}-${index}`"
              class="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs"
            >
              <FileText class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span class="truncate flex-1 text-foreground">{{ file.name }}</span>
              <span class="text-muted-foreground font-mono shrink-0">{{ humanizeBytes(file.size) }}</span>
              <Button
                variant="ghost"
                size="icon"
                class="h-5 w-5 text-muted-foreground hover:text-destructive"
                :aria-label="t('drive.upload_remove_file')"
                @click="removeFile(index)"
              >
                <X class="h-3 w-3" />
              </Button>
            </li>
          </ul>
        </div>
      </div>

      <DialogFooter class="gap-2 pt-2">
        <Button variant="outline" @click="open = false">
          {{ t('drive.cancel_button') }}
        </Button>
        <Button :disabled="selectedFiles.length === 0" @click="handleStart">
          {{ t('drive.upload_start') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

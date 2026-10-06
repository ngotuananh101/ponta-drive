<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { FolderPlus, Loader2 } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useDriveItemsStore } from '@/stores/driveItems'
import { ApiError } from '@/api/client'
import type { DriveItem } from '@/api/driveItems'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  cloudAccountId: number
  parentUuid?: string | null
}>()

const emit = defineEmits<{
  created: [item: DriveItem]
}>()

const { t } = useI18n()
const store = useDriveItemsStore()

const folderName = ref('')
const creating = ref(false)
const error = ref<string | null>(null)

watch(open, (isOpen) => {
  if (isOpen) {
    folderName.value = ''
    error.value = null
  }
})

async function submit() {
  const trimmed = folderName.value.trim()
  if (!trimmed || !props.cloudAccountId) return

  creating.value = true
  error.value = null

  try {
    const item = await store.createFolder(props.cloudAccountId, props.parentUuid ?? null, trimmed)
    toast.success(t('drive.toast_folder_created'))
    open.value = false
    emit('created', item)
  } catch (e) {
    console.error(e)
    error.value = e instanceof ApiError ? e.message : t('drive.action_failed')
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <div class="flex items-center gap-3">
          <div class="h-9 w-9 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
            <FolderPlus class="h-5 w-5" />
          </div>
          <DialogTitle>{{ t('drive.new_folder_title') }}</DialogTitle>
        </div>
        <DialogDescription class="sr-only">
          {{ t('drive.new_folder_title') }}
        </DialogDescription>
      </DialogHeader>

      <form class="space-y-4 py-2" @submit.prevent="submit">
        <div class="space-y-1.5">
          <Label for="new-folder-name" class="sr-only">{{ t('drive.new_folder_placeholder') }}</Label>
          <Input
            id="new-folder-name"
            v-model="folderName"
            :placeholder="t('drive.new_folder_placeholder')"
            autofocus
            :disabled="creating"
          />
        </div>

        <p v-if="error" class="text-xs text-destructive rounded-md bg-destructive/10 p-2">
          {{ error }}
        </p>

        <DialogFooter class="gap-2 pt-2">
          <Button type="button" variant="outline" :disabled="creating" @click="open = false">
            {{ t('drive.cancel_button') }}
          </Button>
          <Button type="submit" :disabled="!folderName.trim() || creating">
            <Loader2 v-if="creating" class="h-4 w-4 animate-spin" />
            {{ t('drive.new_folder_create') }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

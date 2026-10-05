<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { AlertTriangle, Loader2 } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useDriveItemsStore } from '@/stores/driveItems'
import type { DriveItem } from '@/api/driveItems'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  item: DriveItem | null
}>()

const emit = defineEmits<{
  deleted: [uuid: string]
}>()

const { t } = useI18n()
const store = useDriveItemsStore()

const deleting = ref(false)
const error = ref<string | null>(null)

async function confirm() {
  if (!props.item) return

  deleting.value = true
  error.value = null

  try {
    await store.remove(props.item.uuid, true)
    toast.success(t('drive.toast_deleted'))
    open.value = false
    emit('deleted', props.item.uuid)
  } catch (e) {
    console.error(e)
    error.value = e instanceof Error ? e.message : t('drive.action_failed')
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <div class="flex items-center gap-3">
          <div class="h-9 w-9 rounded-full bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
            <AlertTriangle class="h-4.5 w-4.5" />
          </div>
          <DialogTitle>{{ t('drive.delete_item_title') }}</DialogTitle>
        </div>
        <DialogDescription class="pt-2 text-sm text-foreground/80 space-y-2">
          <p>{{ t('drive.delete_item_confirm', { name: item?.name }) }}</p>
          <p v-if="item?.type === 'folder'" class="text-destructive font-medium">
            {{ t('drive.delete_folder_warning') }}
          </p>
          <p class="text-xs text-muted-foreground">{{ t('drive.delete_permanent_note') }}</p>
        </DialogDescription>
      </DialogHeader>

      <p v-if="error" class="text-xs text-destructive rounded-md bg-destructive/10 p-2">
        {{ error }}
      </p>

      <DialogFooter class="gap-2 pt-2">
        <Button variant="outline" :disabled="deleting" @click="open = false">
          {{ t('drive.cancel_button') }}
        </Button>
        <Button
          class="bg-destructive text-white hover:bg-destructive/90"
          :disabled="deleting || !item"
          @click="confirm"
        >
          <Loader2 v-if="deleting" class="h-4 w-4 animate-spin" />
          {{ t('drive.delete_button') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Edit2, Loader2 } from 'lucide-vue-next'
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
import type { DriveItem } from '@/api/driveItems'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  item: DriveItem | null
}>()

const emit = defineEmits<{
  renamed: [item: DriveItem]
}>()

const { t } = useI18n()
const store = useDriveItemsStore()

const newName = ref('')
const saving = ref(false)
const error = ref<string | null>(null)

watch(
  () => props.item,
  (it) => {
    newName.value = it?.name ?? ''
    error.value = null
  },
  { immediate: true },
)

async function submit() {
  const trimmed = newName.value.trim()
  if (!trimmed || !props.item) return

  saving.value = true
  error.value = null

  try {
    const updated = await store.rename(props.item.uuid, trimmed)
    toast.success(t('drive.toast_renamed'))
    open.value = false
    emit('renamed', updated)
  } catch (e) {
    console.error(e)
    error.value = e instanceof Error ? e.message : t('drive.rename_title')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <div class="flex items-center gap-3">
          <div class="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Edit2 class="h-4.5 w-4.5" />
          </div>
          <DialogTitle>{{ t('drive.rename_title') }}</DialogTitle>
        </div>
        <DialogDescription class="sr-only">
          {{ t('drive.rename_title') }}
        </DialogDescription>
      </DialogHeader>

      <form class="space-y-4 py-2" @submit.prevent="submit">
        <div class="space-y-1.5">
          <Label for="rename-input" class="sr-only">{{ t('drive.rename_placeholder') }}</Label>
          <Input
            id="rename-input"
            v-model="newName"
            :placeholder="t('drive.rename_placeholder')"
            autofocus
            :disabled="saving"
          />
        </div>

        <p v-if="error" class="text-xs text-destructive rounded-md bg-destructive/10 p-2">
          {{ error }}
        </p>

        <DialogFooter class="gap-2 pt-2">
          <Button type="button" variant="outline" :disabled="saving" @click="open = false">
            {{ t('drive.cancel_button') }}
          </Button>
          <Button type="submit" :disabled="!newName.trim() || saving || newName.trim() === item?.name">
            <Loader2 v-if="saving" class="h-4 w-4 animate-spin" />
            {{ t('drive.rename_save') }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

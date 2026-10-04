<script setup lang="ts">
/**
 * Confirmation for removing a storage account.
 *
 * shadcn-vue's `alert-dialog` is not installed in this project, so this is
 * composed from the `Dialog` primitives that are — the layout is a small
 * confirmation, but the accessibility contract (focus trap, Escape, labelled
 * title) still comes from `Dialog`. No file under `components/ui/` is touched.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Loader2, AlertTriangle } from 'lucide-vue-next'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useCloudAccountsStore } from '@/stores/cloudAccounts'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  /** The account being removed; `null` keeps the dialog closed. */
  accountUuid: string | null
  accountName: string
}>()

const emit = defineEmits<{ deleted: [] }>()

const { t } = useI18n()
const store = useCloudAccountsStore()

const deleting = ref(false)
const error = ref<string | null>(null)

async function confirm() {
  if (!props.accountUuid) return
  deleting.value = true
  error.value = null
  try {
    await store.remove(props.accountUuid)
    toast.success(t('cloud.delete_success'))
    open.value = false
    emit('deleted')
  } catch (e) {
    // The backend returns a localized, sanitized message; show it verbatim.
    error.value = e instanceof Error ? e.message : String(e)
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
          <DialogTitle>{{ t('cloud.delete_title') }}</DialogTitle>
        </div>
        <DialogDescription class="pt-1">
          {{ t('cloud.delete_confirm', { name: accountName }) }}
        </DialogDescription>
      </DialogHeader>

      <p v-if="error" class="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
        {{ error }}
      </p>

      <DialogFooter class="gap-2">
        <Button variant="outline" :disabled="deleting" @click="open = false">
          {{ t('cloud.cancel') }}
        </Button>
        <Button
          class="bg-destructive text-white hover:bg-destructive/90"
          :disabled="deleting"
          @click="confirm"
        >
          <Loader2 v-if="deleting" class="h-4 w-4 animate-spin" />
          {{ t('cloud.delete') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

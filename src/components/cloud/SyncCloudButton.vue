<script setup lang="ts">
/**
 * The "sync this account" control, shared by the sidebar, the home card and
 * the drive toolbar.
 *
 * It owns the two things every call site would otherwise repeat: disabling and
 * spinning while a sync is in flight (tracked by the store), and the success /
 * failure toast. Views listen for `synced` to refresh whatever they show,
 * because only the view knows what that is (a summary, a file listing).
 */
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { RefreshCw } from 'lucide-vue-next'

import { Button } from '@/components/ui/button'
import { useCloudAccountsStore } from '@/stores/cloudAccounts'

const props = defineProps<{
  accountId: number
  /**
   * `labeled` renders a bordered button with visible text, for a toolbar.
   * The default is an icon-only button that fades in on hover of the nearest
   * `.group` ancestor, for a dense list or card.
   */
  labeled?: boolean
}>()

const emit = defineEmits<{ synced: [] }>()

const { t } = useI18n()
const store = useCloudAccountsStore()

async function onClick() {
  try {
    await store.sync(props.accountId)
    toast.success(t('cloud.sync_started'))
    emit('synced')
  } catch {
    toast.error(t('cloud.sync_failed'))
  }
}
</script>

<template>
  <Button
    v-if="labeled"
    variant="outline"
    size="sm"
    class="h-8 rounded-lg border border-border bg-card shadow-xs gap-1.5 text-xs font-medium cursor-pointer"
    :disabled="store.isSyncing(accountId)"
    :title="store.isSyncing(accountId) ? t('cloud.syncing') : t('cloud.sync')"
    @click="onClick"
  >
    <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': store.isSyncing(accountId) }" />
    <span>{{ store.isSyncing(accountId) ? t('cloud.syncing') : t('cloud.sync') }}</span>
  </Button>

  <button
    v-else
    type="button"
    class="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all cursor-pointer shrink-0 disabled:cursor-default"
    :class="{
      'opacity-100': store.isSyncing(accountId),
      'opacity-0 group-hover:opacity-100 focus-visible:opacity-100': !store.isSyncing(accountId),
    }"
    :disabled="store.isSyncing(accountId)"
    :title="store.isSyncing(accountId) ? t('cloud.syncing') : t('cloud.sync')"
    @click.stop="onClick"
  >
    <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': store.isSyncing(accountId) }" />
    <span class="sr-only">{{ t('cloud.sync') }}</span>
  </button>
</template>

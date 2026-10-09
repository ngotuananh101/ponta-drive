<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { ChevronRight, Folder, FolderInput, Loader2 } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { listDriveItems, type DriveItem } from '@/api/driveItems'
import { useDriveItemsStore } from '@/stores/driveItems'
import { ApiError } from '@/api/client'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  item: DriveItem | null
  parentUuid?: string | null
}>()

const emit = defineEmits<{
  moved: [item: DriveItem]
}>()

const { t } = useI18n()
const store = useDriveItemsStore()

const rootFolders = ref<DriveItem[]>([])
const childrenOf = ref<Record<string, DriveItem[]>>({})
const expanded = ref<Set<string>>(new Set())
const loadingNodes = ref<Set<string>>(new Set())
const forbidden = ref<Set<string>>(new Set())
const selectedUuid = ref<string | null>(null)
const loadingRoot = ref(false)
const moving = ref(false)
const error = ref<string | null>(null)

interface VisibleNode {
  node: DriveItem
  depth: number
}

/** Flattened tree built from rootFolders + expanded + childrenOf. */
const visibleNodes = computed<VisibleNode[]>(() => {
  const rows: VisibleNode[] = []
  const walk = (folders: DriveItem[], depth: number) => {
    for (const node of folders) {
      rows.push({ node, depth })
      if (expanded.value.has(node.uuid)) {
        walk(childrenOf.value[node.uuid] ?? [], depth + 1)
      }
    }
  }
  walk(rootFolders.value, 0)
  return rows
})

async function loadFolders(parentUuid: string | null): Promise<DriveItem[]> {
  if (!props.item) return []
  const res = await listDriveItems({
    cloudAccountId: props.item.cloud_account_id,
    parentUuid,
    type: 'folder',
    limit: 100,
  })
  return res.data ?? []
}

/** Seed forbidden with the item itself; children inherit from a forbidden parent. */
function registerChildren(parentUuid: string | null, folders: DriveItem[]) {
  if (parentUuid && forbidden.value.has(parentUuid)) {
    for (const f of folders) forbidden.value.add(f.uuid)
  }
}

watch(
  () => [open.value, props.item?.uuid] as const,
  async ([isOpen]) => {
    if (!isOpen || !props.item) return
    error.value = null
    selectedUuid.value = null
    expanded.value = new Set()
    childrenOf.value = {}
    forbidden.value = new Set([props.item.uuid])
    loadingRoot.value = true
    try {
      rootFolders.value = await loadFolders(null)
      registerChildren(null, rootFolders.value)
    } catch (e) {
      console.error(e)
      rootFolders.value = []
    } finally {
      loadingRoot.value = false
    }
  },
  { immediate: true },
)

async function toggle(node: DriveItem) {
  const next = new Set(expanded.value)
  if (next.has(node.uuid)) {
    next.delete(node.uuid)
    expanded.value = next
    return
  }
  next.add(node.uuid)
  expanded.value = next

  if (!childrenOf.value[node.uuid]) {
    const loading = new Set(loadingNodes.value)
    loading.add(node.uuid)
    loadingNodes.value = loading
    try {
      const children = await loadFolders(node.uuid)
      childrenOf.value = { ...childrenOf.value, [node.uuid]: children }
      registerChildren(node.uuid, children)
    } catch (e) {
      console.error(e)
      childrenOf.value = { ...childrenOf.value, [node.uuid]: [] }
    } finally {
      const done = new Set(loadingNodes.value)
      done.delete(node.uuid)
      loadingNodes.value = done
    }
  }
}

function isForbidden(uuid: string): boolean {
  return forbidden.value.has(uuid)
}

function select(uuid: string | null) {
  if (uuid !== null && isForbidden(uuid)) return
  selectedUuid.value = uuid
}

async function submit() {
  if (!props.item) return

  // No-op move: the item already lives in the selected destination. Close
  // without calling store.move, whose unconditional filter would otherwise drop
  // the item from the listing it still belongs to.
  const currentParent = props.parentUuid ?? null
  const target = selectedUuid.value ?? null
  if (target === currentParent) {
    open.value = false
    return
  }

  moving.value = true
  error.value = null
  try {
    const updated = await store.move(props.item.uuid, selectedUuid.value)
    toast.success(t('drive.toast_moved'))
    open.value = false
    emit('moved', updated)
  } catch (e) {
    console.error(e)
    error.value = e instanceof ApiError ? e.message : t('drive.action_failed')
  } finally {
    moving.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <div class="flex items-center gap-3">
          <div
            class="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0"
          >
            <FolderInput class="h-4.5 w-4.5" />
          </div>
          <DialogTitle>{{ t('drive.move_title') }}</DialogTitle>
        </div>
        <DialogDescription class="text-sm text-muted-foreground">
          {{ t('drive.move_select_destination') }}
        </DialogDescription>
      </DialogHeader>

      <ScrollArea class="max-h-64 rounded-md border border-border">
        <div class="p-1">
        <!-- Root destination (always selectable, defaults to null) -->
        <button
          type="button"
          data-testid="move-node"
          aria-disabled="false"
          class="w-full flex items-center gap-2 rounded px-2 py-1.5 text-sm text-left cursor-pointer hover:bg-accent"
          :class="{ 'bg-primary/10 text-primary': selectedUuid === null }"
          @click="select(null)"
        >
          <Folder class="h-4 w-4 shrink-0" />
          <span class="truncate">{{ t('drive.move_root') }}</span>
        </button>

        <div v-if="loadingRoot" class="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
          <Loader2 class="h-3.5 w-3.5 animate-spin" />
          <span>{{ t('common.loading') }}</span>
        </div>

        <template v-else>
          <div
            v-for="v in visibleNodes"
            :key="v.node.uuid"
            class="flex items-center"
            :style="{ paddingLeft: `${v.depth}rem` }"
          >
            <button
              v-if="v.node.type === 'folder'"
              type="button"
              :aria-label="expanded.has(v.node.uuid) ? t('common.collapse') : t('common.expand')"
              @click="toggle(v.node)"
              class="mr-1 shrink-0 rounded p-0.5 opacity-60 hover:opacity-100 hover:bg-accent"
            >
              <ChevronRight
                :class="expanded.has(v.node.uuid) ? 'rotate-90' : ''"
                class="h-4 w-4 transition-transform"
              />
              <Loader2 v-if="loadingNodes.has(v.node.uuid)" class="h-3 w-3 animate-spin" />
            </button>
            <span v-else class="mr-1 w-5 shrink-0" aria-hidden="true" />

            <button
              type="button"
              data-testid="move-node"
              :disabled="isForbidden(v.node.uuid)"
              :aria-disabled="isForbidden(v.node.uuid)"
              class="flex min-w-0 flex-1 items-center gap-1 rounded px-2 py-1.5 text-sm text-left cursor-pointer hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              :class="{
                'bg-primary/10 text-primary': selectedUuid === v.node.uuid && !isForbidden(v.node.uuid),
              }"
              @click="select(v.node.uuid)"
            >
              <Folder v-if="v.node.type === 'folder'" class="h-4 w-4 shrink-0" />
              <span class="truncate">{{ v.node.name }}</span>
            </button>
          </div>

          <p
            v-show="visibleNodes.length === 0"
            class="px-2 py-2 text-sm text-muted-foreground"
          >
            {{ t('drive.move_empty') }}
          </p>
        </template>
        </div>
      </ScrollArea>

      <p v-if="error" class="text-xs text-destructive rounded-md bg-destructive/10 p-2">
        {{ error }}
      </p>

      <DialogFooter class="gap-2 pt-2">
        <Button type="button" variant="outline" :disabled="moving" @click="open = false">
          {{ t('drive.cancel_button') }}
        </Button>
        <Button type="button" :disabled="moving || !props.item" @click="submit">
          <Loader2 v-if="moving" class="h-4 w-4 animate-spin" />
          {{ t('drive.move_here') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

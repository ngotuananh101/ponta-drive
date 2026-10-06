<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import {
  MoreVertical,
  Download,
  Star,
  Edit2,
  Trash2,
  FolderInput,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getDriveItemDownloadUrl, type DriveItem } from '@/api/driveItems'
import { useDriveItemsStore } from '@/stores/driveItems'

const props = defineProps<{
  item: DriveItem
}>()

const emit = defineEmits<{
  rename: [item: DriveItem]
  move: [item: DriveItem]
  delete: [item: DriveItem]
}>()

const { t } = useI18n()
const store = useDriveItemsStore()

const isFolder = computed(() => props.item.type === 'folder')

async function handleDownload() {
  if (isFolder.value) return
  toast.info(t('drive.toast_download_started'))
  try {
    const res = await getDriveItemDownloadUrl(props.item.uuid)
    if (res.data?.download_url) {
      window.open(res.data.download_url, '_blank')
    }
  } catch (e) {
    console.error(e)
    toast.error(t('drive.action_failed'))
  }
}

async function handleToggleStar() {
  try {
    const updated = await store.toggleStar(props.item.uuid)
    toast.success(updated.is_starred ? t('drive.toast_starred') : t('drive.toast_unstarred'))
  } catch (e) {
    console.error(e)
    toast.error(t('drive.action_failed'))
  }
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground cursor-pointer"
        @click.stop
      >
        <MoreVertical class="h-4 w-4" />
        <span class="sr-only">{{ t('cloud.menu_actions') }}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-48 p-1.5 shadow-xl border-border">
      <DropdownMenuItem
        v-if="!isFolder"
        class="cursor-pointer py-2 gap-2 text-sm"
        @click="handleDownload"
      >
        <Download class="h-4 w-4" />
        <span>{{ t('drive.action_download') }}</span>
      </DropdownMenuItem>

      <DropdownMenuItem
        class="cursor-pointer py-2 gap-2 text-sm"
        @click="handleToggleStar"
      >
        <Star class="h-4 w-4" :class="{ 'fill-amber-400 text-amber-400': item.is_starred }" />
        <span>{{ t('drive.action_star') }}</span>
      </DropdownMenuItem>

      <DropdownMenuItem
        class="cursor-pointer py-2 gap-2 text-sm"
        @click="emit('rename', item)"
      >
        <Edit2 class="h-4 w-4" />
        <span>{{ t('drive.action_rename') }}</span>
      </DropdownMenuItem>

      <DropdownMenuItem class="cursor-pointer py-2 gap-2 text-sm" @click="emit('move', item)">
        <FolderInput class="h-4 w-4" />
        <span>{{ t('drive.action_move') }}</span>
      </DropdownMenuItem>

      <DropdownMenuSeparator />

      <DropdownMenuItem
        class="cursor-pointer text-destructive focus:text-destructive py-2 gap-2 text-sm"
        @click="emit('delete', item)"
      >
        <Trash2 class="h-4 w-4" />
        <span>{{ t('drive.action_delete') }}</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

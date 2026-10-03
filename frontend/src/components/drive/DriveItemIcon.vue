<script setup lang="ts">
import { computed } from 'vue'
import { FileText, ImageIcon, FileArchive, FileVideo, FileAudio, Folder, File } from 'lucide-vue-next'

import type { DriveItem } from '@/api/driveItems'

const props = defineProps<{ item: DriveItem }>()

// The API only knows "file" and "folder", so the icon comes from the MIME type
// and the extension rather than from `type`.
const icon = computed(() => {
  if (props.item.type === 'folder') return Folder

  const mime = props.item.mime_type || ''
  if (mime.startsWith('image/')) return ImageIcon
  if (mime.startsWith('video/')) return FileVideo
  if (mime.startsWith('audio/')) return FileAudio
  if (mime === 'application/pdf') return FileText

  const ext = (props.item.extension || '').toLowerCase()
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return FileArchive
  if (['txt', 'md', 'doc', 'docx', 'pdf'].includes(ext)) return FileText

  return File
})

const colorClass = computed(() =>
  props.item.type === 'folder' ? 'text-amber-500 fill-amber-500/20' : 'text-muted-foreground',
)
</script>

<template>
  <component :is="icon" class="h-4.5 w-4.5 shrink-0" :class="colorClass" />
</template>

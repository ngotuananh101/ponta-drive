<script setup lang="ts">
import { useRouter } from 'vue-router'
import FilePreviewContent from '@/components/drive/FilePreviewContent.vue'
import { driveLocation } from '@/router/drivePaths'

const props = defineProps<{
  cloudId: string
  uuid: string
}>()

const router = useRouter()

/**
 * The standalone route is opened directly (a shared link) or promoted from the
 * in-list overlay. Closing it returns to the drive list: the previous entry
 * when there is one, otherwise a replace so the history does not grow with a
 * preview the user never sees again.
 */
function goBack() {
  if (window.history.state?.back) {
    router.back()
    return
  }
  void router.replace(driveLocation(Number(props.cloudId)))
}
</script>

<template>
  <!-- Fullscreen, no app chrome: the route renders the preview on its own, the
       way Google Drive's preview page does. -->
  <div class="fixed inset-0 z-50 flex flex-col bg-neutral-900 text-white">
    <FilePreviewContent :uuid="uuid" @close="goBack" />
  </div>
</template>

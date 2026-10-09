<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import FilePreviewContent from '@/components/drive/FilePreviewContent.vue'

defineProps<{ uuid: string }>()

const emit = defineEmits<{
  close: []
  'open-standalone': []
}>()

// Escape closes the dialog, the way a modal is expected to behave.
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

// The list behind must not scroll while the overlay is up; the previous value
// is restored on unmount so a re-open (or route change) does not leave the
// page stuck.
let previousOverflow = ''

onMounted(() => {
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.body.style.overflow = previousOverflow
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex flex-col bg-neutral-900/90 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
  >
    <FilePreviewContent
      :uuid="uuid"
      open-standalone
      @close="emit('close')"
      @open-standalone="emit('open-standalone')"
    />
  </div>
</template>

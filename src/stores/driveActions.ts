import { defineStore } from 'pinia'
import { ref } from 'vue'

export type DriveActionType = 'new-folder' | 'upload-file' | 'upload-folder'

export interface PendingAction {
  type: DriveActionType
  nonce: number
}

/**
 * Bridges user actions in the sidebar (which has no folder/drive context)
 * to DriveView (which holds active folder context and owns dialogs).
 */
export const useDriveActionsStore = defineStore('driveActions', () => {
  const pending = ref<PendingAction | null>(null)
  let counter = 0

  function request(type: DriveActionType): void {
    pending.value = {
      type,
      nonce: ++counter,
    }
  }

  function consume(): void {
    pending.value = null
  }

  return { pending, request, consume }
})

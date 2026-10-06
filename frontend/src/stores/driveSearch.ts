import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * Holds the drive search term.
 *
 * The search inputs live in the layout's top bar (desktop and mobile), but the
 * list they filter lives in DriveView. Neither owns the other, so the term
 * sits here: the inputs write it, DriveView reads it into the list query.
 * Same shape as `driveActions`, which bridges the sidebar to DriveView.
 */
export const useDriveSearchStore = defineStore('driveSearch', () => {
  const query = ref('')

  function setQuery(value: string): void {
    query.value = value
  }

  function clear(): void {
    query.value = ''
  }

  return { query, setQuery, clear }
})

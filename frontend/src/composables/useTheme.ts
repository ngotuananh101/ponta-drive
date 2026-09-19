import { useColorMode } from '@vueuse/core'
import { computed } from 'vue'

export type ThemeMode = 'auto' | 'light' | 'dark'

const mode = useColorMode<ThemeMode>({
  emitAuto: true,
  initialValue: 'auto',
  storageKey: 'ponta-drive-theme',
})

export function useTheme() {
  const isDark = computed(() => {
    if (mode.value === 'dark') return true
    if (mode.value === 'light') return false
    // 'auto' - check system preference
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  function setMode(newMode: ThemeMode) {
    mode.value = newMode
  }

  return {
    mode,
    isDark,
    setMode,
  }
}

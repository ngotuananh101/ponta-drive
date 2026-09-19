<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Sun, Moon, Monitor, Check } from 'lucide-vue-next'
import { useTheme, type ThemeMode } from '@/composables/useTheme'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const { t } = useI18n()
const { mode, setMode } = useTheme()

const options = computed<{ label: string; value: ThemeMode; icon: typeof Sun }[]>(() => [
  { label: t('theme.light'), value: 'light', icon: Sun },
  { label: t('theme.dark'), value: 'dark', icon: Moon },
  { label: t('theme.system'), value: 'auto', icon: Monitor },
])
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="icon"
        class="h-10 w-10 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent/80 transition-all border border-border/50 bg-background/60 shadow-xs"
        :title="t('theme.toggle_theme')"
      >
        <Sun class="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 text-amber-500" />
        <Moon class="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100 text-sky-400" />
        <span class="sr-only">{{ t('theme.toggle_theme') }}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="min-w-[150px] p-1.5">
      <DropdownMenuItem
        v-for="item in options"
        :key="item.value"
        class="flex items-center justify-between cursor-pointer py-2 px-2.5 rounded-lg text-sm"
        @click="setMode(item.value)"
      >
        <div class="flex items-center gap-2.5">
          <component :is="item.icon" class="h-4 w-4 text-muted-foreground" />
          <span class="font-medium">{{ item.label }}</span>
        </div>
        <Check v-if="mode === item.value" class="h-4 w-4 text-primary stroke-[2.5]" />
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<script setup lang="ts">
import { Sun, Moon, Monitor, Check } from 'lucide-vue-next'
import { useTheme, type ThemeMode } from '@/composables/useTheme'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const { mode, setMode } = useTheme()

const options: { label: string; value: ThemeMode; icon: typeof Sun }[] = [
  { label: 'Sáng', value: 'light', icon: Sun },
  { label: 'Tối', value: 'dark', icon: Moon },
  { label: 'Hệ thống', value: 'auto', icon: Monitor },
]
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="icon"
        class="h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
        title="Chuyển đổi giao diện"
      >
        <Sun class="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
        <Moon class="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        <span class="sr-only">Chuyển đổi giao diện</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="min-w-[140px]">
      <DropdownMenuItem
        v-for="item in options"
        :key="item.value"
        class="flex items-center justify-between cursor-pointer"
        @click="setMode(item.value)"
      >
        <div class="flex items-center gap-2">
          <component :is="item.icon" class="h-4 w-4" />
          <span>{{ item.label }}</span>
        </div>
        <Check v-if="mode === item.value" class="h-4 w-4 text-primary" />
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

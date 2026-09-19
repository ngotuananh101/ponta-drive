<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Globe, Check } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { setAppLocale, type SupportedLocale } from '@/i18n'

const { locale, t } = useI18n()

const languages: { label: string; value: SupportedLocale; code: string }[] = [
  { label: 'Tiếng Việt', value: 'vi', code: 'VI' },
  { label: 'English', value: 'en', code: 'EN' },
]

function onSelectLanguage(newLocale: SupportedLocale) {
  setAppLocale(newLocale)
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="sm"
        class="h-9 px-2.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors gap-1.5 font-medium"
        :title="t('common.language')"
      >
        <Globe class="h-4 w-4" />
        <span class="text-xs tracking-wider uppercase font-semibold">{{ locale }}</span>
        <span class="sr-only">{{ t('common.language') }}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="min-w-[200px] p-1.5">
      <DropdownMenuItem
        v-for="item in languages"
        :key="item.value"
        class="flex items-center justify-between cursor-pointer py-2 px-3 rounded-md text-sm"
        @click="onSelectLanguage(item.value)"
      >
        <div class="flex items-center gap-3">
          <span class="text-xs font-mono font-bold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {{ item.code }}
          </span>
          <span class="font-medium">{{ item.label }}</span>
        </div>
        <Check v-if="locale === item.value" class="h-4 w-4 text-primary ml-4" />
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

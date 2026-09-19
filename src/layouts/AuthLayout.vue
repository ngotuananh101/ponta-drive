<script setup lang="ts">
import { AppLogo } from '@/components/icons'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card'

defineProps<{
  title: string
  description: string
}>()
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-muted/40 p-4">
    <Card class="w-full max-w-md shadow-xl border-border py-0">
      <CardHeader class="space-y-2 text-center pt-8">
        <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
          <AppLogo class="h-9 w-9" />
        </div>
        <CardTitle class="text-2xl font-bold tracking-tight">{{ title }}</CardTitle>
        <CardDescription>{{ description }}</CardDescription>
      </CardHeader>

      <CardContent class="pt-0 pb-8">
        <slot />
      </CardContent>

      <CardFooter
        v-if="$slots.footer"
        class="pb-8 pt-0 flex justify-center border-t border-border/50 text-sm text-muted-foreground pt-4"
      >
        <slot name="footer" />
      </CardFooter>
    </Card>
  </div>
</template>

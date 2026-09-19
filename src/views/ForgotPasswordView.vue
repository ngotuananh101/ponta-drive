<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Mail, ArrowLeft, Loader2 } from 'lucide-vue-next'
import AuthLayout from '@/layouts/AuthLayout.vue'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { forgotPassword } from '@/api/client'

const { t } = useI18n()
const email = ref('')
const loading = ref(false)
const isSubmitted = ref(false)
const countdown = ref(0)

let timer: ReturnType<typeof setInterval> | null = null

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function startCountdown(seconds: number) {
  if (timer) {
    clearInterval(timer)
  }
  countdown.value = seconds
  timer = setInterval(() => {
    if (countdown.value > 0) {
      countdown.value--
    } else {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }
  }, 1000)
}

onUnmounted(() => {
  if (timer) {
    clearInterval(timer)
  }
})

function validateEmail(value: string): boolean {
  if (!value) {
    toast.warning(t('auth.forgot_email_empty'))
    return false
  }
  if (!EMAIL_REGEX.test(value)) {
    toast.warning(t('auth.forgot_email_invalid'))
    return false
  }
  return true
}

async function onSubmit() {
  const emailVal = email.value.trim()

  if (!validateEmail(emailVal)) {
    return
  }

  loading.value = true
  try {
    await forgotPassword(emailVal)
    isSubmitted.value = true
    startCountdown(60)
    toast.success(t('auth.forgot_success'))
  } catch (err) {
    toast.error(
      err instanceof Error ? err.message : t('auth.default_login_error')
    )
  } finally {
    loading.value = false
  }
}

function onChangeEmail() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  countdown.value = 0
  isSubmitted.value = false
  email.value = ''
}
</script>

<template>
  <AuthLayout
    :title="t('auth.forgot_title')"
    :description="t('auth.forgot_subtitle')"
  >
    <div v-if="isSubmitted" class="space-y-4">
      <div
        class="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/10 p-4 text-foreground"
      >
        <Mail class="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
        <p class="text-sm">
          {{ t('auth.forgot_sent_notice') }}
        </p>
      </div>

      <div class="text-center text-sm text-muted-foreground">
        {{ t('auth.forgot_resend_countdown', { seconds: countdown }) }}
      </div>

      <Button
        type="button"
        variant="outline"
        class="w-full"
        :disabled="loading || countdown > 0"
        @click="onSubmit"
      >
        <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />{{ t('auth.forgot_resend_button') }}
      </Button>

      <Button type="button" variant="ghost" class="w-full" @click="onChangeEmail">
        {{ t('auth.forgot_change_email') }}
      </Button>
    </div>

    <form v-else @submit.prevent="onSubmit" class="space-y-4">
      <div class="space-y-2">
        <Label for="email">{{ t('common.email') }}</Label>
        <div class="relative flex items-center">
          <Mail
            class="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none"
          />
          <Input
            id="email"
            type="email"
            v-model="email"
            class="pl-9"
            :placeholder="t('auth.email_placeholder')"
            :disabled="loading"
            autofocus
          />
        </div>
      </div>

      <Button
        type="submit"
        class="w-full font-medium"
        :disabled="loading"
      >
        <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
        {{ t('auth.forgot_send_button') }}
      </Button>
    </form>

    <template #footer>
      <RouterLink
        to="/login"
        class="inline-flex items-center text-sm font-medium text-primary hover:underline"
      >
        <ArrowLeft class="mr-2 h-4 w-4" />
        {{ t('common.back_to_login') }}
      </RouterLink>
    </template>
  </AuthLayout>
</template>

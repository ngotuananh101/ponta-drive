<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { toast } from 'vue-sonner'
import { Mail, Lock, Eye, EyeOff, Loader2, LogIn } from 'lucide-vue-next'
import AuthLayout from '@/layouts/AuthLayout.vue'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

const { t } = useI18n()
const router = useRouter()
const authStore = useAuthStore()

const form = ref({
  email: '',
  password: '',
})

const showPassword = ref(false)

async function onSubmit() {
  const emailVal = form.value.email.trim()
  const passwordVal = form.value.password

  if (!emailVal || !passwordVal) {
    toast.warning(t('auth.login_warning_empty'))
    return
  }

  try {
    await authStore.login({
      email: emailVal,
      password: passwordVal,
    })

    toast.success(t('auth.welcome_user', { name: authStore.user?.name || '' }))
    router.push({ name: 'home' })
  } catch (err) {
    toast.error(
      err instanceof Error
        ? err.message
        : t('auth.default_login_error')
    )
  }
}
</script>

<template>
  <AuthLayout :title="t('auth.login_title')" :description="t('auth.login_subtitle')">
    <form @submit.prevent="onSubmit" class="space-y-4">
      <div class="space-y-2">
        <Label for="email">{{ t('common.email') }}</Label>
        <div class="relative flex items-center">
          <Mail class="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            id="email"
            type="email"
            v-model="form.email"
            class="pl-9"
            :placeholder="t('auth.email_placeholder')"
            :disabled="authStore.loading"
            autofocus
          />
        </div>
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <Label for="password">{{ t('common.password') }}</Label>
          <RouterLink
            to="/forgot-password"
            class="text-xs text-primary hover:underline font-medium"
          >
            {{ t('auth.forgot_password') }}
          </RouterLink>
        </div>
        <div class="relative flex items-center">
          <Lock class="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            id="password"
            :type="showPassword ? 'text' : 'password'"
            v-model="form.password"
            class="pl-9 pr-10"
            :placeholder="t('auth.password_placeholder')"
            :disabled="authStore.loading"
          />
          <button
            type="button"
            @click="showPassword = !showPassword"
            class="absolute right-3 text-muted-foreground hover:text-foreground transition-colors"
            tabindex="-1"
          >
            <Eye v-if="!showPassword" class="h-4 w-4" />
            <EyeOff v-else class="h-4 w-4" />
          </button>
        </div>
      </div>

      <Button
        type="submit"
        class="w-full mt-2 font-medium"
        :disabled="authStore.loading"
      >
        <Loader2 v-if="authStore.loading" class="mr-2 h-4 w-4 animate-spin" />
        <LogIn v-else class="mr-2 h-4 w-4" />
        {{ t('auth.login_button') }}
      </Button>
    </form>
  </AuthLayout>
</template>

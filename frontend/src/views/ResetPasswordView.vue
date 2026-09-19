<script setup lang="ts">
  import { ref, computed, watch, onUnmounted } from 'vue'
  import { useRoute, useRouter, RouterLink } from 'vue-router'
  import { useI18n } from 'vue-i18n'
  import { toast } from 'vue-sonner'
  import { Mail, Lock, Eye, EyeOff, Loader2, ArrowLeft } from 'lucide-vue-next'
  import AuthLayout from '@/layouts/AuthLayout.vue'
  import { resetPassword } from '@/api/client'

  import { Input } from '@/components/ui/input'
  import { Label } from '@/components/ui/label'
  import { Button } from '@/components/ui/button'

  const { t } = useI18n()
  const route = useRoute()
  const router = useRouter()

  const token = computed(() => {
    const rawToken = route.query.token
    return String(Array.isArray(rawToken) ? rawToken[0] || '' : rawToken || '')
  })

  const email = ref('')

  watch(
    () => route.query.email,
    (rawEmail) => {
      if (rawEmail) {
        email.value = String(Array.isArray(rawEmail) ? rawEmail[0] || '' : rawEmail || '')
      }
    },
    { immediate: true }
  )

  const isEmailFromQuery = computed(() => Boolean(route.query.email))

  const form = ref({
    password: '',
    password_confirmation: '',
  })

  const showPassword = ref(false)
  const showPasswordConfirmation = ref(false)
  const loading = ref(false)
  let redirectTimer: ReturnType<typeof setTimeout> | null = null

  onUnmounted(() => {
    if (redirectTimer) {
      clearTimeout(redirectTimer)
    }
  })

  async function onSubmit() {
    if (!token.value) {
      return
    }

    const emailVal = email.value.trim()
    if (!emailVal) {
      toast.warning(t('auth.reset_email_empty'))
      return
    }

    const password = form.value.password
    const passwordConfirmation = form.value.password_confirmation

    if (password.length < 8) {
      toast.warning(t('auth.reset_password_min'))
      return
    }

    if (password !== passwordConfirmation) {
      toast.warning(t('auth.reset_password_mismatch'))
      return
    }

    loading.value = true

    try {
      await resetPassword({
        email: emailVal,
        token: token.value,
        password,
        password_confirmation: passwordConfirmation,
      })

      toast.success(t('auth.reset_success'))
      redirectTimer = setTimeout(() => {
        router.push({ name: 'login' })
      }, 1500)
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t('auth.reset_token_error')
      )
    } finally {
      loading.value = false
    }
  }
</script>

<template>
  <AuthLayout
    :title="t('auth.reset_title')"
    :description="t('auth.reset_subtitle')"
  >
    <div v-if="!token" class="space-y-4">
      <div class="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive dark:text-destructive/90 space-y-2">
        <p>{{ t('auth.reset_invalid_link') }}</p>
        <div class="flex flex-col sm:flex-row gap-2 pt-2">
          <RouterLink
            to="/forgot-password"
            class="inline-flex items-center justify-center text-sm font-medium text-primary hover:underline"
          >
            {{ t('auth.reset_request_new') }}
          </RouterLink>
          <RouterLink
            to="/login"
            class="inline-flex items-center justify-center text-sm font-medium text-primary hover:underline"
          >
            {{ t('common.back_to_login') }}
          </RouterLink>
        </div>
      </div>
    </div>

    <form v-else @submit.prevent="onSubmit" class="space-y-4">
      <div class="space-y-2">
        <Label for="email">{{ t('common.email') }}</Label>
        <div class="relative flex items-center">
          <Mail class="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            id="email"
            type="email"
            v-model="email"
            class="pl-9"
            :class="{ 'bg-muted': isEmailFromQuery }"
            :readonly="isEmailFromQuery"
            :disabled="loading"
            placeholder="name@example.com"
          />
        </div>
      </div>

      <div class="space-y-2">
        <Label for="password">{{ t('auth.reset_new_password') }}</Label>
        <div class="relative flex items-center">
          <Lock class="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            id="password"
            :type="showPassword ? 'text' : 'password'"
            v-model="form.password"
            class="pl-9 pr-10"
            :placeholder="t('auth.reset_new_password_placeholder')"
            :disabled="loading"
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

      <div class="space-y-2">
        <Label for="password_confirmation">{{ t('auth.reset_confirm_password') }}</Label>
        <div class="relative flex items-center">
          <Lock class="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            id="password_confirmation"
            :type="showPasswordConfirmation ? 'text' : 'password'"
            v-model="form.password_confirmation"
            class="pl-9 pr-10"
            :placeholder="t('auth.reset_confirm_password_placeholder')"
            :disabled="loading"
          />
          <button
            type="button"
            @click="showPasswordConfirmation = !showPasswordConfirmation"
            class="absolute right-3 text-muted-foreground hover:text-foreground transition-colors"
            tabindex="-1"
          >
            <Eye v-if="!showPasswordConfirmation" class="h-4 w-4" />
            <EyeOff v-else class="h-4 w-4" />
          </button>
        </div>
      </div>

      <Button
        type="submit"
        class="w-full mt-2 font-medium"
        :disabled="loading"
      >
        <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
        {{ t('auth.reset_button') }}
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

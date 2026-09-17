<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { toast } from 'vue-sonner'
import { Mail, Lock, Eye, EyeOff, Loader2, LogIn } from 'lucide-vue-next'
import AuthLayout from '@/layouts/AuthLayout.vue'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

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
    toast.warning('Vui lòng nhập đầy đủ email và mật khẩu')
    return
  }

  try {
    await authStore.login({
      email: emailVal,
      password: passwordVal,
    })

    toast.success(`Chào mừng ${authStore.user?.name || 'bạn'} trở lại!`)
    router.push({ name: 'home' })
  } catch (err) {
    toast.error(
      err instanceof Error
        ? err.message
        : 'Email hoặc mật khẩu không chính xác'
    )
  }
}
</script>

<template>
  <AuthLayout title="Ponta Drive" description="Đăng nhập để quản lý tệp và tài liệu của bạn">
    <form @submit.prevent="onSubmit" class="space-y-4">
      <div class="space-y-2">
        <Label for="email">Email</Label>
        <div class="relative flex items-center">
          <Mail class="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            id="email"
            type="email"
            v-model="form.email"
            class="pl-9"
            placeholder="name@example.com"
            :disabled="authStore.loading"
            autofocus
          />
        </div>
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <Label for="password">Mật khẩu</Label>
          <RouterLink
            to="/forgot-password"
            class="text-xs text-primary hover:underline font-medium"
          >
            Quên mật khẩu?
          </RouterLink>
        </div>
        <div class="relative flex items-center">
          <Lock class="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            id="password"
            :type="showPassword ? 'text' : 'password'"
            v-model="form.password"
            class="pl-9 pr-10"
            placeholder="Nhập mật khẩu"
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
        Đăng nhập
      </Button>
    </form>
  </AuthLayout>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { RouterLink } from 'vue-router'
import { toast } from 'vue-sonner'
import { Mail, ArrowLeft, Loader2 } from 'lucide-vue-next'
import AuthLayout from '@/layouts/AuthLayout.vue'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { forgotPassword } from '@/api/client'

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
    toast.warning('Vui lòng nhập email của bạn')
    return false
  }
  if (!EMAIL_REGEX.test(value)) {
    toast.warning('Email không đúng định dạng')
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
    toast.success('Liên kết khôi phục đã được gửi!')
  } catch (err) {
    toast.error(
      err instanceof Error ? err.message : 'Đã có lỗi xảy ra, vui lòng thử lại'
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
    title="Quên mật khẩu"
    description="Nhập email tài khoản của bạn để nhận liên kết khôi phục"
  >
    <div v-if="isSubmitted" class="space-y-4">
      <div
        class="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-800"
      >
        <Mail class="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600" />
        <p class="text-sm">
          Chúng tôi đã gửi liên kết đặt lại mật khẩu đến email của bạn nếu
          tài khoản tồn tại trong hệ thống. Vui lòng kiểm tra hộp thư đến (hoặc
          mục Spam).
        </p>
      </div>

      <div class="text-center text-sm text-muted-foreground">
        Bạn có thể gửi lại liên kết sau
        <span class="font-medium text-foreground">{{ countdown }}</span>s
      </div>

      <Button
        type="button"
        variant="outline"
        class="w-full"
        :disabled="loading"
        @click="onSubmit"
      >
        <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />Gửi lại
      </Button>

      <Button type="button" variant="ghost" class="w-full" @click="onChangeEmail">
        Đổi email khác
      </Button>
    </div>

    <form v-else @submit.prevent="onSubmit" class="space-y-4">
      <div class="space-y-2">
        <Label for="email">Email</Label>
        <div class="relative flex items-center">
          <Mail
            class="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none"
          />
          <Input
            id="email"
            type="email"
            v-model="email"
            class="pl-9"
            placeholder="name@example.com"
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
        <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />Gửi liên
        kết khôi phục
      </Button>
    </form>

    <template #footer>
      <RouterLink
        to="/login"
        class="inline-flex items-center text-sm font-medium text-primary hover:underline"
      >
        <ArrowLeft class="mr-2 h-4 w-4" />
        Quay lại đăng nhập
      </RouterLink>
    </template>
  </AuthLayout>
</template>

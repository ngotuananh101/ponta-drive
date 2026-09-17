<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { RouterLink } from 'vue-router'
import { toast } from 'vue-sonner'
import { Mail, ArrowLeft, Loader2, CheckCircle2, RotateCcw, ArrowRight } from 'lucide-vue-next'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { forgotPassword } from '@/api/client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

const email = ref('')
const loading = ref(false)
const isSubmitted = ref(false)
const countdown = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

function startCountdown() {
  countdown.value = 60
  if (timer) clearInterval(timer)
  timer = setInterval(() => {
    if (countdown.value > 0) {
      countdown.value--
    } else {
      if (timer) clearInterval(timer)
      timer = null
    }
  }, 1000)
}

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

async function onSubmit() {
  const emailVal = email.value.trim()

  if (!emailVal) {
    toast.warning('Vui lòng nhập địa chỉ email')
    return
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(emailVal)) {
    toast.warning('Địa chỉ email không hợp lệ')
    return
  }

  loading.value = true

  try {
    const res = await forgotPassword(emailVal)
    isSubmitted.value = true
    startCountdown()
    toast.success(res.message || 'Liên kết khôi phục đã được gửi!')
  } catch (err) {
    toast.error(
      err instanceof Error
        ? err.message
        : 'Có lỗi xảy ra, vui lòng thử lại sau'
    )
  } finally {
    loading.value = false
  }
}

function onChangeEmail() {
  isSubmitted.value = false
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  countdown.value = 0
}
</script>

<template>
  <AuthLayout
    title="Quên mật khẩu"
    description="Nhập email tài khoản của bạn để nhận liên kết khôi phục"
  >
    <div v-if="isSubmitted" class="space-y-4">
      <div class="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-4 text-sm text-emerald-800 dark:text-emerald-300 space-y-2">
        <div class="flex items-center gap-2 font-medium">
          <CheckCircle2 class="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>Đã gửi liên kết khôi phục</span>
        </div>
        <p class="text-xs text-muted-foreground leading-relaxed">
          Chúng tôi đã gửi liên kết đặt lại mật khẩu đến email
          <strong class="font-semibold text-foreground">{{ email }}</strong> nếu tài khoản tồn tại trong hệ thống. Vui lòng kiểm tra hộp thư đến (hoặc mục Spam).
        </p>
      </div>

      <div class="flex flex-col gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          class="w-full"
          :disabled="loading || countdown > 0"
          @click="onSubmit"
        >
          <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
          <RotateCcw v-else class="mr-2 h-4 w-4" />
          {{ countdown > 0 ? `Gửi lại sau (${countdown}s)` : 'Gửi lại email' }}
        </Button>

        <Button
          type="button"
          variant="ghost"
          class="w-full text-xs text-muted-foreground hover:text-foreground"
          @click="onChangeEmail"
        >
          Đổi địa chỉ email khác
        </Button>
      </div>
    </div>

    <form v-else @submit.prevent="onSubmit" class="space-y-4">
      <div class="space-y-2">
        <Label for="email">Email</Label>
        <div class="relative flex items-center">
          <Mail class="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
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
        class="w-full mt-2 font-medium"
        :disabled="loading"
      >
        <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
        <ArrowRight v-else class="mr-2 h-4 w-4" />
        Gửi liên kết khôi phục
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

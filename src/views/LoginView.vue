<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { toast } from 'vue-sonner'
import { Cloud, User, Lock, Eye, EyeOff, Loader2, LogIn } from 'lucide-vue-next'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

const router = useRouter()
const authStore = useAuthStore()

const form = ref({
  login: '',
  password: '',
})

const showPassword = ref(false)

async function onSubmit() {
  const loginVal = form.value.login.trim()
  const passwordVal = form.value.password

  if (!loginVal || !passwordVal) {
    toast.warning('Vui lòng nhập đầy đủ tên đăng nhập/email và mật khẩu')
    return
  }

  try {
    await authStore.login({
      login: loginVal,
      password: passwordVal,
    })

    toast.success(`Chào mừng ${authStore.user?.name || 'bạn'} trở lại!`)
    router.push({ name: 'home' })
  } catch (err) {
    toast.error(
      err instanceof Error
        ? err.message
        : 'Tên đăng nhập hoặc mật khẩu không chính xác'
    )
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-muted/40 p-4">
    <Card class="w-full max-w-md shadow-xl border-border">
      <CardHeader class="space-y-2 text-center pt-8">
        <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Cloud class="h-8 w-8" />
        </div>
        <CardTitle class="text-2xl font-bold tracking-tight">Ponta Drive</CardTitle>
        <CardDescription>Đăng nhập để quản lý tệp và tài liệu của bạn</CardDescription>
      </CardHeader>

      <CardContent class="pt-4 pb-8">
        <form @submit.prevent="onSubmit" class="space-y-4">
          <div class="space-y-2">
            <Label for="login">Tên đăng nhập hoặc Email</Label>
            <div class="relative flex items-center">
              <User class="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                id="login"
                v-model="form.login"
                class="pl-9"
                placeholder="admin hoặc email@domain.com"
                :disabled="authStore.loading"
                autofocus
              />
            </div>
          </div>

          <div class="space-y-2">
            <Label for="password">Mật khẩu</Label>
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
      </CardContent>
    </Card>
  </div>
</template>

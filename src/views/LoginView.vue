<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useToast } from 'primevue/usetoast'
import Card from 'primevue/card'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Button from 'primevue/button'

const router = useRouter()
const authStore = useAuthStore()
const toast = useToast()

const form = ref({
  login: '',
  password: '',
})

async function onSubmit() {
  if (!form.value.login.trim() || !form.value.password) {
    toast.add({
      severity: 'warn',
      summary: 'Thiếu thông tin',
      detail: 'Vui lòng nhập tên đăng nhập/email và mật khẩu',
      life: 3000,
    })
    return
  }

  try {
    await authStore.login({
      login: form.value.login.trim(),
      password: form.value.password,
    })
    toast.add({
      severity: 'success',
      summary: 'Đăng nhập thành công',
      detail: `Chào mừng ${authStore.user?.name || 'bạn'} trở lại!`,
      life: 2500,
    })
    router.push({ name: 'home' })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Đăng nhập thất bại',
      detail:
        err instanceof Error
          ? err.message
          : 'Tên đăng nhập hoặc mật khẩu không chính xác',
      life: 4000,
    })
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
    <Card class="w-full max-w-md shadow-xl border border-slate-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900">
      <template #header>
        <div class="pt-8 px-6 text-center">
          <div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 mb-3">
            <i class="pi pi-cloud text-3xl"></i>
          </div>
          <h1 class="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Ponta Drive</h1>
          <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">Đăng nhập để quản lý tệp và tài liệu của bạn</p>
        </div>
      </template>

      <template #content>
        <form @submit.prevent="onSubmit" class="flex flex-col gap-5 px-2">
          <div class="flex flex-col gap-2">
            <label for="login" class="text-sm font-medium text-slate-700 dark:text-slate-300">Tên đăng nhập hoặc Email</label>
            <div class="relative flex items-center">
              <i class="pi pi-user absolute left-3.5 text-slate-400 pointer-events-none z-10"></i>
              <InputText
                id="login"
                v-model="form.login"
                class="w-full pl-10!"
                placeholder="admin hoặc email@domain.com"
                :disabled="authStore.loading"
                autofocus
              />
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <label for="password" class="text-sm font-medium text-slate-700 dark:text-slate-300">Mật khẩu</label>
            <Password
              id="password"
              v-model="form.password"
              class="w-full"
              input-class="w-full"
              placeholder="Nhập mật khẩu"
              :feedback="false"
              toggle-mask
              :disabled="authStore.loading"
            />
          </div>

          <Button
            type="submit"
            label="Đăng nhập"
            icon="pi pi-sign-in"
            class="w-full mt-2"
            :loading="authStore.loading"
          />
        </form>
      </template>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'

const router = useRouter()
const authStore = useAuthStore()

const loginInput = ref<string>('')
const password = ref<string>('')

async function handleLogin() {
  if (!loginInput.value || !password.value) return
  await authStore.login({ login: loginInput.value, password: password.value })
  if (authStore.isAuthenticated) {
    await router.push({ name: 'home' })
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
    <div class="w-full max-w-sm rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 shadow-xs">
      <div class="mb-6 text-center">
        <i class="pi pi-cloud text-blue-600 text-3xl mb-2"></i>
        <h1 class="text-2xl font-bold text-slate-900 dark:text-slate-100">Ponta Drive</h1>
        <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">Đăng nhập để tiếp tục</p>
      </div>

      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1" for="login">
            Email hoặc tên người dùng
          </label>
          <InputText id="login" v-model="loginInput" class="w-full" placeholder="you@example.com" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1" for="password">
            Mật khẩu
          </label>
          <InputText id="password" v-model="password" class="w-full" type="password" placeholder="Mật khẩu" />
        </div>
        <Button label="Đăng nhập" class="w-full justify-center" :loading="authStore.loading" @click="handleLogin" />
      </div>
    </div>
  </div>
</template>

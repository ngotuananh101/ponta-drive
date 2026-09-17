<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import Button from 'primevue/button'

const authStore = useAuthStore()
const router = useRouter()

onMounted(async () => {
  if (!authStore.user) {
    await authStore.fetchUser()
  }
})

async function handleLogout() {
  await authStore.logout()
  router.push({ name: 'login' })
}
</script>

<template>
  <div class="min-h-screen bg-slate-50 dark:bg-slate-950 p-6">
    <header class="flex items-center justify-between max-w-6xl mx-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-6 py-4 shadow-xs">
      <div class="flex items-center gap-3">
        <i class="pi pi-cloud text-blue-600 text-2xl"></i>
        <span class="font-bold text-xl text-slate-900 dark:text-slate-50">Ponta Drive</span>
      </div>

      <div class="flex items-center gap-4">
        <div v-if="authStore.user" class="flex items-center gap-3">
          <img :src="authStore.user.avatar" :alt="authStore.user.name" class="w-9 h-9 rounded-full border border-slate-200 dark:border-slate-700" />
          <div class="text-sm">
            <div class="font-semibold text-slate-800 dark:text-slate-100">{{ authStore.user.name }}</div>
            <div class="text-xs text-slate-500">@{{ authStore.user.username }}</div>
          </div>
        </div>
        <Button label="Đăng xuất" icon="pi pi-sign-out" severity="secondary" size="small" @click="handleLogout" />
      </div>
    </header>

    <main class="max-w-6xl mx-auto mt-8 text-center py-16">
      <div class="inline-flex items-center justify-center w-20 h-20 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 mb-4">
        <i class="pi pi-folder-open text-3xl"></i>
      </div>
      <h1 class="text-2xl font-bold text-slate-900 dark:text-slate-50 mb-2">Chào mừng đến với Ponta Drive</h1>
      <p class="text-slate-600 dark:text-slate-400 max-w-md mx-auto">Hệ thống lưu trữ đám mây an toàn, hiện đại và bảo mật.</p>
    </main>
  </div>
</template>

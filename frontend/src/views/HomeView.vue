<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import ThemeToggle from '@/components/ThemeToggle.vue'
import { Cloud, LogOut, FolderOpen } from 'lucide-vue-next'

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
  <div class="min-h-screen bg-background p-6">
    <header class="flex items-center justify-between max-w-6xl mx-auto bg-card border border-border rounded-xl px-6 py-4 shadow-sm">
      <div class="flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Cloud class="h-6 w-6" />
        </div>
        <span class="font-bold text-xl text-foreground">Ponta Drive</span>
      </div>

      <div class="flex items-center gap-3">
        <div v-if="authStore.user" class="flex items-center gap-3">
          <img :src="authStore.user.avatar" :alt="authStore.user.name" class="w-9 h-9 rounded-full border border-border" />
          <div class="text-sm">
            <div class="font-semibold text-foreground">{{ authStore.user.name }}</div>
            <div class="text-xs text-muted-foreground">@{{ authStore.user.username }}</div>
          </div>
        </div>
        <ThemeToggle />
        <Button variant="outline" size="sm" @click="handleLogout">
          <LogOut class="mr-2 h-4 w-4" />
          Đăng xuất
        </Button>
      </div>
    </header>

    <main class="max-w-6xl mx-auto mt-8 text-center py-16">
      <div class="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10 text-primary mb-4">
        <FolderOpen class="h-10 w-10" />
      </div>
      <h1 class="text-2xl font-bold text-foreground mb-2">Chào mừng đến với Ponta Drive</h1>
      <p class="text-muted-foreground max-w-md mx-auto">Hệ thống lưu trữ đám mây an toàn, hiện đại và bảo mật.</p>
    </main>
  </div>
</template>

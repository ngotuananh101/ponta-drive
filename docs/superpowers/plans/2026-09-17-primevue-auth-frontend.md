# PrimeVue v5 + Aura + Tailwind v4 + Auth Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cài đặt PrimeVue v5 với theme preset Aura, Tailwind CSS v4, xây dựng Pinia Auth Store và màn hình Đăng nhập (Login) kết nối với Goravel API backend (không sử dụng plugin thương mại tailwindcss-primeui).

**Architecture:** Sử dụng PrimeVue v5 kết hợp preset `@primevue/themes/aura` và Tailwind CSS v4 thông qua `@tailwindcss/vite`. Quản lý phiên đăng nhập bằng JWT Bearer token trong Pinia store (`auth`), bảo vệ trang qua Vue Router navigation guards, và hiển thị giao diện Login theo phong cách Centered Card với PrimeVue components.

**Tech Stack:** Vue 3.5, TypeScript 6.0, PrimeVue 5.0.1, @primevue/themes, primeicons, Tailwind CSS v4, @tailwindcss/vite, Pinia, Vue Router, Bun.

**Spec:** docs/superpowers/specs/2026-09-17-primevue-auth-frontend-design.md

## Global Constraints
- Làm việc trong thư mục `frontend/` cho các file Vue / TypeScript / CSS.
- Giữ nguyên proxy `/api` sang `http://127.0.0.1:3000` trong `vite.config.ts`.
- Mọi request API xác thực phải mang header `Authorization: Bearer <token>`.
- Khi nhận phản hồi 401 Unauthorized từ backend, dọn dẹp token và tự động điều hướng sang `/login`.

---

### Task 1: Cài đặt Dependencies & Cấu hình Nền tảng UI (PrimeVue, Tailwind v4, PrimeUI)

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.ts`
- Create/Modify: `frontend/src/assets/main.css`
- Modify: `frontend/src/main.ts`

**Interfaces:**
- Produces: Hệ thống CSS Tailwind v4 kết hợp PrimeUI, PrimeVue plugin đã kích hoạt preset Aura và ToastService trong `main.ts`.

- [ ] **Step 1: Cài đặt các gói thư viện cần thiết bằng Bun**

Trong thư mục `frontend/`, chạy lệnh:
```bash
bun add primevue@^5.0.1 @primevue/themes@^4.5.4 primeicons@^8.0.1 tailwindcss@^4.3.3 @tailwindcss/vite@^4.3.3 tailwindcss-primeui@^0.6.1
```

- [ ] **Step 2: Cập nhật `frontend/vite.config.ts` tích hợp plugin `@tailwindcss/vite`**

Sửa `frontend/vite.config.ts` thành:
```typescript
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueJsx(),
    tailwindcss(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
})
```

- [ ] **Step 3: Tạo và cấu hình file CSS `frontend/src/assets/main.css`**

Tạo nội dung file `frontend/src/assets/main.css`:
```css
@import "tailwindcss";
@import "primeicons/primeicons.css";
```

- [ ] **Step 4: Cập nhật `frontend/src/main.ts` đăng ký PrimeVue, Aura theme và ToastService**

Sửa `frontend/src/main.ts` thành:
```typescript
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Aura from '@primevue/themes/aura'
import ToastService from 'primevue/toastservice'

import App from './App.vue'
import router from './router'
import './assets/main.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: '.p-dark',
    },
  },
})
app.use(ToastService)

app.mount('#app')
```

- [ ] **Step 5: Kiểm tra build sơ bộ**

Chạy: `cd frontend && bun run build`
Kỳ vọng: Build thành công không có lỗi TypeScript hay Tailwind bundling.

---

### Task 2: Cập nhật API Client Xử lý Bearer Token & Lỗi 401

**Files:**
- Modify: `frontend/src/api/client.ts`

**Interfaces:**
- Consumes: `localStorage.getItem('token')`
- Produces: `fetchApi<T>(endpoint, options): Promise<T>` với tự động đính kèm `Authorization: Bearer <token>` và tự động xóa token, redirect khi mã lỗi trả về là 401.

- [ ] **Step 1: Cập nhật `frontend/src/api/client.ts`**

Thay thế toàn bộ nội dung `frontend/src/api/client.ts` bằng:
```typescript
export interface ApiResponse<T = any> {
  status: string
  message?: string
  data?: T
  [key: string]: any
}

export async function fetchApi<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  const token = localStorage.getItem('token')

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(options.headers as Record<string, string>),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(url, {
    ...options,
    headers,
  })

  if (response.status === 401) {
    localStorage.removeItem('token')
    if (window.location.pathname !== '/login') {
      window.location.href = '/login'
    }
  }

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const errorMessage = data?.message || `API Error: ${response.status} ${response.statusText}`
    throw new Error(errorMessage)
  }

  return data as T
}
```

- [ ] **Step 2: Kiểm tra type check**

Chạy: `cd frontend && bun run type-check`
Kỳ vọng: Không có lỗi TypeScript.

---

### Task 3: Xây dựng Pinia Auth Store (`src/stores/auth.ts`)

**Files:**
- Create: `frontend/src/stores/auth.ts`

**Interfaces:**
- Consumes: `fetchApi`, `ApiResponse` từ `@/api/client`
- Produces: `useAuthStore()` với `token`, `user`, `loading`, `isAuthenticated`, `login()`, `fetchUser()`, `logout()`.

- [ ] **Step 1: Tạo file `frontend/src/stores/auth.ts`**

Tạo file `frontend/src/stores/auth.ts` với nội dung:
```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { fetchApi, type ApiResponse } from '@/api/client'

export interface User {
  id: number
  uuid: string
  name: string
  username: string
  email: string
  avatar: string
}

export interface LoginData {
  token: string
  token_type: string
  expires_in: number
  user: User
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem('token'))
  const user = ref<User | null>(null)
  const loading = ref<boolean>(false)

  const isAuthenticated = computed(() => !!token.value)

  async function login(credentials: { login: string; password: string }): Promise<void> {
    loading.value = true
    try {
      const res = await fetchApi<ApiResponse<LoginData>>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials),
      })

      if (res.data?.token) {
        token.value = res.data.token
        localStorage.setItem('token', res.data.token)
        user.value = res.data.user
      }
    } finally {
      loading.value = false
    }
  }

  async function fetchUser(): Promise<void> {
    if (!token.value) return
    try {
      const res = await fetchApi<ApiResponse<User>>('/api/auth/me')
      if (res.data) {
        user.value = res.data
      }
    } catch {
      await logout()
    }
  }

  async function logout(): Promise<void> {
    try {
      if (token.value) {
        await fetchApi('/api/auth/logout', { method: 'POST' }).catch(() => {})
      }
    } finally {
      token.value = null
      user.value = null
      localStorage.removeItem('token')
    }
  }

  return {
    token,
    user,
    loading,
    isAuthenticated,
    login,
    fetchUser,
    logout,
  }
})
```

- [ ] **Step 2: Kiểm tra type check**

Chạy: `cd frontend && bun run type-check`
Kỳ vọng: Không có lỗi TypeScript.

---

### Task 4: Cấu hình Router, Navigation Guards, App Container & Home View

**Files:**
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/App.vue`
- Create: `frontend/src/views/HomeView.vue`

**Interfaces:**
- Consumes: `useAuthStore` từ `@/stores/auth`
- Produces: Router điều hướng thông minh bảo vệ route riêng tư `/` và route công khai `/login`. Component `App.vue` bao bọc `<Toast />` của PrimeVue.

- [ ] **Step 1: Tạo `frontend/src/views/HomeView.vue`**

Tạo file `frontend/src/views/HomeView.vue`:
```vue
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
  <div class="min-h-screen bg-surface-50 dark:bg-surface-950 p-6">
    <header class="flex items-center justify-between max-w-6xl mx-auto bg-surface-0 dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-xl px-6 py-4 shadow-xs">
      <div class="flex items-center gap-3">
        <i class="pi pi-cloud text-primary text-2xl"></i>
        <span class="font-bold text-xl text-surface-900 dark:text-surface-0">Ponta Drive</span>
      </div>

      <div class="flex items-center gap-4">
        <div v-if="authStore.user" class="flex items-center gap-3">
          <img :src="authStore.user.avatar" :alt="authStore.user.name" class="w-9 h-9 rounded-full border border-surface-200 dark:border-surface-700" />
          <div class="text-sm">
            <div class="font-semibold text-surface-800 dark:text-surface-100">{{ authStore.user.name }}</div>
            <div class="text-xs text-surface-500">@{{ authStore.user.username }}</div>
          </div>
        </div>
        <Button label="Đăng xuất" icon="pi pi-sign-out" severity="secondary" size="small" @click="handleLogout" />
      </div>
    </header>

    <main class="max-w-6xl mx-auto mt-8 text-center py-16">
      <div class="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary-50 dark:bg-primary-950/40 text-primary mb-4">
        <i class="pi pi-folder-open text-3xl"></i>
      </div>
      <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-0 mb-2">Chào mừng đến với Ponta Drive</h1>
      <p class="text-surface-600 dark:text-surface-400 max-w-md mx-auto">Hệ thống lưu trữ đám mây an toàn, hiện đại và bảo mật.</p>
    </main>
  </div>
</template>
```

- [ ] **Step 2: Cập nhật `frontend/src/router/index.ts`**

Thay thế nội dung `frontend/src/router/index.ts` bằng:
```typescript
import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { requiresGuest: true },
    },
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
      meta: { requiresAuth: true },
    },
  ],
})

router.beforeEach((to, from, next) => {
  const authStore = useAuthStore()

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    return next({ name: 'login' })
  }

  if (to.meta.requiresGuest && authStore.isAuthenticated) {
    return next({ name: 'home' })
  }

  next()
})

export default router
```

- [ ] **Step 3: Cập nhật `frontend/src/App.vue` để hiển thị `Toast` toàn cục**

Thay thế `frontend/src/App.vue` bằng:
```vue
<script setup lang="ts">
import { RouterView } from 'vue-router'
import Toast from 'primevue/toast'
</script>

<template>
  <Toast position="top-right" />
  <RouterView />
</template>
```

---

### Task 5: Xây dựng Trang Đăng nhập (`frontend/src/views/LoginView.vue`)

**Files:**
- Create: `frontend/src/views/LoginView.vue`

**Interfaces:**
- Consumes: `useAuthStore` từ `@/stores/auth`, `useToast` từ `primevue/usetoast`, components: `Card`, `InputText`, `Password`, `Button` từ `primevue`.
- Produces: Trang đăng nhập chuẩn Centered Card, xử lý nhập `login`/`password`, thông báo Toast trực quan.

- [ ] **Step 1: Tạo file `frontend/src/views/LoginView.vue`**

Tạo file `frontend/src/views/LoginView.vue` với nội dung:
```vue
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
  } catch (err: any) {
    toast.add({
      severity: 'error',
      summary: 'Đăng nhập thất bại',
      detail: err.message || 'Tên đăng nhập hoặc mật khẩu không chính xác',
      life: 4000,
    })
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950 p-4">
    <Card class="w-full max-w-md shadow-xl border border-surface-200 dark:border-surface-800 rounded-2xl">
      <template #header>
        <div class="pt-8 px-6 text-center">
          <div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-50 dark:bg-primary-950/40 text-primary mb-3">
            <i class="pi pi-cloud text-3xl"></i>
          </div>
          <h1 class="text-2xl font-bold tracking-tight text-surface-900 dark:text-surface-0">Ponta Drive</h1>
          <p class="text-sm text-surface-500 dark:text-surface-400 mt-1">Đăng nhập để quản lý tệp và tài liệu của bạn</p>
        </div>
      </template>

      <template #content>
        <form @submit.prevent="onSubmit" class="flex flex-col gap-5 px-2">
          <div class="flex flex-col gap-2">
            <label for="login" class="text-sm font-medium text-surface-700 dark:text-surface-300">Tên đăng nhập hoặc Email</label>
            <div class="relative flex items-center">
              <i class="pi pi-user absolute left-3.5 text-surface-400 pointer-events-none z-10"></i>
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
            <label for="password" class="text-sm font-medium text-surface-700 dark:text-surface-300">Mật khẩu</label>
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
```

- [ ] **Step 2: Kiểm tra type check và build**

Chạy:
```bash
cd frontend && bun run type-check && bun run build
```
Kỳ vọng: Cả 2 lệnh đều vượt qua thành công (Exit code 0), không có bất kỳ lỗi cú pháp hoặc kiểu dữ liệu nào.

---

### Task 6: Kiểm thử Tích hợp Toàn diện (End-to-End Integration Check)

**Files:**
- Test trên backend & frontend: Kiểm tra tương tác API thực tế

- [ ] **Step 1: Kiểm tra chạy đồng thời qua `run.bat` hoặc kiểm thử API**

1. Khởi chạy backend nếu chưa chạy: `cd backend && go test ./tests/feature/auth_test.go -v`
2. Kiểm tra type check: `cd frontend && bun run type-check`
3. Kiểm tra build hoàn thiện: `cd frontend && bun run build`
4. Xác nhận frontend kết nối thành công với backend `/api/auth/login`.

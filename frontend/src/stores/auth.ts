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

  async function login(credentials: { email: string; password: string }): Promise<void> {
    loading.value = true
    try {
      const res = await fetchApi<ApiResponse<LoginData>>('/auth/login', {
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
      const res = await fetchApi<ApiResponse<User>>('/auth/me')
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
        await fetchApi('/auth/logout', { method: 'POST' }).catch(() => {})
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

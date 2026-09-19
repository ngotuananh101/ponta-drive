export interface ApiResponse<T = any> {
  status: string
  message?: string
  data?: T
  [key: string]: any
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')

export async function fetchApi<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  const url = API_BASE_URL ? `${API_BASE_URL}${path}` : path
  const token = localStorage.getItem('token')
  const locale = localStorage.getItem('ponta-drive-locale') || 'vi'

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Locale': locale,
    'Accept-Language': locale === 'vi' ? 'vi-VN,vi;q=0.9,en;q=0.8' : 'en-US,en;q=0.9,vi;q=0.8',
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

export async function forgotPassword(email: string): Promise<ApiResponse> {
  return fetchApi<ApiResponse>('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export interface ResetPasswordPayload {
  email: string
  token: string
  password: string
  password_confirmation: string
}

export async function resetPassword(payload: ResetPasswordPayload): Promise<ApiResponse> {
  return fetchApi<ApiResponse>('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}


export interface ApiResponse<T = any> {
  status: string
  message?: string
  data?: T
  [key: string]: any
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')

/**
 * An API failure. `errors` carries the backend's per-field validation map
 * (Laravel-style: `{ bucket: ["The bucket field is required."] }`) when the
 * response was a 422, so a form can attach each message to its own input.
 *
 * It extends Error so existing `err instanceof Error ? err.message : ...`
 * call sites keep working unchanged.
 */
export class ApiError extends Error {
  readonly status: number
  readonly errors: Record<string, string[]>

  constructor(message: string, status: number, errors: Record<string, string[]> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.errors = errors
  }

  /** The first message recorded for a field, or undefined if it has none. */
  fieldError(field: string): string | undefined {
    return this.errors[field]?.[0]
  }

  /**
   * Flattens the per-field map to one message per field, ready to bind to
   * inputs. The backend sends a list per field; the first entry is the one
   * worth showing.
   */
  fieldMessages(): Record<string, string> {
    const flattened: Record<string, string> = {}
    for (const [field, messages] of Object.entries(this.errors)) {
      const first = messages[0]
      if (first) flattened[field] = first
    }
    return flattened
  }
}

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
    throw new ApiError(errorMessage, response.status, data?.errors ?? {})
  }

  return data as T
}

export async function forgotPassword(email: string): Promise<ApiResponse> {
  return fetchApi<ApiResponse>('/auth/forgot-password', {
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
  return fetchApi<ApiResponse>('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}


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

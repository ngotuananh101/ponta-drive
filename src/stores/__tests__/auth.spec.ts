import { describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '../auth'
import { useUploadStore } from '../upload'
import * as clientApi from '@/api/client'

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('aborts and clears the upload queue on logout', async () => {
    vi.spyOn(clientApi, 'fetchApi').mockResolvedValue({ status: 'ok' })

    const authStore = useAuthStore()
    const uploadStore = useUploadStore()

    // Seed the upload queue with one `uploading` item that has a real controller.
    const controller = new AbortController()
    uploadStore.uploadQueue.push({
      id: 'up-1',
      file: new File(['x'], 'file.txt'),
      progress: 0,
      status: 'uploading',
      abortController: controller,
    })

    await authStore.logout()

    // The controller was aborted and the queue was emptied.
    expect(controller.signal.aborted).toBe(true)
    expect(uploadStore.uploadQueue).toHaveLength(0)
  })
})

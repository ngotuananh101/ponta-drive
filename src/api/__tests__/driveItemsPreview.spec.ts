import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as client from '@/api/client'
import { getDriveItemPreview } from '@/api/driveItems'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('getDriveItemPreview', () => {
  it('requests the preview endpoint and returns the strategy payload', async () => {
    const spy = vi.spyOn(client, 'fetchApi').mockResolvedValue({
      status: 'ok',
      data: {
        strategy: 'proxy',
        url: '/v1/drive/items/abc/content',
        download_url: 'https://cdn.example/abc',
        item: { uuid: 'abc' },
        reason: '',
      },
    })

    const res = await getDriveItemPreview('abc')
    expect(spy).toHaveBeenCalledWith('/v1/drive/items/abc/preview?mode=json')
    expect(res.data?.strategy).toBe('proxy')
  })
})

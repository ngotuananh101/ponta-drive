import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as client from '../client'
import {
  createDriveFolder,
  renameDriveItem,
  deleteDriveItem,
  toggleStarDriveItem,
  getDriveItemDownloadUrl,
} from '../driveItems'

describe('driveItems API mutations', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('createDriveFolder posts to /v1/drive/items/folders', async () => {
    const spy = vi.spyOn(client, 'fetchApi').mockResolvedValue({ status: 'ok' })
    await createDriveFolder({
      cloudAccountUuid: 'cloud-1',
      parentUuid: 'folder-1',
      name: 'New Folder',
    })

    expect(spy).toHaveBeenCalledWith('/v1/drive/items/folders', {
      method: 'POST',
      body: JSON.stringify({
        cloud_account_uuid: 'cloud-1',
        parent_uuid: 'folder-1',
        name: 'New Folder',
      }),
    })
  })

  it('renameDriveItem patches /v1/drive/items/:uuid', async () => {
    const spy = vi.spyOn(client, 'fetchApi').mockResolvedValue({ status: 'ok' })
    await renameDriveItem('item-uuid', 'Updated Name')

    expect(spy).toHaveBeenCalledWith('/v1/drive/items/item-uuid', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated Name' }),
    })
  })

  it('deleteDriveItem sends permanent=true by default', async () => {
    const spy = vi.spyOn(client, 'fetchApi').mockResolvedValue({ status: 'ok' })
    await deleteDriveItem('item-uuid', true)

    expect(spy).toHaveBeenCalledWith('/v1/drive/items/item-uuid?permanent=true', {
      method: 'DELETE',
    })
  })

  it('toggleStarDriveItem posts to /v1/drive/items/:uuid/star', async () => {
    const spy = vi.spyOn(client, 'fetchApi').mockResolvedValue({ status: 'ok' })
    await toggleStarDriveItem('item-uuid')

    expect(spy).toHaveBeenCalledWith('/v1/drive/items/item-uuid/star', {
      method: 'POST',
    })
  })

  it('getDriveItemDownloadUrl queries download with mode=json', async () => {
    const spy = vi.spyOn(client, 'fetchApi').mockResolvedValue({ status: 'ok' })
    await getDriveItemDownloadUrl('item-uuid')

    expect(spy).toHaveBeenCalledWith('/v1/drive/items/item-uuid/download?mode=json')
  })
})

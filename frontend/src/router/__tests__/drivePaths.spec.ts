import { describe, expect, it } from 'vitest'

import { drivePath, driveLocation } from '@/router/drivePaths'

describe('drivePaths', () => {
  it('builds the account-root path without a folder', () => {
    expect(drivePath(1)).toBe('/d/1')
    expect(driveLocation(1)).toEqual({ name: 'drive', params: { cloudId: 1 } })
  })

  it('builds the folder path when a folder uuid is given', () => {
    expect(drivePath(1, 'fold-1')).toBe('/d/1/f/fold-1')
    expect(driveLocation(1, 'fold-1')).toEqual({
      name: 'drive-folder',
      params: { cloudId: 1, folderUuid: 'fold-1' },
    })
  })

  it('treats null and empty folder as the root', () => {
    expect(drivePath(1, null)).toBe('/d/1')
    expect(drivePath(1, '')).toBe('/d/1')
  })
})

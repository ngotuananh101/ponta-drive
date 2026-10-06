import { describe, expect, it } from 'vitest'

import { drivePath, driveLocation } from '@/router/drivePaths'

describe('drivePaths', () => {
  it('builds the account-root path without a folder', () => {
    expect(drivePath('acc-1')).toBe('/d/acc-1')
    expect(driveLocation('acc-1')).toEqual({ name: 'drive', params: { cloudUuid: 'acc-1' } })
  })

  it('builds the folder path when a folder uuid is given', () => {
    expect(drivePath('acc-1', 'fold-1')).toBe('/d/acc-1/f/fold-1')
    expect(driveLocation('acc-1', 'fold-1')).toEqual({
      name: 'drive-folder',
      params: { cloudUuid: 'acc-1', folderUuid: 'fold-1' },
    })
  })

  it('treats null and empty folder as the root', () => {
    expect(drivePath('acc-1', null)).toBe('/d/acc-1')
    expect(drivePath('acc-1', '')).toBe('/d/acc-1')
  })
})

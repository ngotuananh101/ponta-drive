import { describe, expect, it } from 'vitest'
import vi from '@/locales/vi.json'
import en from '@/locales/en.json'

describe('drive locale namespace', () => {
  it('defines the drive namespace in both locales', () => {
    expect(vi.drive).toBeTruthy()
    expect(en.drive).toBeTruthy()
  })

  it('has identical keys for drive in both locales', () => {
    const viKeys = Object.keys(vi.drive).sort()
    const enKeys = Object.keys(en.drive).sort()
    expect(enKeys).toEqual(viKeys)
  })

  it('has no empty translations in drive namespace', () => {
    for (const [key, value] of Object.entries(vi.drive)) {
      expect(value, `vi.drive.${key}`).toBeTruthy()
    }
    for (const [key, value] of Object.entries(en.drive)) {
      expect(value, `en.drive.${key}`).toBeTruthy()
    }
  })

  it('defines dialog action keys needed for management', () => {
    const required = [
      'new_folder_title',
      'new_folder_placeholder',
      'new_folder_create',
      'rename_title',
      'rename_placeholder',
      'rename_save',
      'action_move',
      'move_title',
      'move_select_destination',
      'move_here',
      'move_root',
      'move_empty',
      'toast_moved',
      'delete_item_title',
      'delete_item_confirm',
      'delete_folder_warning',
      'delete_permanent_note',
      'delete_button',
      'cancel_button',
      'upload_title',
      'upload_method_title',
      'upload_method_direct',
      'upload_method_direct_desc',
      'upload_method_server',
      'upload_method_server_desc',
      'upload_select_files',
      'upload_select_folder',
      'upload_drop_hint',
      'upload_start',
      'upload_cancel',
      'upload_status_uploading',
      'upload_status_completed',
      'upload_status_failed',
      'toast_folder_created',
      'toast_renamed',
      'toast_deleted',
      'toast_starred',
      'toast_unstarred',
      'toast_download_started',
      'toast_upload_completed',
    ]

    for (const k of required) {
      expect((vi.drive as Record<string, string>)[k], `vi.drive.${k}`).toBeTruthy()
      expect((en.drive as Record<string, string>)[k], `en.drive.${k}`).toBeTruthy()
    }
  })
})

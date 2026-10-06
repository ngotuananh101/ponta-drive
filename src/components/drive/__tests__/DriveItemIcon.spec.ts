import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import DriveItemIcon from '@/components/drive/DriveItemIcon.vue'
import type { DriveItem } from '@/api/driveItems'

function item(partial: Partial<DriveItem>): DriveItem {
  return {
    uuid: 'item-1',
    name: 'item',
    type: 'file',
    mime_type: '',
    size: 0,
    extension: '',
    cloud_account_id: 1,
    is_starred: false,
    status: 'ready',
    updated_at: '2026-10-01 00:00:00',
    ...partial,
  }
}

/** The rendered lucide icon's class list, which names the chosen icon. */
function iconClasses(wrapper: ReturnType<typeof mount>): string {
  return wrapper.get('svg').classes().join(' ')
}

describe('DriveItemIcon', () => {
  it('renders a folder icon for folders', () => {
    const wrapper = mount(DriveItemIcon, { props: { item: item({ type: 'folder' }) } })
    expect(iconClasses(wrapper)).toContain('lucide-folder')
  })

  it('picks the icon from the MIME type before the extension', () => {
    const wrapper = mount(DriveItemIcon, {
      props: { item: item({ mime_type: 'image/png', extension: 'zip' }) },
    })
    expect(iconClasses(wrapper)).toContain('lucide-image')
  })

  it('falls back to the extension for an archive with no useful MIME type', () => {
    const wrapper = mount(DriveItemIcon, {
      props: { item: item({ mime_type: 'application/octet-stream', extension: 'zip' }) },
    })
    expect(iconClasses(wrapper)).toContain('lucide-file-archive')
  })

  it('uses the default size class when none is given', () => {
    const wrapper = mount(DriveItemIcon, { props: { item: item({}) } })
    expect(wrapper.get('svg').classes()).toContain('h-4.5')
  })

  it('applies a caller-supplied size class instead of the default', () => {
    const wrapper = mount(DriveItemIcon, {
      props: { item: item({}), sizeClass: 'h-12 w-12' },
    })
    const classes = wrapper.get('svg').classes()
    expect(classes).toContain('h-12')
    expect(classes).toContain('w-12')
    expect(classes).not.toContain('h-4.5')
  })
})

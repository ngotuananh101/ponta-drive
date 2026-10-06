import type { RouteLocationRaw } from 'vue-router'

/**
 * Builds the drive URL from uuids only. The URL is the source of truth for the
 * open folder, so every navigation site (sidebar, home cards, breadcrumb) goes
 * through here and produces the same shape.
 */
export function drivePath(cloudUuid: string, folderUuid?: string | null): string {
  return folderUuid ? `/d/${cloudUuid}/f/${folderUuid}` : `/d/${cloudUuid}`
}

export function driveLocation(cloudUuid: string, folderUuid?: string | null): RouteLocationRaw {
  return folderUuid
    ? { name: 'drive-folder', params: { cloudUuid, folderUuid } }
    : { name: 'drive', params: { cloudUuid } }
}

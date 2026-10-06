import type { RouteLocationRaw } from 'vue-router'

/**
 * Builds the drive URL from the numeric cloud account id and an optional folder
 * uuid. The URL is the source of truth for the open folder, so every navigation
 * site (sidebar, home cards, breadcrumb) goes through here and produces the
 * same shape.
 */
export function drivePath(cloudId: number, folderUuid?: string | null): string {
  return folderUuid ? `/d/${cloudId}/f/${folderUuid}` : `/d/${cloudId}`
}

export function driveLocation(cloudId: number, folderUuid?: string | null): RouteLocationRaw {
  return folderUuid
    ? { name: 'drive-folder', params: { cloudId, folderUuid } }
    : { name: 'drive', params: { cloudId } }
}

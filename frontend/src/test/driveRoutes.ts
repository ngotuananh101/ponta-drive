import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import type { Component } from 'vue'

/**
 * The drive routes every view/layout spec needs, in one place.
 *
 * The same three records were copy-pasted into five specs; keeping them here
 * means a URL change (the cloud segment is a numeric id, not a uuid) is fixed
 * once instead of in every test.
 *
 * `driveComponent` is the real `DriveView` for specs that mount it with
 * `props: true`; the default stub is enough for specs that only assert the
 * resulting route.
 */
export function makeDriveRouter(driveComponent?: Component): Router {
  const drive = driveComponent ?? { template: '<div/>' }
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/d/:cloudId', name: 'drive', component: drive, props: true },
      { path: '/d/:cloudId/f/:folderUuid', name: 'drive-folder', component: drive, props: true },
    ],
  })
}

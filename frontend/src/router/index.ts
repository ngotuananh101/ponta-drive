import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { i18n } from '@/i18n'
import { setDocumentTitle } from '@/lib/documentTitle'

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    requiresGuest?: boolean
    titleKey?: string
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { requiresGuest: true, titleKey: 'routes.login' },
    },
    {
      path: '/forgot-password',
      name: 'forgot-password',
      component: () => import('@/views/ForgotPasswordView.vue'),
      meta: { requiresGuest: true, titleKey: 'routes.forgot_password' },
    },
    {
      path: '/reset-password',
      name: 'reset-password',
      component: () => import('@/views/ResetPasswordView.vue'),
      meta: { requiresGuest: true, titleKey: 'routes.reset_password' },
    },
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
      meta: { requiresAuth: true, titleKey: 'routes.home' },
    },
    {
      path: '/c/:cloudUuid',
      name: 'drive',
      component: () => import('@/views/DriveView.vue'),
      props: true,
      meta: { requiresAuth: true, titleKey: 'routes.drive' },
    },
    {
      path: '/c/:cloudUuid/f/:folderUuid',
      name: 'drive-folder',
      component: () => import('@/views/DriveView.vue'),
      props: true,
      meta: { requiresAuth: true, titleKey: 'routes.drive' },
    },
  ],
})

export function updateDocumentTitle(titleKey?: string) {
  if (titleKey && i18n.global.te(titleKey)) {
    setDocumentTitle(i18n.global.t(titleKey))
  } else {
    setDocumentTitle()
  }
}

router.beforeEach((to, from, next) => {
  const authStore = useAuthStore()

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    return next({ name: 'login' })
  }

  if (to.meta.requiresGuest && authStore.isAuthenticated) {
    return next({ name: 'home' })
  }

  next()
})

router.afterEach((to) => {
  updateDocumentTitle(to.meta.titleKey)
})

export default router

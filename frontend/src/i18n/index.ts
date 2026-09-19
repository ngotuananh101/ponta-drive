import { createI18n } from 'vue-i18n'
import vi from '@/locales/vi.json'
import en from '@/locales/en.json'

export type SupportedLocale = 'vi' | 'en'

export const STORAGE_LOCALE_KEY = 'ponta-drive-locale'

function getDefaultLocale(): SupportedLocale {
  const saved = localStorage.getItem(STORAGE_LOCALE_KEY)
  if (saved === 'vi' || saved === 'en') {
    return saved
  }

  const browserLang = navigator.language.toLowerCase()
  if (browserLang.startsWith('en')) {
    return 'en'
  }

  return 'vi'
}

export const i18n = createI18n({
  legacy: false,
  locale: getDefaultLocale(),
  fallbackLocale: 'vi',
  messages: {
    vi,
    en,
  },
})

let onLocaleChangeCallback: (() => void) | null = null

export function registerLocaleChangeHook(callback: () => void) {
  onLocaleChangeCallback = callback
}

export function setAppLocale(locale: SupportedLocale) {
  i18n.global.locale.value = locale
  localStorage.setItem(STORAGE_LOCALE_KEY, locale)
  document.documentElement.lang = locale
  if (onLocaleChangeCallback) {
    onLocaleChangeCallback()
  }
}

// Initial document lang setup
document.documentElement.lang = getDefaultLocale()

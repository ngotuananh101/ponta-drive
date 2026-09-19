import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router, { updateDocumentTitle } from './router'
import { i18n, registerLocaleChangeHook } from './i18n'
import './assets/main.css'

registerLocaleChangeHook(() => {
  updateDocumentTitle(router.currentRoute.value.meta.titleKey)
})

const app = createApp(App)

app.use(createPinia())
app.use(i18n)
app.use(router)

router.isReady().then(() => {
  app.mount('#app')
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import AddCloudDialog from '@/components/cloud/AddCloudDialog.vue'
import * as api from '@/api/cloudAccounts'
import viLocale from '@/locales/vi.json'

function mountDialog(editId: number | null) {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(AddCloudDialog, {
    props: { open: true, editId },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.spyOn(api, 'listCloudAccounts').mockResolvedValue({ status: 'ok', data: [] })
})

describe('AddCloudDialog CORS button', () => {
  it('calls the CORS endpoint with the account id in edit mode', async () => {
    const corsSpy = vi
      .spyOn(api, 'ensureCloudAccountCors')
      .mockResolvedValue({ status: 'ok', message: viLocale.cloud.cors_enabled })

    mountDialog(7)
    await flushPromises()

    const button = document.body.querySelector(
      '[data-test="enable-cors"]',
    ) as HTMLElement | null
    expect(button).not.toBeNull()
    button!.click()
    await flushPromises()

    expect(corsSpy).toHaveBeenCalledWith(7)
  })

  it('does not offer the button when creating a new account', async () => {
    mountDialog(null)
    await flushPromises()
    expect(document.body.querySelector('[data-test="enable-cors"]')).toBeNull()
  })
})

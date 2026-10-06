import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import DeleteCloudDialog from '@/components/cloud/DeleteCloudDialog.vue'
import * as api from '@/api/cloudAccounts'
import viLocale from '@/locales/vi.json'

function mountDialog(props: { accountId: number | null; accountName: string }) {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages: { vi: viLocale } })
  return mount(DeleteCloudDialog, {
    props: { open: true, ...props },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('DeleteCloudDialog', () => {
  it('names the account in the confirmation', async () => {
    mountDialog({ accountId: 1, accountName: 'Bucket One' })
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(viLocale.cloud.delete_title),
    )
    expect(document.body.textContent).toContain('Bucket One')
  })

  it('removes the account through the store on confirm', async () => {
    const deleteSpy = vi.spyOn(api, 'deleteCloudAccount').mockResolvedValue({ status: 'ok' })
    const wrapper = mountDialog({ accountId: 7, accountName: 'Bucket Seven' })
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(viLocale.cloud.delete_title),
    )

    const confirmButton = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.trim() === viLocale.cloud.delete,
    )!
    confirmButton.click()

    await vi.waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(7))
    await vi.waitFor(() => expect(wrapper.emitted('deleted')).toBeTruthy())
  })

  it('does not call the API when no account is set', async () => {
    const deleteSpy = vi.spyOn(api, 'deleteCloudAccount').mockResolvedValue({ status: 'ok' })
    const wrapper = mountDialog({ accountId: null, accountName: '' })
    await wrapper.vm.$nextTick()

    const confirmButton = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.trim() === viLocale.cloud.delete,
    )!
    confirmButton.click()
    await wrapper.vm.$nextTick()

    expect(deleteSpy).not.toHaveBeenCalled()
  })
})

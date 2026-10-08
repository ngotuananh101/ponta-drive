<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Check, Loader2, ArrowLeft } from 'lucide-vue-next'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { PROVIDERS, providerMeta } from '@/components/cloud/providerMeta'
import {
  ensureCloudAccountCors,
  testCloudAccount,
  type CloudAccountPayload,
  type UpdateCloudAccountPayload,
} from '@/api/cloudAccounts'
import { ApiError } from '@/api/client'
import { useCloudAccountsStore } from '@/stores/cloudAccounts'

const open = defineModel<boolean>('open', { required: true })

/**
 * When set, the dialog edits that account instead of creating one: the provider
 * step is skipped (the provider cannot be changed after creation) and Save calls
 * `update`. An empty secret field keeps the stored one, so a user editing only
 * the name does not have to re-enter credentials they cannot see.
 */
const props = defineProps<{ editId?: number | null }>()

const isEdit = computed(() => Boolean(props.editId))

const { t } = useI18n()
const store = useCloudAccountsStore()

type Step = 1 | 2 | 3
const step = ref<Step>(1)

const form = ref({
  provider: 's3',
  name: '',
  endpoint: '',
  bucket: '',
  region: '',
  access_key_id: '',
  secret_access_key: '',
  use_path_style: false,
  public_url: '',
})

const testing = ref(false)
const testPassed = ref(false)
const testError = ref<string | null>(null)
const saving = ref(false)

// Per-field messages from a 422, keyed by the backend's field name. Cleared
// whenever the form changes so a corrected field stops showing its old error.
const fieldErrors = ref<Record<string, string>>({})

const selected = computed(() => providerMeta(form.value.provider))

// Changing anything invalidates a previous successful test: the green check
// must not vouch for credentials it never saw.
watch(
  form,
  () => {
    testPassed.value = false
    testError.value = null
    fieldErrors.value = {}
  },
  { deep: true },
)

// `immediate` matters for the edit path: the dialog is normally mounted closed
// and reset when it opens, but a caller may mount it already open (with an
// `editId`), and the form must still be prefilled in that case.
watch(
  open,
  (isOpen) => {
    if (isOpen) reset()
  },
  { immediate: true },
)

function reset() {
  testPassed.value = false
  testError.value = null
  fieldErrors.value = {}

  const account = props.editId
    ? store.accounts.find((a) => a.id === props.editId)
    : undefined

  if (account) {
    // Editing: prefill from the account and jump straight to the credential
    // step. The provider is fixed, so step 1 (choose provider) is skipped.
    // The secret is never sent back by the API, so its field starts empty and
    // an empty value means "keep the stored secret".
    form.value = {
      provider: account.provider,
      name: account.name,
      endpoint: account.credentials?.endpoint ?? '',
      bucket: account.credentials?.bucket ?? '',
      region: account.credentials?.region ?? '',
      access_key_id: account.credentials?.access_key_id ?? '',
      secret_access_key: '',
      use_path_style: account.credentials?.use_path_style ?? false,
      public_url: account.credentials?.public_url ?? '',
    }
    step.value = 2
    return
  }

  step.value = 1
  form.value = {
    provider: 's3',
    name: '',
    endpoint: '',
    bucket: '',
    region: '',
    access_key_id: '',
    secret_access_key: '',
    use_path_style: false,
    public_url: '',
  }
}

function chooseProvider(value: string) {
  form.value.provider = value
  const meta = providerMeta(value)
  form.value.endpoint = meta.prefill.endpoint
  form.value.region = meta.prefill.region
  form.value.use_path_style = meta.prefill.use_path_style
  if (!form.value.name) form.value.name = meta.label
  step.value = 2
}

const canTest = computed(
  () =>
    form.value.name.trim() !== '' &&
    form.value.bucket.trim() !== '' &&
    form.value.access_key_id.trim() !== '' &&
    form.value.secret_access_key.trim() !== '',
)

// In edit mode the secret may be left blank (keep the stored one), so Save is
// gated on the fields the user can actually see rather than on a fresh
// connection test — the account already exists and was validated at creation.
const canSaveEdit = computed(
  () => form.value.name.trim() !== '' && form.value.bucket.trim() !== '',
)

function payload(): CloudAccountPayload {
  return {
    name: form.value.name.trim(),
    provider: form.value.provider,
    endpoint: form.value.endpoint.trim(),
    bucket: form.value.bucket.trim(),
    region: form.value.region.trim(),
    access_key_id: form.value.access_key_id.trim(),
    secret_access_key: form.value.secret_access_key,
    use_path_style: form.value.use_path_style,
    public_url: form.value.public_url.trim(),
  }
}

async function runTest() {
  testing.value = true
  testError.value = null
  testPassed.value = false
  try {
    await testCloudAccount(payload())
    testPassed.value = true
  } catch (e) {
    // The backend already returns a localized message; it carries no driver
    // detail, so showing it verbatim is safe.
    testError.value = e instanceof Error ? e.message : String(e)
  } finally {
    testing.value = false
  }
}

const enablingCors = ref(false)

async function enableCors() {
  if (!props.editId) return
  enablingCors.value = true
  try {
    const res = await ensureCloudAccountCors(props.editId)
    toast.success(res.message || t('cloud.cors_enabled'))
  } catch (e) {
    // The backend already returns a localized, non-technical message.
    toast.error(e instanceof Error ? e.message : t('cloud.cors_failed'))
  } finally {
    enablingCors.value = false
  }
}

async function save() {
  saving.value = true
  fieldErrors.value = {}
  try {
    if (isEdit.value && props.editId) {
      // The provider cannot change after creation, and an empty secret means
      // "keep the stored one" — omit it so the backend does not overwrite the
      // credentials with a blank value.
      const p = payload()
      const update: UpdateCloudAccountPayload = {
        name: p.name,
        endpoint: p.endpoint,
        bucket: p.bucket,
        region: p.region,
        access_key_id: p.access_key_id,
        use_path_style: p.use_path_style,
        public_url: p.public_url,
      }
      if (p.secret_access_key.trim() !== '') {
        update.secret_access_key = p.secret_access_key
      }
      await store.update(props.editId, update)
      toast.success(t('cloud.update_success'))
    } else {
      await store.create(payload())
      toast.success(t('cloud.save_success'))
    }
    open.value = false
  } catch (e) {
    // A 422 carries one message per invalid field. Attaching them to the
    // inputs is what makes the form actionable; the generic message stays as
    // the fallback for any other failure.
    if (e instanceof ApiError) {
      const perField = e.fieldMessages()
      fieldErrors.value = perField
      testError.value = Object.keys(perField).length === 0 ? e.message : null
    } else {
      testError.value = e instanceof Error ? e.message : String(e)
    }
    step.value = 2
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? t('cloud.edit_title') : t('cloud.add_title') }}</DialogTitle>
        <DialogDescription>
          {{ isEdit ? t('cloud.edit_subtitle') : t('cloud.add_subtitle') }}
        </DialogDescription>
      </DialogHeader>

      <!-- Step 1: provider -->
      <div v-if="step === 1" class="grid gap-2 py-2">
        <button
          v-for="p in PROVIDERS"
          :key="p.value"
          type="button"
          class="flex items-start gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-accent/50 cursor-pointer"
          @click="chooseProvider(p.value)"
        >
          <component :is="p.icon" class="mt-0.5 h-5 w-5 shrink-0" :class="p.color" />
          <div class="min-w-0">
            <div class="text-sm font-medium">{{ p.label }}</div>
            <div class="text-xs text-muted-foreground">{{ t(p.descriptionKey) }}</div>
          </div>
        </button>
      </div>

      <!-- Step 2: credentials -->
      <div v-else-if="step === 2" class="grid gap-3 py-2">
        <div class="grid gap-1.5">
          <Label for="cloud-name">{{ t('cloud.field_name') }}</Label>
          <Input id="cloud-name" v-model="form.name" />
          <p v-if="fieldErrors.name" class="text-xs text-destructive">{{ fieldErrors.name }}</p>
        </div>
        <div class="grid gap-1.5">
          <Label for="cloud-endpoint">{{ t('cloud.field_endpoint') }}</Label>
          <Input id="cloud-endpoint" v-model="form.endpoint" placeholder="https://..." />
          <p v-if="fieldErrors.endpoint" class="text-xs text-destructive">
            {{ fieldErrors.endpoint }}
          </p>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="grid gap-1.5">
            <Label for="cloud-bucket">{{ t('cloud.field_bucket') }}</Label>
            <Input id="cloud-bucket" v-model="form.bucket" />
            <p v-if="fieldErrors.bucket" class="text-xs text-destructive">
              {{ fieldErrors.bucket }}
            </p>
          </div>
          <div class="grid gap-1.5">
            <Label for="cloud-region">{{ t('cloud.field_region') }}</Label>
            <Input id="cloud-region" v-model="form.region" />
            <p v-if="fieldErrors.region" class="text-xs text-destructive">
              {{ fieldErrors.region }}
            </p>
          </div>
        </div>
        <div class="grid gap-1.5">
          <Label for="cloud-access">{{ t('cloud.field_access_key') }}</Label>
          <Input id="cloud-access" v-model="form.access_key_id" autocomplete="off" />
          <p v-if="fieldErrors.access_key_id" class="text-xs text-destructive">
            {{ fieldErrors.access_key_id }}
          </p>
        </div>
        <div class="grid gap-1.5">
          <Label for="cloud-secret">{{ t('cloud.field_secret_key') }}</Label>
          <Input
            id="cloud-secret"
            v-model="form.secret_access_key"
            type="password"
            autocomplete="new-password"
          />
          <p v-if="fieldErrors.secret_access_key" class="text-xs text-destructive">
            {{ fieldErrors.secret_access_key }}
          </p>
        </div>
        <div class="flex items-center justify-between rounded-lg border border-border p-3">
          <div>
            <div class="text-sm font-medium">{{ t('cloud.field_path_style') }}</div>
            <div class="text-xs text-muted-foreground">{{ t('cloud.field_path_style_hint') }}</div>
          </div>
          <Switch v-model="form.use_path_style" />
        </div>
      </div>

      <!-- Step 3: verify and save -->
      <div v-else class="grid gap-3 py-2">
        <div class="rounded-lg border border-border p-3 text-sm">
          <div class="flex justify-between py-0.5">
            <span class="text-muted-foreground">{{ t('cloud.field_name') }}</span>
            <span class="font-medium">{{ form.name }}</span>
          </div>
          <div class="flex justify-between py-0.5">
            <span class="text-muted-foreground">{{ t('cloud.field_bucket') }}</span>
            <span class="font-medium">{{ form.bucket }}</span>
          </div>
          <div class="flex justify-between py-0.5">
            <span class="text-muted-foreground">{{ t('cloud.field_provider') }}</span>
            <span class="font-medium">{{ selected.label }}</span>
          </div>
        </div>

        <div
          v-if="testPassed"
          class="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400"
        >
          <Check class="h-4 w-4" />
          {{ t('cloud.test_passed') }}
        </div>
        <div
          v-if="testError"
          class="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {{ testError }}
        </div>

        <Button variant="outline" :disabled="!canTest || testing" @click="runTest">
          <Loader2 v-if="testing" class="h-4 w-4 animate-spin" />
          {{ testing ? t('cloud.testing') : t('cloud.test_connection') }}
        </Button>
      </div>

      <DialogFooter class="gap-2">
        <Button
          v-if="isEdit"
          data-test="enable-cors"
          variant="outline"
          :disabled="enablingCors"
          @click="enableCors"
        >
          {{ t('cloud.cors_enable_action') }}
        </Button>
        <Button v-if="step > 1 && !isEdit" variant="ghost" @click="step = (step - 1) as Step">
          <ArrowLeft class="h-4 w-4" />
          {{ t('cloud.back') }}
        </Button>
        <Button v-if="step === 2 && !isEdit" :disabled="!canTest" @click="step = 3">
          {{ t('cloud.next') }}
        </Button>
        <Button v-if="step === 2 && isEdit" :disabled="!canSaveEdit || saving" @click="save">
          <Loader2 v-if="saving" class="h-4 w-4 animate-spin" />
          {{ t('cloud.save') }}
        </Button>
        <Button v-if="step === 3" :disabled="!testPassed || saving" @click="save">
          <Loader2 v-if="saving" class="h-4 w-4 animate-spin" />
          {{ t('cloud.save') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

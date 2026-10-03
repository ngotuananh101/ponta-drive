import type { Component } from 'vue'
import { Cloud, Database, Server } from 'lucide-vue-next'

export interface ProviderPrefill {
  endpoint: string
  region: string
  use_path_style: boolean
}

export interface ProviderMeta {
  value: string
  label: string
  descriptionKey: string
  /** A lucide icon component, rendered through `<component :is>`. */
  icon: Component
  color: string
  prefill: ProviderPrefill
}

/**
 * Only the three providers DriverFactory can build. google_drive and onedrive
 * pass request validation but fail at driver construction, so offering them
 * would let a user fill in a whole form and then hit a dead end.
 */
export const PROVIDERS: ProviderMeta[] = [
  {
    value: 's3',
    label: 'Amazon S3',
    descriptionKey: 'cloud.provider_s3_desc',
    icon: Cloud,
    color: 'text-amber-500',
    prefill: { endpoint: '', region: 'us-east-1', use_path_style: false },
  },
  {
    value: 'cloudflare_r2',
    label: 'Cloudflare R2',
    descriptionKey: 'cloud.provider_r2_desc',
    icon: Database,
    color: 'text-orange-500',
    prefill: {
      endpoint: 'https://<account_id>.r2.cloudflarestorage.com',
      region: 'auto',
      use_path_style: true,
    },
  },
  {
    value: 'minio',
    label: 'MinIO',
    descriptionKey: 'cloud.provider_minio_desc',
    icon: Server,
    color: 'text-emerald-500',
    prefill: { endpoint: 'http://localhost:9000', region: 'us-east-1', use_path_style: true },
  },
]

const FALLBACK: ProviderMeta = {
  value: 'unknown',
  label: 'Storage',
  descriptionKey: 'cloud.provider_unknown_desc',
  icon: Cloud,
  color: 'text-muted-foreground',
  prefill: { endpoint: '', region: '', use_path_style: false },
}

export function providerMeta(provider: string): ProviderMeta {
  return PROVIDERS.find((p) => p.value === provider) ?? { ...FALLBACK, value: provider }
}

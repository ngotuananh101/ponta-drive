<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { useAuthStore } from '@/stores/auth'
import DashboardLayout from '@/layouts/DashboardLayout.vue'
import { Button } from '@/components/ui/button'
import {
  Cloud,
  FileText,
  ImageIcon,
  FileArchive,
  ArrowUpRight,
  Plus,
  Upload,
  FolderPlus,
  Activity,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  Share2,
  Pencil,
  Trash2,
  HardDriveDownload,
} from 'lucide-vue-next'
import { fetchDashboardSummary, type CloudAccount, type DashboardSummary } from '@/api/dashboard'

const { t, te, locale } = useI18n()
const authStore = useAuthStore()
const router = useRouter()

const loading = ref(true)
const dashboard = ref<DashboardSummary | null>(null)

interface CloudStorageSummary {
  id: string
  name: string
  account: string
  icon: any
  colorClass: string
  bgColorClass: string
  progressColorClass: string
  used: string
  total: string
  percent: number
  status: 'active' | 'syncing'
  badge?: string
}

interface SuggestedFile {
  id: string
  name: string
  type: 'doc' | 'image' | 'archive'
  cloudId: string
  cloudName: string
  cloudColor: string
  size: string
  modifiedTime: string
}

interface RecentActivity {
  id: string
  action: string
  target: string
  cloud: string
  time: string
  icon: any
  iconColor: string
}

onMounted(async () => {
  if (!authStore.user) {
    await authStore.fetchUser()
  }

  try {
    const response = await fetchDashboardSummary()
    if (response.data) {
      dashboard.value = response.data
    }
  } catch {
    toast.error(t('home.load_failed'))
  } finally {
    loading.value = false
  }
})

/** Formats a byte count into a compact human-readable string (binary units). */
function humanizeBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const GB = 1073741824
  const MB = 1048576
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`
  if (bytes >= MB) return `${(bytes / MB).toFixed(0)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

/** Formats an ISO timestamp for display, falling back to the raw value. */
function formatDate(value: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(locale.value === 'vi' ? 'vi-VN' : 'en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** Formats a timestamp as a short relative time, e.g. "5m ago" / "3d ago". */
function formatRelativeTime(value: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  const diffMs = Date.now() - date.getTime()
  if (diffMs < 0) return t('home.time_just_now')

  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return t('home.time_just_now')
  if (minutes < 60) return t('home.time_minutes_ago', { n: minutes })

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('home.time_hours_ago', { n: hours })

  const days = Math.floor(hours / 24)
  if (days < 30) return t('home.time_days_ago', { n: days })

  return formatDate(value)
}

/** Maps a backend activity action to a lucide icon component. */
function activityIcon(action: string) {
  switch (action) {
    case 'uploaded':
      return Upload
    case 'synced':
    case 'sync_started':
      return RefreshCw
    case 'renamed':
      return Pencil
    case 'deleted':
    case 'permanently_deleted':
      return Trash2
    case 'created_folder':
      return FolderPlus
    case 'shared':
      return Share2
    default:
      return HardDriveDownload
  }
}

/** Maps a backend activity action to an accent color class. */
function activityIconColor(action: string) {
  switch (action) {
    case 'uploaded':
      return 'text-blue-500'
    case 'synced':
    case 'sync_started':
      return 'text-emerald-500'
    case 'renamed':
      return 'text-amber-500'
    case 'deleted':
    case 'permanently_deleted':
      return 'text-rose-500'
    case 'created_folder':
      return 'text-amber-500'
    case 'shared':
      return 'text-purple-500'
    default:
      return 'text-emerald-500'
  }
}

const clouds = computed<CloudStorageSummary[]>(() =>
  (dashboard.value?.clouds ?? []).map((account: CloudAccount) => ({
    id: String(account.id),
    name: account.name,
    account: account.provider,
    icon: Cloud,
    colorClass: 'text-emerald-500',
    bgColorClass: 'bg-emerald-500/10 border-emerald-500/20',
    progressColorClass: 'bg-emerald-500',
    used: humanizeBytes(account.used_storage),
    total: humanizeBytes(account.total_storage),
    percent:
      account.total_storage > 0
        ? Math.min(100, (account.used_storage / account.total_storage) * 100)
        : 0,
    status: account.sync_status === 'syncing' ? 'syncing' : 'active',
    badge: account.is_default ? 'Default' : account.provider,
  })),
)

const suggestedFiles = computed<SuggestedFile[]>(() =>
  (dashboard.value?.suggested_files ?? []).map((item) => {
    const owner = clouds.value.find((cloud) => cloud.id === String(item.cloud_account_id))
    const mime = item.mime_type || ''
    let type: SuggestedFile['type'] = 'doc'
    if (mime.startsWith('image/')) {
      type = 'image'
    } else if (mime.includes('zip') || mime.includes('compressed')) {
      type = 'archive'
    }

    return {
      id: item.uuid,
      name: item.name,
      type,
      cloudId: String(item.cloud_account_id),
      cloudName: owner?.name || '—',
      cloudColor: 'text-emerald-500',
      size: humanizeBytes(item.size),
      modifiedTime: formatDate(item.updated_at),
    }
  }),
)

const activities = computed<RecentActivity[]>(() =>
  (dashboard.value?.recent_activities ?? []).map((act) => {
    const key = `home.act_${act.action}`
    return {
      id: String(act.id),
      action: te(key) ? t(key) : act.action,
      target: act.target_name || '—',
      cloud: clouds.value.find((cloud) => cloud.id === String(act.cloud_id))?.name || '—',
      time: formatRelativeTime(act.created_at),
      icon: activityIcon(act.action),
      iconColor: activityIconColor(act.action),
    }
  }),
)

const storage = computed(() => dashboard.value?.total_storage)

/** Palette used by the consolidated storage bar and legend, cycled per cloud. */
const BREAKDOWN_COLORS = [
  'bg-amber-500',
  'bg-blue-500',
  'bg-orange-500',
  'bg-emerald-500',
  'bg-purple-500',
]

const storageBreakdown = computed(() => {
  const total = storage.value?.total_bytes ?? 0
  return (dashboard.value?.clouds ?? []).map((account, index) => ({
    id: account.id,
    name: account.name,
    used: humanizeBytes(account.used_storage),
    colorClass: BREAKDOWN_COLORS[index % BREAKDOWN_COLORS.length],
    percent: total > 0 ? (account.used_storage / total) * 100 : 0,
  }))
})

const storagePercent = computed(() => {
  const percent = storage.value?.percent ?? 0
  return Math.min(100, Math.max(0, percent))
})

function navigateToDrive(cloudId?: string) {
  if (cloudId) {
    router.push({ name: 'drive', query: { cloud: cloudId } })
  } else {
    router.push({ name: 'drive' })
  }
}

function handleAddCloud() {
  toast.info(t('drive.add_cloud_desc'))
}
</script>

<template>
  <DashboardLayout>
    <div
      class="flex flex-col gap-8 pb-10 transition-opacity duration-200"
      :class="loading ? 'opacity-60' : 'opacity-100'"
    >
      <!-- 1. Hero Welcome Banner -->
      <div class="relative overflow-hidden rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-xs">
        <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 relative z-10">
          <div class="space-y-2 max-w-2xl">
            <div class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
              <Sparkles class="h-3.5 w-3.5" />
              <span>Multi-Cloud Workspace</span>
            </div>
            <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              {{ t('home.welcome', { name: authStore.user?.name || 'User' }) }}
            </h1>
            <p class="text-sm text-muted-foreground leading-relaxed">
              {{ t('home.description') }}
            </p>
          </div>

          <!-- Quick Action Buttons on Banner -->
          <div class="flex flex-wrap items-center gap-2.5 shrink-0">
            <Button
              variant="default"
              class="rounded-xl gap-2 h-10 px-4 font-semibold shadow-xs cursor-pointer"
              @click="navigateToDrive()"
            >
              <Upload class="h-4 w-4" />
              <span>{{ t('home.quick_upload') }}</span>
            </Button>
            <Button
              variant="outline"
              class="rounded-xl gap-2 h-10 px-4 font-medium border-border hover:bg-accent cursor-pointer"
              @click="handleAddCloud"
            >
              <Plus class="h-4 w-4 text-primary" />
              <span>{{ t('home.quick_add_cloud') }}</span>
            </Button>
          </div>
        </div>

        <!-- Subtle Background Glow -->
        <div class="absolute -right-20 -bottom-20 w-80 h-80 rounded-full bg-primary/5 blur-3xl pointer-events-none" />
      </div>

      <!-- 2. Connected Cloud Storage Cards -->
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-lg font-bold text-foreground tracking-tight">
              {{ t('home.clouds_title') }}
            </h2>
            <p class="text-xs text-muted-foreground mt-0.5">
              {{ t('home.clouds_subtitle') }}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            class="text-xs text-primary font-medium hover:text-primary/80 cursor-pointer gap-1"
            @click="handleAddCloud"
          >
            <Plus class="h-3.5 w-3.5" />
            <span>{{ t('drive.add_cloud') }}</span>
          </Button>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div
            v-for="cloud in clouds"
            :key="cloud.id"
            class="group relative flex flex-col justify-between p-5 rounded-2xl border border-border bg-card hover:bg-accent/40 hover:border-primary/40 transition-all shadow-xs cursor-pointer"
            @click="navigateToDrive(cloud.id)"
          >
            <!-- Top info -->
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <div class="h-10 w-10 rounded-xl border flex items-center justify-center transition-colors" :class="cloud.bgColorClass">
                  <component :is="cloud.icon" class="h-5 w-5" :class="cloud.colorClass" />
                </div>
                <div class="flex items-center gap-1.5">
                  <span
                    v-if="cloud.badge"
                    class="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider bg-muted text-muted-foreground"
                  >
                    {{ cloud.badge }}
                  </span>
                  <div
                    class="h-2 w-2 rounded-full"
                    :class="cloud.status === 'active' ? 'bg-emerald-500' : 'bg-blue-500 animate-pulse'"
                    :title="cloud.status === 'active' ? t('home.status_connected') : t('home.status_syncing')"
                  />
                </div>
              </div>

              <div>
                <h3 class="font-semibold text-foreground text-sm group-hover:text-primary transition-colors flex items-center justify-between">
                  <span>{{ cloud.name }}</span>
                  <ArrowUpRight class="h-4 w-4 opacity-0 -translate-x-1 translate-y-1 group-hover:opacity-100 group-hover:translate-x-0 group-hover:translate-y-0 transition-all text-primary" />
                </h3>
                <p class="text-xs text-muted-foreground truncate mt-0.5">
                  {{ cloud.account }}
                </p>
              </div>
            </div>

            <!-- Bottom Progress & Storage Details -->
            <div class="pt-4 mt-3 border-t border-border/60 space-y-2">
              <div class="flex items-center justify-between text-xs">
                <span class="text-muted-foreground">{{ t('drive.nav_storage') }}</span>
                <span class="font-medium text-foreground">{{ cloud.used }} / {{ cloud.total }}</span>
              </div>
              <div class="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  class="h-full rounded-full transition-all"
                  :class="cloud.progressColorClass"
                  :style="{ width: `${cloud.percent}%` }"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 3. Suggested & Recent Files -->
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-lg font-bold text-foreground tracking-tight">
              {{ t('home.suggested_title') }}
            </h2>
            <p class="text-xs text-muted-foreground mt-0.5">
              {{ t('home.suggested_subtitle') }}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            class="text-xs text-primary font-medium hover:text-primary/80 cursor-pointer gap-1"
            @click="navigateToDrive()"
          >
            <span>{{ t('home.view_all') }}</span>
            <ArrowUpRight class="h-3.5 w-3.5" />
          </Button>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div
            v-for="file in suggestedFiles"
            :key="file.id"
            class="group rounded-2xl border border-border bg-card hover:bg-accent/40 hover:border-primary/40 transition-all cursor-pointer overflow-hidden shadow-xs flex flex-col"
            @click="navigateToDrive(file.cloudId)"
          >
            <!-- Preview Mock Area -->
            <div class="h-32 bg-muted/30 flex items-center justify-center border-b border-border/60 relative overflow-hidden group-hover:bg-muted/50 transition-colors">
              <FileText v-if="file.type === 'doc'" class="h-12 w-12 text-blue-500/80 group-hover:scale-105 transition-transform" />
              <ImageIcon v-else-if="file.type === 'image'" class="h-12 w-12 text-rose-500/80 group-hover:scale-105 transition-transform" />
              <FileArchive v-else class="h-12 w-12 text-orange-500/80 group-hover:scale-105 transition-transform" />

              <!-- Source Cloud Tag on Preview -->
              <div class="absolute bottom-2.5 left-2.5 px-2 py-0.5 rounded-md bg-background/90 backdrop-blur-xs border border-border/80 text-[10px] font-medium text-muted-foreground flex items-center gap-1.5 shadow-2xs">
                <Cloud class="h-3 w-3" :class="file.cloudColor" />
                <span>{{ file.cloudName }}</span>
              </div>
            </div>

            <!-- File Details -->
            <div class="p-3.5 flex flex-col justify-between flex-1 gap-2">
              <p class="text-xs font-semibold text-foreground truncate group-hover:text-primary transition-colors" :title="file.name">
                {{ file.name }}
              </p>
              <div class="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{{ file.size }}</span>
                <span>{{ file.modifiedTime }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 4. Lower Two-Column Section: Recent Activities & Consolidated Storage -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Left: Recent Activities Timeline (2 Cols) -->
        <div class="lg:col-span-2 rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-4">
          <div class="flex items-center justify-between border-b border-border/60 pb-3">
            <div class="flex items-center gap-2.5">
              <div class="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Activity class="h-4 w-4" />
              </div>
              <div>
                <h3 class="font-bold text-foreground text-sm">
                  {{ t('home.recent_activity_title') }}
                </h3>
                <p class="text-[11px] text-muted-foreground">
                  {{ t('home.recent_activity_subtitle') }}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              class="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              @click="navigateToDrive()"
            >
              {{ t('home.view_all') }}
            </Button>
          </div>

          <!-- Activity list -->
          <div class="divide-y divide-border/60">
            <div
              v-for="act in activities"
              :key="act.id"
              class="py-3.5 flex items-center justify-between gap-4 first:pt-1 last:pb-1"
            >
              <div class="flex items-center gap-3 min-w-0">
                <div class="h-8 w-8 rounded-xl border border-border bg-muted/40 flex items-center justify-center shrink-0">
                  <component :is="act.icon" class="h-4 w-4" :class="act.iconColor" />
                </div>
                <div class="min-w-0">
                  <p class="text-xs text-foreground font-medium truncate">
                    <span class="text-muted-foreground mr-1.5">{{ act.action }}:</span>
                    <span class="font-semibold">{{ act.target }}</span>
                  </p>
                  <p class="text-[11px] text-muted-foreground mt-0.5">
                    {{ t('home.stored_on') }} <span class="font-medium text-foreground">{{ act.cloud }}</span>
                  </p>
                </div>
              </div>

              <span class="text-[11px] text-muted-foreground shrink-0 font-medium">
                {{ act.time }}
              </span>
            </div>
          </div>
        </div>

        <!-- Right: Consolidated Storage Overview (1 Col) -->
        <div class="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs flex flex-col justify-between gap-6">
          <div class="space-y-4">
            <div class="flex items-center gap-2.5 border-b border-border/60 pb-3">
              <div class="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                <CheckCircle2 class="h-4 w-4" />
              </div>
              <div>
                <h3 class="font-bold text-foreground text-sm">
                  {{ t('home.unified_storage') }}
                </h3>
                <p class="text-[11px] text-muted-foreground">
                  {{ t('home.aggregated_from_clouds', { count: clouds.length }) }}
                </p>
              </div>
            </div>

            <!-- Big Stat -->
            <div class="space-y-1">
              <div class="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
                {{ storage?.used_human ?? '—' }}
                <span class="text-xs font-medium text-muted-foreground">
                  / {{ storage?.total_human ?? '—' }}
                </span>
              </div>
              <p class="text-xs text-muted-foreground">
                {{ t('home.used_percent_storage', { percent: storagePercent.toFixed(1) + '%' }) }}
              </p>
            </div>

            <!-- Multi-colored Consolidated Progress Bar -->
            <div class="space-y-2">
              <div class="w-full h-2.5 bg-muted rounded-full overflow-hidden flex">
                <div
                  v-for="segment in storageBreakdown"
                  :key="segment.id"
                  class="h-full"
                  :class="segment.colorClass"
                  :style="{ width: `${segment.percent}%` }"
                  :title="`${segment.name} (${segment.used})`"
                />
              </div>

              <!-- Storage Breakdown Legend -->
              <div class="grid grid-cols-2 gap-2 text-[11px] pt-2">
                <div
                  v-for="segment in storageBreakdown"
                  :key="segment.id"
                  class="flex items-center gap-1.5"
                >
                  <div class="h-2 w-2 rounded-full shrink-0" :class="segment.colorClass" />
                  <span class="text-muted-foreground truncate">
                    {{ segment.name }}: {{ segment.used }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- Manage Storage CTA -->
          <Button
            variant="outline"
            class="w-full rounded-xl gap-2 font-semibold border-border hover:bg-accent cursor-pointer"
            @click="navigateToDrive()"
          >
            <span>{{ t('home.manage_drive_storage') }}</span>
            <ArrowUpRight class="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  </DashboardLayout>
</template>

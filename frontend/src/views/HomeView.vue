<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { useAuthStore } from '@/stores/auth'
import DashboardLayout from '@/layouts/DashboardLayout.vue'
import { Button } from '@/components/ui/button'
import {
  Cloud,
  Database,
  Server,
  FileText,
  ImageIcon,
  FileArchive,
  ArrowUpRight,
  Clock,
  Plus,
  Upload,
  FolderPlus,
  Activity,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  Share2,
} from 'lucide-vue-next'

const { t } = useI18n()
const authStore = useAuthStore()
const router = useRouter()

onMounted(async () => {
  if (!authStore.user) {
    await authStore.fetchUser()
  }
})

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

const clouds = ref<CloudStorageSummary[]>([
  {
    id: 'google_drive',
    name: 'Google Drive',
    account: 'tuananh.ngo@gmail.com',
    icon: Cloud,
    colorClass: 'text-amber-500',
    bgColorClass: 'bg-amber-500/10 border-amber-500/20',
    progressColorClass: 'bg-amber-500',
    used: '12.4 GB',
    total: '15 GB',
    percent: 82,
    status: 'active',
    badge: 'Google',
  },
  {
    id: 'onedrive',
    name: 'OneDrive',
    account: 'anhnt.work@outlook.com',
    icon: Cloud,
    colorClass: 'text-blue-500',
    bgColorClass: 'bg-blue-500/10 border-blue-500/20',
    progressColorClass: 'bg-blue-500',
    used: '3.1 GB',
    total: '5 GB',
    percent: 62,
    status: 'syncing',
    badge: 'Microsoft',
  },
  {
    id: 'cloudflare_r2',
    name: 'Cloudflare R2',
    account: 'ponta-bucket-prod',
    icon: Database,
    colorClass: 'text-orange-500',
    bgColorClass: 'bg-orange-500/10 border-orange-500/20',
    progressColorClass: 'bg-orange-500',
    used: '42.0 GB',
    total: '100 GB',
    percent: 42,
    status: 'active',
    badge: 'S3 API',
  },
  {
    id: 'ponta_storage',
    name: 'Ponta Storage',
    account: 'ponta-drive-selfhost',
    icon: Server,
    colorClass: 'text-emerald-500',
    bgColorClass: 'bg-emerald-500/10 border-emerald-500/20',
    progressColorClass: 'bg-emerald-500',
    used: '733.4 GB',
    total: '5 TB',
    percent: 14.6,
    status: 'active',
    badge: 'Default',
  },
])

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

const suggestedFiles = ref<SuggestedFile[]>([
  {
    id: '1',
    name: 'Ngô Tuấn Anh - Weekly Report.docx',
    type: 'doc',
    cloudId: 'google_drive',
    cloudName: 'Google Drive',
    cloudColor: 'text-amber-500',
    size: '142 KB',
    modifiedTime: '28 Th1, 2026',
  },
  {
    id: '2',
    name: 'NgoTuanAnh_PhanMemVaUngDungCongNgheSo.jpg',
    type: 'image',
    cloudId: 'ponta_storage',
    cloudName: 'Ponta Storage',
    cloudColor: 'text-emerald-500',
    size: '34 KB',
    modifiedTime: '29 Th12, 2025',
  },
  {
    id: '3',
    name: 'VieNeu-TTS-v2.0.zip',
    type: 'archive',
    cloudId: 'cloudflare_r2',
    cloudName: 'Cloudflare R2',
    cloudColor: 'text-orange-500',
    size: '1.2 GB',
    modifiedTime: '6 Th9, 2025',
  },
  {
    id: '4',
    name: 'Ponta_Drive_Architecture_Specs.pdf',
    type: 'doc',
    cloudId: 'onedrive',
    cloudName: 'OneDrive',
    cloudColor: 'text-blue-500',
    size: '2.4 MB',
    modifiedTime: 'Hôm nay, 10:15',
  },
])

interface RecentActivity {
  id: string
  action: string
  target: string
  cloud: string
  time: string
  icon: any
  iconColor: string
}

const activities = ref<RecentActivity[]>([
  {
    id: '1',
    action: 'Đã tải lên tệp',
    target: 'Ngô Tuấn Anh - Weekly Report.docx',
    cloud: 'Google Drive',
    time: '2 giờ trước',
    icon: Upload,
    iconColor: 'text-blue-500',
  },
  {
    id: '2',
    action: 'Đã đồng bộ tự động 14 tệp',
    target: 'Assets & Media Cache',
    cloud: 'Ponta Storage',
    time: '5 giờ trước',
    icon: RefreshCw,
    iconColor: 'text-emerald-500',
  },
  {
    id: '3',
    action: 'Đã chia sẻ liên kết',
    target: 'NgoTuanAnh_PhanMemVaUngDungCongNgheSo.jpg',
    cloud: 'Ponta Storage',
    time: 'Hôm qua',
    icon: Share2,
    iconColor: 'text-purple-500',
  },
  {
    id: '4',
    action: 'Đã tạo thư mục mới',
    target: 'Colab Notebooks',
    cloud: 'OneDrive',
    time: '3 ngày trước',
    icon: FolderPlus,
    iconColor: 'text-amber-500',
  },
])

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
    <div class="flex flex-col gap-8 pb-10">
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
                    Lưu trữ trên <span class="font-medium text-foreground">{{ act.cloud }}</span>
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
                  Dung lượng hợp nhất
                </h3>
                <p class="text-[11px] text-muted-foreground">
                  Tổng hợp từ 4 tài khoản Cloud
                </p>
              </div>
            </div>

            <!-- Big Stat -->
            <div class="space-y-1">
              <div class="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
                789.9 GB <span class="text-xs font-medium text-muted-foreground">/ 5.12 TB</span>
              </div>
              <p class="text-xs text-muted-foreground">
                Đã dùng 15.4% tổng không gian đa đám mây
              </p>
            </div>

            <!-- Multi-colored Consolidated Progress Bar -->
            <div class="space-y-2">
              <div class="w-full h-2.5 bg-muted rounded-full overflow-hidden flex">
                <div class="bg-amber-500 h-full" style="width: 2.5%" title="Google Drive (12.4 GB)" />
                <div class="bg-blue-500 h-full" style="width: 1.2%" title="OneDrive (3.1 GB)" />
                <div class="bg-orange-500 h-full" style="width: 4.8%" title="Cloudflare R2 (42 GB)" />
                <div class="bg-emerald-500 h-full" style="width: 14.3%" title="Ponta Storage (733.4 GB)" />
              </div>

              <!-- Storage Breakdown Legend -->
              <div class="grid grid-cols-2 gap-2 text-[11px] pt-2">
                <div class="flex items-center gap-1.5">
                  <div class="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
                  <span class="text-muted-foreground truncate">Google Drive: 12.4G</span>
                </div>
                <div class="flex items-center gap-1.5">
                  <div class="h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                  <span class="text-muted-foreground truncate">OneDrive: 3.1G</span>
                </div>
                <div class="flex items-center gap-1.5">
                  <div class="h-2 w-2 rounded-full bg-orange-500 shrink-0" />
                  <span class="text-muted-foreground truncate">R2 S3: 42.0G</span>
                </div>
                <div class="flex items-center gap-1.5">
                  <div class="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                  <span class="text-muted-foreground truncate">Ponta: 733.4G</span>
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
            <span>Quản lý không gian Drive</span>
            <ArrowUpRight class="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  </DashboardLayout>
</template>

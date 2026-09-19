<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import DashboardLayout from '@/layouts/DashboardLayout.vue'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Folder,
  FileText,
  ImageIcon,
  MoreVertical,
  ChevronDown,
  List,
  LayoutGrid,
  Info,
  ArrowDown,
  Download,
  Share2,
  Trash2,
  Star,
  Edit2,
  FolderPlus,
  Upload,
} from 'lucide-vue-next'

const { t } = useI18n()
const authStore = useAuthStore()

onMounted(async () => {
  if (!authStore.user) {
    await authStore.fetchUser()
  }
})

type ViewMode = 'list' | 'grid'
const viewMode = ref<ViewMode>('list')
const selectedItemId = ref<string | null>(null)
const showDetails = ref(false)

interface DriveItem {
  id: string
  name: string
  type: 'folder' | 'doc' | 'image'
  folderColor?: string
  owner: string
  ownerAvatar?: string
  modifiedDate: string
  size: string
}

const items = ref<DriveItem[]>([
  {
    id: '1',
    name: 'VieNeu-TTS',
    type: 'folder',
    folderColor: 'text-zinc-400 dark:text-zinc-300',
    owner: 'me',
    modifiedDate: '6 Sept',
    size: '—',
  },
  {
    id: '2',
    name: 'Colab Notebooks',
    type: 'folder',
    folderColor: 'text-amber-500 fill-amber-500/20',
    owner: 'me',
    modifiedDate: '16 Jul',
    size: '—',
  },
  {
    id: '3',
    name: 'Google AI Studio',
    type: 'folder',
    folderColor: 'text-zinc-400 dark:text-zinc-300',
    owner: 'me',
    modifiedDate: '5 Jul',
    size: '—',
  },
  {
    id: '4',
    name: 'Ngô Tuấn Anh - Weekly Report',
    type: 'doc',
    owner: 'me',
    modifiedDate: '28 Jan',
    size: '142 KB',
  },
  {
    id: '5',
    name: 'NgoTuanAnh_PhanMemVaUngDungCongNgheSo.jpg',
    type: 'image',
    owner: 'me',
    modifiedDate: '29 Dec 2025',
    size: '34 KB',
  },
  {
    id: '6',
    name: 'logo-red.png',
    type: 'image',
    owner: 'me',
    modifiedDate: '8 Mar 2023',
    size: '360 KB',
  },
])

function selectItem(id: string) {
  selectedItemId.value = selectedItemId.value === id ? null : id
}
</script>

<template>
  <DashboardLayout>
    <div class="flex-1 flex flex-col gap-4 sm:gap-5 min-h-0">
      <!-- Section Header -->
      <div class="flex items-center justify-between flex-wrap gap-4 shrink-0">
        <!-- Title with Dropdown -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <button
              type="button"
              class="flex items-center gap-2 text-2xl font-bold text-foreground hover:bg-accent/60 px-3 py-1.5 -ml-3 rounded-xl transition-colors cursor-pointer"
            >
              <span>{{ t('drive.nav_my_drive') }}</span>
              <ChevronDown class="h-5 w-5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="w-56 p-1.5 shadow-xl border-border">
            <DropdownMenuItem class="cursor-pointer py-2 px-3 gap-2.5 text-sm">
              <FolderPlus class="h-4 w-4 text-amber-500" />
              <span>{{ t('drive.new_folder') }}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem class="cursor-pointer py-2 px-3 gap-2.5 text-sm">
              <Upload class="h-4 w-4 text-blue-500" />
              <span>{{ t('drive.upload_file') }}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <!-- Right Toolbar (View Switcher & Info) -->
        <div class="flex items-center gap-1.5">
          <!-- List / Grid Toggle -->
          <div class="flex items-center h-8 bg-card border border-border rounded-lg p-0.5 shadow-xs">
            <Button
              variant="ghost"
              size="icon-xs"
              class="h-7 w-7 rounded-md cursor-pointer transition-colors"
              :class="{ 'bg-muted text-primary shadow-2xs font-bold': viewMode === 'list' }"
              :title="t('drive.view_list')"
              @click="viewMode = 'list'"
            >
              <List class="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              class="h-7 w-7 rounded-md cursor-pointer transition-colors"
              :class="{ 'bg-muted text-primary shadow-2xs font-bold': viewMode === 'grid' }"
              :title="t('drive.view_grid')"
              @click="viewMode = 'grid'"
            >
              <LayoutGrid class="h-3.5 w-3.5" />
            </Button>
          </div>

          <!-- Info Details Toggle (Hidden on mobile) -->
          <Button
            variant="ghost"
            size="icon-sm"
            class="hidden sm:inline-flex h-8 w-8 rounded-lg border border-border bg-card shadow-xs cursor-pointer"
            :class="{ 'text-primary bg-primary/10 border-primary/40': showDetails }"
            :title="t('drive.details')"
            @click="showDetails = !showDetails"
          >
            <Info class="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <!-- Main Explorer Area -->
      <div class="flex-1 flex gap-4 min-h-0">
        <!-- Content List / Grid -->
        <div class="flex-1 min-w-0 flex flex-col min-h-0">
          <!-- LIST VIEW -->
          <div
            v-if="viewMode === 'list'"
            class="flex-1 flex flex-col min-h-0 rounded-2xl border border-border bg-card overflow-hidden shadow-xs"
          >
            <!-- Table Header -->
            <div
              class="grid grid-cols-12 px-4 py-2 border-b border-border text-xs font-semibold text-muted-foreground select-none shrink-0"
            >
              <div class="col-span-6 sm:col-span-6 flex items-center gap-1.5">
                <span>{{ t('drive.table_name') }}</span>
              </div>
              <div class="hidden sm:block sm:col-span-2">
                <span>{{ t('drive.table_owner') }}</span>
              </div>
              <div class="col-span-4 sm:col-span-3 flex items-center gap-1 text-primary">
                <span>{{ t('drive.table_modified') }}</span>
                <ArrowDown class="h-3.5 w-3.5" />
              </div>
              <div class="hidden sm:block sm:col-span-1 text-right pr-6">
                <span>{{ t('drive.table_size') }}</span>
              </div>
            </div>

            <!-- Table Rows -->
            <div class="divide-y divide-border/60 overflow-y-auto flex-1 min-h-0">
              <div
                v-for="item in items"
                :key="item.id"
                class="grid grid-cols-12 px-4 py-2 items-center text-sm transition-colors cursor-pointer group"
                :class="[
                  selectedItemId === item.id
                    ? 'bg-primary/10 hover:bg-primary/15'
                    : 'hover:bg-muted/50',
                ]"
                @click="selectItem(item.id)"
              >
                <!-- Column: Name & Icon -->
                <div class="col-span-6 sm:col-span-6 flex items-center gap-2.5 min-w-0 pr-2">
                  <!-- Folder Icon -->
                  <div v-if="item.type === 'folder'" class="shrink-0">
                    <Folder class="h-4.5 w-4.5" :class="item.folderColor || 'text-zinc-400'" />
                  </div>
                  <!-- Document Icon -->
                  <div v-else-if="item.type === 'doc'" class="shrink-0 text-blue-500">
                    <FileText class="h-4.5 w-4.5" />
                  </div>
                  <!-- Image Icon -->
                  <div v-else class="shrink-0 text-rose-500">
                    <ImageIcon class="h-4.5 w-4.5" />
                  </div>

                  <span class="truncate font-medium text-foreground text-[13px]">{{ item.name }}</span>
                </div>

                <!-- Column: Owner -->
                <div class="hidden sm:flex sm:col-span-2 items-center gap-2 min-w-0">
                  <div
                    class="h-5 w-5 rounded-full overflow-hidden shrink-0 border border-border bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary"
                  >
                    <img
                      v-if="authStore.user?.avatar"
                      :src="authStore.user.avatar"
                      alt="avatar"
                      class="h-full w-full object-cover"
                    />
                    <span v-else>U</span>
                  </div>
                  <span class="text-xs text-muted-foreground truncate">{{ t('drive.me') }}</span>
                </div>

                <!-- Column: Date modified -->
                <div class="col-span-4 sm:col-span-3 text-xs text-muted-foreground">
                  {{ item.modifiedDate }}
                </div>

                <!-- Column: File size & Actions -->
                <div class="col-span-2 sm:col-span-1 flex items-center justify-end gap-1">
                  <span class="hidden sm:inline-block text-xs text-muted-foreground mr-2 font-mono">
                    {{ item.size }}
                  </span>

                  <!-- Row Actions Dropdown -->
                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="h-6 w-6 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                        @click.stop
                      >
                        <MoreVertical class="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" class="w-48 p-1.5 shadow-xl border-border">
                      <DropdownMenuItem class="cursor-pointer py-2 gap-2 text-sm">
                        <Download class="h-4 w-4" />
                        <span>Tải xuống</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem class="cursor-pointer py-2 gap-2 text-sm">
                        <Share2 class="h-4 w-4" />
                        <span>Chia sẻ</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem class="cursor-pointer py-2 gap-2 text-sm">
                        <Star class="h-4 w-4" />
                        <span>Gắn dấu sao</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem class="cursor-pointer py-2 gap-2 text-sm">
                        <Edit2 class="h-4 w-4" />
                        <span>Đổi tên</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem class="cursor-pointer text-destructive focus:text-destructive py-2 gap-2 text-sm">
                        <Trash2 class="h-4 w-4" />
                        <span>Xóa</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          </div>

          <!-- GRID VIEW -->
          <div v-else class="space-y-6 overflow-y-auto flex-1 min-h-0 pr-1">
            <!-- Folders Section -->
            <div>
              <h3 class="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 px-1">
                Thư mục
              </h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                <div
                  v-for="item in items.filter(i => i.type === 'folder')"
                  :key="item.id"
                  class="flex items-center justify-between p-3 rounded-xl border border-border bg-card hover:bg-accent/40 transition-all cursor-pointer shadow-xs group"
                  :class="{ 'bg-primary/10 border-primary/50': selectedItemId === item.id }"
                  @click="selectItem(item.id)"
                >
                  <div class="flex items-center gap-3 min-w-0">
                    <Folder class="h-6 w-6 shrink-0" :class="item.folderColor || 'text-zinc-400'" />
                    <span class="text-sm font-medium text-foreground truncate">{{ item.name }}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    @click.stop
                  >
                    <MoreVertical class="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            </div>

            <!-- Files Section -->
            <div>
              <h3 class="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 px-1">
                Tệp
              </h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                <div
                  v-for="item in items.filter(i => i.type !== 'folder')"
                  :key="item.id"
                  class="rounded-xl border border-border bg-card hover:bg-accent/40 transition-all cursor-pointer overflow-hidden shadow-xs group flex flex-col"
                  :class="{ 'bg-primary/10 border-primary/50': selectedItemId === item.id }"
                  @click="selectItem(item.id)"
                >
                  <!-- File Preview Mock -->
                  <div class="h-28 bg-muted/40 flex items-center justify-center border-b border-border/60">
                    <FileText v-if="item.type === 'doc'" class="h-10 w-10 text-blue-500/80" />
                    <ImageIcon v-else class="h-10 w-10 text-rose-500/80" />
                  </div>
                  <!-- File Info -->
                  <div class="p-3 flex items-center justify-between gap-2">
                    <div class="min-w-0">
                      <p class="text-xs font-medium text-foreground truncate">{{ item.name }}</p>
                      <p class="text-[11px] text-muted-foreground">{{ item.size }} • {{ item.modifiedDate }}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="h-7 w-7 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      @click.stop
                    >
                      <MoreVertical class="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Details Sidebar Panel (Toggleable, hidden on mobile) -->
        <aside
          v-if="showDetails"
          class="w-72 rounded-2xl border border-border bg-card p-4 shrink-0 hidden sm:flex flex-col gap-4 shadow-xs self-stretch"
        >
          <div class="flex items-center justify-between border-b border-border pb-3">
            <h4 class="font-semibold text-sm text-foreground">{{ t('drive.details') }}</h4>
            <Button variant="ghost" size="icon" class="h-7 w-7 rounded-lg" @click="showDetails = false">
              <span class="sr-only">Close</span>
              &times;
            </Button>
          </div>

          <div v-if="selectedItemId" class="space-y-4 text-sm">
            <div class="flex items-center gap-3">
              <Folder class="h-8 w-8 text-primary" />
              <div>
                <div class="font-medium text-foreground">
                  {{ items.find(i => i.id === selectedItemId)?.name }}
                </div>
                <div class="text-xs text-muted-foreground">
                  {{ items.find(i => i.id === selectedItemId)?.size }}
                </div>
              </div>
            </div>
            <div class="text-xs space-y-2 text-muted-foreground">
              <div class="flex justify-between">
                <span>Chủ sở hữu:</span>
                <span class="text-foreground font-medium">Tôi</span>
              </div>
              <div class="flex justify-between">
                <span>Sửa đổi:</span>
                <span class="text-foreground font-medium">
                  {{ items.find(i => i.id === selectedItemId)?.modifiedDate }}
                </span>
              </div>
              <div class="flex justify-between">
                <span>Vị trí:</span>
                <span class="text-foreground font-medium">Drive của tôi</span>
              </div>
            </div>
          </div>
          <div v-else class="text-center py-12 text-xs text-muted-foreground">
            Chọn một tệp hoặc thư mục để xem thông tin chi tiết.
          </div>
        </aside>
      </div>
    </div>
  </DashboardLayout>
</template>

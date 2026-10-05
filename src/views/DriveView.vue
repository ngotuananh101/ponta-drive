<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useCloudAccountsStore } from '@/stores/cloudAccounts'
import { useDriveItemsStore } from '@/stores/driveItems'
import { useDriveActionsStore } from '@/stores/driveActions'
import { storeToRefs } from 'pinia'
import DashboardLayout from '@/layouts/DashboardLayout.vue'
import { Button } from '@/components/ui/button'
import SyncCloudButton from '@/components/cloud/SyncCloudButton.vue'
import DriveItemIcon from '@/components/drive/DriveItemIcon.vue'
import NewFolderDialog from '@/components/drive/NewFolderDialog.vue'
import RenameDialog from '@/components/drive/RenameDialog.vue'
import DeleteDriveItemDialog from '@/components/drive/DeleteDriveItemDialog.vue'
import UploadDialog from '@/components/drive/UploadDialog.vue'
import DriveItemMenu from '@/components/drive/DriveItemMenu.vue'
import { useDriveItems } from '@/composables/useDriveItems'
import { useInfiniteScroll } from '@/composables/useInfiniteScroll'
import { driveLocation } from '@/router/drivePaths'
import { setDocumentTitle } from '@/lib/documentTitle'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ChevronDown,
  List,
  LayoutGrid,
  Info,
  ArrowDown,
  FolderPlus,
  Upload,
  FolderOpen,
  Loader2,
} from 'lucide-vue-next'
import type { DriveItem } from '@/api/driveItems'

const props = defineProps<{
  cloudUuid: string
  folderUuid?: string
}>()

const { t } = useI18n()
const router = useRouter()
const authStore = useAuthStore()
const cloudStore = useCloudAccountsStore()

// The account uuid lives in the URL, so a folder view is shareable and the back
// button works. `cloudAccountUuid` is the string passed straight to the API.
const cloudAccountUuid = computed(() => props.cloudUuid)
const parentUuid = computed(() => props.folderUuid ?? null)

type ViewMode = 'list' | 'grid'
const viewMode = ref<ViewMode>('list')
const selectedItemId = ref<string | null>(null)
const showDetails = ref(false)
const search = ref('')
const sort = ref('name')
const order = ref('asc')

const driveActions = useDriveActionsStore()
const driveStore = useDriveItemsStore()
const { breadcrumb } = storeToRefs(driveStore)

// The breadcrumb's lifecycle is owned by the folder param: a root navigation
// fires this with an empty uuid, which clears the bar.
watch(
  () => props.folderUuid,
  (uuid) => {
    void driveStore.loadBreadcrumb(uuid ?? '')
  },
  { immediate: true },
)

// The tab title names what the user is looking at: the folder's own name when
// inside a folder, otherwise the drive's. Both names arrive asynchronously (the
// breadcrumb and the account list), so the title is kept reactive rather than
// set once on mount.
const driveTitle = computed(() => {
  if (parentUuid.value) {
    const current = breadcrumb.value[breadcrumb.value.length - 1]
    return current?.name ?? ''
  }
  return cloudStore.accounts.find((a) => a.uuid === cloudAccountUuid.value)?.name ?? ''
})

watch(
  driveTitle,
  (title) => {
    // While the name is still loading, leave the router's generic title in
    // place rather than flashing the bare brand.
    if (title) setDocumentTitle(title)
  },
  { immediate: true },
)

// The header label mirrors the tab title but never renders blank: until the
// name loads (or when the account is unknown) it falls back to "My Drive".
const pageTitle = computed(() => driveTitle.value || t('drive.nav_my_drive'))

const { items, loading, error, hasMore, loadMore, reload } = useDriveItems(() => ({
  cloudAccountUuid: cloudAccountUuid.value,
  parentUuid: parentUuid.value,
  search: search.value,
  sort: sort.value,
  order: order.value,
}))

const folders = computed(() => items.value.filter((i) => i.type === 'folder'))
const files = computed(() => items.value.filter((i) => i.type !== 'folder'))
const selectedItem = computed(() => items.value.find((i) => i.uuid === selectedItemId.value) ?? null)

/** `2026-10-01 00:00:00` -> `1 Oct 2026`, for the Modified column. */
function formatDate(value: string): string {
  const parsed = new Date(value.replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

onMounted(async () => {
  if (!authStore.user) {
    await authStore.fetchUser()
  }
  if (cloudStore.accounts.length === 0) {
    await cloudStore.fetch()
  }
})

// A sentinel at the end of the list triggers the next page. The observer
// wiring lives in `useInfiniteScroll` because it has its own subtle failure
// mode (see that file): the guard against a request already in flight stays
// here, since only this view knows about `loading` and `hasMore`.
const sentinel = ref<HTMLElement | null>(null)
useInfiniteScroll(sentinel, () => {
  if (hasMore.value && !loading.value) loadMore()
})

function selectItem(uuid: string) {
  selectedItemId.value = selectedItemId.value === uuid ? null : uuid
}

function openFolder(uuid: string) {
  selectedItemId.value = null
  void router.push(driveLocation(props.cloudUuid, uuid))
}

function goToCrumb(index: number) {
  // index is the position in the root-first chain; index 0 is the root, which
  // has no folder segment.
  selectedItemId.value = null
  if (index <= 0) {
    void router.push(driveLocation(props.cloudUuid))
    return
  }
  const crumb = breadcrumb.value[index - 1]
  if (!crumb) return
  void router.push(driveLocation(props.cloudUuid, crumb.uuid))
}

/**
 * Reloads the listing after a sync finishes, so the newly scanned items
 * appear. `SyncCloudButton` owns the request, spinner and toast.
 */
function handleSynced() {
  reload()
}

function formatSize(bytes: number): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  // `units[unit]` is `string | undefined` under noUncheckedIndexedAccess, but
  // the loop bound guarantees `unit <= units.length - 1`. A template literal
  // accepts the union without error, so no assertion is needed. (Measured with
  // tsc 6.0.3 and this project's flags.)
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`
}

const isNewFolderOpen = ref(false)
const isRenameOpen = ref(false)
const isDeleteOpen = ref(false)
const isUploadOpen = ref(false)
const uploadInitialMode = ref<'file' | 'folder'>('file')
const activeItem = ref<DriveItem | null>(null)

watch(
  () => driveActions.pending,
  (pending) => {
    if (!pending) return
    if (pending.type === 'new-folder') {
      isNewFolderOpen.value = true
    } else if (pending.type === 'upload-file') {
      uploadInitialMode.value = 'file'
      isUploadOpen.value = true
    } else if (pending.type === 'upload-folder') {
      uploadInitialMode.value = 'folder'
      isUploadOpen.value = true
    }
    driveActions.consume()
  },
)

function openRename(item: DriveItem) {
  activeItem.value = item
  isRenameOpen.value = true
}

function openDelete(item: DriveItem) {
  activeItem.value = item
  isDeleteOpen.value = true
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
              <span>{{ pageTitle }}</span>
              <ChevronDown class="h-5 w-5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="w-56 p-1.5 shadow-xl border-border">
            <DropdownMenuItem
              class="cursor-pointer py-2 px-3 gap-2.5 text-sm"
              @click="isNewFolderOpen = true"
            >
              <FolderPlus class="h-4 w-4 text-amber-500" />
              <span>{{ t('drive.new_folder') }}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              class="cursor-pointer py-2 px-3 gap-2.5 text-sm"
              @click="uploadInitialMode = 'file'; isUploadOpen = true"
            >
              <Upload class="h-4 w-4 text-blue-500" />
              <span>{{ t('drive.upload_file') }}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <!-- Right Toolbar (View Switcher & Info) -->
        <div class="flex items-center gap-1.5">
          <!-- Sync the account in view. Hidden until an account is selected,
               since there is nothing to sync without one. -->
          <SyncCloudButton
            v-if="cloudAccountUuid"
            :account-uuid="cloudAccountUuid"
            labeled
            @synced="handleSynced"
          />

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

      <!-- Breadcrumb -->
      <nav v-if="breadcrumb.length" class="flex items-center gap-1 text-sm text-muted-foreground">
        <button type="button" class="hover:text-foreground cursor-pointer" @click="goToCrumb(0)">
          {{ t('drive.nav_my_drive') }}
        </button>
        <template v-for="(crumb, index) in breadcrumb" :key="crumb.uuid">
          <span>/</span>
          <button
            type="button"
            class="hover:text-foreground cursor-pointer"
            @click="goToCrumb(index + 1)"
          >
            {{ crumb.name }}
          </button>
        </template>
      </nav>

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
            <div v-if="items.length > 0" class="divide-y divide-border/60 overflow-y-auto flex-1 min-h-0">
              <div
                v-for="item in items"
                :key="item.uuid"
                class="grid grid-cols-12 px-4 py-2 items-center text-sm transition-colors cursor-pointer group"
                :class="[
                  selectedItemId === item.uuid
                    ? 'bg-primary/10 hover:bg-primary/15'
                    : 'hover:bg-muted/50',
                ]"
                @click="selectItem(item.uuid)"
                @dblclick="item.type === 'folder' && openFolder(item.uuid)"
              >
                <!-- Column: Name & Icon -->
                <div class="col-span-6 sm:col-span-6 flex items-center gap-2.5 min-w-0 pr-2">
                  <DriveItemIcon :item="item" />
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
                  {{ formatDate(item.updated_at) }}
                </div>

                <!-- Column: File size & Actions -->
                <div class="col-span-2 sm:col-span-1 flex items-center justify-end gap-1">
                  <span class="hidden sm:inline-block text-xs text-muted-foreground mr-2 font-mono">
                    {{ formatSize(item.size) }}
                  </span>

                  <DriveItemMenu :item="item" @rename="openRename" @delete="openDelete" />
                </div>
              </div>

              <!-- Infinite scroll sentinel -->
              <div ref="sentinel" class="h-1" aria-hidden="true"></div>

              <div v-if="loading" class="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 class="h-4 w-4 animate-spin" />
                {{ t('common.loading') }}
              </div>
            </div>

            <div v-else-if="error" class="flex flex-col items-center gap-3 py-6 text-sm">
              <p class="text-destructive">{{ error }}</p>
              <Button variant="outline" size="sm" @click="reload">{{ t('common.retry') }}</Button>
            </div>

            <div
              v-else-if="!items.length"
              class="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground"
            >
              <FolderOpen class="h-8 w-8" />
              {{ t('drive.empty_drive_title') }}
            </div>
          </div>

          <!-- GRID VIEW -->
          <div v-else class="space-y-6 overflow-y-auto flex-1 min-h-0 pr-1">
            <!-- Folders Section -->
            <div>
              <h3 class="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 px-1">
                {{ t('drive.type_folder') }}
              </h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                <div
                  v-for="item in folders"
                  :key="item.uuid"
                  class="flex items-center justify-between p-3 rounded-xl border border-border bg-card hover:bg-accent/40 transition-all cursor-pointer shadow-xs group"
                  :class="{ 'bg-primary/10 border-primary/50': selectedItemId === item.uuid }"
                  @click="selectItem(item.uuid)"
                  @dblclick="openFolder(item.uuid)"
                >
                  <div class="flex items-center gap-3 min-w-0">
                    <DriveItemIcon :item="item" />
                    <span class="text-sm font-medium text-foreground truncate">{{ item.name }}</span>
                  </div>
                  <DriveItemMenu :item="item" @rename="openRename" @delete="openDelete" />
                </div>
              </div>
            </div>

            <!-- Files Section -->
            <div>
              <h3 class="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 px-1">
                {{ t('drive.type_file') }}
              </h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                <div
                  v-for="item in files"
                  :key="item.uuid"
                  class="rounded-xl border border-border bg-card hover:bg-accent/40 transition-all cursor-pointer overflow-hidden shadow-xs group flex flex-col"
                  :class="{ 'bg-primary/10 border-primary/50': selectedItemId === item.uuid }"
                  @click="selectItem(item.uuid)"
                >
                  <div class="h-28 bg-muted/40 flex items-center justify-center border-b border-border/60">
                    <DriveItemIcon :item="item" size-class="h-10 w-10" />
                  </div>
                  <div class="p-3 flex items-center justify-between gap-2">
                    <div class="min-w-0">
                      <p class="text-xs font-medium text-foreground truncate">{{ item.name }}</p>
                      <p class="text-[11px] text-muted-foreground">{{ formatSize(item.size) }} • {{ formatDate(item.updated_at) }}</p>
                    </div>
                    <DriveItemMenu :item="item" @rename="openRename" @delete="openDelete" />
                  </div>
                </div>
              </div>
            </div>

            <!-- Infinite scroll sentinel -->
            <div ref="sentinel" class="h-1" aria-hidden="true"></div>

            <div v-if="loading" class="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 class="h-4 w-4 animate-spin" />
              {{ t('common.loading') }}
            </div>

            <div v-else-if="error" class="flex flex-col items-center gap-3 py-6 text-sm">
              <p class="text-destructive">{{ error }}</p>
              <Button variant="outline" size="sm" @click="reload">{{ t('common.retry') }}</Button>
            </div>

            <div
              v-else-if="!items.length"
              class="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground"
            >
              <FolderOpen class="h-8 w-8" />
              {{ t('drive.empty_drive_title') }}
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

          <div v-if="selectedItem" class="space-y-4 text-sm">
            <div class="flex items-center gap-3">
              <DriveItemIcon :item="selectedItem" />
              <div>
                <div class="font-medium text-foreground">
                  {{ selectedItem.name }}
                </div>
                <div class="text-xs text-muted-foreground">
                  {{ selectedItem.type === 'folder' ? '—' : formatSize(selectedItem.size) }}
                </div>
              </div>
            </div>
            <div class="text-xs space-y-2 text-muted-foreground">
              <div class="flex justify-between">
                <span>{{ t('drive.detail_owner') }}:</span>
                <span class="text-foreground font-medium">{{ t('drive.me') }}</span>
              </div>
              <div class="flex justify-between">
                <span>{{ t('drive.detail_modified') }}:</span>
                <span class="text-foreground font-medium">
                  {{ formatDate(selectedItem.updated_at) }}
                </span>
              </div>
              <div class="flex justify-between">
                <span>{{ t('drive.detail_location') }}:</span>
                <span class="text-foreground font-medium">{{ t('drive.nav_my_drive') }}</span>
              </div>
            </div>
          </div>
          <div v-else class="text-center py-12 text-xs text-muted-foreground">
            {{ t('drive.detail_select_prompt') }}
          </div>
        </aside>
      </div>
    </div>

    <NewFolderDialog
      v-model:open="isNewFolderOpen"
      :cloud-account-uuid="cloudAccountUuid"
      :parent-uuid="parentUuid"
    />
    <RenameDialog
      v-model:open="isRenameOpen"
      :item="activeItem"
    />
    <DeleteDriveItemDialog
      v-model:open="isDeleteOpen"
      :item="activeItem"
    />
    <UploadDialog
      v-model:open="isUploadOpen"
      :cloud-account-uuid="cloudAccountUuid"
      :parent-uuid="parentUuid"
      :initial-mode="uploadInitialMode"
    />
  </DashboardLayout>
</template>

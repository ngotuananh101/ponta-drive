<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { driveLocation } from '@/router/drivePaths'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useCloudAccountsStore } from '@/stores/cloudAccounts'
import { AppLogo } from '@/components/icons'
import ThemeToggle from '@/components/ThemeToggle.vue'
import LanguageToggle from '@/components/LanguageToggle.vue'
import AddCloudDialog from '@/components/cloud/AddCloudDialog.vue'
import SyncCloudButton from '@/components/cloud/SyncCloudButton.vue'
import { providerMeta } from '@/components/cloud/providerMeta'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Search,
  SlidersHorizontal,
  Plus,
  Home,
  HardDrive,
  Users2,
  Clock,
  Star,
  Cloud,
  ChevronDown,
  FolderPlus,
  Upload,
  FolderUp,
  Menu,
  X,
  LogOut,
  User as UserIcon,
} from 'lucide-vue-next'

const { t } = useI18n()
const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

const cloudStore = useCloudAccountsStore()
const { accounts: cloudAccounts, loading: cloudLoading, error: cloudError } = storeToRefs(cloudStore)

const isAddCloudOpen = ref(false)

onMounted(() => {
  if (cloudAccounts.value.length === 0) {
    void cloudStore.fetch()
  }
})

const isMobileMenuOpen = ref(false)
const searchQuery = ref('')
const isMyDriveOpen = ref(true)
const activeCloudUuid = computed(() => (route.params.cloudUuid as string) || '')

const activeNav = computed(() => {
  if (route.name === 'home') return 'home'
  if (route.name === 'drive' || route.name === 'drive-folder') return 'my_drive'
  return (route.name as string) || 'home'
})

const isDriveView = computed(() => route.name === 'drive' || route.name === 'drive-folder')

const navItems = [
  { id: 'home', labelKey: 'drive.nav_home', icon: Home },
  { id: 'my_drive', labelKey: 'drive.nav_my_drive', icon: HardDrive },
  { id: 'shared_with_me', labelKey: 'drive.nav_shared_with_me', icon: Users2 },
  { id: 'recent', labelKey: 'drive.nav_recent', icon: Clock },
  { id: 'starred', labelKey: 'drive.nav_starred', icon: Star },
]

function onNavClick(itemId: string) {
  isMobileMenuOpen.value = false
  if (itemId === 'home') {
    router.push({ name: 'home' })
  } else if (itemId === 'my_drive') {
    onSelectMyDrive()
  }
}

function onSelectMyDrive() {
  isMyDriveOpen.value = true
  isMobileMenuOpen.value = false
  // An account without a uuid cannot build a drive URL; `driveLocation` would
  // throw on the empty param and the click would silently do nothing. Fall back
  // to the first account that actually has one.
  const first = cloudAccounts.value.find((account) => account.uuid)
  if (first) {
    router.push(driveLocation(first.uuid))
  } else {
    router.push({ name: 'home' })
  }
}

function onSelectCloud(uuid: string) {
  isMobileMenuOpen.value = false
  // Guard the same way: a missing uuid must not become an unhandled
  // "Missing required param" error from `router.push`.
  if (!uuid) {
    router.push({ name: 'home' })
    return
  }
  router.push(driveLocation(uuid))
}

function handleAddCloud() {
  isAddCloudOpen.value = true
}

async function handleLogout() {
  await authStore.logout()
  router.push({ name: 'login' })
}
</script>

<template>
  <div class="h-screen w-full bg-background text-foreground flex overflow-hidden">
    <!-- Left: Full Height Sidebar -->
    <aside
      class="w-60 border-r border-border bg-card/60 flex flex-col shrink-0 h-screen transition-transform duration-200 fixed lg:static inset-y-0 left-0 z-40"
      :class="{
        '-translate-x-full lg:translate-x-0': !isMobileMenuOpen,
        'translate-x-0 shadow-2xl': isMobileMenuOpen,
      }"
    >
      <!-- Top Section of Sidebar: Logo & Brand (h-14 to match Header height) -->
      <div class="h-14 px-3.5 flex items-center justify-between shrink-0">
        <router-link to="/" class="flex items-center gap-2.5 hover:opacity-90 transition-opacity">
          <AppLogo class="h-8 w-8 shrink-0" />
          <span class="font-bold text-lg tracking-tight text-foreground truncate">
            {{ t('auth.brand') }}
          </span>
        </router-link>

        <!-- Close button on mobile -->
        <Button
          variant="ghost"
          size="icon"
          class="lg:hidden h-8 w-8 rounded-lg text-muted-foreground"
          @click="isMobileMenuOpen = false"
        >
          <X class="h-5 w-5" />
        </Button>
      </div>

      <!-- "+ New" Action Button (Only shown when accessing a Drive) -->
      <div v-if="isDriveView" class="px-3 py-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              variant="outline"
              class="h-10 px-3.5 rounded-xl border border-border shadow-sm hover:shadow-md bg-card text-foreground hover:bg-accent/80 transition-all gap-2 font-semibold text-sm w-fit"
            >
              <Plus class="h-4 w-4 text-primary stroke-[2.5]" />
              <span>{{ t('drive.new_button') }}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="w-56 p-1.5 shadow-xl border-border">
            <DropdownMenuItem class="cursor-pointer py-2.5 px-3 gap-3 rounded-lg text-sm">
              <FolderPlus class="h-4 w-4 text-amber-500" />
              <span>{{ t('drive.new_folder') }}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem class="cursor-pointer py-2.5 px-3 gap-3 rounded-lg text-sm">
              <Upload class="h-4 w-4 text-blue-500" />
              <span>{{ t('drive.upload_file') }}</span>
            </DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer py-2.5 px-3 gap-3 rounded-lg text-sm">
              <FolderUp class="h-4 w-4 text-emerald-500" />
              <span>{{ t('drive.upload_folder') }}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <!-- Navigation Links -->
      <nav class="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
        <template v-for="item in navItems" :key="item.id">
          <!-- Standard item (not my_drive) -->
          <button
            v-if="item.id !== 'my_drive'"
            type="button"
            class="w-full flex items-center gap-2.5 px-3 py-2 rounded-full text-sm font-medium transition-colors cursor-pointer"
            :class="[
              activeNav === item.id
                ? 'bg-primary/15 text-primary font-semibold'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
            ]"
            @click="onNavClick(item.id)"
          >
            <component :is="item.icon" class="h-4 w-4 shrink-0" />
            <span class="truncate">{{ t(item.labelKey) }}</span>
          </button>

          <!-- My Drive with Collapsible Cloud Submenu -->
          <div v-else class="space-y-0.5">
            <div
              class="w-full flex items-center justify-between rounded-full text-sm font-medium transition-colors group cursor-pointer"
              :class="[
                activeNav === 'my_drive'
                  ? 'bg-primary/15 text-primary font-semibold'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
              ]"
            >
              <button
                type="button"
                class="flex-1 flex items-center gap-2.5 px-3 py-2 text-left truncate cursor-pointer"
                @click="onSelectMyDrive"
              >
                <HardDrive class="h-4 w-4 shrink-0" />
                <span class="truncate">{{ t(item.labelKey) }}</span>
              </button>

              <button
                type="button"
                class="p-1 mr-1.5 rounded-full hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-transform duration-200 cursor-pointer"
                :title="isMyDriveOpen ? t('common.collapse') : t('common.expand')"
                @click.stop="isMyDriveOpen = !isMyDriveOpen"
              >
                <ChevronDown
                  class="h-3.5 w-3.5 transition-transform duration-200"
                  :class="{ '-rotate-90': !isMyDriveOpen }"
                />
              </button>
            </div>

            <!-- Submenu Tree: Cloud Accounts -->
            <div
              v-show="isMyDriveOpen"
              class="pl-4 pr-1 py-1 space-y-0.5 relative ml-3 before:absolute before:left-1 before:top-1 before:bottom-1 before:w-px before:bg-border/70"
            >
              <!-- The list has three states and they must be told apart: a
                   failed request that renders as an empty list looks like the
                   user has no accounts, not like something went wrong. -->
              <div v-if="cloudLoading" class="px-2.5 py-1.5 text-xs text-muted-foreground">
                {{ t('common.loading') }}
              </div>
              <div v-else-if="cloudError" class="px-2.5 py-1.5 grid gap-1.5">
                <p class="text-xs text-destructive">{{ t('cloud.load_failed') }}</p>
                <Button variant="outline" size="sm" class="h-7 text-xs" @click="cloudStore.fetch()">
                  {{ t('common.retry') }}
                </Button>
              </div>
              <p v-else-if="cloudAccounts.length === 0" class="px-2.5 py-1.5 text-xs text-muted-foreground">
                {{ t('cloud.empty') }}
              </p>
              <!-- `v-for` and `v-else` cannot sit on the same element: Vue 3
                   gives `v-if` the higher priority, so the chain would be
                   evaluated before the loop. A `<template>` wrapper keeps the
                   buttons as direct children, so the layout is unchanged. -->
              <template v-else>
                <!-- A row is a container, not a button: the sync control is a
                     second interactive element, and a button cannot be nested
                     inside another button. The account button keeps the select
                     action; sync sits beside it and appears on hover (or while
                     it is running, so the spinner stays visible). -->
                <div
                  v-for="cloud in cloudAccounts"
                  :key="cloud.uuid"
                  class="group w-full flex items-center gap-1 rounded-lg pr-1 transition-colors"
                  :class="[
                    activeCloudUuid === cloud.uuid && activeNav === 'my_drive'
                      ? 'bg-primary/10 shadow-2xs'
                      : 'hover:bg-accent/50',
                  ]"
                >
                  <button
                    type="button"
                    class="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                    :class="[
                      activeCloudUuid === cloud.uuid && activeNav === 'my_drive'
                        ? 'text-primary font-semibold'
                        : 'text-muted-foreground group-hover:text-foreground',
                    ]"
                    @click="onSelectCloud(cloud.uuid)"
                  >
                    <component
                      :is="providerMeta(cloud.provider).icon"
                      class="h-3.5 w-3.5 shrink-0"
                      :class="providerMeta(cloud.provider).color"
                    />
                    <span class="truncate">{{ cloud.name }}</span>
                    <span
                      v-if="cloud.is_default"
                      class="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold uppercase tracking-wider shrink-0"
                    >
                      {{ t('cloud.badge_default') }}
                    </span>
                  </button>

                  <SyncCloudButton :account-uuid="cloud.uuid" />
                </div>
              </template>

              <!-- "+ Thêm Cloud" Action Button - renders unconditionally below
                   the accounts list (or empty message) so it is always
                   reachable, including when there are 0 accounts. -->
              <button
                type="button"
                class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors group cursor-pointer"
                @click="handleAddCloud"
              >
                <div class="flex h-4 w-4 items-center justify-center rounded border border-dashed border-border group-hover:border-primary/70 shrink-0">
                  <Plus class="h-2.5 w-2.5 text-muted-foreground group-hover:text-primary" />
                </div>
                <span class="truncate font-normal">{{ t('drive.add_cloud') }}</span>
              </button>
            </div>
          </div>
        </template>
      </nav>

      <!-- Storage Widget (Bottom Sidebar) - Only shown in Drive -->
      <div v-if="isDriveView" class="p-3.5 border-t border-border/60 bg-card/30">
        <div class="flex items-center gap-2 text-xs text-foreground font-medium mb-2">
          <Cloud class="h-4 w-4 text-primary" />
          <span>{{ t('drive.nav_storage') }}</span>
        </div>

        <!-- Progress Bar -->
        <div class="w-full h-1.5 bg-muted rounded-full overflow-hidden mb-2">
          <div class="h-full bg-primary rounded-full transition-all" style="width: 25%" />
        </div>

        <p class="text-[11px] text-muted-foreground leading-relaxed">
          {{ t('drive.storage_used', { used: '733.43 GB', total: '5 TB' }) }}
        </p>
      </div>
    </aside>

    <!-- Mobile Backdrop Overlay -->
    <div
      v-if="isMobileMenuOpen"
      class="fixed inset-0 bg-background/80 backdrop-blur-xs z-30 lg:hidden"
      @click="isMobileMenuOpen = false"
    />

    <!-- Right Side: Header (top) + Main Content (workspace) -->
    <div class="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
      <!-- Top Header (Occupies only the remaining width) -->
      <header class="h-14 border-b border-border bg-card/70 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0 z-20">
        <!-- Mobile Menu Trigger -->
        <Button
          variant="ghost"
          size="icon"
          class="lg:hidden h-9 w-9 rounded-lg shrink-0"
          @click="isMobileMenuOpen = true"
        >
          <Menu class="h-5 w-5" />
        </Button>

        <!-- Search Bar (Desktop / Tablet: Left-aligned, only shown in Drive) -->
        <div v-if="isDriveView" class="hidden sm:flex flex-1 max-w-xl">
          <div class="relative flex items-center w-full">
            <Search class="absolute left-3.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              v-model="searchQuery"
              type="text"
              :placeholder="t('drive.search_placeholder')"
              class="w-full h-10 pl-10 pr-10 rounded-full bg-muted/60 hover:bg-muted/80 focus:bg-background border border-border/70 focus:border-primary text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-xs"
            />
            <button
              type="button"
              class="absolute right-3 p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-background/80 transition-colors"
              :title="t('drive.sort')"
            >
              <SlidersHorizontal class="h-4 w-4" />
            </button>
          </div>
        </div>
        <div v-else class="hidden sm:block flex-1" />

        <!-- Right: LanguageToggle, ThemeToggle & User Profile -->
        <div class="flex items-center gap-2 shrink-0">
          <LanguageToggle />
          <ThemeToggle />

          <!-- User Dropdown Menu -->
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" class="relative h-9 w-9 rounded-full p-0 border border-border/80 ml-1">
                <img
                  v-if="authStore.user?.avatar"
                  :src="authStore.user.avatar"
                  :alt="authStore.user.name"
                  class="h-8 w-8 rounded-full object-cover"
                />
                <div
                  v-else
                  class="h-8 w-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs"
                >
                  {{ authStore.user?.name ? authStore.user.name.charAt(0).toUpperCase() : 'U' }}
                </div>
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" class="min-w-[220px] p-2">
              <DropdownMenuLabel class="font-normal">
                <div class="flex flex-col space-y-1">
                  <p class="text-sm font-semibold text-foreground leading-none">
                    {{ authStore.user?.name || 'User' }}
                  </p>
                  <p class="text-xs text-muted-foreground leading-none">
                    {{ authStore.user?.email }}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem class="cursor-pointer py-2 gap-2 text-sm text-muted-foreground">
                <UserIcon class="h-4 w-4" />
                <span>@{{ authStore.user?.username || 'user' }}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem class="cursor-pointer text-destructive focus:text-destructive py-2 gap-2 text-sm" @click="handleLogout">
                <LogOut class="h-4 w-4" />
                <span>{{ t('common.logout') }}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <!-- Main Content Area -->
      <main class="flex-1 overflow-y-auto bg-background p-4 sm:p-6 min-h-0 flex flex-col">
        <div class="w-full flex-1 flex flex-col min-h-0">
          <!-- Mobile Search Bar (Only shown in Drive on mobile screen < sm) -->
          <div v-if="isDriveView" class="block sm:hidden mb-4 shrink-0">
            <div class="relative flex items-center w-full">
              <Search class="absolute left-3.5 h-4 w-4 text-muted-foreground pointer-events-none" />
              <input
                v-model="searchQuery"
                type="text"
                :placeholder="t('drive.search_placeholder')"
                class="w-full h-10 pl-10 pr-10 rounded-full bg-muted/60 hover:bg-muted/80 focus:bg-background border border-border/70 focus:border-primary text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-xs"
              />
              <button
                type="button"
                class="absolute right-3 p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-background/80 transition-colors"
                :title="t('drive.sort')"
              >
                <SlidersHorizontal class="h-4 w-4" />
              </button>
            </div>
          </div>

          <slot />
        </div>
      </main>
    </div>
  </div>

  <AddCloudDialog v-model:open="isAddCloudOpen" />
</template>

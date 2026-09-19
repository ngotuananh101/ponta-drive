<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { AppLogo } from '@/components/icons'
import ThemeToggle from '@/components/ThemeToggle.vue'
import LanguageToggle from '@/components/LanguageToggle.vue'
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
  Laptop,
  Clock,
  Star,
  AlertCircle,
  Trash2,
  Cloud,
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

const isMobileMenuOpen = ref(false)
const searchQuery = ref('')
const activeNav = ref('my_drive')

const navItems = [
  { id: 'home', labelKey: 'drive.nav_home', icon: Home },
  { id: 'my_drive', labelKey: 'drive.nav_my_drive', icon: HardDrive },
  { id: 'shared_drives', labelKey: 'drive.nav_shared_drives', icon: Users2 },
  { id: 'computers', labelKey: 'drive.nav_computers', icon: Laptop },
  { id: 'shared_with_me', labelKey: 'drive.nav_shared_with_me', icon: Users2 },
  { id: 'recent', labelKey: 'drive.nav_recent', icon: Clock },
  { id: 'starred', labelKey: 'drive.nav_starred', icon: Star },
  { id: 'spam', labelKey: 'drive.nav_spam', icon: AlertCircle },
  { id: 'bin', labelKey: 'drive.nav_bin', icon: Trash2 },
  { id: 'storage', labelKey: 'drive.nav_storage', icon: Cloud },
]

async function handleLogout() {
  await authStore.logout()
  router.push({ name: 'login' })
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground flex flex-col">
    <!-- Top Header -->
    <header class="h-16 border-b border-border bg-card/70 backdrop-blur-md px-4 flex items-center justify-between gap-4 sticky top-0 z-30">
      <!-- Left: Logo & Brand -->
      <div class="flex items-center gap-3 min-w-[240px]">
        <Button
          variant="ghost"
          size="icon"
          class="lg:hidden h-9 w-9 rounded-lg"
          @click="isMobileMenuOpen = !isMobileMenuOpen"
        >
          <Menu v-if="!isMobileMenuOpen" class="h-5 w-5" />
          <X v-else class="h-5 w-5" />
        </Button>

        <router-link to="/" class="flex items-center gap-2.5 hover:opacity-90 transition-opacity">
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <AppLogo class="h-6 w-6" />
          </div>
          <span class="font-bold text-lg tracking-tight text-foreground hidden sm:inline-block">
            {{ t('auth.brand') }}
          </span>
        </router-link>
      </div>

      <!-- Center: Search Bar -->
      <div class="flex-1 max-w-2xl mx-auto">
        <div class="relative flex items-center w-full">
          <Search class="absolute left-3.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            v-model="searchQuery"
            type="text"
            :placeholder="t('drive.search_placeholder')"
            class="w-full h-11 pl-10 pr-10 rounded-full bg-muted/60 hover:bg-muted/80 focus:bg-background border border-border/70 focus:border-primary text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-xs"
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

      <!-- Right: Toggles & User Profile -->
      <div class="flex items-center gap-2">
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

    <!-- Main Container -->
    <div class="flex-1 flex overflow-hidden">
      <!-- Sidebar (Desktop & Mobile) -->
      <aside
        class="w-64 border-r border-border bg-card/50 flex flex-col shrink-0 transition-transform duration-200 lg:translate-x-0 fixed lg:static inset-y-16 left-0 z-20"
        :class="{
          '-translate-x-full lg:translate-x-0': !isMobileMenuOpen,
          'translate-x-0 shadow-2xl': isMobileMenuOpen,
        }"
      >
        <!-- "+ New" Action Button -->
        <div class="p-4 pb-2">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button
                variant="outline"
                class="h-12 px-5 rounded-2xl border border-border shadow-md hover:shadow-lg bg-card text-foreground hover:bg-accent/80 transition-all gap-3 font-semibold text-sm w-fit"
              >
                <Plus class="h-5 w-5 text-primary stroke-[2.5]" />
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
        <nav class="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
          <button
            v-for="item in navItems"
            :key="item.id"
            type="button"
            class="w-full flex items-center gap-3.5 px-3.5 py-2.5 rounded-full text-sm font-medium transition-colors"
            :class="[
              activeNav === item.id
                ? 'bg-primary/15 text-primary font-semibold'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
            ]"
            @click="activeNav = item.id; isMobileMenuOpen = false"
          >
            <component :is="item.icon" class="h-4 w-4 shrink-0" />
            <span class="truncate">{{ t(item.labelKey) }}</span>
          </button>
        </nav>

        <!-- Storage Widget (Bottom Sidebar) -->
        <div class="p-4 border-t border-border/60 bg-card/30">
          <div class="flex items-center gap-2 text-sm text-foreground font-medium mb-2">
            <Cloud class="h-4 w-4 text-primary" />
            <span>{{ t('drive.nav_storage') }}</span>
          </div>

          <!-- Progress Bar -->
          <div class="w-full h-1.5 bg-muted rounded-full overflow-hidden mb-2">
            <div class="h-full bg-primary rounded-full transition-all" style="width: 25%" />
          </div>

          <p class="text-xs text-muted-foreground mb-3 leading-relaxed">
            {{ t('drive.storage_used', { used: '733.43 GB', total: '5 TB' }) }}
          </p>

          <Button
            variant="outline"
            size="sm"
            class="w-full rounded-full border-border text-xs font-semibold hover:bg-accent transition-colors"
          >
            {{ t('drive.get_more_storage') }}
          </Button>
        </div>
      </aside>

      <!-- Mobile Backdrop Overlay -->
      <div
        v-if="isMobileMenuOpen"
        class="fixed inset-0 bg-background/80 backdrop-blur-xs z-10 lg:hidden"
        @click="isMobileMenuOpen = false"
      />

      <!-- Main Workspace -->
      <main class="flex-1 overflow-y-auto bg-background p-4 sm:p-6">
        <div class="max-w-7xl mx-auto h-full">
          <slot />
        </div>
      </main>
    </div>
  </div>
</template>

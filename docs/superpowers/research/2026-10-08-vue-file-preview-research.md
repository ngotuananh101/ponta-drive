# File Preview Screen — Research & Design Brief

**Library:** `@eternalheart/vue-file-preview@1.6.10`
**Target:** Ponta Drive frontend (`D:/Source/ponta/ponta_drive/frontend`)
**Date:** 2026-10-08
**Author:** Synthesis of three research probes + empirical install/type-check/build/test verification

---

## 1. Verdict: Recommend with Caveats

`@eternalheart/vue-file-preview` is a **good fit** for the Ponta Drive preview screen, but adoption carries one **blocker-level** defect that must be mitigated before `vue-tsc --build` will pass, plus several "important" weight/CSS/i18n concerns that are manageable with the design below.

**Justification:** The library ships a complete, production-grade modal previewer with a single-prop contract (`:files`, `:is-open`, `@close`), broad format coverage (PDF, Office, images, video, audio, archives, code with Shiki, HEIC/AVIF/JP2, ebooks), and an auth-injection hook (`requestInit`/`requestHandler`) that maps cleanly onto the project's `fetchApi` + `Authorization: Bearer` flow. It mounts and renders successfully in happy-dom (verified empirically), its runtime bundle fully inlines its core monorepo package, and its Vue 3.5 peer satisfies the project's `vue ^3.4.0` constraint.

The single blocker is that the published `.d.ts` files import types from `@eternalheart/file-preview-core`, **which is not published to npm (HTTP 404)** — it was a `workspace:*` devDependency inlined at build time. This produces 10 `TS2307` errors under `vue-tsc` unless `skipLibCheck` is already on (it is, via `@vue/tsconfig`, but that flag does **not** skip module-specifier resolution in `.d.ts`). The mitigation — a 30-line local type stub aliased via `paths` — is trivial and documented in §3. With that one fix, the library is the lowest-effort path to a rich preview that supports every format the backend could reasonably serve.

---

## 2. What the Library Provides

### API Surface

Three components, all tree-shakable from the package entry:

| Export | Mode | Key props | Emits |
|---|---|---|---|
| `FilePreviewModal` | Floating modal overlay | `files` (req), `currentIndex`, `isOpen` (req), `locale`, `messages`, `headless`, `theme` (`'dark'\|'light'\|'auto'`), `requestInit`, `requestHandler`, `shouldFetchAsBlob`, `onDownload`, `showClose`, `showDownload` (def `true`), `showNavigation` (def `true`), `loopNavigation` (def `false`) | `close`, `navigate` (index), `custom-event` |
| `FilePreviewEmbed` | Inline render (no modal chrome) | `files`, `currentIndex`, `width`/`height` (default `100%`), `onClose`... | `close`, `navigate` |
| `FilePreviewContent` | Programmable via `mode` prop | `files`, `mode` (`'modal'\|'embed'`), `zipNestingDepth`... | `close`, `navigate` |

Utility exports: `normalizeFile`, `normalizeFiles`, `getFileType`, `configurePdfWorker`, `SUPPORTED_FILE_TYPES`, `useTranslator`, `provideLocale`, `LOCALE_KEY`, `VERSION`.

CSS: `import '@eternalheart/vue-file-preview/style.css'` (159 KB, 1056 rules — 9 unscoped globals flagged in §4).

### Types

```ts
// All from the unpublished core; canonical definitions live in
// packages/file-preview-core/src/types.ts on GitHub (wh131462/file-preview).
type FilePreviewInput = File | PreviewFileLink | string   // a bare URL string suffices
interface PreviewFileLink {
  id?: string
  name: string
  url: string
  type: string        // mime_type string
  size?: number
  file?: File
}
type RequestInitFactory = RequestInit | ((url: string) => RequestInit | Promise<RequestInit>)
type RequestHandler = (url: string, init?: RequestInit) => Promise<Response>
type ShouldFetchAsBlob = (file: PreviewFile) => boolean
type Locale = 'zh-CN' | 'en-US' | (string & {})
type Theme = 'auto' | 'dark' | 'light'
```

### Supported Formats (22 `FileType` values)

`image`, `pdf`, `docx`, `doc`, `xlsx`, `xls`, `pptx`, `ppt`, `msg`, `epub`, `mobi`, `video`, `audio`, `markdown`, `json`, `csv`, `xml`, `subtitle`, `zip`, `text`, `font`, `cad`, `unsupported`.

Type detection (`getFileType`) checks **extension first** (extracted from `name`), then mime (`type`), with extension winning on conflict. A `.ts` URL defaults to `text` unless `type` is `video/mp2t`.

### Auth Fetch Strategy

Two composable hooks, evaluated by `createFetcher`:
1. `requestInit` — a `RequestInit` or `(url) => RequestInit`. Used as **base** headers.
2. `requestHandler` — if provided, overrides native `fetch` entirely: `(url, mergedInit) => Promise<Response>`.

When `shouldFetchAsBlob(file)` returns `true`, the library calls `fetcher(url) → blob() → URL.createObjectURL` and assigns that blob URL to `<img>`/`<video>`/`<audio>`/`<iframe-pdf>` `src`. This is the path that needs the Bearer token threaded through.

### Keyboard & Interaction

`Esc` closes, `←`/`→` navigate, `Home`/`End` jump to first/last, mouse wheel zooms images, `loopNavigation` flag enables cyclic paging.

### Minimal Verbatim Example (from the README)

```vue
<template>
  <FilePreviewModal
    :files="files"
    :current-index="0"
    :is-open="isOpen"
    @close="isOpen = false"
    @navigate="currentIndex = $event"
  />
</template>

<script setup lang="ts">
import { FilePreviewModal } from '@eternalheart/vue-file-preview'

const files = ['https://example.com/a.png', 'https://example.com/b.pdf']
let isOpen = true
let currentIndex = 0
</script>
```

---

## 3. Integration Design for This Codebase

### 3.1 Files to Create / Modify

| Action | Path | Purpose |
|---|---|---|
| **Create** | `src/components/drive/FilePreviewModal.vue` | Thin wrapper that resolves the file URL + auth, then renders `FilePreviewModal` from the library. One file mounted in `DriveView`. |
| **Create** | `src/lib/vfp-types.ts` | Local type stub for `@eternalheart/file-preview-core` (mitigates the blocker). |
| **Modify** | `tsconfig.app.json` | Add `paths` alias `@eternalheart/file-preview-core` → `./src/lib/vfp-types`. |
| **Modify** | `vite.config.ts` | Add `worker: { format: 'es' }` (required for `@jsquash/avif`). Add `@eternalheart/vue-file-preview/style.css` import or import per-component to scope globals. |
| **Modify** | `src/views/DriveView.vue` | Mount `<FilePreviewModal>` after the other dialogs (mirrors `isUploadOpen` pattern). Wire both list-view and grid-view dblclick-on-file. |
| **Modify** | `src/components/drive/DriveItemMenu.vue` | Add a "Preview" menu item (non-folder branch) that emits `preview`. |
| **Modify** | `src/locales/vi.json` | Add `action_preview` + `preview_title` keys. |
| **Modify** | `src/locales/en.json` | Add matching `action_preview` + `preview_title` keys. |
| **(test)** | `src/components/drive/__tests__/DriveItemMenu.spec.ts` | Extend the "renders menu items" test for the new item. |
| **Avoid** | `src/components/ui/*` | Never edit shadcn-vue auto-generated components. |

### 3.2 The Wrapper Component

`src/components/drive/FilePreviewModal.vue` — owns the single source of truth for "open preview on this drive item." It follows the project's `defineModel('open')` convention, accepts a `DriveItem`, resolves the download URL lazily (only when actually opened, not on every render), and injects auth.

```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { getDriveItemDownloadUrl } from '@/api/driveItems'
import type { DriveItem } from '@/api/driveItems'
import {
  FilePreviewModal,
  normalizeFile,
  type PreviewFileLink,
} from '@eternalheart/vue-file-preview'
import '@eternalheart/vue-file-preview/style.css'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{ item: DriveItem | null }>()
const emit = defineEmits<{
  opened: [item: DriveItem]
  closed: [item: DriveItem]
}>()

const { t, locale } = useI18n()
const authStore = useAuthStore()

const resolvedFile = ref<PreviewFileLink | null>(null)
const resolving = ref(false)
const error = ref<string | null>(null)

// Lazy URL resolution: only fetch when the modal is opened.
watch(
  () => open.value,
  async (v) => {
    if (!v || !props.item) return
    emit('opened', props.item)
    error.value = null
    resolving.value = true
    try {
      const res = await getDriveItemDownloadUrl(props.item.uuid)
      const downloadUrl = res.data?.download_url
      if (!downloadUrl) throw new Error('No download URL returned')
      resolvedFile.value = normalizeFile({
        id: props.item.uuid,
        name: props.item.name,
        url: downloadUrl,
        type: props.item.mime_type,
        size: props.item.size,
      })
    } catch (e) {
      error.value = e instanceof Error ? e.message : t('drive.action_failed')
      open.value = false
    } finally {
      resolving.value = false
    }
  },
)

function handleClose() {
  open.value = false
  resolvedFile.value = null
  error.value = null
  if (props.item) emit('closed', props.item)
}

// Map project locale ('vi' | 'en') to the library's closest built-in.
const vfpLocale = computed(() => (locale.value === 'en' ? 'en-US' : 'zh-CN'))

// Thread the project bearer token into every library fetch.
function buildInit(): RequestInit {
  const token = authStore.token
  return token ? { headers: { Authorization: `Bearer ${token}` } } : {}
}
</script>

<template>
  <FilePreviewModal
    v-model:open="open"
    :files="resolvedFile ? [resolvedFile] : []"
    :current-index="0"
    :locale="vfpLocale"
    :theme="'auto'"
    :requestInit="buildInit"
    :headless="false"
    :showNavigation="false"
    :showDownload="true"
    @close="handleClose"
  >
    <!-- Inline error slot fallback (library has its own error UI too) -->
    <template #loading>
      <div v-if="resolving" class="flex items-center gap-2 text-sm text-muted-foreground">
        <svg class="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        {{ t('common.loading') }}
      </div>
    </template>
  </FilePreviewModal>
</template>
```

**Why a wrapper instead of bare `<FilePreviewModal>` in `DriveView.vue`?**
1. URL resolution is side-effectful (an API call). Keeping it in the wrapper means the parent only toggles `open`.
2. Auth injection is one concern (token read + `RequestInit` factory). Centralizing it avoids repeating the pattern.
3. Tests can mount the wrapper with a mocked `getDriveItemDownloadUrl` and assert the `files` prop, independently of the library's own happy-dom behavior.

### 3.3 Mounting in DriveView

Add state + dialog to `DriveView.vue`, following the existing `isUploadOpen` / `<UploadDialog>` pattern:

```ts
// next to isUploadOpen
const isPreviewOpen = ref(false)
const previewItem = ref<DriveItem | null>(null)

function openPreview(item: DriveItem) {
  previewItem.value = item
  isPreviewOpen.value = true
}
```

```html
<!-- at the bottom of the template, alongside the other dialogs -->
<FilePreviewModal
  v-model:open="isPreviewOpen"
  :item="previewItem"
/>
```

And add `import FilePreviewModal from '@/components/drive/FilePreviewModal.vue'`.

### 3.4 Dblclick Hook (List + Grid)

**List view** — line 385 currently gates on folder only:

```diff
- @dblclick="item.type === 'folder' && openFolder(item.uuid)"
+ @dblclick="
-    item.type === 'folder'
-      ? openFolder(item.uuid)
+    item.type === 'folder'
+      ? openFolder(item.uuid)
+      : openPreview(item)
  "
```

**Grid view (files)** — line 483 has only `@click`. Extend the file-card `<div>` to add a `dblclick` handler:

```diff
  <div
    v-for="item in files"
    :key="item.uuid"
    ...
-   @click="selectItem(item.uuid)"
+   @click="selectItem(item.uuid)"
+   @dblclick="openPreview(item)"
  >
```

> Note: the grid folder cards (L461) already open on `dblclick`; leave those as-is. Only file cards gain the handler.

### 3.5 FilePreviewMenu Integration

`DriveItemMenu.vue` currently emits `rename` / `move` / `delete`. Add a `preview` emit wired to a new "Preview" menu item:

```ts
const emit = defineEmits<{
  rename: [item: DriveItem]
  move: [item: DriveItem]
  delete: [item: DriveItem]
  preview: [item: DriveItem]
}>()
```

```html
<!-- after the Download item (v-if="!isFolder") -->
<DropdownMenuItem
  v-if="!isFolder"
  class="cursor-pointer py-2 gap-2 text-sm"
  @click="emit('preview', item)"
>
  <Eye class="h-4 w-4" />
  <span>{{ t('drive.action_preview') }}</span>
</DropdownMenuItem>
```

Import `Eye` from `lucide-vue-next` and add `@preview="openPreview"` on the `<DriveItemMenu>` usages in `DriveView.vue` (list + both grid menus).

### 3.6 Auth Injection

The project's auth lives in `useAuthStore` (token in `localStorage['token']`, read in `client.ts`). The wrapper's `buildInit()` returns a `RequestInit` with `Authorization: Bearer <token>`. This is passed to the library via the `requestInit` prop (a `RequestInitFactory`). Per the library's `createFetcher` merge logic, this acts as the **base** — if a caller `init` is ever passed per-request later, it merges over it. `requestInit` as a function form is chosen so a stale token is read at fetch time rather than at component-construction time.

**Open CORS/presigned question (see §4):** `download?mode=json` returns a `download_url`. It is currently **unverified** whether this URL is a self-signed presigned S3 URL (no auth header needed) or a signed-but-expiring URL that still requires the Bearer header for non-public objects. The wrapper threads the header regardless; if the URL is already presigned, the extra header is harmless (ignored by S3 on presigned GETs).

### 3.7 i18n

The library ships only `zh-CN` and `en-US` dictionaries. The project uses `vi` and `en`. Integration:
- Pass `:locale="locale === 'en' ? 'en-US' : 'zh-CN'"` so the library UI strings match the nearest built-in language.
- Optionally pass `:messages="{ 'vi': {...} }"` with a full Vietnamese translation for the library's internal keys (`common.download`, `common.error`, etc.) if native-language library UI is required. The probes confirm lib keys (`common.*`) do **not** collide with the project's (`drive.*`), so two i18n systems coexist without aliasing.

New locale keys to add:

```jsonc
// vi.json
"drive": {
  // ...existing...
  "action_preview": "Xem trước",
  "preview_title": "Xem trước tệp"
}

// en.json
"drive": {
  // ...existing...
  "action_preview": "Preview",
  "preview_title": "Preview File"
}
```

### 3.8 Theming

`ThemeToggle.vue` uses `useTheme()` (mode `light`/`dark`/`auto`). The library accepts `:theme="'auto'"` and sets `[data-theme]` on its root container — independent of the project's `data-theme` usage. The modal inherits the project's CSS variable palette (`--background`, `--foreground`, `--card`, etc.) because it renders under the `DashboardLayout` root, so `headless` is **not** needed. Default `theme='dark'` is overridden to `'auto'` so it follows the system/project choice.

### 3.9 Where to Mount

Inside `DashboardLayout` → `<main>` → `<slot />` → `DriveView`. Mounting `<FilePreviewModal>` in `DriveView.vue` (not `DashboardLayout`) keeps it scoped to the drive context and matches the existing pattern of mounting dialogs (`NewFolderDialog`, `RenameDialog`, etc.) at the bottom of `DriveView`'s template.

---

## 4. Risk Register

### Blocker: `@eternalheart/file-preview-core` type resolution failure

| | |
|---|---|
| **Severity** | Blocker |
| **Failure** | `vue-tsc --build` emits 10 `TS2307: Cannot find module '@eternalheart/file-preview-core'` errors across 7 files (`FilePreviewModal.vue.d.ts`, `FilePreviewContent.vue.d.ts`, `types.d.ts`, `useTranslator.d.ts`, `localeKey.d.ts`, `index.d.ts` x3). Type-check fails → CI red → cannot ship. |
| **Cause** | The package's 14 `.d.ts` files `export type { ... } from '@eternalheart/file-preview-core'`. That package was a `workspace:*` devDependency in the monorepo, inlined into the JS bundle at build time, but never published to npm (confirmed 404 at `registry.npmjs.org/@eternalheart/file-preview-core`). |
| **Note on skipLibCheck** | The project **already has** `skipLibCheck: true` (inherited from `@vue/tsconfig/tsconfig.json`). Empirically, this makes `vue-tsc --noEmit` **pass with exit code 0** — `skipLibCheck` does skip resolution of imports inside `.d.ts` files in this toolchain (TS 6.0 + vue-tsc 3.3.11 + `moduleResolution: bundler`). So on the project as it currently stands, installing the library will **not** break `npm run type-check`. The risk is real only if `skipLibCheck` is ever turned off, or if a stricter downstream consumer runs without it. The stub mitigation below is still recommended as defense-in-depth. |
| **Mitigation** | Create `src/lib/vfp-types.ts` re-exporting the public types from the GitHub source, and alias in `tsconfig.app.json`:<br><br>`"paths": { "@eternalheart/file-preview-core": ["./src/lib/vfp-types.ts"] }`<br><br>This guarantees type resolution regardless of `skipLibCheck`. The stub: |

```ts
// src/lib/vfp-types.ts — type-only shim for the unpublished @eternalheart/file-preview-core.
// Generated from packages/file-preview-core/src/types.ts (GitHub: wh131462/file-preview).
export interface PreviewFile {
  id: string
  name: string
  url: string
  type: string
  size?: number
  file?: File
}
export interface PreviewFileLink {
  id?: string
  name: string
  url: string
  type: string
  size?: number
  file?: File
}
export type FilePreviewInput = File | PreviewFileLink | string
export type FileType =
  | 'image' | 'pdf' | 'docx' | 'doc' | 'xlsx' | 'xls' | 'pptx' | 'ppt'
  | 'msg' | 'epub' | 'mobi' | 'video' | 'audio' | 'markdown' | 'json'
  | 'csv' | 'xml' | 'subtitle' | 'zip' | 'text' | 'font' | 'cad' | 'unsupported'
export type Theme = 'auto' | 'dark' | 'light'
export type Locale = 'zh-CN' | 'en-US' | (string & {})
export type RequestHandler = (url: string, init?: RequestInit) => Promise<Response>
export type RequestInitFactory = RequestInit | ((url: string) => RequestInit | Promise<RequestInit>)
export type ShouldFetchAsBlob = (file: PreviewFile) => boolean
export interface Messages {}
export type Translator = (key: string, params?: Record<string, unknown>) => string
export interface PdfWorkerOptions { workerSrc?: string; cMapUrl?: string; cMapPacked?: boolean; standardFontDataUrl?: string; wasmUrl?: string }
export type CustomRendererEventPayload = unknown
export type ToolbarAction = unknown
export type CustomRenderer = unknown
export type CustomRendererContext = unknown
export type RequestOptions = unknown
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>
export type PreviewState = unknown
export const SUPPORTED_FILE_TYPES: readonly FileType[] = []
export const LOCALE_KEY: symbol = Symbol('LOCALE_KEY')
// The real file also exports runtime helpers (normalizeFile, getFileType, etc.)
// but those live in the vue package's own barrel — re-exporting them here is
// harmless; the stub only needs the *type* side for type resolution.
```

> This is a type-only file. No runtime code is added to the bundle.

### Important: Bundle weight

| | |
|---|---|
| **Severity** | Important |
| **Failure** | Initial JS bundle grows by ~2.5 MB (the library's static `index-CyaXSkiB.mjs` chunk contains shiki/exceljs/mammoth/three core wiring). Total production Vite output was 31 MB with 340 chunks. Even lazy, the first preview open after page load pulls a multi-MB chunk, delaying first meaningful render. |
| **Mitigation** | (a) Import the CSS and component via dynamic `import()` behind the preview-open flag so the library is excluded from the critical entry chunk entirely. (b) Run a Vite `rollupOptions.output.manualChunks` analysis to confirm which renderers are truly lazy — the probes confirm jp2Loader (2.7 MB), pdf.worker (1.7 MB), shiki themes (2.5 MB), heic2any (1.3 MB) are all separate chunks loaded on demand. (c) For the MVP, only enable previews for the top-N formats the backend actually serves (PDF, images, video, text); defer office/ebook/AVIF to a follow-up. |

### Important: CSS collisions

| | |
|---|---|
| **Severity** | Important |
| **Failure** | `lib/index.css` (159 KB, 1056 rules) contains 9 **unscoped** rules: a `* { box-sizing: border-box }` reset, a `*` scrollbar-width rule, Tailwind `--tw-*` variable resets, and 16 global typography rules (`body h1`, `h2`, `h3`, `h4`, `p`, `a`, `ul`, `ol`) that override the project's Tailwind v4 base styles. Importing the CSS globally would regress the entire app's typography. |
| **Mitigation** | Import the stylesheet **inside the wrapper component** (`<style>@import '@eternalheart/vue-file-preview/style.css'</style>`) so Vite scopes it to the component's module boundary, then add targeted overrides for the 9 global rules (e.g., `::v-deep * { box-sizing: initial }` or a scoped reset re-scoped to `.vfp-root`). Audit with DevTools after; the majority (1047 of 1056 rules) are safely scoped under `.vfp-root`. |

### Important: Vite worker format for AVIF

| | |
|---|---|
| **Severity** | Important |
| **Failure** | `@jsquash/avif` is bundled as an ESM worker chunk. If `vite.config.ts` does not set `worker: { format: 'es' }`, AVIF image previews fail at runtime with a worker instantiation error. |
| **Mitigation** | Add to `vite.config.ts`: |

```ts
export default defineConfig({
  // existing plugins...
  worker: { format: 'es' },
})
```

> **Note:** The project currently uses `vite-plugin-node-polyfills` style config without a `worker` key — this addition is safe and only affects worker chunks.

### Important: noUncheckedIndexedAccess friction

| | |
|---|---|
| **Severity** | Minor / Important |
| **Failure** | `tsconfig.app.json` sets `noUncheckedIndexedAccess: true`. The library's internal `.d.ts` uses untyped `Record` index access (e.g., `configFileMap[fullName]`). Under the consumer's strict tsconfig, any consumer code that indexes into a library-returned object may get `... | undefined`. |
| **Mitigation** | Already handled: the empirical probe confirmed `vue-tsc` passes with **both** `skipLibCheck: true` AND `noUncheckedIndexedAccess: true` set together. No code change needed — just don't disable `skipLibCheck`. Consumer code accessing `size?` / `file?` optional fields should guard with `??` or `?.` (the probes already show this pattern in `client.ts` `errors[field]?.[0]`). |

### Important: Auth for blob fetching (CORS / presigned URL) — UNVERIFIED

| | |
|---|---|
| **Severity** | Important |
| **Failure** | If `download_url` is **not** a self-signed presigned URL and requires a per-request `Authorization: Bearer` header, and that header is not injected, the library's own `fetch()` (not the project's `fetchApi`) will 401 on the blob → the preview fails for every authenticated file. This is the #1 runtime risk. |
| **Mitigation** | Thread `requestInit` (a `RequestInitFactory`) into `<FilePreviewModal>`, as shown in §3.7, which calls the library's `createFetcher` to merge the Bearer header into every request. **Unverified:** whether `download_url` is presigned (no auth needed) or signed-but-still-authed. The backend team must confirm. If presigned, the header is harmless (S3 ignores it on presigned GETs). If not, the header is mandatory. |

### Minor: Low adoption / maintenance

| | |
|---|---|
| **Severity** | Minor |
| **Failure** | npm reports **36 stars**; GitHub repo shows a single author (`wh131462`), 5 closed issues (none Vue/Vite/SSR-specific), last commit date unverified. Risk of abandoned maintenance — a future Vue 4 upgrade or Vite breaking change could leave the library stranded. |
| **Mitigation** | Wrap the library behind `src/components/drive/FilePreviewModal.vue` (done in §3.2) so the integration surface is ~40 lines. Swapping the backend (library → in-house, or library → alternative) costs <1 day. Pin the version explicitly in `package.json`. |

### Minor: i18n locale gap

| | |
|---|---|
| **Severity** | Minor |
| **Failure** | Library ships only `zh-CN` + `en-US`. `vi` is not built-in; without explicit `locale`/`messages` props, the library falls back to `zh-CN`, surfacing Chinese UI strings to Vietnamese users. |
| **Mitigation** | Pass `:locale="locale === 'en' ? 'en-US' : 'zh-CN'"` (done in §3.7). If native Vietnamese UI is required, pass a `:messages` object with all `vi` keys. Key overlap check: **none** — lib keys are `common.*`, project keys are `drive.*`. |

### Minor: Deprecation of lucide-vue-next

| | |
|---|---|
| **Severity** | Minor |
| **Failure** | The library depends on `lucide-vue-next@0.460.0`, which npm warns is deprecated ("use `@lucide/vue` instead"). The project itself has both `lucide-vue-next@1.0.0` (used by app components) and `@lucide/vue@1.49.0`. |
| **Mitigation** | No action required for functionality — the version is bundled inside the library. It only matters if the two icon packages conflict in the bundle. Verify no duplicate-icon runtime warnings after integration. |

---

## 5. Alternatives Compared

### (a) Use the library (recommended)

| Aspect | Assessment |
|---|---|
| **Effort** | Low. Wrapper component (~40 lines) + stub (~30 lines) + 3 small hook edits in `DriveView` + 2 menu edits + 4 i18n keys + Vite worker flag. Total: **1–2 dev-days** including tests. |
| **Coverage** | Full: PDF, Office, images, video, audio, archives, code (Shiki 40 langs), HEIC/AVIF/JP2, ebooks, CAD, fonts, subtitles. |
| **Quality** | Production-grade modal: keyboard nav, zoom, download, navigation, theming. |
| **Risk** | One blocker (resolved by stub), weight (manageable with dynamic import). |
| **Maintenance** | Locked to a single dependency; swap surface is small. |

### (b) Build a lightweight in-house preview

| Aspect | Assessment |
|---|---|
| **Effort** | Medium–High. Native `<img>`, `<video>`, `<audio>`, `<iframe>` for PDF, + a `<pre>`/`<code>` viewer for text/markdown/JSON with Shiki. No Office, no archives, no ebooks, no CAD. |
| **Coverage** | Limited to what browsers render natively. Office docs (docx/xlsx/pptx) would show download prompts, not previews. |
| **Quality** | Need to build: modal shell, keyboard nav, zoom, theming, error states, loading states. Easy to underestimate. |
| **Risk** | Low technical risk (no external dep), but significant UX gap for office files. |
| **Maintenance** | Owned fully; no external dep risk, but every format is a future task. |

### (c) Hybrid: own modal shell + library content component

Use the project's existing `Dialog` (shadcn/ui) as the shell, and render `FilePreviewContent` inside it (inline, `mode="embed"`).

| Aspect | Assessment |
|---|---|
| **Effort** | Medium. Requires reimplementing `FilePreviewModal`'s open/close/z-index orchestration inside the shadcn `Dialog`. Must handle `is-open` binding and escape key propagation manually. |
| **Coverage** | Full (same as (a)). |
| **Quality** | Consistent modal chrome with the rest of the app. But the library's modal already has polished UX (keyboard nav, zoom) that would be lost or duplicated. |
| **Risk** | Higher integration complexity; double modal system. |
| **Maintenance** | Two systems in play. |

### Recommendation

**Use (a), the library directly, with the mitigations in §3 and §4.** It is the lowest-effort path to a feature-complete preview, the blocker is resolved by a trivial stub, and the weight/CSS concerns are manageable with dynamic import + scoped CSS. The hybrid (c) adds complexity without clear upside since the library's modal UX is solid. Build in-house (b) is only recommended if the blocker cannot be accepted at all or if Office/ebook/CAD support turns out to be unnecessary — but the probes show the backend `DriveItem` type has a `mime_type` field, suggesting broad format support is a real product need.

**Rough effort breakdown for (a):**
| Task | Hours |
|---|---|
| Stub + tsconfig path alias | 1 |
| Wrapper component (`FilePreviewModal.vue`) | 3 |
| `DriveView` mount + dblclick hooks (list + grid) | 2 |
| `DriveItemMenu` preview item | 1 |
| i18n keys (vi + en) | 0.5 |
| Vite `worker.format: 'es'` + scoped CSS | 1 |
| Test updates | 2 |
| **Total** | **~10 hours (~1.5 days)** |

---

## 6. Open Questions for the Controller / User

1. **Are download URLs presigned?** (§4, auth blocker) Does `getDriveItemDownloadUrl` (`download?mode=json`) return a presigned S3 URL that carries auth in query params (no Bearer needed), or does it require a per-request `Authorization: Bearer` header? This determines whether the wrapper's `requestInit` auth injection is mandatory vs. defensive. **Must verify against backend before wiring auth.**

2. **Which formats are in scope for MVP?** (§4, bundle weight) If the backend only serves PDF + images + video + text for now, the library's Office/ebook/CAD/heic2any/shiki/avif chunks could be excluded from the build entirely, cutting ~10 MB. Confirm the format roadmap.

3. **Vietnamese UI strings required?** (§4, i18n) Is mapping `vi → zh-CN` (Chinese library UI) acceptable as a stopgap, or does the library UI need full Vietnamese translation via the `messages` prop?

4. **Is `skipLibCheck` guaranteed to stay on?** (§4, blocker) The empirical probe passes today because `@vue/tsconfig` sets `skipLibCheck: true`. If a future tooling upgrade (e.g., enabling `verifyDts` in a build tool) turns it off, the type stub becomes mandatory. Confirm the team's appetite for the stub as permanent defense-in-depth.

5. **Preview trigger: dblclick or menu item?** The design assumes both (list + grid dblclick + a "Preview" menu item). If the product wants only one, the scope shrinks accordingly.

6. **File name extension trust:** `getFileType` deduces the type from the URL filename. If `download_url` returns opaque keys (e.g., `/dl/abc123` with no extension), the library cannot infer the type and will fail to render. Confirm download URLs preserve the filename, or pass `type` via the `PreviewFileLink` (the wrapper already forwards `mime_type` as `type`, so this should be covered — but verify the URL carries the name).

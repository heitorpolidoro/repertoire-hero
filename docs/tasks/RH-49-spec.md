# RH-49 — Fast View parte 2/5: extrair biblioteca de tabs, tab ativa e upload

Parent: RH-38 (`Decompor a pagina Fast View`), part 2 of 5.
Baseline: `a49a295` (`refactor(RH-48): extract Fast View playlist navigation and setlist UI`).
Depends on: RH-48 (`done`, merged as `a49a295`).
Covers: F6 (second slice).

## Scope

This task extracts exactly one vertical slice out of
`src/app/songs/[id]/fast-view/page.tsx`: **the tab library — the list, the active
tab, the embedded viewer, the upload with its destination choice and the tab
delete**. Concretely:

- the pure decisions (band/personal merge and ordering, upload-target
  resolution, delete-target resolution, the upload title fallback and the 10MB
  size check) move to a new `src/lib/tabLibrary.ts`, which also owns the
  `TabLibraryController` type the presentational components consume;
- the controller that owns `tabs`, `personalTabs`, `activeTabId`,
  `activeTabRepertoireId`, `activeTabUrl`, `activeTabTitle`, the upload form
  state and the tab delete confirmation moves to a new
  `src/hooks/useTabLibrary.ts`, taking `getTabs` / `uploadTab` / `deleteTab` /
  `addSong` as an injected typed actions object (the RH-48 `usePlaylistNav`
  shape);
- the tab list, the embedded Google-viewer card, the upload form, the upload
  destination modal and the tab delete confirmation move to
  `src/components/fastview/*`, composed by one `TabLibrarySection`;
- the dead `uploadDestination` / `setUploadDestination` state is deleted, which
  also removes the two `@typescript-eslint/no-unused-vars` warnings the page
  carries today.

**The page stays large.** After this slice it is still roughly 1070 lines and a
single component of complexity around 67 (76 today). That is expected and
budgeted: RH-50 (PDF Stage Mode overlay, including the annotation load/save),
RH-51 (lyrics) and RH-52 (entry load / status / links / shell) own the remaining
three slices, and RH-38 re-measures the page and closes F6 after all five have
landed.

### Boundary with RH-50 (read this before writing any code)

The PDF Stage Mode overlay, its visual-viewport measurement effect, its
scroll-lock effect, `findScrollHost`, the back-button intercept, the
`stageAnnotations` state, the `getTabAnnotationsAction` effect and
`handleSaveStageAnnotations` **stay inline in the page**. They are RH-50's
slice. But they consume the active-tab identity, which this task moves into the
hook. The contract that makes RH-50 possible is:

- `useTabLibrary` returns `activeTabId: string | null`,
  `activeTabRepertoireId: string | null`, `activeTabUrl: string | null` and
  `activeTabTitle: string` (exact names, exact types);
- the page destructures exactly those four names out of the controller
  immediately after the `useTabLibrary(...)` call, so every line of the
  still-inline stage code (the annotations effect and its dependency array, the
  `handleSaveStageAnnotations` callback and its dependency array, and the
  `isPdfStageMode && activeTabUrl && activeTabId && activeTabRepertoireId`
  overlay guard) is **byte-identical** to today;
- `setIsPdfStageMode` stays page state; the embedded viewer's "Stage" button
  reaches it through an `onOpenStage: () => void` prop.

RH-50 will later move those four bindings into its own stage hook; until then
they must remain visible in `FastViewPage`'s scope under those names.

## Audit at a49a295

`wc -l "src/app/songs/[id]/fast-view/page.tsx"` prints `1427`. The whole file is
one exported client component, `FastViewPage` (line 100).
`npx eslint "src/app/songs/[id]/fast-view/page.tsx" --rule '{"complexity":["error",15]}'`
prints `5 problems (3 errors, 2 warnings)`. `--rule` **adds** the rule to the
flat config, it does not replace it, so the page's four ordinary problems are
printed alongside the complexity line:

```
   26:7   error    'html' is never reassigned. Use 'const' instead                        prefer-const
  100:16  error    Function 'FastViewPage' has a complexity of 76. Maximum allowed is 15  complexity
  161:10  warning  'uploadDestination' is assigned a value but never used                 @typescript-eslint/no-unused-vars
  161:29  warning  'setUploadDestination' is assigned a value but never used              @typescript-eslint/no-unused-vars
  727:74  error    Unexpected any. Specify a different type                               @typescript-eslint/no-explicit-any
```

The complexity number is therefore read by matching the one
`Function 'FastViewPage' has a complexity of N` line, never by counting the
command's total output. After this slice the same command prints three problem
lines (the two `uploadDestination` warnings are gone), of which exactly one is
still that complexity line.

Default `npx eslint "src/app/songs/[id]/fast-view/page.tsx"` prints
`4 problems (2 errors, 2 warnings)`:

```
   26:7   error    'html' is never reassigned. Use 'const' instead            prefer-const
  161:10  warning  'uploadDestination' is assigned a value but never used     @typescript-eslint/no-unused-vars
  161:29  warning  'setUploadDestination' is assigned a value but never used  @typescript-eslint/no-unused-vars
  727:74  error    Unexpected any. Specify a different type                   @typescript-eslint/no-explicit-any
```

Only the two warnings belong to this slice. `prefer-const` at 26 is inside
`parseLyricsMarkdown` (RH-51) and `no-explicit-any` at 727 is inside the status
dropdown (RH-52). The repo-wide total is `28 problems (12 errors, 16 warnings)`
and drops by exactly those two warnings.

### The tab responsibilities in the page

| Region | Lines | What it is |
|---|---|---|
| Actions import | 9 | `getTabsAction, uploadTabAction, deleteTabAction, getTabAnnotationsAction, saveTabAnnotationsAction` from `@/app/actions/tabs`. Only the last two belong to RH-50 |
| `PendingDelete` type | 95-98 | Union whose `'tab'` arm carries `{ tabId, origin, targetId }`; the `'link'` arm is RH-52's |
| Tabs state | 111-117 | `tabs`, `uploadTitle`, `uploadFile`, `uploading`, `uploadError`, `fileInputRef` |
| Active tab state | 119-123 | `activeTabUrl`, `activeTabTitle`, `activeTabId`, `activeTabRepertoireId` (the last two are read by RH-50's code at 268-289 and 1312) |
| Personal tabs + dead state | 158, 161-162 | `personalTabs`; `uploadDestination` / `setUploadDestination` (dead, written nowhere); `showUploadDestModal` |
| Tab fetches inside `load()` | 296-299, 316-322 | `getTabsAction(id).catch(() => [])` in the `Promise.all`, `setTabs(tabData)` at 306, and the nested `getTabsAction(pEntry.id)` try/catch that fills `personalTabs` and logs `Failed to load personal tabs` |
| Merge and ordering | 372-376 | `tabsOrigin = entry.band_id ? 'band' : 'personal'`; `mergedTabs` = entry tabs tagged with that origin, plus `personalTabs` tagged `personal`, sorted by `created_at` descending |
| `handleUploadClick` | 381-391 | Form submit: `preventDefault`, bail without an entry or a file, open the destination modal in a band entry, otherwise upload straight to `'personal'` |
| `triggerUpload` | 393-453 | The 10MB check (before the `try`, so an oversized file leaves the destination modal open), the target resolution (band entry + personal destination auto-creates the personal entry via `addSongAction`), the `FormData` build with the `uploadTitle.trim() || <file name without extension>` title, `uploadTabAction`, the optimistic prepend into `personalTabs` or `tabs`, the form reset including `fileInputRef.current.value = ''`, and the `finally` that clears `uploading` and closes the modal |
| `handleDeleteTab` | 455-460 | Resolves the target repertoire (`origin === 'personal' && personalEntry ? personalEntry.id : entry?.id`) and opens the in-page confirmation |
| Tab arm of `confirmPendingDelete` | 595-611 | `deleteTabAction(tabId, targetId)`, error toast, optimistic removal from the right list, `Tab deleted.` info toast, `Failed to delete tab` catch |
| Tabs section JSX | 757-957 | `<section aria-label="Tabs">`: heading, the list-or-skeleton-or-empty ternary chain, the `<ul>` of rows (PDF glyph, title, band/personal badge, `Viewing` badge, external-link anchor, delete button that also clears the active tab), the embedded viewer card (Google gview iframe on `activeTabUrl`, "Stage" and "Close" buttons) and the upload form |
| Destination modal | 1354-1403 | Root-level `fixed inset-0 z-50` overlay with the personal and band buttons plus Cancel |
| Delete confirmation | 1406-1419 | Shared `ConfirmPanel`; its message is a ternary on `pendingDelete.kind` |

Not tab code and explicitly out of this slice, even though it is adjacent:
`personalEntry`, `loadingPersonal`, `getPersonalEntryForSongAction` and the rest
of the `load()` effect (RH-52), and everything listed under "Boundary with
RH-50" above.

### Why the destination modal and the tab confirmation must stay at the page root

Both are `position: fixed`. The page's `<main>` carries
`slideOutClassName(...)`, which always ends in `translate-x-0` /
`translate-x-full` / `-translate-x-full`; Tailwind 4 emits those as the CSS
`translate` property, and any value other than `none` makes the element a
containing block for fixed-position descendants. Rendering either overlay
inside `<main>` would therefore resolve `fixed inset-0` against the
`max-w-xl mx-auto` column instead of the viewport — a visible desktop
regression. `TabDestinationModal` and `TabDeleteConfirm` are rendered by the
page at the root fragment, in the same DOM position as today.

### Measured budget for this slice

I built a throwaway probe copy of the page with exactly the regions above
deleted and the planned component elements substituted, ran ESLint on it, and
deleted it: `Function 'FastViewPage' has a complexity of 67` and 1063 lines.
ER6 pins bounds with margin against those measurements.

### `e2e/fast-view-mobile.spec.ts` is RED at this baseline (not a gate)

Verified at `a49a295` after `npx next build` (which exits 0):

```
set -a; . ./.env.local; set +a; \
PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" \
npx playwright test e2e/fast-view-mobile.spec.ts --project=mobile
```

prints `2 failed` / `1 passed`. Both failures come from the shared `addSong`
helper (`e2e/helpers.ts:57`, `dialog[open]` never reaching count 0) — the RH-44
breakage that also makes `e2e/songs-crud.spec.ts` red. Neither spec is an
expected result of this task. (`--project=chromium` runs zero tests for that
file: `playwright.config.ts` routes it to the `mobile` project.)
`e2e/ssr-smoke.spec.ts` (4 tests) is green and is the e2e gate.

## Approach

### 1. `src/lib/tabLibrary.ts` (new: pure helpers plus the controller contract)

Written in the style of `src/lib/playlistNav.ts`: decision helpers with no
runtime React, no DOM access and no `window`, behind a module doc comment
saying why they live out here. It must not import from `@/app/*` and must not
import `@/lib/tabs.ts` (that module is server-side data access and pulls in the
`pg` pool).

It differs from `playlistNav.ts` in one deliberate way: it also declares the
`TabLibraryController` shape, so `src/components/fastview/*` and their tests can
type the controller they receive **without importing the hook**. That keeps the
component layer independent of `src/hooks` and keeps the set of files that
import `@/hooks/useTabLibrary` down to the three ER1 names. What ER1 pins is the
**import specifier** `from '@/hooks/useTabLibrary'`, not the bare identifier, so
naming `useTabLibrary` in a doc comment (as the `TabLibraryController` block
below does) is fine anywhere, including under `src/lib` and
`src/components/fastview`. What is forbidden is an actual `import ... from
'@/hooks/useTabLibrary'` in those directories. The only React reference this
file creates is a `import type { RefObject } from 'react'`, which is erased at
compile time and adds no runtime dependency.

```ts
import type { RefObject } from 'react'
import type { RepertoireTab } from '@/types/database'

/** Which repertoire a tab belongs to, as the UI labels it. */
export type TabOrigin = 'band' | 'personal'

/** A tab plus the origin badge the list renders. */
export interface MergedTab extends RepertoireTab {
  origin: TabOrigin
}

/** Maximum upload size accepted by `uploadTabAction`, mirrored client-side. */
export const MAX_TAB_FILE_BYTES = 10 * 1024 * 1024

/** 'band' for a band entry, 'personal' otherwise. */
export function entryTabOrigin(entryBandId: string | null | undefined): TabOrigin

/** Entry tabs tagged `entryOrigin` plus personal tabs tagged 'personal',
 *  newest `created_at` first. Pure: neither input array is mutated. */
export function mergeTabs(
  entryTabs: RepertoireTab[],
  personalTabs: RepertoireTab[],
  entryOrigin: TabOrigin,
): MergedTab[]

/** True when the upload has to ask band vs personal first. */
export function needsDestinationChoice(entryBandId: string | null): boolean

/** Where an upload lands. `repertoireId === null` means "create the personal
 *  repertoire entry first, then upload into it". */
export interface UploadTarget {
  repertoireId: string | null
  isPersonal: boolean
}

export function resolveUploadTarget(args: {
  entryId: string
  entryBandId: string | null
  personalRepertoireId: string | null
  destination: TabOrigin
}): UploadTarget

/** Which repertoire a delete is issued against; null when it cannot be resolved. */
export function resolveDeleteTarget(args: {
  origin: TabOrigin
  entryId: string | null
  personalRepertoireId: string | null
}): string | null

/** `name.pdf` -> `name`; only the last extension is stripped. */
export function defaultTitleFromFileName(fileName: string): string

/** The trimmed typed title, or the file name without its extension. */
export function tabUploadTitle(typedTitle: string, fileName: string): string

/** A file picked for upload, reduced to what the validator needs. A `File`
 *  satisfies it structurally; a test passing a wider literal must assign it to
 *  a variable first, or TypeScript's excess-property check fires. */
export interface TabFileDescriptor {
  size: number
}

export type TabFileValidation = { ok: true } | { ok: false; message: string }

export function validateTabFile(file: TabFileDescriptor): TabFileValidation

/** A tab delete awaiting confirmation. */
export interface PendingTabDelete {
  tabId: string
  origin: TabOrigin
  targetId: string
}

/** Everything `useTabLibrary` exposes. Declared here, not in the hook, so the
 *  presentational components can type it without importing `src/hooks`. */
export interface TabLibraryController {
  tabs: MergedTab[]
  activeTabId: string | null
  activeTabRepertoireId: string | null
  activeTabUrl: string | null
  activeTabTitle: string
  selectTab: (tab: MergedTab) => void
  closeActiveTab: () => void
  uploadTitle: string
  uploadFile: File | null
  uploading: boolean
  uploadError: string | null
  fileInputRef: RefObject<HTMLInputElement | null>
  setUploadTitle: (title: string) => void
  pickFile: (file: File | null) => void
  submitUpload: () => void
  isDestinationModalOpen: boolean
  chooseDestination: (destination: TabOrigin) => Promise<void>
  cancelDestination: () => void
  pendingDelete: PendingTabDelete | null
  deleteBusy: boolean
  requestDelete: (tabId: string, origin: TabOrigin) => void
  confirmDelete: () => Promise<void>
  cancelDelete: () => void
}
```

Behaviour these must reproduce exactly:

- `resolveUploadTarget`: no band entry -> `{ repertoireId: entryId, isPersonal: true }`
  whatever the destination; band entry + `'band'` ->
  `{ repertoireId: entryId, isPersonal: false }`; band entry + `'personal'` with
  a known personal entry -> `{ repertoireId: personalRepertoireId, isPersonal: true }`;
  band entry + `'personal'` without one -> `{ repertoireId: null, isPersonal: true }`.
- `resolveDeleteTarget`: `origin === 'personal' && personalRepertoireId` ->
  `personalRepertoireId`; otherwise `entryId` (which may be `null`).
- `validateTabFile` is the size check and nothing else:
  `size > MAX_TAB_FILE_BYTES` -> `{ ok: false, message: 'File size exceeds the 10MB limit' }`
  (the message the page shows today, character for character); otherwise
  `{ ok: true }`.

  **No client-side PDF type or extension check may be added.** This slice
  preserves behaviour, and today the page validates size only. A type/extension
  check would also be a real regression rather than a "strict subset" of the
  server: `uploadTabAction` computes
  `file.type === 'application/pdf' || buffer.subarray(0, 5).toString('latin1') === '%PDF-'`,
  so it accepts a genuine PDF on its magic bytes alone regardless of the
  reported type **and** regardless of the file name — the Android Storage
  Access Framework case its own comment documents, where Chrome reports
  `application/octet-stream` for a file whose name has no `.pdf` in it. Any
  client check on `type` or on the extension would reject that upload before
  the bytes are ever read. The `Only PDF files are allowed` message stays
  server-side, reaching the user through `res.error` on the upload response,
  exactly as it does today.

### 2. `src/hooks/useTabLibrary.ts` (new controller)

`PendingTabDelete`, `TabLibraryController`, `MergedTab`, `TabOrigin` and the
helpers are **imported** from `@/lib/tabLibrary` and are not re-exported from
here (a pass-through re-export would be an unused export and `npm run lint:dead`
would fail on it). The hook owns only the two types below.

```ts
export interface TabLibraryActions {
  getTabs: (repertoireId: string) => Promise<RepertoireTab[]>
  uploadTab: (formData: FormData) => Promise<{ data?: RepertoireTab; error?: string }>
  deleteTab: (tabId: string, repertoireId: string) => Promise<{ success?: boolean; error?: string }>
  addSong: (songId: string) => Promise<Repertoire>
}

export interface UseTabLibraryOptions {
  /** The route's repertoire id, i.e. `entry.id`. */
  repertoireId: string
  /** `entry.band_id`, null until the entry loads and for a personal entry. */
  entryBandId: string | null
  /** `entry.song_id`, needed to auto-create the personal entry. */
  songId: string | null
  /** `personalEntry?.id ?? null`, owned by the page (RH-52). */
  personalRepertoireId: string | null
  /** Required, never defaulted — see `src/app/fastViewTabActions.ts`. */
  actions: TabLibraryActions
  /** Called with the entry this hook auto-created, so the page can adopt it. */
  onPersonalEntryCreated: (entry: Repertoire) => void
  /** `showToast` from the page's `useToast`. */
  notify: (message: string, tone: ToastTone) => void
  /** Called when a tab delete confirmation opens, so the page can close its
   *  own (link) confirmation and keep exactly one panel on screen. */
  onDeleteRequested?: () => void
}

export function useTabLibrary(options: UseTabLibraryOptions): TabLibraryController
```

Behaviour, unchanged from the page unless stated:

- **Entry tabs fetch.** One effect on `[repertoireId, actions]`:
  `actions.getTabs(repertoireId).then(setEntryTabs).catch(() => {})` behind a
  `cancelled` flag. Today this call sits in the `load()` `Promise.all`; moving it
  into its own effect keeps it concurrent with the entry fetch. Two deliberate,
  unobservable consequences: it no longer re-runs when only `?bandId=` changes
  (`getTabsAction(id)` does not depend on `bandId`), and it now also runs when
  the entry turns out not to exist (the page returns its "Song not found" screen
  before rendering anything that reads the list).
- **Personal tabs fetch.** One effect on `[personalRepertoireId, actions]`:
  skips when `personalRepertoireId` is null; skips when it equals the id of a
  personal entry this hook itself created (tracked in a ref) — today a personal
  entry auto-created during an upload never triggers a personal-tabs fetch, and
  preserving that avoids a race in which the refetch could overwrite the
  optimistic prepend; otherwise fetches and, on rejection, calls
  `logger.error('Failed to load personal tabs', ...)` with the narrowed error,
  exactly as the page does today.
- **`tabs`** is `mergeTabs(entryTabs, personalTabs, entryTabOrigin(entryBandId))`,
  memoised with `useMemo`.
- **`selectTab(tab)`** toggles: when `activeTabUrl === tab.file_url` it clears
  all four active fields (`activeTabTitle` back to `''`), otherwise it sets
  `file_url`, `title`, `id` and `repertoire_id`. `closeActiveTab()` clears them.
- **`pickFile(file)`** stores the file and, only when the current
  `uploadTitle.trim()` is empty and a file was picked, sets the title to
  `defaultTitleFromFileName(file.name)`.
- **`submitUpload()`** bails without a file; opens the destination modal when
  `needsDestinationChoice(entryBandId)`; otherwise calls
  `chooseDestination('personal')`.
- **`chooseDestination(destination)`** is today's `triggerUpload`, in the same
  order: bail without a file; run `validateTabFile(uploadFile)` and, when it
  fails, set `uploadError` to its message and return **without** closing the
  destination modal (today's behaviour, preserved verbatim); then
  `setUploading(true)`, `setUploadError(null)`, resolve the target with
  `resolveUploadTarget`, and when `repertoireId` is null call
  `actions.addSong(songId)`, remember the created id in the ref, and call
  `onPersonalEntryCreated(created)`. Build the `FormData` with `repertoireId`,
  `title` = `tabUploadTitle(uploadTitle, uploadFile.name)` and `file`, call
  `actions.uploadTab(formData)`, on `res.error` set `uploadError` and return, on
  `res.data` prepend to `personalTabs` when the target was personal and to
  `entryTabs` otherwise, then clear `uploadTitle`, `uploadFile` and
  `fileInputRef.current.value`. A thrown error is narrowed with
  `err instanceof Error ? err.message : undefined` and shown as `uploadError`
  falling back to `'Failed to upload tab'`. `finally` clears `uploading` and
  closes the destination modal.
- **`requestDelete(tabId, origin)`** resolves the target with
  `resolveDeleteTarget`, returns when it is null, clears the active tab when
  `activeTabId === tabId` (today the row's delete button clears the active tab
  when the row is the active one), calls `onDeleteRequested?.()` and stores the
  pending descriptor.
- **`confirmDelete()`** sets `deleteBusy`, calls
  `actions.deleteTab(tabId, targetId)`, on `res.error` calls
  `notify(res.error, 'error')`, otherwise removes the tab from `personalTabs` or
  `entryTabs` by origin and calls `notify('Tab deleted.', 'info')`; a throw is
  swallowed into `notify('Failed to delete tab', 'error')`; then the pending
  descriptor is cleared and `deleteBusy` released in `finally`.
  `cancelDelete()` just clears the pending descriptor.

`ToastTone` is imported from `@/lib/uiTones` and `logger` from `@/lib/logger`;
neither crosses the import-direction rule.

### 3. `src/app/fastViewTabActions.ts` (new, the injection point)

A sibling of `src/app/fastViewNavActions.ts` rather than an edit to it: keeping
one composition-root file per slice leaves RH-48's file untouched and lets
RH-50..RH-52 add their own without conflicting on the same lines.

```ts
import { getTabsAction, uploadTabAction, deleteTabAction } from '@/app/actions/tabs'
import { addSongAction } from '@/app/actions/repertoire'
import type { TabLibraryActions } from '@/hooks/useTabLibrary'

/** Module-level, so the object identity is stable and the hook's fetch effects
 *  cannot be restarted by a re-render (the `src/app/bandAdminActions.ts` pattern). */
export const TAB_LIBRARY_ACTIONS: TabLibraryActions = {
  getTabs: getTabsAction,
  uploadTab: uploadTabAction,
  deleteTab: deleteTabAction,
  addSong: addSongAction,
}
```

No Server Action is added, renamed or deleted, so `src/app/actions/**` is not
edited at all and RH-45's `actionSessionGuard.test.ts` (44 entries) and
`actionAuthorizationGuard.test.ts` keep passing untouched.

### 4. `src/components/fastview/*` (new, presentational)

Each of these returns `null` itself when it has nothing to render, so no tab
conditional is left in `FastViewPage`. All markup, class strings and copy are
carried over character for character from the audited regions. Every type these
components name (`MergedTab`, `TabOrigin`, `TabLibraryController`) comes from
`@/lib/tabLibrary`; **no file under `src/components/fastview/` contains an
`import ... from '@/hooks/useTabLibrary'`**, and neither does any of their
tests — in particular the controller stub `TabOverlays.test.tsx` builds for
`TabLibrarySection` is typed `TabLibraryController` imported from
`@/lib/tabLibrary`. Mentioning the name `useTabLibrary` in a comment is not
restricted; only the import is.

| File | Component | Props | Notes |
|---|---|---|---|
| `TabList.tsx` | `TabList` | `{ tabs: MergedTab[]; activeTabUrl: string \| null; onSelect: (tab: MergedTab) => void; onDelete: (tabId: string, origin: TabOrigin) => void }` | The `<ul className="flex flex-col gap-2">` and its rows, from lines 764-854. `isActive` stays `activeTabUrl === tab.file_url`. Keeps the PDF glyph, the `Band` / `Personal` badges with their titles, the `Viewing` badge, the external-link anchor (`target="_blank" rel="noopener noreferrer"`) and the `aria-label="Delete tab"` button |
| `TabViewer.tsx` | `TabViewer` | `{ url: string \| null; title: string; onOpenStage: () => void; onClose: () => void }` | Lines 857-891. Returns `null` without a `url`. Keeps `Viewing: {title}`, the `Stage` button, the `Close` button and the iframe `src` `https://docs.google.com/gview?url=${encodeURIComponent(url)}&embedded=true` with `title={title}` |
| `TabUploadForm.tsx` | `TabUploadForm` | `{ title: string; file: File \| null; uploading: boolean; error: string \| null; inputRef: RefObject<HTMLInputElement \| null>; onTitleChange: (v: string) => void; onFileChange: (f: File \| null) => void; onSubmit: () => void }` | Lines 908-956. Its `<form onSubmit>` calls `e.preventDefault()` then `onSubmit()`; the file input reports `e.target.files?.[0] || null` and keeps `accept="application/pdf"` from line 922 verbatim (a picker hint the user can override with `All Files`, not validation) |
| `TabDestinationModal.tsx` | `TabDestinationModal` | `{ open: boolean; uploading: boolean; onChoose: (destination: TabOrigin) => void; onCancel: () => void }` | Lines 1355-1403. Returns `null` unless `open` |
| `TabDeleteConfirm.tsx` | `TabDeleteConfirm` | `{ pending: boolean; busy: boolean; onConfirm: () => void; onCancel: () => void }` | Returns `null` unless `pending`; otherwise the shared `ConfirmPanel` with `className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] w-[90%] max-w-sm shadow-xl"`, `message="Delete this tab? This can't be undone."` and `confirmLabel="Delete"` — the exact panel the page renders today for a tab |
| `TabLibrarySection.tsx` | `TabLibrarySection` | `{ library: TabLibraryController; loadingPersonal: boolean; onOpenStage: () => void }`, with `TabLibraryController` imported from `@/lib/tabLibrary` | The whole `<section aria-label="Tabs" className="flex flex-col gap-4">`: the heading, then `library.tabs.length > 0 ? (<div className="flex flex-col gap-4"><TabList/><TabViewer/></div>) : loadingPersonal ? (<the animate-pulse skeleton>) : (<p>No PDFs uploaded yet.</p>)`, then `<TabUploadForm/>`. The skeleton stays inline here, unchanged from lines 894-902 |

No browser `alert()` / `confirm()` anywhere (the delete keeps going through
`ConfirmPanel`); upload failures stay inline under the form and delete failures
stay Toasts, matching the page today and the P1 convention.

### 5. `src/app/songs/[id]/fast-view/page.tsx` (edited)

- Line 9 becomes
  `import { getTabAnnotationsAction, saveTabAnnotationsAction } from '@/app/actions/tabs'`;
  add imports for `useTabLibrary`, `TAB_LIBRARY_ACTIONS`, `TabLibrarySection`,
  `TabDestinationModal`, `TabDeleteConfirm`; drop `RepertoireTab` from the
  `@/types/database` type import if it becomes unused.
- `PendingDelete` becomes `type PendingDelete = { kind: 'link'; url: string }`.
- Delete the state at 111-117, 119-123, 158 and 161-162; add
  ```ts
  const tabLibrary = useTabLibrary({
    repertoireId: id,
    entryBandId: entry?.band_id ?? null,
    songId: entry?.song_id ?? null,
    personalRepertoireId: personalEntry?.id ?? null,
    actions: TAB_LIBRARY_ACTIONS,
    onPersonalEntryCreated: setPersonalEntry,
    notify: showToast,
    onDeleteRequested: () => setPendingDelete(null),
  })
  const { activeTabId, activeTabRepertoireId, activeTabUrl, activeTabTitle } = tabLibrary
  ```
  placed **above** the RH-50 stage code so that code is untouched. The hook call
  must sit after `personalEntry` and `showToast` are declared and before the
  first early `return`.
- `load()` keeps `getSongEntry`, `setEntry`, `setLyricsText`, the
  `getPersonalEntryForSongAction` branch and `loadingPersonal`; it loses the
  `Promise.all` wrapper, `getTabsAction`, `setTabs` and the nested
  `getTabsAction(pEntry.id)` try/catch.
- Delete 372-376, 381-460 and the tab arm of `confirmPendingDelete` (595-611);
  `confirmPendingDelete` keeps only the link path, and the `ConfirmPanel`
  message at 1409-1413 becomes the plain link string.
- `handleDeleteLink` gains one line, `tabLibrary.cancelDelete()`, before it sets
  its own pending delete — the mirror of `onDeleteRequested`, so a tab
  confirmation and a link confirmation can never be on screen at once (today one
  `pendingDelete` state makes that impossible; two states would not).
- The tabs section at 757-957 becomes
  `<TabLibrarySection library={tabLibrary} loadingPersonal={loadingPersonal} onOpenStage={() => setIsPdfStageMode(true)} />`.
- At the root fragment, in the same positions as today: the destination modal at
  1354 becomes `<TabDestinationModal open={tabLibrary.isDestinationModalOpen} uploading={tabLibrary.uploading} onChoose={tabLibrary.chooseDestination} onCancel={tabLibrary.cancelDestination} />`,
  and `<TabDeleteConfirm pending={tabLibrary.pendingDelete !== null} busy={tabLibrary.deleteBusy} onConfirm={tabLibrary.confirmDelete} onCancel={tabLibrary.cancelDelete} />`
  goes immediately before the surviving link `ConfirmPanel`.

Nothing else in the page changes. In particular no state, effect, handler or JSX
belonging to the entry load, PDF Stage Mode, lyrics, status, links or the Toast
may be touched beyond the two lines named above.

### 6. Test plan (exact files and test names)

**`src/lib/__tests__/tabLibrary.test.ts`** — node environment, 18 tests:

- `entryTabOrigin` > `labels a band entry band and a personal entry personal`
- `mergeTabs` > `labels the entry tabs with the entry origin and the personal tabs personal`
- `mergeTabs` > `orders the merged list by creation date, newest first`
- `mergeTabs` > `returns an empty list when there are no tabs at all`
- `mergeTabs` > `does not mutate the input arrays`
- `needsDestinationChoice` > `asks for a destination only in a band entry`
- `resolveUploadTarget` > `uploads to the entry itself and marks it personal outside a band`
- `resolveUploadTarget` > `uploads to the band entry when the band destination is chosen`
- `resolveUploadTarget` > `uploads to the existing personal entry when the personal destination is chosen in a band`
- `resolveUploadTarget` > `asks for a personal entry to be created when the band member has none`
- `resolveDeleteTarget` > `deletes a band tab from the entry and a personal tab from the personal entry`
- `resolveDeleteTarget` > `falls back to the entry when a personal tab has no personal entry`
- `defaultTitleFromFileName` > `strips the last extension only`
- `tabUploadTitle` > `uses the trimmed typed title when there is one`
- `tabUploadTitle` > `falls back to the file name without its extension`
- `validateTabFile` > `accepts a file within the size limit`
- `validateTabFile` > `rejects a file larger than the 10MB limit with the size message`
- `validateTabFile` > `accepts a file whose browser-reported type is not a PDF, leaving that check to the server`

**`src/hooks/__tests__/useTabLibrary.test.tsx`** — `// @vitest-environment jsdom`
as the literal first line, `renderHook` + `act` from `@testing-library/react`,
`afterEach(cleanup)`, a `makeActions()` factory of `vi.fn()` spies, 15 tests:

- `loads the entry tabs on mount and exposes them merged and ordered`
- `loads the personal tabs once a personal repertoire id is known`
- `keeps an empty list when the tab fetch rejects`
- `selects a tab and clears the selection when the same tab is chosen again`
- `exposes the active tab id, repertoire id, url and title for the stage overlay`
- `fills the upload title from the file name only when the title box is empty`
- `opens the destination modal instead of uploading when the entry belongs to a band`
- `uploads straight to the personal entry when the entry has no band`
- `rejects an oversized file with an inline error and never calls the upload action`
- `creates the personal entry before uploading when the band member has none`
- `does not refetch the personal tabs for a personal entry it just created`
- `shows the error returned by the upload action and keeps the file selected`
- `prepends the uploaded tab to the list and clears the form`
- `asks for confirmation before deleting and removes the tab only after the delete action succeeds`
- `clears the active tab when the tab being deleted is the active one`

**`src/components/fastview/__tests__/TabList.test.tsx`** — jsdom, 6 tests:
`renders one row per tab with its title and origin badge`;
`marks the active tab with the Viewing badge`;
`calls onSelect with the clicked tab`;
`calls onDelete with the tab id and origin`;
`links each tab to its file url with a safe target`;
`renders nothing but an empty list when there are no tabs`.

**`src/components/fastview/__tests__/TabUploadForm.test.tsx`** — jsdom, 5 tests:
`submits without reloading and asks the controller to upload`;
`shows the inline upload error when there is one`;
`disables the submit button while no file is selected`;
`shows the uploading label and disables the inputs while an upload is running`;
`reports the chosen file to the controller`.

**`src/components/fastview/__tests__/TabOverlays.test.tsx`** — jsdom, 9 tests
covering the three self-guarding overlays and the section:
`TabViewer renders nothing without an active tab`;
`TabViewer embeds the active tab url in the Google viewer iframe`;
`TabViewer opens Stage Mode and closes the viewer from the header buttons`;
`TabDestinationModal renders nothing while it is closed`;
`TabDestinationModal offers the personal and band destinations and reports the chosen one`;
`TabDestinationModal cancels without uploading`;
`TabDeleteConfirm renders nothing when no tab delete is pending`;
`TabDeleteConfirm asks for confirmation with the tab wording and reports confirm and cancel`;
`TabLibrarySection shows the empty state, the loading skeleton and the list in turn`.

That is 53 new tests across 5 new files, and no existing test is edited.

### 7. Conventions this task must not break

- No `alert()` / `confirm()` anywhere
  (`src/lib/__tests__/noBrowserDialogs.test.ts` walks all of `src/`).
- No `catch (x: any)`; narrow instead
  (`src/lib/__tests__/errorHandlingStyle.test.ts` walks all of `src/`). The
  entry-tabs `.catch(() => {})` stays a deliberate S1 swallow with its one-line
  comment.
- Nothing under `src/lib`, `src/hooks` or `src/components` may import `@/app/*`
  (`no-restricted-imports` in `eslint.config.mjs`).
- Every `*.test.tsx` needs `// @vitest-environment jsdom` as its literal first
  line and an explicit `afterEach(cleanup)`.
- This is an internal refactor with no user-facing feature: it is **not** a
  landing-page selling point and the landing copy must not change.

## Expected Results

ER1 - From the project root all nine of these files exist and are non-empty: `src/lib/tabLibrary.ts`, `src/hooks/useTabLibrary.ts`, `src/app/fastViewTabActions.ts`, `src/components/fastview/TabLibrarySection.tsx`, `src/components/fastview/TabList.tsx`, `src/components/fastview/TabViewer.tsx`, `src/components/fastview/TabUploadForm.tsx`, `src/components/fastview/TabDestinationModal.tsx`, `src/components/fastview/TabDeleteConfirm.tsx`. `grep -rn "@/app/" src/lib/tabLibrary.ts src/hooks/useTabLibrary.ts src/components/fastview` prints nothing and exits with status 1. `grep -rln "from '@/hooks/useTabLibrary'" src` lists exactly these three paths and no others, in any order: `src/hooks/__tests__/useTabLibrary.test.tsx`, `src/app/fastViewTabActions.ts`, `src/app/songs/[id]/fast-view/page.tsx` (the hook file itself does not import itself, and this check matches import specifiers only, so naming the identifier in a doc comment is never a match). `grep -rln "@/hooks/useTabLibrary" src/components src/lib` prints nothing and exits with status 1, because `src/lib/tabLibrary.ts` exports the `TabLibraryController` type the components consume: `grep -c "TabLibraryController" src/lib/tabLibrary.ts` prints a number greater than 0 and `grep -c "@/lib/tabLibrary" src/components/fastview/TabLibrarySection.tsx` also prints a number greater than 0. `grep -c "TAB_LIBRARY_ACTIONS" "src/app/songs/[id]/fast-view/page.tsx"` prints a number greater than 0.

ER2 - `npx vitest run src/lib/__tests__/tabLibrary.test.ts --reporter=verbose` exits 0 and reports at least 18 passed and 0 failed tests, among which these exact names all appear and pass: `labels a band entry band and a personal entry personal`, `labels the entry tabs with the entry origin and the personal tabs personal`, `orders the merged list by creation date, newest first`, `returns an empty list when there are no tabs at all`, `does not mutate the input arrays`, `asks for a destination only in a band entry`, `uploads to the entry itself and marks it personal outside a band`, `uploads to the band entry when the band destination is chosen`, `uploads to the existing personal entry when the personal destination is chosen in a band`, `asks for a personal entry to be created when the band member has none`, `deletes a band tab from the entry and a personal tab from the personal entry`, `falls back to the entry when a personal tab has no personal entry`, `strips the last extension only`, `uses the trimmed typed title when there is one`, `falls back to the file name without its extension`, `accepts a file within the size limit`, `rejects a file larger than the 10MB limit with the size message`, `accepts a file whose browser-reported type is not a PDF, leaving that check to the server`. The size test asserts the exact message `File size exceeds the 10MB limit`, which is the only rejection `validateTabFile` can produce. No client-side PDF type or extension check is introduced: the `accepts a file whose browser-reported type is not a PDF` test assigns `const picked = { size: 1024, name: 'chart', type: 'application/octet-stream' }` and asserts that `validateTabFile(picked)` returns `{ ok: true }`, and `grep -rn "application/pdf\|Only PDF files are allowed" src/lib/tabLibrary.ts src/hooks/useTabLibrary.ts` prints nothing and exits with status 1. `src/components/fastview/TabUploadForm.tsx` still carries the file input's `accept="application/pdf"` attribute verbatim from the page, which is a picker hint rather than a validation gate and rejects nothing the user can still choose with `All Files`. A genuine PDF that Android reports as `application/octet-stream` with no `.pdf` in its name therefore still reaches `uploadTabAction`, which accepts it on its `%PDF-` magic bytes.

ER3 - `npx vitest run src/hooks/__tests__/useTabLibrary.test.tsx --reporter=verbose` exits 0 and reports at least 15 passed and 0 failed tests, among which these exact names all appear and pass: `loads the entry tabs on mount and exposes them merged and ordered`, `loads the personal tabs once a personal repertoire id is known`, `keeps an empty list when the tab fetch rejects`, `selects a tab and clears the selection when the same tab is chosen again`, `exposes the active tab id, repertoire id, url and title for the stage overlay`, `fills the upload title from the file name only when the title box is empty`, `opens the destination modal instead of uploading when the entry belongs to a band`, `uploads straight to the personal entry when the entry has no band`, `rejects an oversized file with an inline error and never calls the upload action`, `creates the personal entry before uploading when the band member has none`, `does not refetch the personal tabs for a personal entry it just created`, `shows the error returned by the upload action and keeps the file selected`, `prepends the uploaded tab to the list and clears the form`, `asks for confirmation before deleting and removes the tab only after the delete action succeeds`, `clears the active tab when the tab being deleted is the active one`. The first line of that file is exactly `// @vitest-environment jsdom`, the file contains `afterEach(cleanup)`, it calls `renderHook`, and `grep -c "@/app/actions" src/hooks/__tests__/useTabLibrary.test.tsx` prints `0` because every action the hook uses is passed in as a test double.

ER4 - `npx vitest run src/components/fastview --reporter=verbose` exits 0 and reports 0 failed tests across at least seven files, including these three new ones: `src/components/fastview/__tests__/TabList.test.tsx` with at least 6 tests including `marks the active tab with the Viewing badge` and `calls onDelete with the tab id and origin`; `src/components/fastview/__tests__/TabUploadForm.test.tsx` with at least 5 tests including `submits without reloading and asks the controller to upload` and `disables the submit button while no file is selected`; `src/components/fastview/__tests__/TabOverlays.test.tsx` with at least 9 tests including `TabViewer embeds the active tab url in the Google viewer iframe`, `TabDestinationModal offers the personal and band destinations and reports the chosen one`, `TabDeleteConfirm asks for confirmation with the tab wording and reports confirm and cancel` and `TabLibrarySection shows the empty state, the loading skeleton and the list in turn`. Each of those three files has `// @vitest-environment jsdom` as its literal first line and calls `afterEach(cleanup)`. The four RH-48 files in that directory (`SetlistRow.test.tsx`, `SetlistDrawer.test.tsx`, `SetlistSidebar.test.tsx`, `SetlistControls.test.tsx`) still pass and `git diff a49a295 -- src/components/fastview/__tests__/SetlistRow.test.tsx src/components/fastview/__tests__/SetlistDrawer.test.tsx src/components/fastview/__tests__/SetlistSidebar.test.tsx src/components/fastview/__tests__/SetlistControls.test.tsx` prints nothing.

ER5 - `grep -rn "uploadDestination" src` prints nothing and exits with status 1 (it matches one line in `src/app/songs/[id]/fast-view/page.tsx` at commit `a49a295`). `grep -c "uploadTabAction\|deleteTabAction\|getTabsAction" "src/app/songs/[id]/fast-view/page.tsx"` prints `0` (it prints `5` at `a49a295`), while `grep -c "uploadTabAction\|deleteTabAction\|getTabsAction" src/app/fastViewTabActions.ts` prints a number greater than 0. `grep -c "getTabAnnotationsAction\|saveTabAnnotationsAction" "src/app/songs/[id]/fast-view/page.tsx"` prints a number greater than 0, and `grep -c "activeTabId\|activeTabRepertoireId\|activeTabUrl" "src/app/songs/[id]/fast-view/page.tsx"` prints a number greater than 0, because the still-inline PDF Stage Mode code keeps consuming those bindings. `git diff a49a295 -- src/app/actions src/lib/tabs.ts src/lib/songs.ts src/components/tabs src/app/fastViewNavActions.ts` prints nothing.

ER6 - `npx eslint src/lib/tabLibrary.ts src/hooks/useTabLibrary.ts src/app/fastViewTabActions.ts src/components/fastview --rule '{"complexity":["error",15],"max-lines-per-function":["error",200]}'` exits 0 and prints no output at all. `wc -l` on each of the nine files listed in ER1 and on each of the five new test files (`src/lib/__tests__/tabLibrary.test.ts`, `src/hooks/__tests__/useTabLibrary.test.tsx`, `src/components/fastview/__tests__/TabList.test.tsx`, `src/components/fastview/__tests__/TabUploadForm.test.tsx`, `src/components/fastview/__tests__/TabOverlays.test.tsx`) prints a number strictly less than 400. `wc -l "src/app/songs/[id]/fast-view/page.tsx"` prints a number strictly less than 1150 (it printed 1427 at `a49a295`). The output of `npx eslint "src/app/songs/[id]/fast-view/page.tsx" --rule '{"complexity":["error",15]}'` contains exactly one line matching `Function 'FastViewPage' has a complexity of N`, and N is at most 69 (it was 76 at `a49a295`). That command's other output lines are not constrained here: `--rule` adds to the flat config rather than replacing it, so the command also reports the page's ordinary problems, which ER7 pins separately (five problem lines at `a49a295`, three afterwards).

ER7 - `npx eslint .` prints the summary line `26 problems (12 errors, 14 warnings)` and nothing worse, and `npx eslint "src/app/songs/[id]/fast-view/page.tsx"` prints the summary line `2 problems (2 errors, 0 warnings)`, the two remaining problems being one `prefer-const` error on the `let html` declaration inside `parseLyricsMarkdown` and one `@typescript-eslint/no-explicit-any` error inside the status dropdown, both with possibly shifted line numbers. `./node_modules/.bin/tsc --noEmit` exits 0 and prints nothing. `npm run lint:dead` exits 0 and reports no unused files, exports, types or dependencies. `npm run lint:dup` exits 0 and prints `Found N clones.` with N at most 18 and a total duplicated-lines percentage at most 0.82% (18 clones and 230 lines, 0.82%, at `a49a295`). `npm run audit` exits 0 and reports 0 vulnerabilities.

ER8 - `git diff a49a295 -- src/lib/__tests__/erasePersistence.test.ts src/lib/__tests__/stageInteraction.test.ts src/lib/__tests__/annotationMath.test.ts src/lib/__tests__/pdfWorkerAsset.test.ts src/lib/__tests__/tabs.test.ts src/lib/__tests__/noBrowserDialogs.test.ts src/lib/__tests__/errorHandlingStyle.test.ts src/components/tabs/__tests__/TabDrawingStage.test.tsx src/lib/stageInteraction.ts src/lib/annotationMath.ts src/components/tabs/TabDrawingStage.tsx` prints nothing, and `npx vitest run src/lib/__tests__/erasePersistence.test.ts src/lib/__tests__/stageInteraction.test.ts src/lib/__tests__/annotationMath.test.ts src/lib/__tests__/pdfWorkerAsset.test.ts src/lib/__tests__/tabs.test.ts src/lib/__tests__/noBrowserDialogs.test.ts src/lib/__tests__/errorHandlingStyle.test.ts src/components/tabs/__tests__/TabDrawingStage.test.tsx src/app/actions/__tests__/actionSessionGuard.test.ts src/app/actions/__tests__/actionAuthorizationGuard.test.ts` exits 0 with 0 failed tests.

ER9 - With a live Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with all migrations applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` exported into the environment (for example `set -a; . ./.env.local; set +a`), `npx vitest run` exits 0 and its summary reports at least 70 test files passed, 0 test files failed, at least 843 tests passed, 0 tests failed and 0 tests skipped (the same command at `a49a295` reported 65 files and 791 tests, 0 skipped; this task adds 53).

ER10 - Under the same Postgres and `SUPABASE_SERVICE_ROLE_KEY` precondition as ER9, `npm run test:coverage` exits 0 with no threshold error and its `All files` row shows statements at least 95, branches at least 78, functions at least 97 and lines at least 95. Because the text table can omit a file that is fully covered, the per-file floors are read from the JSON summary instead: `npx vitest run --coverage --coverage.reporter=json-summary` exits 0 and, in the resulting `coverage/coverage-summary.json`, the entry whose key ends with `src/lib/tabLibrary.ts` reports `statements.pct` 100, `functions.pct` 100, `lines.pct` 100 and `branches.pct` at least 90, and the entry whose key ends with `src/hooks/useTabLibrary.ts` reports `statements.pct` at least 90, `functions.pct` at least 90, `lines.pct` at least 90 and `branches.pct` at least 75.

ER11 - `npx next build` exits 0 and its route table lists `/songs/[id]/fast-view` marked `f` (Dynamic, server-rendered on demand). Immediately afterwards, `set -a; . ./.env.local; set +a; PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" npx playwright test e2e/ssr-smoke.spec.ts --project=chromium` prints `4 passed` and exits 0. `e2e/fast-view-mobile.spec.ts` and `e2e/songs-crud.spec.ts` are not gates here: both are red at `a49a295` for the same RH-44 `addSong` helper reason (`e2e/helpers.ts:57`), verified at this baseline as `2 failed` / `1 passed` for the mobile fast-view spec.

ER12 - The `version` field in `package.json` matches `0.1.77-` followed by exactly twelve digits (it is `0.1.76-202609071622` at `a49a295`, and the version may only ever go up). `git diff a49a295 -- src/components/landing/LandingPage.tsx src/i18n/dictionaries/en.json src/i18n/dictionaries/pt-BR.json` prints nothing, and `npx vitest run src/lib/__tests__/landingCopy.test.ts` exits 0 with 0 failed tests. `git diff --name-only a49a295` lists only paths drawn from this closed set and nothing else: `AGENTS.md`, `package.json`, `.meridian/tasks.json`, `docs/tasks/RH-49-spec.md`, `docs/suggestions-log.md`, `src/app/songs/[id]/fast-view/page.tsx`, `src/app/fastViewTabActions.ts`, `src/lib/tabLibrary.ts`, `src/lib/__tests__/tabLibrary.test.ts`, `src/hooks/useTabLibrary.ts`, `src/hooks/__tests__/useTabLibrary.test.tsx`, `src/components/fastview/TabLibrarySection.tsx`, `src/components/fastview/TabList.tsx`, `src/components/fastview/TabViewer.tsx`, `src/components/fastview/TabUploadForm.tsx`, `src/components/fastview/TabDestinationModal.tsx`, `src/components/fastview/TabDeleteConfirm.tsx`, `src/components/fastview/__tests__/TabList.test.tsx`, `src/components/fastview/__tests__/TabUploadForm.test.tsx`, `src/components/fastview/__tests__/TabOverlays.test.tsx`. In particular that list contains no path under `migrations/`, no `eslint.config.mjs`, no `vitest.config.ts`, no `src/lib/tabs.ts`, no `src/lib/songs.ts`, no path under `src/components/tabs/`, no path under `src/app/actions/` and no `docs/plans/code-quality-review.md`.

## Out of Scope

- The other three Fast View slices: the PDF Stage Mode overlay including
  `findScrollHost`, the visual-viewport measurement, the back-button intercept
  and the annotation load/save (RH-50), lyrics and `parseLyricsMarkdown`
  (RH-51), and the entry load / band-vs-personal reconciliation / status
  dropdown / links / page shell (RH-52). The page keeps all of them unchanged
  apart from the two lines named in section 5 (`handleDeleteLink` gaining
  `tabLibrary.cancelDelete()` and the link-only `ConfirmPanel` message).
- Reaching the F6 target (no function over complexity 15, no file over 400
  lines) for `page.tsx` itself. That is RH-38's integration task, after all five
  parts land.
- Closing F6 in `docs/plans/code-quality-review.md`. That file must not be
  edited by this task.
- Changing any Server Action: `uploadTabAction`, `deleteTabAction`,
  `getTabsAction` and `addSongAction` keep their current signatures and
  behaviour, `src/app/actions/**` is not edited, and no server-side validation
  is moved or weakened. Client-side validation stays exactly what the page does
  today — the 10MB size check and nothing else. The PDF check is deliberately
  left server-only: `uploadTabAction` accepts a file on its `%PDF-` magic bytes
  regardless of the browser-reported type and name, so any client-side type or
  extension test would reject uploads the product accepts today.
- Fixing the two preserved warts this slice moves as they are: an oversized file
  chosen in a band entry still leaves the destination modal open with the error
  rendered behind it, and the desktop tab list still has no bulk actions. Both
  are recorded in `docs/suggestions-log.md` instead.
- Fixing `e2e/fast-view-mobile.spec.ts` or `e2e/songs-crud.spec.ts` (RH-44).
- Adding ESLint complexity budgets to `eslint.config.mjs` (RH-39).
- Any landing-page or dictionary change: this refactor ships no user-facing
  selling point.
- Any change to `migrations/`, `vitest.config.ts`, `src/lib/tabs.ts`,
  `src/lib/songs.ts`, `src/components/tabs/**` or `src/app/fastViewNavActions.ts`.

## Post-merge checks (orchestrator)

- Re-run `npx eslint "src/app/songs/[id]/fast-view/page.tsx" --rule '{"complexity":["error",15],"max-lines-per-function":["error",200]}'` and record the new complexity and line count in the RH-38 tracking notes, so parts 3-5 each get a fresh floor to beat. Read the numbers off the single `Function 'FastViewPage' has a complexity of N` line and the single `max-lines-per-function` line; the command also reprints the page's unrelated pre-existing problems, because `--rule` adds to the flat config instead of replacing it.
- RH-50's spec must be written against the post-RH-49 page and must consume the
  `activeTabId` / `activeTabRepertoireId` / `activeTabUrl` / `activeTabTitle`
  contract documented under "Boundary with RH-50" above.

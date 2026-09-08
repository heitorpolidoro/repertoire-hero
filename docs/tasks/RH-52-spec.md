# RH-52 — Fast View parte 5/5: extrair entrada de musica, status, links e o shell da pagina

Parent: RH-38 (Fast View decomposition, T5 of `docs/plans/code-quality-review.md`).
Part 5 of 5, the last slice. Baseline: `aaf9a21`
(`refactor(RH-51): extract Fast View lyrics editor, auto-import and lyrics Stage Mode`).

## Scope

This task finishes the decomposition of `src/app/songs/[id]/fast-view/page.tsx`
by moving the four regions RH-48..RH-51 deliberately left behind — the song
entry load with its band/personal reconciliation, the status dropdown and its
write, the links section (add with label auto-fill, delete through the
moderation queue) and the page's own shell (loading / not-found placeholders,
tags, the overlay stack) — into `src/lib`, `src/hooks` and
`src/components/fastview`, and reduces the page to a composition root that pins
the FINAL budget for the whole parent task:

- `FastViewPage` at complexity **at most 15** and **at most 200 lines**;
- **no function anywhere in the page file** over complexity 15, over 200 lines,
  or nested deeper than 4 blocks;
- the page **file** strictly under **400 lines**.

It also removes the last `@typescript-eslint/no-explicit-any` error in the page
(`handleStatusChange(statusKey as any)` at line 433), by giving the status
dropdown a typed option list in `src/lib`.

What this task does **not** cover:

- **F26.** Its second half is already closed at this baseline — RH-48 pulled all
  four `window.location.search` reads into `useSearchParams()` (see "The F26 read
  at `aaf9a21`" below). This task must **preserve** that: the band id keeps
  coming from `useSearchParams()` and keeps appearing in the load effect's
  dependency array, now inside `useSongEntry`. No new `window.location` read may
  appear anywhere.
- **Closing F6 / F26 in `docs/plans/code-quality-review.md`.** That file must not
  be edited here; the parent RH-38 owns the integration close-out and the
  re-measurement of the whole page after this slice lands.
- Any change to `src/app/actions/**`, `src/lib/songs.ts`, the moderation
  pipeline (RH-34), `migrations/`, `eslint.config.mjs` (the complexity budgets in
  the shared config are RH-39/F20) or `vitest.config.ts`.
- Any behaviour change. This is a pure refactor: every Toast string, every
  class-for-class layout contract in AGENTS.md (Link Card UI, Fast View Playlist
  Layout) and every observable interaction stays identical. In particular the
  `pending` moderation path keeps the deleted link on screen.
- Converting the page to a Server Component (T8), fixing the missing "next"
  desktop arrow, or touching the landing page (an internal refactor is not a
  selling point, so the Landing Page Rule resolves to "no landing copy change").

## Audit at aaf9a21

`git log --oneline -1` prints `aaf9a21 refactor(RH-51): extract Fast View lyrics
editor, auto-import and lyrics Stage Mode`.
`wc -l "src/app/songs/[id]/fast-view/page.tsx"` prints `658`.

```
rtk proxy npx eslint "src/app/songs/[id]/fast-view/page.tsx" \
  --rule '{"complexity":["error",15],"max-lines-per-function":["error",200],"max-depth":["error",4]}'
```

prints exactly three errors:

```
   92:16  error  Function 'FastViewPage' has too many lines (567). Maximum allowed is 200  max-lines-per-function
   92:16  error  Function 'FastViewPage' has a complexity of 30. Maximum allowed is 15     complexity
  433:74  error  Unexpected any. Specify a different type                                  @typescript-eslint/no-explicit-any
```

`max-depth` is already clean. Plain `rtk proxy npx eslint "src/app/songs/[id]/fast-view/page.tsx"`
prints `1 problem (1 error, 0 warnings)` — the `any` at `433:74`. Whole-tree
`rtk proxy npx eslint .` prints `25 problems (11 errors, 14 warnings)`.

### Every region still in the page, with line ranges

| Lines | Region | Destination |
|---|---|---|
| 1-31 | `'use client'` + imports (5 entry/status/link actions on line 8) | rewritten |
| 33-74 | `getLinkIcon(url)` — 5 branches returning 5 different SVGs | `src/components/fastview/LinkIcon.tsx` |
| 76-87 | `tabLibraryEntryInputs(entry, personalEntry)` (RH-49 helper) | folded into `SongEntryController` (`entryBandId` / `songId` / `personalRepertoireId`) |
| 89-90 | `type PendingDelete = { kind: 'link'; url: string }` | replaced by `pendingDeleteUrl: string \| null` in `SongLinksController` |
| 93-97 | `useParams` / `useRouter` / `useSearchParams` + `returnTo` + `queryBandId` | **stays** in the page |
| 99-101 | `entry`, `loading`, `notFound` state | `useSongEntry` |
| 103-105 | `isStatusDropdownOpen`, `updatingStatus` | `useSongStatus` |
| 107-109 | `pendingDelete`, `deleteBusy` | `useSongLinks` |
| 111-112 | `useToast()` | **stays** (one Toast for the page; RH-38 invariant) |
| 114-118 | `isAddingLink`, `newLinkLabel`, `newLinkUrl`, `savingLink` | `useSongLinks` |
| 120-122 | `personalEntry`, `loadingPersonal` | `useSongEntry` |
| 124-135 | `useTabLibrary(...)` call (RH-49) | **stays**, inputs rewired |
| 137-144 | `usePdfStage(...)` call (RH-50) | **stays** |
| 146-155 | `usePlaylistNav(...)` call (RH-48) | **stays** |
| 157-170 | `useLyricsEditor(...)` call (RH-51), with two inline `prev ? {...} : null` patchers | **stays**, patchers replaced by `song.applyEntryLyrics` / `song.applyPersonalLyrics` |
| 172-209 | the load effect: `getSongEntry(id, queryBandId)`, `setNotFound`, and the band-context `getPersonalEntryForSongAction` reconciliation with `logger.error`; deps `[id, queryBandId]` | `useSongEntry` |
| 211-217 | `loading` early return (`min-h-screen ... aria-busy`, `Loading...`) | `SongLoading` |
| 219-232 | `notFound \|\| !entry` early return (`Song not found` + `← Back`) | `SongNotFound` |
| 234-238 | derived `title` / `artist` / `key` / `cfg` / `links` | `songIdentity()` in lib (`cfg` moves into `StatusDropdown`, `links` into `SongLinksController`) |
| 240-254 | `handleStatusChange(newStatus)` | `useSongStatus.change` |
| 256-303 | `handleAddLink(e)` — duplicate check, blank-label auto-fetch, append, patch, reset form | `useSongLinks.submit` (the `e.preventDefault()` moves into `AddLinkForm`) |
| 305-311 | `handleDeleteLink(url)` — cancels the tab confirmation, then opens the link one | `useSongLinks.requestDelete` + one wiring arrow in the page |
| 313-350 | `confirmPendingDelete()` — `updateSongLinksAction` returning `{ success, pending }`; on `pending` the link stays visible with a warning Toast | `useSongLinks.confirmDelete` |
| 352-395 | root fragment, `SetlistDrawer`, `PlaylistPrevArrow`, layout `div`/`main` with the touch handlers, back button, `SetlistPill`, `SetlistSelect` | **stays** |
| 397-461 | "Song details" section: title/artist/key + the status trigger, the backdrop and the `Object.entries(STATUS_CONFIG)` list (the `as any` is at 433) | `SongIdentityHeader` + `StatusDropdown` |
| 463-468 | `TabLibrarySection` | **stays** |
| 470-571 | "Links" section: heading + `+ Add Link`, the link cards (`getLinkIcon`, external-link SVG, `h-4 w-px bg-gray-200` divider, delete button), the empty state and the add form | `LinksSection` + `LinkIcon` + `AddLinkForm` |
| 573-574 | `LyricsSection` | **stays** |
| 576-591 | "Tags" section | `SongTagsSection` |
| 592-604 | `SwipeHint`, `SetlistSidebar` | **stays** |
| 605-655 | the overlay stack: `LyricsStageOverlay`, `PdfStageOverlay`, `TabDestinationModal`, `TabDeleteConfirm`, the link `ConfirmPanel`, the `Toast` | `FastViewOverlays` (+ `LinkDeleteConfirm`) |

Five `useState` groups (13 `useState` calls), one `useEffect`, four handlers and
about 250 lines of JSX are what this slice moves.

### The F26 read at `aaf9a21`

`grep -c "window.location" "src/app/songs/[id]/fast-view/page.tsx"` already
prints `0`. Line 95-97 reads

```ts
const searchParams = useSearchParams()
const returnTo = searchParams.get('returnTo')
const queryBandId = searchParams.get('bandId')
```

and the load effect's dependency array (line 209) is already `[id, queryBandId]`,
i.e. it already carries the search-params-derived value. RH-48 pulled the whole
of F26 forward (see its spec's "F26 scope note"), so the second half is closed
before this task starts. RH-52's obligation is **conservation**: the load effect
moves into `useSongEntry` and its dependency array must still carry the band id
that the page derived from `useSearchParams()`, so a navigation that changes only
`?bandId=` still refetches. ER6 verifies this by grep plus a `renderHook`
rerender test (ER3), not by trusting the move.

### Existing guards this slice must not break

- `src/app/actions/__tests__/actionSessionGuard.test.ts` (44 `mode: '` entries),
  `actionAuthorizationGuard.test.ts`, `actionDataAccessGuard.test.ts`: no Server
  Action is added, deleted or re-signed here.
- `src/lib/__tests__/errorHandlingStyle.test.ts` and `noBrowserDialogs.test.ts`
  walk all of `src/`: no `catch (x: any)`, no `console.error` in a catch, no
  `alert`/`confirm` in the new files.
- `eslint.config.mjs` `no-restricted-imports`: nothing new under
  `src/components`, `src/hooks` or `src/lib` may import `@/app/*`.
- `knip` (`ignoreExportsUsedInFile: true`): every new export must have a
  non-test consumer, or `npm run lint:dead` fails.
- Coverage `include` covers `src/lib/**/*.ts` and `src/hooks/**/*.ts`
  automatically, so each new module carries its own unit test file.

## Approach

Three pure modules in `src/lib`, three controllers in `src/hooks`, one Server
Action composition root in `src/app`, nine presentational components in
`src/components/fastview`. Same shape as RH-48..RH-51: decisions in `lib` (node
tests, no DOM), state and effects in `hooks` (jsdom `renderHook` tests, actions
injected), markup in `components` (jsdom render tests, zero logic), controller
types declared in `lib` so components never import `src/hooks`.

### `src/lib/songEntry.ts`

```ts
export interface SongIdentity { title: string; artist: string; key: string | null }

/** `entry.song?.title ?? '(untitled)'`, `entry.song?.artist ?? ''`, `entry.personal_key ?? entry.song?.standard_key ?? null`. */
export function songIdentity(entry: Repertoire | null): SongIdentity

/** True only in band context and only once the entry's song id is known. */
export function shouldLoadPersonalEntry(bandId: string | null, songId: string | null | undefined): boolean

/** Immutable patchers; each returns the input unchanged (or null) when there is nothing to patch. */
export function withStatus(entry: Repertoire | null, status: SongStatus): Repertoire | null
export function withSongLinks(entry: Repertoire | null, links: SongLink[]): Repertoire | null
export function withLyrics(entry: Repertoire | null, lyrics: string): Repertoire | null

export interface SongEntryController {
  entry: Repertoire | null
  personalEntry: Repertoire | null
  loading: boolean
  loadingPersonal: boolean
  notFound: boolean
  identity: SongIdentity
  /** The three tab-library inputs, replacing the page's `tabLibraryEntryInputs`. */
  entryBandId: string | null
  songId: string | null
  personalRepertoireId: string | null
  adoptPersonalEntry: (entry: Repertoire) => void
  applyStatus: (status: SongStatus) => void
  applyLinks: (links: SongLink[]) => void
  applyEntryLyrics: (lyrics: string) => void
  applyPersonalLyrics: (lyrics: string) => void
}
```

`withStatus(null, s)` is `null` and `withSongLinks(entry, links)` returns `entry`
untouched when `entry.song` is undefined — exactly the `prev ? ... : null` and
`if (!prev || !prev.song) return prev` guards the page has today (lines 246,
284-293, 330-339).

### `src/lib/songStatus.ts`

```ts
export interface SongStatusOption { status: SongStatus; label: string; bgColor: string }
/** Built from STATUS_ORDER + STATUS_CONFIG, so the dropdown is typed `SongStatus` end to end. */
export const STATUS_OPTIONS: SongStatusOption[]
/** `Status updated to ${STATUS_CONFIG[status]?.label ?? status}` — the exact string at line 248. */
export function statusUpdatedMessage(status: SongStatus): string

export interface SongStatusController {
  status: SongStatus
  updating: boolean
  isDropdownOpen: boolean
  toggleDropdown: () => void
  closeDropdown: () => void
  change: (status: SongStatus) => Promise<void>
}
```

`STATUS_OPTIONS` is what removes the `as any`: the dropdown maps over a
`SongStatus`-typed array instead of `Object.entries(STATUS_CONFIG)`. It must
preserve today's render order, which is `STATUS_CONFIG`'s insertion order and is
identical to `STATUS_ORDER` (`unknown, learning, practicing, polishing,
mastered`). `src/lib/statusConfig.ts` itself is not modified.

### `src/lib/songLinks.ts`

```ts
/** Compares against `url.trim()`, as line 263 does. */
export function isDuplicateLinkUrl(links: SongLink[], url: string): boolean
/** `label || fetchedTitle || url` — the `finalLabel || newLinkUrl.trim()` fallback at line 277. */
export function resolveLinkLabel(label: string, fetchedTitle: string, url: string): string
export function appendLink(links: SongLink[], link: SongLink): SongLink[]
export function removeLinkByUrl(links: SongLink[], url: string): SongLink[]

export interface SongLinksController {
  links: SongLink[]                      // `entry?.song?.links ?? []`
  isAdding: boolean
  startAdding: () => void
  cancelAdding: () => void               // also clears both inputs (lines 552-555)
  label: string
  setLabel: (value: string) => void
  url: string
  setUrl: (value: string) => void
  saving: boolean
  submit: () => Promise<void>            // DOM-free: `preventDefault` stays in AddLinkForm
  pendingDeleteUrl: string | null
  deleteBusy: boolean
  requestDelete: (url: string) => void
  confirmDelete: () => Promise<void>
  cancelDelete: () => void
}
```

### `src/hooks/useSongEntry.ts`

```ts
export interface SongEntryActions {
  getSongEntry: (repertoireId: string, bandId: string | null) => Promise<Repertoire | null>
  getPersonalEntryForSong: (songId: string) => Promise<Repertoire | null>
}
export interface UseSongEntryOptions {
  repertoireId: string
  /** From the page's `useSearchParams().get('bandId')` — F26. */
  bandId: string | null
  actions: SongEntryActions
}
export function useSongEntry(options: UseSongEntryOptions): SongEntryController
```

One `useEffect`, a byte-for-byte behavioural copy of lines 172-209: a `cancelled`
flag, `setNotFound(true)` when the entry is missing **and** when the load throws,
`setLoading(false)` in `finally`, and — only when
`shouldLoadPersonalEntry(bandId, data.song_id)` — the background
`getPersonalEntryForSong` whose `.then` adopts the entry, whose `.catch` calls
`logger.error('Failed to load personal entry', err)` (message unchanged) and
whose `.finally` clears `loadingPersonal`. **Dependency array `[actions, bandId,
repertoireId]`** — the F26 conservation point. `identity` is
`songIdentity(entry)`; the five mutators are `useCallback`s wrapping the `lib`
patchers.

### `src/hooks/useSongStatus.ts`

```ts
export interface SongStatusActions {
  updateStatus: (repertoireId: string, status: SongStatus, bandId: string | null) => Promise<void>
}
export function useSongStatus(options: {
  entry: Repertoire | null
  actions: SongStatusActions
  onStatusSaved: (status: SongStatus) => void   // the page passes `song.applyStatus`
  notify: (message: string, tone: ToastTone) => void
}): SongStatusController
```

`change(next)` reproduces lines 241-254 exactly: return early without an entry;
`updating` true; `await actions.updateStatus(entry.id, next, entry.band_id)`;
`onStatusSaved(next)`; close the dropdown; `notify(statusUpdatedMessage(next),
'success')`; on any throw `notify('Failed to update status', 'error')`;
`updating` false in `finally`. `status` is `entry?.status ?? 'unknown'`.

### `src/hooks/useSongLinks.ts`

```ts
export interface SongLinksActions {
  updateLinks: (repertoireId: string, links: SongLink[]) => Promise<{ success: boolean; pending?: boolean }>
  fetchUrlTitle: (url: string) => Promise<string>
}
export function useSongLinks(options: {
  entry: Repertoire | null
  actions: SongLinksActions
  onLinksSaved: (links: SongLink[]) => void     // the page passes `song.applyLinks`
  notify: (message: string, tone: ToastTone) => void
}): SongLinksController
```

`submit()` (lines 257-303): no entry or no `entry.song` → return; duplicate URL →
`notify('This URL is already in the links list.', 'warning')` and return **before**
`saving` is set; otherwise `saving` true, fetch the title **only when the typed
label is blank** (`actions.fetchUrlTitle(url.trim())`), build the link with
`resolveLinkLabel`, `await actions.updateLinks(entry.id, appendLink(current, link))`,
`onLinksSaved(updated)`, close and clear the form,
`notify('Link added successfully!', 'success')`; `catch (err)` →
`notify(err instanceof Error ? err.message : 'Failed to add link.', 'error')`;
`saving` false in `finally`.

`requestDelete(url)` sets `pendingDeleteUrl`. `confirmDelete()` (lines 314-350)
keeps the moderation semantics of RH-34 intact:

```ts
const updated = removeLinkByUrl(current, pendingDeleteUrl)
const result = await actions.updateLinks(entry.id, updated)
if (result.pending) {
  // The catalog is shared, so a removal is queued for review: the link stays
  // on screen until an admin approves it.
  notify('Link removal submitted for review. It stays visible until an admin approves it.', 'warning')
} else {
  onLinksSaved(updated)
  notify('Link deleted.', 'info')
}
```

with `catch { notify('Failed to delete link.', 'error') }`, `pendingDeleteUrl`
cleared on **every** path (including the failure one, as today) and `deleteBusy`
cleared in `finally`.

### `src/app/fastViewEntryActions.ts`

Module-level, stable identities, following `src/app/fastViewLyricsActions.ts`:

```ts
export const SONG_ENTRY_ACTIONS: SongEntryActions = {
  getSongEntry: getSongEntryAction,
  getPersonalEntryForSong: getPersonalEntryForSongAction,
}
export const SONG_STATUS_ACTIONS: SongStatusActions = { updateStatus: updateSongStatusAction }
export const SONG_LINKS_ACTIONS: SongLinksActions = {
  updateLinks: updateSongLinksAction,
  fetchUrlTitle: fetchUrlTitleAction,
}
```

No action in `src/app/actions/repertoire.ts` changes.

### Components (`src/components/fastview/`)

All `'use client'`, all presentational, none holding `useState` / `useEffect` /
`useRef` and none importing `@/app/*` or `@/hooks/*`:

1. `LinkIcon.tsx` — `<LinkIcon url={...} />`, the five branches of `getLinkIcon`
   moved verbatim (Spotify `#1DB954`, YouTube `#FF0000`, cifraclub /
   ultimate-guitar `#FFB600`, Drive/Docs/`.pdf` `text-blue-500`, generic
   `text-gray-400`).
2. `StatusDropdown.tsx` — props `{ controller: SongStatusController }`. Trigger
   button with `STATUS_CONFIG[controller.status]` colours, `disabled` while
   `updating`, the `fixed inset-0 z-20` backdrop and the `absolute right-0 mt-1
   w-40 ...` list mapping `STATUS_OPTIONS` (typed, no `as any`), with the colour
   dot and the `✓` on the selected row.
3. `SongIdentityHeader.tsx` — props `{ identity: SongIdentity; status:
   SongStatusController }`; the `<section aria-label="Song details">` with the
   `h1`, the optional artist line, the `Key:` line and `StatusDropdown`.
4. `AddLinkForm.tsx` — props `{ controller: SongLinksController }`; the `<form>`
   whose `onSubmit` does `e.preventDefault()` then `controller.submit()`, the two
   inputs (same placeholders, `required` on the URL) and the Cancel / `Add` |
   `Saving...` buttons.
5. `LinksSection.tsx` — props `{ controller: SongLinksController; onDelete: (url:
   string) => void }`; heading, `+ Add Link`, the card list (Link Card UI classes
   preserved: `rounded-xl bg-white border border-gray-200 shadow-sm`, the
   square-with-arrow SVG, the `h-4 w-px bg-gray-200` divider and the in-card
   delete button with `aria-label="Delete link"`), the `No links added yet.`
   empty state and `AddLinkForm`.
6. `LinkDeleteConfirm.tsx` — the `ConfirmPanel` twin of `TabDeleteConfirm`,
   message `Delete this link? This can't be undone.`, same anchor classes.
7. `SongTagsSection.tsx` — props `{ tags: string[] }`; renders `null` when empty.
8. `SongLoadStates.tsx` — exports `SongLoading` (the `aria-busy` `Loading...`
   screen) and `SongNotFound` (`{ onBack }`, `Song not found` + `← Back`).
9. `FastViewOverlays.tsx` — the overlay stack, so the page's return stays inside
   the 200-line budget. Props: `{ identity, lyrics: LyricsEditorController,
   pdfStage, tabLibrary: TabLibraryController, links: SongLinksController, toast:
   { message: string; tone: ToastTone } | null, onDismissToast: () => void }`. It
   renders `LyricsStageOverlay`, `PdfStageOverlay`, `TabDestinationModal`,
   `TabDeleteConfirm`, `LinkDeleteConfirm` and `Toast` with exactly the props the
   page passes today. `usePdfStage` has no controller type in `src/lib`, so
   `FastViewOverlays` declares a local structural `FastViewPdfStage` interface
   (`isOpen`, `overlayRef`, `height`, `annotations`, `annotationsError`,
   `saveAnnotations`, `close`) rather than importing the hook.

### The composition root

The page keeps `useParams` / `useRouter` / `useSearchParams`, `useToast`, seven
hook calls, two early returns and the JSX skeleton. Verified shape (a throwaway
copy of exactly this page measured `FastViewPage` at **191 lines / complexity 6**
in a 221-line file, so the budget has real headroom):

```tsx
const { toast, showToast, dismissToast } = useToast()
const song = useSongEntry({ repertoireId: id, bandId: queryBandId, actions: SONG_ENTRY_ACTIONS })
const { entry, personalEntry, identity } = song
const status = useSongStatus({ entry, actions: SONG_STATUS_ACTIONS, onStatusSaved: song.applyStatus, notify: showToast })
const links  = useSongLinks({ entry, actions: SONG_LINKS_ACTIONS, onLinksSaved: song.applyLinks, notify: showToast })
const tabLibrary = useTabLibrary({
  repertoireId: id,
  entryBandId: song.entryBandId, songId: song.songId, personalRepertoireId: song.personalRepertoireId,
  actions: TAB_LIBRARY_ACTIONS, onPersonalEntryCreated: song.adoptPersonalEntry,
  notify: showToast, onDeleteRequested: links.cancelDelete,
})
const pdfStage = usePdfStage({ tabId: tabLibrary.activeTabId, repertoireId: tabLibrary.activeTabRepertoireId, actions: PDF_STAGE_ACTIONS })
const playlist = usePlaylistNav({ currentRepertoireId: id, returnTo, bandId: queryBandId, actions: PLAYLIST_NAV_ACTIONS, navigate: (href) => router.push(href), navigateBack: () => router.back() })
const lyrics = useLyricsEditor({
  entry, personalEntry, songTitle: identity.title, artist: identity.artist,
  actions: LYRICS_EDITOR_ACTIONS,
  onEntryLyricsSaved: song.applyEntryLyrics, onPersonalLyricsSaved: song.applyPersonalLyrics,
  onPersonalEntryCreated: song.adoptPersonalEntry, notify: showToast,
})

if (song.loading) return <SongLoading />
if (song.notFound || !entry) return <SongNotFound onBack={() => router.back()} />
```

Two wiring notes:

- **Declaration order matters.** `useSongLinks` is declared *before*
  `useTabLibrary`, so the tab hook can receive `onDeleteRequested:
  links.cancelDelete` (RH-49's file is not modified). The opposite direction —
  the link delete closing the tab confirmation, which line 309 does today — is
  wired in the JSX instead of through a hook option, avoiding a circular
  reference: `<LinksSection controller={links} onDelete={(url) => {
  tabLibrary.cancelDelete(); links.requestDelete(url) }} />`. Mutual exclusion of
  the two confirmation panels is preserved in both directions.
- `song.loadingPersonal` feeds both `TabLibrarySection` and `LyricsSection`
  exactly as `loadingPersonal` does today.

### Test plan

Node (default environment, no `@vitest-environment` line):
`src/lib/__tests__/songEntry.test.ts`, `songStatus.test.ts`, `songLinks.test.ts`.
jsdom (`// @vitest-environment jsdom` as the literal first line, `afterEach(cleanup)`):
`src/hooks/__tests__/useSongEntry.test.tsx`, `useSongStatus.test.tsx`,
`useSongLinks.test.tsx` (all three with `renderHook` and hand-written fake
actions — no `@/app/actions` import), and
`src/components/fastview/__tests__/SongIdentityHeader.test.tsx`,
`LinksSection.test.tsx`, `FastViewShell.test.tsx`.
The exact test names are the ones enumerated in ER2-ER5; they are the contract,
not a suggestion.

## Expected Results

ER1 - From the project root all twenty-five of these files exist and are non-empty: `src/lib/songEntry.ts`, `src/lib/__tests__/songEntry.test.ts`, `src/lib/songStatus.ts`, `src/lib/__tests__/songStatus.test.ts`, `src/lib/songLinks.ts`, `src/lib/__tests__/songLinks.test.ts`, `src/hooks/useSongEntry.ts`, `src/hooks/__tests__/useSongEntry.test.tsx`, `src/hooks/useSongStatus.ts`, `src/hooks/__tests__/useSongStatus.test.tsx`, `src/hooks/useSongLinks.ts`, `src/hooks/__tests__/useSongLinks.test.tsx`, `src/app/fastViewEntryActions.ts`, `src/components/fastview/LinkIcon.tsx`, `src/components/fastview/StatusDropdown.tsx`, `src/components/fastview/SongIdentityHeader.tsx`, `src/components/fastview/AddLinkForm.tsx`, `src/components/fastview/LinksSection.tsx`, `src/components/fastview/LinkDeleteConfirm.tsx`, `src/components/fastview/SongTagsSection.tsx`, `src/components/fastview/SongLoadStates.tsx`, `src/components/fastview/FastViewOverlays.tsx`, `src/components/fastview/__tests__/SongIdentityHeader.test.tsx`, `src/components/fastview/__tests__/LinksSection.test.tsx`, `src/components/fastview/__tests__/FastViewShell.test.tsx`. `grep -rn "@/app/" src/lib/songEntry.ts src/lib/songStatus.ts src/lib/songLinks.ts src/hooks/useSongEntry.ts src/hooks/useSongStatus.ts src/hooks/useSongLinks.ts src/components/fastview/LinkIcon.tsx src/components/fastview/StatusDropdown.tsx src/components/fastview/SongIdentityHeader.tsx src/components/fastview/AddLinkForm.tsx src/components/fastview/LinksSection.tsx src/components/fastview/LinkDeleteConfirm.tsx src/components/fastview/SongTagsSection.tsx src/components/fastview/SongLoadStates.tsx src/components/fastview/FastViewOverlays.tsx` prints nothing and exits with status 1. `grep -rln "@/hooks/useSongEntry\|@/hooks/useSongStatus\|@/hooks/useSongLinks" src/components src/lib` prints nothing and exits with status 1, and for each of the three hook names X in `useSongEntry`, `useSongStatus`, `useSongLinks` the command `grep -rln "from '@/hooks/X'" src` lists exactly these three paths and no others, in any order: `src/hooks/__tests__/X.test.tsx`, `src/app/fastViewEntryActions.ts`, `src/app/songs/[id]/fast-view/page.tsx`. `grep -c "SONG_ENTRY_ACTIONS\|SONG_STATUS_ACTIONS\|SONG_LINKS_ACTIONS" src/app/fastViewEntryActions.ts` and the same grep over `src/app/songs/[id]/fast-view/page.tsx` each print a number of at least 3, and `grep -c "getSongEntryAction\|getPersonalEntryForSongAction\|updateSongStatusAction\|updateSongLinksAction\|fetchUrlTitleAction" src/app/fastViewEntryActions.ts` prints a number of at least 5.

ER2 - `npx vitest run src/lib/__tests__/songEntry.test.ts --reporter=verbose` exits 0 and reports at least 12 passed and 0 failed tests, among which these exact names all appear and pass: `shouldLoadPersonalEntry is false outside a band`, `shouldLoadPersonalEntry is false when the song id is not known yet`, `shouldLoadPersonalEntry is true for a band entry with a song id`, `songIdentity falls back to (untitled) when the entry carries no song`, `songIdentity reads the title and the artist from the song`, `songIdentity prefers the personal key over the standard key`, `songIdentity falls back to the standard key when there is no personal key`, `withStatus returns a new entry carrying the new status`, `withStatus returns null for a null entry`, `withSongLinks replaces the song links and leaves the rest of the entry untouched`, `withSongLinks returns the entry unchanged when it carries no song`, `withLyrics returns a new entry carrying the saved lyrics`. The `songIdentity` fallback test asserts the exact triple `{ title: '(untitled)', artist: '', key: null }` for a null entry, and the two `withSongLinks` / `withStatus` tests assert that the input object is not mutated (the original entry still reports its old status and its old links after the call). The file `src/lib/__tests__/songEntry.test.ts` does not contain the string `@vitest-environment` at all, and `grep -c "window\.\|document\." src/lib/songEntry.ts` prints `0`. Separately, `npx vitest run src/lib/__tests__/songStatus.test.ts src/lib/__tests__/songLinks.test.ts --reporter=verbose` exits 0 and reports at least 12 passed and 0 failed tests, among which these exact names all appear and pass: `STATUS_OPTIONS lists the five statuses in mastery order`, `STATUS_OPTIONS carries the label and the badge colour of each status`, `statusUpdatedMessage names the label of the new status`, `statusUpdatedMessage falls back to the raw status when it has no config`, `isDuplicateLinkUrl is false for a url that is not in the list`, `isDuplicateLinkUrl is true for a url already in the list`, `isDuplicateLinkUrl ignores surrounding whitespace on the candidate url`, `resolveLinkLabel keeps the label the musician typed`, `resolveLinkLabel uses the fetched title when the typed label is blank`, `resolveLinkLabel falls back to the url when both the label and the fetched title are blank`, `appendLink adds the link at the end without mutating the input list`, `removeLinkByUrl drops every link with that url and keeps the others`. The order test asserts that `STATUS_OPTIONS.map(o => o.status)` deep-equals `['unknown', 'learning', 'practicing', 'polishing', 'mastered']`, and `statusUpdatedMessage('mastered')` is asserted to be exactly `Status updated to Mastered`. Neither file contains the string `@vitest-environment`.

ER3 - `npx vitest run src/hooks/__tests__/useSongEntry.test.tsx --reporter=verbose` exits 0 and reports at least 11 passed and 0 failed tests, among which these exact names all appear and pass: `loads the entry for the route id and clears the loading flag`, `reports not found when the entry does not exist`, `reports not found when the entry load throws`, `loads the personal entry in band context and exposes it`, `does not load a personal entry outside a band context`, `keeps the entry and clears loadingPersonal when the personal load fails`, `refetches the entry when the band id from the query changes`, `exposes the tab library inputs taken from the two entries`, `applyStatus patches the entry status`, `applyLinks patches the song links`, `adoptPersonalEntry adopts an entry created by another controller`. The refetch test uses `renderHook`'s `rerender` to change only `bandId` (route id unchanged) and asserts the injected `getSongEntry` double was called twice, the second time with the new band id  -  this is the F26 dependency-array proof. The band-context test asserts `getPersonalEntryForSong` was called exactly once with the entry's `song_id`; the personal-failure test asserts the hook still exposes the band entry and ends with `loadingPersonal` false. The first line of the file is exactly `// @vitest-environment jsdom`, it contains `afterEach(cleanup)`, it calls `renderHook`, and `grep -c "@/app/actions" src/hooks/__tests__/useSongEntry.test.tsx` prints `0` because both actions are passed in as test doubles.

ER4 - `npx vitest run src/hooks/__tests__/useSongStatus.test.tsx src/hooks/__tests__/useSongLinks.test.tsx --reporter=verbose` exits 0 and reports at least 14 passed and 0 failed tests, among which these exact names all appear and pass: `toggles the status dropdown open and closed`, `writes the new status against the entry id and its band id`, `reports the new status label in a success toast and closes the dropdown`, `reports a status write failure with the Failed to update status toast`, `refuses a duplicate url and does not call the action`, `adds a link with the label the musician typed`, `auto-fills a blank label from the fetched url title`, `falls back to the url when the fetched title is empty`, `closes and clears the add form after a successful add`, `reports the action error message when adding a link fails`, `deletes a link and reports it with the Link deleted toast`, `keeps the link and warns when the removal is queued for review`, `reports a delete failure with the Failed to delete link toast`, `cancelDelete closes the confirmation without calling the action`. The Toast strings are asserted verbatim against the injected `notify` spy: `Status updated to Mastered` with tone `success`, `Failed to update status` with tone `error`, `This URL is already in the links list.` with tone `warning`, `Link added successfully!` with tone `success`, `Link removal submitted for review. It stays visible until an admin approves it.` with tone `warning`, `Link deleted.` with tone `info`, `Failed to delete link.` with tone `error`. The action argument tuples are asserted exactly: `updateStatus` receives `(<the entry id>, 'mastered', <the entry band id>)`; the add case receives `updateLinks(<the entry id>, [...<the existing links>, { label: <the resolved label>, url: <the trimmed url> }])`; the typed-label case additionally asserts `fetchUrlTitle` was never called. The queued-removal test makes `updateLinks` resolve `{ success: true, pending: true }` and asserts that the injected `onLinksSaved` was NOT called (the link stays visible), while the plain case resolves `{ success: true }` and asserts `onLinksSaved` received the list without the removed url. Both files have `// @vitest-environment jsdom` as their literal first line, contain `afterEach(cleanup)`, call `renderHook`, and `grep -c "@/app/actions" src/hooks/__tests__/useSongStatus.test.tsx src/hooks/__tests__/useSongLinks.test.tsx` prints the two lines `src/hooks/__tests__/useSongStatus.test.tsx:0` and `src/hooks/__tests__/useSongLinks.test.tsx:0`.

ER5 - `npx vitest run src/components/fastview --reporter=verbose` exits 0 with 0 failed tests across at least thirteen files, including `src/components/fastview/__tests__/SongIdentityHeader.test.tsx` with at least 9 tests whose names include exactly `SongIdentityHeader shows the title and the artist`, `SongIdentityHeader omits the artist line when the song has none`, `SongIdentityHeader shows the key when there is one`, `StatusDropdown shows the current status label on the trigger`, `StatusDropdown reports the trigger press`, `StatusDropdown lists the five statuses in mastery order while open`, `StatusDropdown marks the current status as selected`, `StatusDropdown reports the status the musician picked`, `StatusDropdown disables the trigger while a status write is in flight`; including `src/components/fastview/__tests__/LinksSection.test.tsx` with at least 9 tests whose names include exactly `LinksSection renders one card per link with its label`, `LinksSection shows the empty state when there are no links`, `LinksSection reports the delete press with the url of that link`, `LinksSection opens the add form from the Add Link button`, `LinkIcon renders a distinct icon for Spotify, YouTube, a chord site, a PDF and an unknown url`, `AddLinkForm reports label and url keystrokes`, `AddLinkForm reports the submit without reloading the page`, `AddLinkForm shows the saving state and disables the submit button`, `AddLinkForm reports the cancel press`; and including `src/components/fastview/__tests__/FastViewShell.test.tsx` with at least 6 tests whose names include exactly `SongLoading renders the busy placeholder`, `SongNotFound reports the back press`, `SongTagsSection renders nothing when there are no tags`, `SongTagsSection renders one chip per tag`, `LinkDeleteConfirm renders nothing until a delete is pending`, `LinkDeleteConfirm asks the exact delete question and reports confirm and cancel`. The `LinkDeleteConfirm` test asserts the message text is exactly `Delete this link? This can't be undone.`. All three files have `// @vitest-environment jsdom` as their literal first line and call `afterEach(cleanup)`. The nine new components carry no state, no effects and no data access: `grep -c "useState\|useEffect\|useRef\|addEventListener\|@/app/\|@/hooks/" src/components/fastview/LinkIcon.tsx src/components/fastview/StatusDropdown.tsx src/components/fastview/SongIdentityHeader.tsx src/components/fastview/AddLinkForm.tsx src/components/fastview/LinksSection.tsx src/components/fastview/LinkDeleteConfirm.tsx src/components/fastview/SongTagsSection.tsx src/components/fastview/SongLoadStates.tsx src/components/fastview/FastViewOverlays.tsx` prints exactly nine lines, each ending in `:0`.

ER6 - The page holds no entry, status or link logic any more: `grep -c "updateSongStatusAction\|updateSongLinksAction\|getPersonalEntryForSongAction\|fetchUrlTitleAction\|getSongEntryAction\|window.location\|getLinkIcon" "src/app/songs/[id]/fast-view/page.tsx"` prints `0` (it prints `8` at `aaf9a21`), and `grep -c "useState\|useEffect\|STATUS_CONFIG\|ConfirmPanel\|@/types/database\|tabLibraryEntryInputs\|PendingDelete" "src/app/songs/[id]/fast-view/page.tsx"` also prints `0`. F26 stays closed and its dependency wiring is visible: `grep -c "const queryBandId = searchParams.get('bandId')" "src/app/songs/[id]/fast-view/page.tsx"` prints `1`, `grep -c "bandId: queryBandId" "src/app/songs/[id]/fast-view/page.tsx"` prints a number of at least 2 (the entry controller and the playlist controller both receive it), `grep -c "useEffect(" src/hooks/useSongEntry.ts` prints `1` (the hook declares exactly one effect; the plain `useEffect` pattern would print `2`, because the `react` import line matches too), and `grep -nE "\}, \[[^]]*bandId[^]]*\]\)" src/hooks/useSongEntry.ts` prints at least one line, i.e. the load effect's dependency array carries the search-params-derived band id. `grep -rn "window.location" src/hooks/useSongEntry.ts src/hooks/useSongStatus.ts src/hooks/useSongLinks.ts src/lib/songEntry.ts src/lib/songStatus.ts src/lib/songLinks.ts` prints nothing and exits with status 1. The page still renders the new pieces: `grep -c "SongIdentityHeader\|LinksSection\|SongTagsSection\|FastViewOverlays\|SongLoading\|SongNotFound" "src/app/songs/[id]/fast-view/page.tsx"` prints a number of at least 6, and `grep -c "tabLibrary.cancelDelete" "src/app/songs/[id]/fast-view/page.tsx"` prints a number of at least 1 (the link delete still closes the tab confirmation), while `grep -c "onDeleteRequested: links.cancelDelete" "src/app/songs/[id]/fast-view/page.tsx"` prints `1` (the tab delete still closes the link confirmation).

ER7 - FINAL BUDGET. `rtk proxy npx eslint "src/app/songs/[id]/fast-view/page.tsx" --rule '{"complexity":["error",15],"max-lines-per-function":["error",200],"max-depth":["error",4]}'` prints no output at all (raw, no summary line) and exits 0; at `aaf9a21` the same command prints three errors, including `Function 'FastViewPage' has too many lines (567)` and `has a complexity of 30`. `wc -l "src/app/songs/[id]/fast-view/page.tsx"` prints a number strictly less than `400` (it prints `658` at `aaf9a21`; a throwaway copy of the composition root this spec describes measures 221 lines with `FastViewPage` at 191 lines and complexity 6). The same `--rule` invocation over the sixteen new source files  -  `rtk proxy npx eslint src/lib/songEntry.ts src/lib/songStatus.ts src/lib/songLinks.ts src/hooks/useSongEntry.ts src/hooks/useSongStatus.ts src/hooks/useSongLinks.ts src/app/fastViewEntryActions.ts src/components/fastview/LinkIcon.tsx src/components/fastview/StatusDropdown.tsx src/components/fastview/SongIdentityHeader.tsx src/components/fastview/AddLinkForm.tsx src/components/fastview/LinksSection.tsx src/components/fastview/LinkDeleteConfirm.tsx src/components/fastview/SongTagsSection.tsx src/components/fastview/SongLoadStates.tsx src/components/fastview/FastViewOverlays.tsx --rule '{"complexity":["error",15],"max-lines-per-function":["error",200],"max-depth":["error",4]}'`  -  also prints no output at all and exits 0, and `wc -l` on each of those sixteen files prints a number strictly less than 400.

ER8 - Static gates. `rtk proxy npx eslint "src/app/songs/[id]/fast-view/page.tsx"` prints no output at all and exits 0, i.e. the page is at 0 problems (it prints `1 problem (1 error, 0 warnings)` at `aaf9a21`, the `@typescript-eslint/no-explicit-any` at 433:74). `rtk proxy npx eslint .` prints the summary line `24 problems (10 errors, 14 warnings)` and nothing worse  -  exactly one error fewer than the `25 problems (11 errors, 14 warnings)` at `aaf9a21`, that one error being the page's `any`. `./node_modules/.bin/tsc --noEmit` exits 0 and prints nothing. `npm run lint:dead` exits 0 and reports no unused files, exports, types or dependencies. `npm run lint:dup` exits 0, prints `Found N clones.` with N at most 20, and the `Total:` row of its table shows a duplicated-lines percentage of at most 1.00% (18 clones, 230 lines, 0.73% at `aaf9a21`). `npm run audit` exits 0 and reports 0 vulnerabilities.

ER9 - Nothing owned by RH-48, RH-49, RH-50, RH-51 or the Stage Mode guards changed: `git diff aaf9a21 -- src/lib/playlistNav.ts src/hooks/usePlaylistNav.ts src/app/fastViewNavActions.ts src/components/fastview/SetlistDrawer.tsx src/components/fastview/SetlistSidebar.tsx src/components/fastview/SetlistSelect.tsx src/components/fastview/SetlistPill.tsx src/components/fastview/SetlistPanel.tsx src/components/fastview/SetlistRow.tsx src/components/fastview/PlaylistPrevArrow.tsx src/components/fastview/SwipeHint.tsx src/lib/tabLibrary.ts src/hooks/useTabLibrary.ts src/app/fastViewTabActions.ts src/components/fastview/TabLibrarySection.tsx src/components/fastview/TabList.tsx src/components/fastview/TabViewer.tsx src/components/fastview/TabUploadForm.tsx src/components/fastview/TabDestinationModal.tsx src/components/fastview/TabDeleteConfirm.tsx src/lib/scrollHost.ts src/lib/stageHistory.ts src/hooks/usePdfStage.ts src/components/fastview/PdfStageOverlay.tsx src/lib/lyricsMarkdown.ts src/lib/lyricsEditor.ts src/hooks/useLyricsEditor.ts src/app/fastViewLyricsActions.ts src/components/fastview/LyricsSection.tsx src/components/fastview/LyricsEditorPanel.tsx src/components/fastview/LyricsStageOverlay.tsx src/lib/statusConfig.ts src/lib/annotationMath.ts src/lib/stageInteraction.ts src/components/tabs/TabDrawingStage.tsx src/components/ui/ConfirmPanel.tsx src/components/ui/Toast.tsx src/hooks/useToast.ts` prints nothing. `npx vitest run src/hooks/__tests__/usePlaylistNav.test.tsx src/hooks/__tests__/useTabLibrary.test.tsx src/hooks/__tests__/usePdfStage.test.tsx src/hooks/__tests__/useLyricsEditor.test.tsx src/hooks/__tests__/useToast.test.tsx src/lib/__tests__/errorHandlingStyle.test.ts src/lib/__tests__/noBrowserDialogs.test.ts src/app/actions/__tests__/actionSessionGuard.test.ts src/app/actions/__tests__/actionAuthorizationGuard.test.ts src/app/actions/__tests__/actionDataAccessGuard.test.ts` exits 0 with 0 failed tests, and `grep -c "mode: '" src/app/actions/__tests__/actionSessionGuard.test.ts` still prints `44`.

ER10 - With a live Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with all migrations applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` exported into the environment (for example `set -a; . ./.env.local; set +a`), `npx vitest run` exits 0 and its summary reports at least 88 test files passed, 0 test files failed, at least 1000 tests passed, 0 tests failed and 0 tests skipped (the same command at `aaf9a21` reports 79 files and 952 tests, 0 skipped; this task adds 9 test files and at least 48 tests). Under the same precondition `npm run test:coverage` exits 0 with no threshold error (the configured gates are statements 80, branches 65, functions 78, lines 80) and its `All files` row shows statements at least 90, branches at least 74, functions at least 92 and lines at least 90.

ER11 - Under the same Postgres and `SUPABASE_SERVICE_ROLE_KEY` precondition as ER10, `npx vitest run --coverage --coverage.reporter=json-summary` exits 0 and, in the resulting `coverage/coverage-summary.json`, the entries whose keys end with `src/lib/songEntry.ts`, `src/lib/songStatus.ts` and `src/lib/songLinks.ts` each report `statements.pct` 100, `functions.pct` 100, `lines.pct` 100 and `branches.pct` at least 90, and the entries whose keys end with `src/hooks/useSongEntry.ts`, `src/hooks/useSongStatus.ts` and `src/hooks/useSongLinks.ts` each report `statements.pct` at least 90, `functions.pct` at least 90, `lines.pct` at least 90 and `branches.pct` at least 75. The per-file floors are read from this JSON rather than from the text table because the table can omit a fully covered file.

ER12 - `npx next build` exits 0, prints no error mentioning a missing Suspense boundary or `useSearchParams`, and its route table lists `/songs/[id]/fast-view` marked `f` (Dynamic, server-rendered on demand). Immediately afterwards, `set -a; . ./.env.local; set +a; PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" npx playwright test e2e/ssr-smoke.spec.ts --project=chromium` prints `4 passed` and exits 0. `e2e/fast-view-mobile.spec.ts` and `e2e/songs-crud.spec.ts` are not gates here: both are red at `aaf9a21` for the RH-44 `addSong` helper reason (`e2e/helpers.ts`), so their result is recorded but never blocks this task. The `version` field in `package.json` matches `0.1.80-` followed by exactly twelve digits (it is `0.1.79-202609072030` at `aaf9a21`, and the version may only ever go up). `git diff aaf9a21 -- src/components/landing/LandingPage.tsx src/i18n/dictionaries/en.json src/i18n/dictionaries/pt-BR.json` prints nothing and `npx vitest run src/lib/__tests__/landingCopy.test.ts` exits 0 with 0 failed tests: this refactor ships no selling point, so the landing copy is untouched.

ER13 - `git diff --name-only aaf9a21` lists only paths drawn from this closed set and nothing else: `AGENTS.md`, `package.json`, `docs/tasks/RH-52-spec.md`, `docs/suggestions-log.md`, `src/app/songs/[id]/fast-view/page.tsx`, `src/app/fastViewEntryActions.ts`, `src/lib/songEntry.ts`, `src/lib/__tests__/songEntry.test.ts`, `src/lib/songStatus.ts`, `src/lib/__tests__/songStatus.test.ts`, `src/lib/songLinks.ts`, `src/lib/__tests__/songLinks.test.ts`, `src/hooks/useSongEntry.ts`, `src/hooks/__tests__/useSongEntry.test.tsx`, `src/hooks/useSongStatus.ts`, `src/hooks/__tests__/useSongStatus.test.tsx`, `src/hooks/useSongLinks.ts`, `src/hooks/__tests__/useSongLinks.test.tsx`, `src/components/fastview/LinkIcon.tsx`, `src/components/fastview/StatusDropdown.tsx`, `src/components/fastview/SongIdentityHeader.tsx`, `src/components/fastview/AddLinkForm.tsx`, `src/components/fastview/LinksSection.tsx`, `src/components/fastview/LinkDeleteConfirm.tsx`, `src/components/fastview/SongTagsSection.tsx`, `src/components/fastview/SongLoadStates.tsx`, `src/components/fastview/FastViewOverlays.tsx`, `src/components/fastview/__tests__/SongIdentityHeader.test.tsx`, `src/components/fastview/__tests__/LinksSection.test.tsx`, `src/components/fastview/__tests__/FastViewShell.test.tsx`. In particular that list contains no path under `migrations/`, no `eslint.config.mjs`, no `vitest.config.ts`, no `src/lib/songs.ts`, no `src/lib/statusConfig.ts`, no path under `src/app/actions/`, no path under `src/components/tabs/`, no `docs/plans/code-quality-review.md` and none of the RH-48..RH-51 files listed in ER9.

## Out of Scope

- **The RH-38 integration close-out.** Marking F6 and F26 as closed in
  `docs/plans/code-quality-review.md`, re-measuring the whole page against the
  original 1586-line / complexity-82 baseline, and the parent's own summary
  belong to RH-38's final spec. `docs/plans/code-quality-review.md` must not be
  edited by this task (ER13 forbids it).
- **RH-39 / F20** — adding `complexity`, `max-depth`, `max-lines-per-function`
  and `max-params` to `eslint.config.mjs`. This task proves the page passes those
  thresholds by invoking them with `--rule`; wiring them into the shared config
  (with the override list for the known offenders in `src/lib` and
  `src/hooks/useBandAdmin.ts`) is RH-39's job.
- **T8 / F25** — converting Fast View to a Server Component and dropping the
  `useEffect` data fetch. The load effect is *moved*, not eliminated.
- **Server Action changes.** No action is added, deleted, renamed or re-signed;
  `src/app/actions/repertoire.ts` and the three action guard suites stay as they
  are.
- **The missing desktop "next" arrow** and any other latent asymmetry recorded by
  the RH-38 report. Preserve today's behaviour; do not fix.
- **Landing copy.** An internal refactor is not a selling point.
- `e2e/fast-view-mobile.spec.ts` and `e2e/songs-crud.spec.ts` remain red for the
  RH-44 reason; repairing them is not part of this task.

## Post-merge checks (orchestrator)

- Re-run `rtk proxy npx eslint . ` once more on `master` and confirm the summary
  is `24 problems (10 errors, 14 warnings)`; that number is the input RH-39 will
  ratchet against.
- Hand RH-38 the two numbers it needs for its close-out: the page's final
  `wc -l` and the fact that the `--rule` invocation over the page now prints
  nothing.

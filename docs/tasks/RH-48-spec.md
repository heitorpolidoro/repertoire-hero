# RH-48 — Fast View parte 1/5: extrair navegacao de playlist e UI de setlist

Parent: RH-38 (`Decompor a pagina Fast View`), part 1 of 5.
Baseline: `c8665cd` (`docs(RH-37): close out data-access layering findings F8, F21 and F22`).
Covers: F6 (first slice) and F26 (both halves — see "F26 scope note" below).

## Scope

This task extracts exactly one vertical slice out of
`src/app/songs/[id]/fast-view/page.tsx`: **playlist navigation and the setlist
UI**. Concretely:

- the pure navigation decisions (previous / next / position, the `returnTo`
  playlist-id match, the query-string preservation, the swipe threshold, the
  slide-out class) move to a new `src/lib` module;
- the controller that owns the playlist fetch, the drawer open/closed state, the
  slide-out animation and the actual `router.push` moves to a new `src/hooks`
  hook, taking its Server Action as an injected typed dependency (the RH-47
  `useBandAdmin` shape);
- the mobile bottom-sheet drawer, the desktop sidebar, the mobile select, the
  desktop previous arrow, the mobile `Setlist (X/Y)` pill and the mobile swipe
  hint move to `src/components/fastview/*`, with **one shared row component**
  used by both the drawer and the sidebar (which removes the one jscpd clone
  that lives inside the page today);
- the page stops reading `window.location.search` anywhere and reads
  `returnTo` / `bandId` through `useSearchParams()`;
- the pure alias Server Action `getPlaylistEntryIdsAction` is deleted, together
  with its two guard-table entries and its unit test.

**The page stays large.** After this slice it is still roughly 1440 lines and
still a single component of complexity around 74. That is expected and
budgeted: RH-49..RH-52 own the remaining four slices (tabs/upload, the PDF
Stage Mode overlay, lyrics, and the entry/status/links/shell), and RH-38 closes
F6 by re-measuring the whole page after all five have landed. Nothing in this
task may touch those four slices.

### F26 scope note (deviation from the RH-38 decomposition report)

The RH-38 report allocated the two load-effect `window.location.search` reads
(lines 290-291 and 329-330) to part 5 and only the `navigateTo` / back-button
reads (667-669 and 784) to part 1. This spec pulls **all four** into part 1,
because the split is not actually available: once the page holds a
`useSearchParams()`-derived `bandId` at the top (which part 1 needs anyway for
the navigation query string), leaving the load effect reading
`window.location.search` while a `bandId` binding is in scope either duplicates
the read for no reason or trips `react-hooks/exhaustive-deps` the moment the
derived value is used. Converting the load effect too costs four lines, closes
F26 completely, and is verified mechanically by ER5.

This has one deliberate, user-visible consequence, and it is the F26
remediation: the load effect's dependency array becomes `[id, bandId]`, so a
client-side navigation that changes only `?bandId=` now refetches the entry
instead of showing the previous context's data.

## Audit at c8665cd

`wc -l "src/app/songs/[id]/fast-view/page.tsx"` prints `1625`. The whole file is
one exported client component, `FastViewPage` (line 92), measured with
`npx eslint "src/app/songs/[id]/fast-view/page.tsx" --rule '{"complexity":["error",15],"max-lines-per-function":["error",200]}'`
as `Function 'FastViewPage' has too many lines (1534)` and
`Function 'FastViewPage' has a complexity of 88`.

Default `npx eslint "src/app/songs/[id]/fast-view/page.tsx"` prints:

```
   15:10  warning  'getPlaylistEntryIdsAction' is defined but never used      @typescript-eslint/no-unused-vars
   18:7   error    'html' is never reassigned. Use 'const' instead            prefer-const
  150:10  warning  'uploadDestination' is assigned a value but never used     @typescript-eslint/no-unused-vars
  150:29  warning  'setUploadDestination' is assigned a value but never used  @typescript-eslint/no-unused-vars
  870:74  error    Unexpected any. Specify a different type                   @typescript-eslint/no-explicit-any

5 problems (2 errors, 3 warnings)
```

Only the first of the five belongs to this slice (it disappears when the alias
action is deleted). `prefer-const` at 18 is inside `parseLyricsMarkdown`
(RH-51), the two `uploadDestination` warnings are RH-49, and the
`no-explicit-any` at 870 is inside the status dropdown (RH-52). The repo-wide
total is `29 problems (12 errors, 17 warnings)` and drops by exactly one
warning.

### The nav / setlist responsibilities in the page

| Region | Lines | What it is |
|---|---|---|
| Import of the alias action | 15 | `getPlaylistEntryIdsAction` imported and never used, alongside `getPlaylistDetailsWithEntriesAction` |
| Nav state | 153-167 | `playlistNav` (`{prevId, nextId, position, total, playlistId, playlistName}`), `playlistEntries`, `isDrawerOpen`, `touchStartX` ref, `slideOut` |
| Nav fetch | 328-348 | Inside the `load()` effect: reads `returnTo`, matches `/^\/playlists\/([\w-]+)$/`, calls `getPlaylistDetailsWithEntriesAction(playlistId, queryBandId)`, computes prev/next/position/total, swallows errors |
| `navigateTo` | 665-677 | Rebuilds the query string from `returnTo` + `bandId`, sets `slideOut`, `setTimeout(220)` then `router.push` |
| Mobile drawer | 681-746 | Bottom sheet: backdrop, header with the music-note glyph + playlist name + close button, scroll container `flex-1 overflow-y-auto p-4 flex flex-col gap-1.5`, one button row per entry |
| Desktop arrow | 748-760 | `fixed left-4 top-1/2 ... hidden lg:flex`, `aria-label="Previous song"`. There is **no** next arrow (see "Preserved asymmetry") |
| Slide-out class | 766-768 | `slideOut === 'left' ? '-translate-x-full' : slideOut === 'right' ? 'translate-x-full' : 'translate-x-0'` |
| Swipe handlers | 769-777 | `onTouchStart` records `clientX`; `onTouchEnd` needs `abs(delta) >= 60`, `delta > 0` goes to `nextId` sliding `left`, `delta < 0` goes to `prevId` sliding `right` |
| Setlist pill | 798-807 | `lg:hidden` pill, label `Setlist ({position}/{total})` |
| Mobile select | 810-832 | `lg:hidden` `<select value={id}>`, options `"{idx+1}. {title} - {artist}"` |
| Swipe hint | 1360-1367 | `lg:hidden` strip: left-arrow `prev` when `prevId`, `{position} / {total}`, `next` right-arrow when `nextId` |
| Desktop sidebar | 1371-1426 | `<aside className="w-80 shrink-0 border-l border-gray-200 bg-white sticky top-0 h-screen overflow-y-auto hidden lg:flex flex-col z-20">`, sticky header with the playlist name and a `{position} / {total}` badge, then the same scroll container and the same row markup as the drawer |

### The two duplicated row blocks

`npm run lint:dup` reports `Found 19 clones.` / `239 (0.88%)` duplicated lines
overall, `10` clones and `140 (1.22%)` duplicated lines in the `tsx` bucket. One
of those tsx clones is inside this page: `[713:23 - 722:26]` against
`[1394:19 - 1403:22]` — the drawer row markup against the sidebar row markup.
The rows differ only in two Tailwind fragments: the sidebar's current row adds
`ring-1 ring-emerald-400/20` and its idle row adds `hover:border-gray-200`.
The two headers (690-695 / 1375-1380) and the two scroll containers (704 /
1386) are character-identical.

### The two `window.location.search` reads named by F26 (plus two more)

`grep -c "window.location.search" "src/app/songs/[id]/fast-view/page.tsx"`
prints `4`, at lines 290, 329, 667 and 784:

- 290 — `queryBandId` for `getSongEntry(id, queryBandId)` inside `load()`;
- 329 — `returnTo` for the playlist-nav fetch inside `load()`;
- 667 — `returnTo` + `bandId` inside `navigateTo`;
- 784 — `returnTo` for the back button (`router.push(returnTo)` else `router.back()`).

### The alias action

`src/app/actions/playlists.ts:77-83`:

```ts
export async function getPlaylistEntryIdsAction(
  playlistId: string,
  bandId?: string | null
): Promise<PlaylistEntrySummary[]> {
  const details = await getPlaylistDetailsWithEntriesAction(playlistId, bandId)
  return details.entries
}
```

`grep -rn "getPlaylistEntryIdsAction" src` returns five hits:

- `src/app/songs/[id]/fast-view/page.tsx:15` — imported, never used;
- `src/app/actions/playlists.ts:77` — the definition;
- `src/app/actions/__tests__/playlists.test.ts:36` (import) and `:180-186`
  (a one-test `describe` block);
- `src/app/actions/__tests__/actionSessionGuard.test.ts:72` (import) and
  `:156` (the `FAIL_CLOSED` table entry);
- `src/app/actions/__tests__/actionAuthorizationGuard.test.ts:28` — a comment
  only; the `SESSION_RESOLVING_HELPERS` map itself has just two keys
  (`getPlaylistDetailsWithEntriesAction`, `resolveOwner`) and is asserted
  literally at line 65, so it does **not** change.

`actionSessionGuard.test.ts:207` asserts
`expect(Object.keys(FAIL_CLOSED).sort()).toEqual(allExportedActionNames())`, and
`FAIL_CLOSED` currently holds **45** entries. Deleting the action therefore
requires deleting the table entry in the same commit; the table drops to **44**.

### `useSearchParams()` and the build (verified, not assumed)

`npx next build` at `c8665cd` prints `ƒ /songs/[id]/fast-view` — every app route
in this project is `ƒ (Dynamic) server-rendered on demand`, because
`src/proxy.ts` gates every request. I verified the concern empirically: I
temporarily added `const searchParams = useSearchParams()` plus a
`searchParams.get('bandId')` read to `FastViewPage`, ran `npx next build`, and it
exited 0 with the route still `ƒ`, with **no** "missing Suspense boundary with
`useSearchParams`" error. **No Suspense boundary is needed.** The probe edit was
reverted; the working tree is byte-identical to `c8665cd`.

### `e2e/fast-view-mobile.spec.ts` is RED at baseline (do not gate on it)

Verified locally at `c8665cd` after `npx next build`:

```
set -a; . ./.env.local; set +a; \
PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" \
npx playwright test e2e/fast-view-mobile.spec.ts --project=mobile
```

prints `2 failed` / `1 passed`. Both failures are the shared `addSong` helper
(`e2e/helpers.ts:57`, `dialog[open]` never reaching count 0) — the same RH-44
breakage that makes `e2e/songs-crud.spec.ts` red. It is therefore **not** an
expected result of this task. (Note also that `--project=chromium` runs zero
tests here: `playwright.config.ts` gives the `chromium` project
`testIgnore: '**/fast-view-mobile.spec.ts'` and routes that file to the
`mobile` project.) `e2e/ssr-smoke.spec.ts` (4 tests) is green and is the e2e
gate.

### Preserved asymmetry (deliberate, not a defect fixed here)

Desktop renders a **previous** arrow only; there is no next arrow, while the
mobile swipe supports both directions. This slice preserves that exactly — the
component is named `PlaylistPrevArrow` so the asymmetry is explicit rather than
accidental. A newly appearing next arrow is a regression, not an improvement.

## Approach

### 1. `src/lib/playlistNav.ts` (new, pure, no React, no DOM, no `window`)

Written in the style of `src/lib/stageInteraction.ts`: DOM-free decision helpers
with a module doc comment explaining why they are out here.

```ts
/** One playlist entry as the setlist UI needs it. Structurally identical to
 *  `PlaylistEntrySummary` in `src/lib/playlists.ts`, redeclared here so this
 *  client-safe module never pulls the `pg` pool into the browser bundle. */
export interface PlaylistEntry {
  repertoireId: string
  songId: string
  title: string
  artist: string | null
}

export interface PlaylistNav {
  prevId: string | null
  nextId: string | null
  position: number
  total: number
  playlistId: string
  playlistName: string
}

export type SlideDirection = 'left' | 'right'

/** `/playlists/<id>` -> `<id>`; anything else (incl. null) -> null. */
export function playlistIdFromReturnTo(returnTo: string | null): string | null

/** null when `entries` is empty or `currentRepertoireId` is not in it. */
export function computePlaylistNav(
  entries: PlaylistEntry[],
  currentRepertoireId: string,
  playlistId: string,
  playlistName: string,
): PlaylistNav | null

/** `/songs/<id>/fast-view?returnTo=..&bandId=..`, both omitted when empty,
 *  always in that order (byte-identical to today's `navigateTo`). */
export function fastViewHref(
  repertoireId: string,
  returnTo: string | null,
  bandId: string | null,
): string

/** 'left' when the target sits later in the list, otherwise 'right'. */
export function slideDirection(
  entries: PlaylistEntry[],
  currentRepertoireId: string,
  targetRepertoireId: string,
): SlideDirection

/** deltaX = startX - endX. |deltaX| < 60 -> null. */
export function swipeTarget(
  deltaX: number,
  nav: PlaylistNav | null,
): { repertoireId: string; direction: SlideDirection } | null

/** The full className of the page's <main>, including the transform. */
export function slideOutClassName(slideOut: SlideDirection | null): string

/** What the back button must do. */
export function backTarget(
  returnTo: string | null,
): { kind: 'push'; href: string } | { kind: 'back' }
```

`slideOutClassName` must return, character-for-character, the string the page
produces today:
`min-h-screen px-6 py-8 flex flex-col gap-6 max-w-xl mx-auto transition-transform duration-200 ease-in-out ` followed by
`-translate-x-full` / `translate-x-full` / `translate-x-0`.

`SWIPE_THRESHOLD_PX = 60` and `SLIDE_OUT_MS = 220` are exported named constants
so the hook and its tests share one source of truth.

### 2. `src/hooks/usePlaylistNav.ts` (new controller)

```ts
export interface PlaylistNavActions {
  /** Injected, never imported: `src/hooks` must not reach into `@/app/*`. */
  getPlaylistDetailsWithEntries: (
    playlistId: string,
    bandId?: string | null,
  ) => Promise<{ name: string; entries: PlaylistEntry[] }>
}

export interface UsePlaylistNavOptions {
  currentRepertoireId: string
  returnTo: string | null
  bandId: string | null
  actions: PlaylistNavActions
  /** `router.push` */
  navigate: (href: string) => void
  /** `router.back` */
  navigateBack: () => void
}

export interface PlaylistNavController {
  nav: PlaylistNav | null
  entries: PlaylistEntry[]
  isDrawerOpen: boolean
  slideOut: SlideDirection | null
  openDrawer: () => void
  closeDrawer: () => void
  /** No-op when `repertoireId` is the current entry. */
  selectEntry: (repertoireId: string) => void
  goPrev: () => void
  goBack: () => void
  onTouchStart: (clientX: number) => void
  onTouchEnd: (clientX: number) => void
}

export function usePlaylistNav(options: UsePlaylistNavOptions): PlaylistNavController
```

Behaviour, unchanged from the page:

- On mount and whenever `currentRepertoireId`, `returnTo` or `bandId` changes:
  if `playlistIdFromReturnTo(returnTo)` is null, do nothing (no request). Else
  call `actions.getPlaylistDetailsWithEntries(playlistId, bandId)`, and on
  success set `entries` and `computePlaylistNav(...)`. An empty entry list, a
  current id absent from the list, or a rejection all leave `nav` at `null` and
  are swallowed (navigation is optional; today's `.catch(() => {})`). A
  `cancelled` flag guards the unmount, exactly as `load()` does.
- `selectEntry(targetId)` returns immediately when `targetId ===
  currentRepertoireId`; otherwise sets `slideOut` to
  `slideDirection(entries, currentRepertoireId, targetId)` and, after
  `SLIDE_OUT_MS` (`setTimeout`, cleared on unmount), calls
  `navigate(fastViewHref(targetId, returnTo, bandId))`.
- `goPrev()` is `selectEntry(nav.prevId)` with an explicit `'right'` slide
  (matching the desktop arrow today), and is a no-op when `nav?.prevId` is null.
- `onTouchStart(clientX)` stores `clientX` in a ref; `onTouchEnd(clientX)`
  computes `deltaX = start - clientX`, clears the ref, and routes the result of
  `swipeTarget(deltaX, nav)` into the same slide-then-push path.
- `goBack()` switches on `backTarget(returnTo)`: `push` calls
  `navigate(href)`, `back` calls `navigateBack()`.

### 3. `src/app/fastViewNavActions.ts` (new, the injection point)

Module-level, so the object identity is stable across renders and cannot restart
the hook's effect (the `src/app/bandAdminActions.ts` pattern):

```ts
import { getPlaylistDetailsWithEntriesAction } from '@/app/actions/playlists'
import type { PlaylistNavActions } from '@/hooks/usePlaylistNav'

export const PLAYLIST_NAV_ACTIONS: PlaylistNavActions = {
  getPlaylistDetailsWithEntries: getPlaylistDetailsWithEntriesAction,
}
```

### 4. `src/components/fastview/*` (new, presentational)

Every one of these takes `nav: PlaylistNav | null` (or the equivalent) and
**returns `null` itself** when it has nothing to render. That is deliberate: it
keeps every nav conditional out of `FastViewPage`, which is what makes the
page's measured complexity drop.

| File | Component | Notes |
|---|---|---|
| `SetlistRow.tsx` | `SetlistRow` | The single shared row. Props `{ index, entry, isCurrent, variant: 'drawer' \| 'sidebar', onSelect }`. Renders the `w-5 shrink-0 text-right font-mono text-xs` position number, title, optional artist, and the current-row badge ending in `NOW`. `variant === 'sidebar'` appends `ring-1 ring-emerald-400/20` to the current row and `hover:border-gray-200` to an idle row; everything else is identical for both variants. Calls `onSelect(entry.repertoireId)` only when `!isCurrent`. |
| `SetlistPanel.tsx` | `SetlistPanel` | The header + scroll list shared by the drawer and the sidebar. Props `{ playlistName, trailing, headerClassName, entries, currentRepertoireId, variant, onSelect }`. Header is the music-note glyph plus `<h3 className="font-bold text-gray-900 text-sm truncate" title={playlistName}>`; body is `<div className="flex-1 overflow-y-auto p-4 flex flex-col gap-1.5">` mapping `entries` to `SetlistRow`. Existing to remove the header/container duplication, not only the row duplication. |
| `SetlistDrawer.tsx` | `SetlistDrawer` | `{ open, nav, entries, currentRepertoireId, onClose, onSelect }`. Returns `null` unless `open && nav`. Keeps `fixed inset-0 z-50 flex flex-col justify-end lg:hidden`, the backdrop, the `rounded-t-2xl max-h-[80vh] ... animate-in slide-in-from-bottom duration-200` sheet, and the close button. A row click calls `onClose()` and then `onSelect(id)`. |
| `SetlistSidebar.tsx` | `SetlistSidebar` | `{ nav, entries, currentRepertoireId, onSelect }`. Returns `null` unless `nav && entries.length > 0`. Root `<aside>` keeps `w-80 shrink-0 border-l border-gray-200 bg-white sticky top-0 h-screen overflow-y-auto hidden lg:flex flex-col z-20` verbatim (AGENTS.md contract), trailing badge `{position} / {total}`. |
| `SetlistSelect.tsx` | `SetlistSelect` | `{ nav, entries, currentRepertoireId, onSelect }`. Returns `null` unless `nav && entries.length > 0`. Same `lg:hidden` wrapper, same `<select value={currentRepertoireId}>`, same option text `"{idx+1}. {title} - {artist}"`. |
| `SetlistPill.tsx` | `SetlistPill` | `{ nav, onOpen }`. Returns `null` without `nav`. The `lg:hidden` pill whose label is `Setlist ({position}/{total})` (AGENTS.md contract). |
| `PlaylistPrevArrow.tsx` | `PlaylistPrevArrow` | `{ prevId, onNavigate }`. Returns `null` without `prevId`. The `fixed left-4 top-1/2 ... hidden lg:flex` button with `aria-label="Previous song"`. No next arrow (see "Preserved asymmetry"). |
| `SwipeHint.tsx` | `SwipeHint` | `{ nav }`. Returns `null` without `nav`. The `lg:hidden` strip with the two conditional arrow glyphs and `{position} / {total}`. |

### 5. `src/app/songs/[id]/fast-view/page.tsx` (edited)

- `useSearchParams` added to the existing `next/navigation` import; the
  `@/app/actions/playlists` import line is removed entirely and replaced by
  `import { PLAYLIST_NAV_ACTIONS } from '@/app/fastViewNavActions'`.
- Near the top of the component:
  `const searchParams = useSearchParams()`,
  `const returnTo = searchParams.get('returnTo')`,
  `const queryBandId = searchParams.get('bandId')`.
- The `load()` effect uses `queryBandId` directly (no `URLSearchParams`, no
  `typeof window` guard) and its dependency array becomes `[id, queryBandId]`.
  Lines 328-348 (the nav fetch) are deleted outright.
- The five nav `useState`s, the `touchStartX` ref and `navigateTo` are replaced
  by one `usePlaylistNav({ currentRepertoireId: id, returnTo, bandId:
  queryBandId, actions: PLAYLIST_NAV_ACTIONS, navigate: (href) =>
  router.push(href), navigateBack: () => router.back() })` call.
- The back button's `onClick` becomes `playlist.goBack`.
- `<main className={slideOutClassName(playlist.slideOut)}
  onTouchStart={(e) => playlist.onTouchStart(e.touches[0].clientX)}
  onTouchEnd={(e) => playlist.onTouchEnd(e.changedTouches[0].clientX)}>`.
- The seven JSX regions become seven self-guarding component elements in the
  **same DOM order** as today: `SetlistDrawer` and `PlaylistPrevArrow` before
  the layout `<div>`, `SetlistPill` in the back-button row, `SetlistSelect`
  after it, `SwipeHint` at the end of `<main>`, `SetlistSidebar` after
  `</main>`'s wrapper.

Nothing else in the page changes. In particular, no state, effect, handler or
JSX belonging to tabs, PDF Stage Mode, lyrics, status, links, delete
confirmation or the Toast may be touched.

### 6. Deletions

- `src/app/actions/playlists.ts`: delete `getPlaylistEntryIdsAction` and its doc
  comment. Drop the now-unused `PlaylistEntrySummary` import only if it becomes
  unused (it does not — `getPlaylistDetailsWithEntriesAction` still names it).
- `src/app/actions/__tests__/playlists.test.ts`: delete the import at line 36
  and the whole `describe('getPlaylistEntryIdsAction', ...)` block.
- `src/app/actions/__tests__/actionSessionGuard.test.ts`: delete the import at
  line 72 and the `FAIL_CLOSED` entry at line 156. The table goes from 45 to 44
  entries and `allExportedActionNames()` follows automatically.
- `src/app/actions/__tests__/actionAuthorizationGuard.test.ts`: update the
  comment at lines 26-29 so it no longer names the deleted action. Comment only
  — the `SESSION_RESOLVING_HELPERS` map and the assertion at line 65 must not
  change.

### 7. Test plan (exact files and test names)

**`src/lib/__tests__/playlistNav.test.ts`** — node environment, 20 tests:

- `playlistIdFromReturnTo` > `extracts the playlist id from a /playlists/:id returnTo`
- `playlistIdFromReturnTo` > `returns null for null, an empty string and a non-playlist returnTo`
- `playlistIdFromReturnTo` > `returns null for a nested path below /playlists/:id`
- `computePlaylistNav` > `reports position, total, previous and next for a middle entry`
- `computePlaylistNav` > `reports no previous for the first entry and no next for the last`
- `computePlaylistNav` > `returns null when the entry list is empty`
- `computePlaylistNav` > `returns null when the current repertoire id is not in the list`
- `computePlaylistNav` > `carries the playlist id and name through unchanged`
- `fastViewHref` > `preserves returnTo and bandId in that order`
- `fastViewHref` > `omits an absent returnTo and an absent bandId`
- `fastViewHref` > `percent-encodes the returnTo value`
- `slideDirection` > `slides left when the target is further down the setlist`
- `slideDirection` > `slides right when the target is further up the setlist`
- `swipeTarget` > `ignores a horizontal movement below the 60 pixel threshold`
- `swipeTarget` > `advances to the next entry on a leftward swipe`
- `swipeTarget` > `returns to the previous entry on a rightward swipe`
- `swipeTarget` > `returns null when the requested direction has no neighbour`
- `slideOutClassName` > `returns the untranslated classes when no slide is in progress`
- `slideOutClassName` > `translates the page fully left and fully right`
- `backTarget` > `pushes the returnTo path when there is one, and falls back to history when there is not`

**`src/hooks/__tests__/usePlaylistNav.test.tsx`** — `// @vitest-environment jsdom`
first line, `renderHook` + `act` from `@testing-library/react`,
`afterEach(cleanup)`, fake timers for the 220 ms slide, 11 tests:

- `does not call the playlist action when returnTo is not a playlist path`
- `loads the playlist entries and exposes the computed navigation`
- `exposes no navigation when the playlist action rejects`
- `exposes no navigation when the current entry is absent from the playlist`
- `opens and closes the drawer`
- `navigates to the selected entry after the slide-out delay, preserving returnTo and bandId`
- `does not navigate when the selected entry is the current one`
- `goPrev slides right to the previous entry and does nothing on the first entry`
- `advances to the next entry on a leftward swipe past the threshold`
- `ignores a swipe shorter than the threshold`
- `refetches the playlist when the bandId option changes`

**`src/components/fastview/__tests__/SetlistRow.test.tsx`** — jsdom, 5 tests:
`renders the one-based position, title and artist`;
`omits the artist line when the entry has none`;
`marks the current entry with the NOW badge and does not call onSelect for it`;
`calls onSelect with the repertoire id of a non-current entry`;
`adds the sidebar-only ring class only in the sidebar variant`.

**`src/components/fastview/__tests__/SetlistDrawer.test.tsx`** — jsdom, 5 tests:
`renders nothing when it is closed`;
`renders nothing when there is no playlist navigation`;
`shows the playlist name and one row per entry`;
`closes on the backdrop click and on the close button`;
`closes the drawer and selects the entry when a row is clicked`.

**`src/components/fastview/__tests__/SetlistSidebar.test.tsx`** — jsdom, 4 tests:
`renders nothing when there is no playlist navigation`;
`carries the desktop sidebar classes required by AGENTS.md`;
`shows the playlist name, the position counter and one row per entry`;
`calls onSelect with the clicked entry`.

**`src/components/fastview/__tests__/SetlistControls.test.tsx`** — jsdom, 10 tests
covering `SetlistPill` (2), `SetlistSelect` (3), `PlaylistPrevArrow` (2) and
`SwipeHint` (3), as listed in ER4.

That is 55 new tests across 6 new files, minus the 1 deleted alias test.

### 8. Conventions this task must not break

- No `alert()` / `confirm()` anywhere (`src/lib/__tests__/noBrowserDialogs.test.ts`
  walks all of `src/`).
- No `catch (x: any)`; the P1 pattern applies to any new catch in a component
  (`src/lib/__tests__/errorHandlingStyle.test.ts` walks all of `src/`). The
  playlist-fetch catch stays a deliberate S1 swallow with its one-line comment.
- Nothing under `src/lib`, `src/hooks` or `src/components` may import `@/app/*`
  (`no-restricted-imports` in `eslint.config.mjs`).
- The AGENTS.md "Fast View Playlist Layout" classes are a contract, not a
  description.
- This is an internal refactor with no user-facing feature: it is **not** a
  landing-page selling point, and the landing copy must not change.

## Expected Results

ER1 - From the project root the following eleven files exist and are non-empty: `src/lib/playlistNav.ts`, `src/hooks/usePlaylistNav.ts`, `src/app/fastViewNavActions.ts`, `src/components/fastview/SetlistRow.tsx`, `src/components/fastview/SetlistPanel.tsx`, `src/components/fastview/SetlistDrawer.tsx`, `src/components/fastview/SetlistSidebar.tsx`, `src/components/fastview/SetlistSelect.tsx`, `src/components/fastview/SetlistPill.tsx`, `src/components/fastview/PlaylistPrevArrow.tsx`, `src/components/fastview/SwipeHint.tsx`. `grep -rn "@/app/" src/lib/playlistNav.ts src/hooks/usePlaylistNav.ts src/components/fastview` prints nothing and exits with status 1. `grep -rln "usePlaylistNav" src` lists exactly these four paths and no others, in any order: `src/hooks/usePlaylistNav.ts`, `src/hooks/__tests__/usePlaylistNav.test.tsx`, `src/app/fastViewNavActions.ts`, `src/app/songs/[id]/fast-view/page.tsx`. `grep -c "PLAYLIST_NAV_ACTIONS" "src/app/songs/[id]/fast-view/page.tsx"` prints a number greater than 0.

ER2 - `npx vitest run src/lib/__tests__/playlistNav.test.ts --reporter=verbose` exits 0 and reports at least 20 passed and 0 failed tests, among which these exact names all appear and pass: `extracts the playlist id from a /playlists/:id returnTo`, `returns null for null, an empty string and a non-playlist returnTo`, `returns null for a nested path below /playlists/:id`, `reports position, total, previous and next for a middle entry`, `reports no previous for the first entry and no next for the last`, `returns null when the entry list is empty`, `returns null when the current repertoire id is not in the list`, `carries the playlist id and name through unchanged`, `preserves returnTo and bandId in that order`, `omits an absent returnTo and an absent bandId`, `percent-encodes the returnTo value`, `slides left when the target is further down the setlist`, `slides right when the target is further up the setlist`, `ignores a horizontal movement below the 60 pixel threshold`, `advances to the next entry on a leftward swipe`, `returns to the previous entry on a rightward swipe`, `returns null when the requested direction has no neighbour`, `returns the untranslated classes when no slide is in progress`, `translates the page fully left and fully right`, `pushes the returnTo path when there is one, and falls back to history when there is not`.

ER3 - `npx vitest run src/hooks/__tests__/usePlaylistNav.test.tsx --reporter=verbose` exits 0 and reports at least 11 passed and 0 failed tests, among which these exact names all appear and pass: `does not call the playlist action when returnTo is not a playlist path`, `loads the playlist entries and exposes the computed navigation`, `exposes no navigation when the playlist action rejects`, `exposes no navigation when the current entry is absent from the playlist`, `opens and closes the drawer`, `navigates to the selected entry after the slide-out delay, preserving returnTo and bandId`, `does not navigate when the selected entry is the current one`, `goPrev slides right to the previous entry and does nothing on the first entry`, `advances to the next entry on a leftward swipe past the threshold`, `ignores a swipe shorter than the threshold`, `refetches the playlist when the bandId option changes`. The first line of that file is exactly `// @vitest-environment jsdom` and the file contains `afterEach(cleanup)`.

ER4 - `npx vitest run src/components/fastview --reporter=verbose` exits 0 and reports at least 24 passed and 0 failed tests across exactly these four files: `src/components/fastview/__tests__/SetlistRow.test.tsx` (at least 5 tests, including `marks the current entry with the NOW badge and does not call onSelect for it` and `adds the sidebar-only ring class only in the sidebar variant`), `src/components/fastview/__tests__/SetlistDrawer.test.tsx` (at least 5 tests, including `renders nothing when it is closed` and `closes the drawer and selects the entry when a row is clicked`), `src/components/fastview/__tests__/SetlistSidebar.test.tsx` (at least 4 tests, including `carries the desktop sidebar classes required by AGENTS.md`, which asserts that the rendered `aside` element's class attribute contains every one of `w-80`, `shrink-0`, `border-l`, `border-gray-200`, `bg-white`, `sticky`, `top-0`, `h-screen`), and `src/components/fastview/__tests__/SetlistControls.test.tsx` (at least 10 tests, including `renders a Previous song button that calls onNavigate`, which asserts a button with `aria-label="Previous song"`, and a `SetlistPill` test asserting the rendered label text matches the regular expression `Setlist \(\d+/\d+\)`). Every one of those four files has `// @vitest-environment jsdom` as its literal first line and calls `afterEach(cleanup)`.

ER5 - `grep -c "window.location.search" "src/app/songs/[id]/fast-view/page.tsx"` prints `0` (it printed `4` at commit `c8665cd`), and `grep -c "useSearchParams" "src/app/songs/[id]/fast-view/page.tsx"` prints a number greater than 0. `grep -rn "getPlaylistEntryIdsAction" src` prints nothing and exits with status 1. `grep -c "export async function" src/app/actions/playlists.ts` prints exactly one less than it printed at `c8665cd`. `grep -c "mode: '" src/app/actions/__tests__/actionSessionGuard.test.ts` prints `44` (it prints `45` at `c8665cd`; the unquoted `mode: FailMode` type declaration is not matched). `npx vitest run src/app/actions/__tests__/actionSessionGuard.test.ts src/app/actions/__tests__/actionAuthorizationGuard.test.ts src/app/actions/__tests__/actionDataAccessGuard.test.ts src/app/actions/__tests__/playlists.test.ts` exits 0 with 0 failed tests.

ER6 - `npx eslint src/lib/playlistNav.ts src/hooks/usePlaylistNav.ts src/app/fastViewNavActions.ts src/components/fastview --rule '{"complexity":["error",15],"max-lines-per-function":["error",200]}'` exits 0 and prints no output at all. `wc -l` on each of the eleven files listed in ER1 prints a number strictly less than 400. `wc -l "src/app/songs/[id]/fast-view/page.tsx"` prints a number strictly less than 1500 (it printed 1625 at `c8665cd`). `npx eslint "src/app/songs/[id]/fast-view/page.tsx" --rule '{"complexity":["error",15]}'` prints exactly one line matching `Function 'FastViewPage' has a complexity of N`, and that N is at most 79 (it was 88 at `c8665cd`).

ER7 - `npx eslint .` prints the summary line `28 problems (12 errors, 16 warnings)` and nothing worse, and `npx eslint "src/app/songs/[id]/fast-view/page.tsx"` prints the summary line `4 problems (2 errors, 2 warnings)`, with the four remaining problems being one `prefer-const` error on the `let html` declaration inside `parseLyricsMarkdown` (its line number shifts, because the page gains net new import lines above it), two `no-unused-vars` warnings for `uploadDestination` and `setUploadDestination`, and one `no-explicit-any`. `./node_modules/.bin/tsc --noEmit` exits 0 and prints nothing. `npm run lint:dead` exits 0 and reports no unused files, exports, types or dependencies. `npm run lint:dup` exits 0 and prints `Found N clones.` with N at most 18 (it was 19 at `c8665cd`), with a total duplicated-lines percentage at most 0.88% and no reported clone whose two locations are both inside `src/app/songs/[id]/fast-view/page.tsx`. `npm run audit` exits 0 and reports 0 vulnerabilities.

ER8 - `git diff c8665cd -- src/lib/__tests__/erasePersistence.test.ts src/lib/__tests__/stageInteraction.test.ts src/lib/__tests__/annotationMath.test.ts src/lib/__tests__/pdfWorkerAsset.test.ts src/components/tabs/__tests__/TabDrawingStage.test.tsx src/lib/__tests__/noBrowserDialogs.test.ts src/lib/__tests__/errorHandlingStyle.test.ts` prints nothing, and `npx vitest run src/lib/__tests__/erasePersistence.test.ts src/lib/__tests__/stageInteraction.test.ts src/lib/__tests__/annotationMath.test.ts src/lib/__tests__/pdfWorkerAsset.test.ts src/components/tabs/__tests__/TabDrawingStage.test.tsx src/lib/__tests__/noBrowserDialogs.test.ts src/lib/__tests__/errorHandlingStyle.test.ts` exits 0 with 0 failed tests.

ER9 - With a live Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with all migrations applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` exported into the environment (for example `set -a; . ./.env.local; set +a`), `npx vitest run` exits 0 and its summary reports at least 65 test files passed, 0 test files failed, at least 790 tests passed, 0 tests failed and 0 tests skipped (the same command at `c8665cd` reported 59 files and 736 tests).

ER10 - Under the same Postgres and `SUPABASE_SERVICE_ROLE_KEY` precondition as ER9, `npm run test:coverage` exits 0 with no threshold error, and in its per-file table the `All files` row shows statements at least 95, branches at least 78, functions at least 97 and lines at least 95; the `playlistNav.ts` row shows statements 100, functions 100, lines 100 and branches at least 90; and the `usePlaylistNav.ts` row shows statements at least 95, branches at least 78, functions at least 90 and lines at least 95.

ER11 - `npx next build` exits 0, prints no error mentioning a missing Suspense boundary or `useSearchParams`, and its route table lists `/songs/[id]/fast-view` marked `f` (Dynamic, server-rendered on demand). Immediately afterwards, `set -a; . ./.env.local; set +a; PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" npx playwright test e2e/ssr-smoke.spec.ts --project=chromium` prints `4 passed` and exits 0.

ER12 - `git diff --name-only c8665cd` lists only paths drawn from this closed set and nothing else: `AGENTS.md`, `package.json`, `.meridian/tasks.json`, `docs/tasks/RH-48-spec.md`, `docs/suggestions-log.md`, `src/app/songs/[id]/fast-view/page.tsx`, `src/app/fastViewNavActions.ts`, `src/app/actions/playlists.ts`, `src/app/actions/__tests__/playlists.test.ts`, `src/app/actions/__tests__/actionSessionGuard.test.ts`, `src/app/actions/__tests__/actionAuthorizationGuard.test.ts`, `src/lib/playlistNav.ts`, `src/lib/__tests__/playlistNav.test.ts`, `src/hooks/usePlaylistNav.ts`, `src/hooks/__tests__/usePlaylistNav.test.tsx`, `src/components/fastview/SetlistRow.tsx`, `src/components/fastview/SetlistPanel.tsx`, `src/components/fastview/SetlistDrawer.tsx`, `src/components/fastview/SetlistSidebar.tsx`, `src/components/fastview/SetlistSelect.tsx`, `src/components/fastview/SetlistPill.tsx`, `src/components/fastview/PlaylistPrevArrow.tsx`, `src/components/fastview/SwipeHint.tsx`, `src/components/fastview/__tests__/SetlistRow.test.tsx`, `src/components/fastview/__tests__/SetlistDrawer.test.tsx`, `src/components/fastview/__tests__/SetlistSidebar.test.tsx`, `src/components/fastview/__tests__/SetlistControls.test.tsx`. In particular that list contains no path under `migrations/`, no `eslint.config.mjs`, no `vitest.config.ts`, no `src/lib/tabs.ts`, no `src/lib/songs.ts`, no `docs/plans/code-quality-review.md` and no file under `src/components/landing/` or `src/i18n/dictionaries/`. The `version` field in `package.json` matches `0.1.76-` followed by exactly twelve digits, and `git diff c8665cd -- src/components/landing/LandingPage.tsx src/i18n/dictionaries/en.json src/i18n/dictionaries/pt-BR.json` prints nothing.

## Out of Scope

- The other four Fast View slices: tabs/upload with the destination modal
  (RH-49), the PDF Stage Mode overlay including `findScrollHost` and the visual
  viewport measurement (RH-50), lyrics and `parseLyricsMarkdown` (RH-51), and
  the entry load / band-vs-personal reconciliation / status dropdown / links /
  delete confirmation / page shell (RH-52). The page keeps all of them
  unchanged.
- Reaching the F6 target (no function over complexity 15, no file over 400
  lines) for `page.tsx` itself. That is RH-38's integration task, after all five
  parts land.
- Closing F6 or F26 in `docs/plans/code-quality-review.md`. That file must not
  be edited by this task; RH-38 closes both findings.
- Adding a desktop **next** arrow. The current previous-only asymmetry is
  preserved verbatim.
- Fixing `e2e/fast-view-mobile.spec.ts` or `e2e/songs-crud.spec.ts`. Both are
  red at `c8665cd` for the same RH-44 `addSong` helper reason and are not gates
  here.
- Adding ESLint complexity budgets to `eslint.config.mjs` (RH-39) — that must
  land after all five RH-38 parts, or the page fails `npx eslint .` for the
  whole decomposition.
- Any landing-page or dictionary change: this refactor ships no user-facing
  selling point.
- Any change to `migrations/`, `vitest.config.ts`, `src/lib/tabs.ts` or
  `src/lib/songs.ts`.

## Post-merge checks (orchestrator)

- Re-run `npx eslint "src/app/songs/[id]/fast-view/page.tsx" --rule '{"complexity":["error",15],"max-lines-per-function":["error",200]}'` and record the new complexity and line count in the RH-38 tracking notes, so parts 2-5 each get a fresh floor to beat.
- RH-49's spec should be written against the post-RH-48 page, not against `c8665cd` line numbers.

# RH-51 - Fast View parte 4/5: extrair letras, editor, auto-import e Stage Mode de letra

Part 4 of 5 of the RH-38 decomposition of `src/app/songs/[id]/fast-view/page.tsx`
(parent RH-38; RH-25 T5, covers F6). Baseline for every measurement in this spec
is `bf0c97e` ("refactor(RH-50): extract the Fast View PDF Stage Mode overlay"),
where the page is 964 lines and `FastViewPage` has an ESLint cyclomatic
complexity of 54.

## Scope

This task moves the **lyrics half** of the Fast View page out of the page and
nothing else. Concretely it covers:

- `parseLyricsMarkdown` (page lines 30-40) moved into `src/lib/lyricsMarkdown.ts`,
  with the escaping / XSS tests it has never had;
- the lyrics/version-selection helpers (`hasDifferentPersonalLyrics`,
  `displayedLyrics`, the save-target resolution buried inside `handleSaveLyrics`)
  and the Stage Mode font-size clamp extracted as pure functions in
  `src/lib/lyricsEditor.ts`, which also declares the controller contract;
- one controller hook `src/hooks/useLyricsEditor.ts` owning the edit state, the
  save (through an injected `updateLyrics`), the auto-import (through an injected
  `fetchLyrics`), the band/personal switch, the Stage Mode font size and dark
  mode, and the lyrics Stage Mode open/close **including the lyrics-half popstate
  effect that RH-50 deliberately left on the page**, reusing
  `src/lib/stageHistory.ts` unchanged;
- three presentational components under `src/components/fastview/`:
  `LyricsSection.tsx`, `LyricsEditorPanel.tsx` and `LyricsStageOverlay.tsx`;
- one new composition root `src/app/fastViewLyricsActions.ts` wiring
  `updateLyricsAction`, `fetchLyricsAction` and `addSongAction`;
- unit tests for the two lib modules, `renderHook` tests for the controller with
  injected fake actions, and jsdom tests for the components.

It is a behaviour-preserving refactor: no user-visible change, no schema change,
no change to `TabDrawingStage`, `usePdfStage`, `useTabLibrary` or any RH-20 /
RH-28 guard test.

What this task does **not** cover: the page's `entry` / `personalEntry` state,
the entry load, the status dropdown, the links section and the page shell, all of
which are RH-52 (part 5); the second pre-existing ESLint error in the page
(`@typescript-eslint/no-explicit-any` in the status dropdown), which belongs to
RH-52 and stays exactly as it is; the two red RH-44 e2e specs; and any landing
page copy.

## Audit at bf0c97e

Every lyrics-related site in `src/app/songs/[id]/fast-view/page.tsx` (964 lines),
with its line range and its destination.

| Lines | What is there today | Destination |
|---|---|---|
| 8 | the `@/app/actions/repertoire` import list, which includes `updateLyricsAction`, `fetchLyricsAction` and `addSongAction` | all three drop off the page import and are wired in `src/app/fastViewLyricsActions.ts`. `addSongAction` has no other page use (its only call site is `handleSaveLyrics` line 287; the tab library reaches it through `TAB_LIBRARY_ACTIONS`), so leaving it in the page import would raise a fresh `no-unused-vars` warning |
| 12 | `import { isStageHistoryEntry, stageHistoryState } from '@/lib/stageHistory'` | moves to `src/hooks/useLyricsEditor.ts`; the page keeps no Stage Mode history code |
| 30-40 | `function parseLyricsMarkdown(text)`: escapes `&`, `<`, `>`, then rewrites `**bold**`, `*em*`, `__u__` and `[chord]`; holds the `prefer-const` error on `let html` | moves to `src/lib/lyricsMarkdown.ts`; the `let` binding is dropped, which retires that ESLint error |
| 112-116 | `// Lyrics state` plus `isEditingLyrics`, `lyricsText`, `savingLyrics`, `fetchingLyrics` | become `isEditing`, `draft`, `saving`, `fetching` inside `useLyricsEditor` |
| 135-138 | `// Stage mode states` plus `isStageMode` (136), `lyricsFontSize` (137, initial `18`), `isStageDarkMode` (138) | become `isStageOpen`, `fontSize`, `isDarkMode` inside `useLyricsEditor` |
| 141-142 | `personalEntry` / `loadingPersonal` state | **stays** on the page (RH-52). `personalEntry` is passed into the hook; `loadingPersonal` is passed into `LyricsSection` |
| 143 | `const [showPersonalLyrics, setShowPersonalLyrics] = useState(false)` | becomes `showPersonalLyrics` inside `useLyricsEditor` |
| 178-194 | the lyrics-half popstate effect RH-50 left behind: `if (!isStageMode) return`, `window.history.pushState(stageHistoryState(), '')`, a `handlePopState` clearing `isStageMode`, subscribe/unsubscribe on `popstate` | moves verbatim into `useLyricsEditor`, keyed on `isStageOpen` |
| 196-201 | `closeStageMode`: clears `isStageMode`, then `if (isStageHistoryEntry(window.history.state)) window.history.back()` | becomes `closeStage()` inside `useLyricsEditor`, character for character |
| 215 | `setLyricsText(data.lyrics ?? '')` inside the entry-load effect | **deleted**, see "The load-time draft seed" below |
| 272 | `const hasDifferentPersonalLyrics = !!(entry.band_id && personalEntry && personalEntry.lyrics && personalEntry.lyrics !== entry.lyrics)` | becomes `hasDifferentPersonalLyrics(entry, personalEntry)` in `src/lib/lyricsEditor.ts` |
| 273 | `const displayedLyrics = (entry.band_id && showPersonalLyrics && personalEntry) ? personalEntry.lyrics : entry.lyrics` | becomes `selectDisplayedLyrics(entry, personalEntry, showPersonalLyrics)` in `src/lib/lyricsEditor.ts` |
| 275-308 | `handleSaveLyrics`: picks `targetId`/`targetBandId`, creates the personal entry with `addSongAction` when the member has none, calls `updateLyricsAction`, updates `personalEntry` **or** `entry`, leaves edit mode, toasts `Lyrics saved successfully!` / `Failed to save lyrics` | becomes `save()` inside `useLyricsEditor`; the target choice becomes `resolveLyricsSaveTarget` in `src/lib/lyricsEditor.ts`; the two state updates become the injected callbacks below |
| 310-330 | `handleAutoImportLyrics`: refuses without an artist, calls `fetchLyricsAction(artist, title)`, writes the result into the draft, toasts the four verbatim messages | becomes `autoImport()` inside `useLyricsEditor` |
| 665-802 | the whole `<section aria-label="Lyrics">`: heading with the Band/Personal badge (670-680), Stage Mode and Edit/Add buttons (682-704), the version-switcher banner (708-719), the editor block (721-783) and the read-only viewer with its skeleton and empty state (784-801) | splits into `LyricsSection.tsx` (heading, badge, buttons, banner, viewer) and `LyricsEditorPanel.tsx` (the 721-783 editor block) |
| 833-912 | the lyrics Stage Mode overlay: full-screen root with `style={{ fontSize: \`${lyricsFontSize}px\` }}` and the light/dark surface classes, the sticky header with the title and `Tom: {key}`, the dark-mode toggle, the `A-` / `A+` buttons (`Math.max(12, prev - 2)` / `Math.min(36, prev + 2)`), the red close button calling `closeStageMode`, and the `dangerouslySetInnerHTML` lyrics body | moves verbatim to `LyricsStageOverlay.tsx` |
| 789, 908 | the two `dangerouslySetInnerHTML={{ __html: parseLyricsMarkdown(displayedLyrics) }}` sites | move with their components; both import `parseLyricsMarkdown` from `@/lib/lyricsMarkdown` |

Untouched by this task and confirmed as such: `entry` / `setEntry` (108),
`loading` / `notFound` (109-110), the status dropdown (119-120, 333-346,
498-545), the links state and handlers (130-133, 348-442, 563-663), the tab
library and PDF stage wiring (148-165), the playlist wiring (169-176), the entry
load effect (203-241) apart from its line 215, the tags section (805-819) and
every overlay from line 914 on.

Measured baselines used by the Expected Results (all at `bf0c97e`):

- `wc -l "src/app/songs/[id]/fast-view/page.tsx"` prints `964`.
- `rtk proxy npx eslint "src/app/songs/[id]/fast-view/page.tsx" --rule '{"complexity":["error",15]}'`
  prints three problem lines, one of which is
  `Function 'FastViewPage' has a complexity of 54. Maximum allowed is 15`.
- `rtk proxy npx eslint .` prints `26 problems (12 errors, 14 warnings)`;
  `rtk proxy npx eslint "src/app/songs/[id]/fast-view/page.tsx"` prints
  `2 problems (2 errors, 0 warnings)` (the `prefer-const` this task retires, plus
  the RH-52 `no-explicit-any`).
- `grep -c "parseLyricsMarkdown\|updateLyricsAction\|fetchLyricsAction\|lyricsFontSize\|isStageMode\|popstate" "src/app/songs/[id]/fast-view/page.tsx"`
  prints `14`.
- `npm run lint:dup` prints `Found 18 clones.` with 230 duplicated lines (0.76%).
- `npx vitest run` reports 74 files / 884 tests / 0 skipped, with Postgres up.

A throwaway copy of the page with exactly the regions above removed and the
wiring of section 6 added measures **674 lines** and `FastViewPage` **complexity
30**, which is where the bounds in ER7 come from.

### The RH-52 boundary for `entry` / `personalEntry` (explicit contract)

The page keeps owning `entry` and `personalEntry` (RH-52 owns them for good).
`useLyricsEditor` therefore **reads** both as options and **never** holds a copy;
when a save changes lyrics it hands the new text back through three injected
callbacks, each the exact `setState` call the page makes today:

| Hook option | Page passes | Replaces page code |
|---|---|---|
| `onEntryLyricsSaved(lyrics)` | `(lyrics) => setEntry(prev => prev ? { ...prev, lyrics } : null)` | line 299 |
| `onPersonalLyricsSaved(lyrics)` | `(lyrics) => setPersonalEntry(prev => prev ? { ...prev, lyrics } : null)` | line 297 |
| `onPersonalEntryCreated(created)` | `setPersonalEntry` | line 288 |

`onPersonalEntryCreated` is deliberately the same name and the same shape as
`useTabLibrary`'s option (RH-49), because it is the same event: this controller
called `addSong` and the page must adopt the row it got back. Two separate
"lyrics saved" callbacks rather than one with a target flag, because the page's
two updaters are genuinely different setters and a flag would only re-encode the
branch the hook already resolved.

Nothing else crosses the boundary: the hook does not read `entry.status`,
`entry.tags` or `entry.song.links`, and it never calls `router`.

### The load-time draft seed (explicit decision)

Page line 215 seeds `lyricsText` from the freshly loaded entry. That write is
**unobservable**: the textarea only exists while `isEditingLyrics` is true, and
the sole way into that state is the Edit/Add button at 692-703, which itself does
`setLyricsText(displayedLyrics ?? '')` first. `handleAutoImportLyrics` and
`handleSaveLyrics` are likewise reachable only from inside the editor. So the
draft's value before the Edit button is pressed can never reach the screen or the
server.

**Decision.** The line is deleted rather than reproduced as an effect in the
hook. `draft` starts as `''`, and `startEditing()` seeds it from the currently
displayed lyrics exactly as the button does today. ER4 pins that seeding with a
named test, so the equivalence is checked and not merely asserted here.

## Approach

### 1. `src/lib/lyricsMarkdown.ts` (new)

Pure, no DOM, no React, default `node` test environment. One export:

```ts
/**
 * The Fast View lyrics mini-markdown, rendered to HTML.
 *
 * The three escapes run FIRST and in this order (`&` before `<` and `>`), so
 * user text can never introduce markup and an escaped entity can never be
 * double-escaped. Everything emitted afterwards is markup this function chose.
 */
export function parseLyricsMarkdown(text: string): string
```

The body is page lines 31-39 with the `let html = ... ; return html` binding
replaced by a direct `return text.replace(...)...` chain. The replacement order,
the four markup rules and the chord badge's class string
(`text-emerald-700 bg-emerald-50 px-1 py-0.5 rounded border border-emerald-100 text-xs font-semibold select-all`)
are moved character for character. Dropping the binding is what retires the
page's `prefer-const` error; no other ESLint problem is touched.

**XSS safety.** The security property this module carries is: after the three
escapes, no `<` or `>` from `text` survives, so a pasted `<script>`,
`<img onerror=...>` or `</div>` is inert text. It has never had a test. This task
adds them (ER2).

Tests: `src/lib/__tests__/lyricsMarkdown.test.ts`, default `node` environment
(the file must **not** contain `@vitest-environment`, which is itself proof the
module touches no DOM). One constraint on the fixtures: the repository guard
`src/lib/__tests__/noBrowserDialogs.test.ts` scans every `.ts`/`.tsx` under
`src/` for `alert(` and `confirm(` outside comments, so the injection fixtures
must not spell those calls - use `<script>document.title = 'pwned'</script>` and
`<img src=x onerror=boom()>`. Eleven tests, names in ER2.

### 2. `src/lib/lyricsEditor.ts` (new)

Pure decision helpers plus the controller contract, following exactly the
`src/lib/tabLibrary.ts` pattern from RH-49. No DOM, no React value import (the
only React reference is an erased `import type`, and here there is none), no
`@/app/*` import.

```ts
/** The slice of a repertoire row the lyrics helpers read. `Repertoire` fits structurally. */
export interface LyricsSource {
  band_id: string | null
  lyrics: string | null
}

export const LYRICS_FONT_MIN = 12
export const LYRICS_FONT_MAX = 36
export const LYRICS_FONT_DEFAULT = 18
export const LYRICS_FONT_STEP = 2

/** Clamps a Stage Mode font size into [LYRICS_FONT_MIN, LYRICS_FONT_MAX]. */
export function clampLyricsFontSize(size: number): number

/** `current + delta`, clamped. The A- / A+ buttons pass -/+ LYRICS_FONT_STEP. */
export function stepLyricsFontSize(current: number, delta: number): number

/** True when a band entry's member has their own, non-empty, different lyrics. */
export function hasDifferentPersonalLyrics(
  entry: LyricsSource | null,
  personalEntry: LyricsSource | null,
): boolean

/** Which lyrics text is on screen: the personal version only in a band, only when selected, only when loaded. */
export function selectDisplayedLyrics(
  entry: LyricsSource | null,
  personalEntry: LyricsSource | null,
  showPersonalLyrics: boolean,
): string | null

/** Where a lyrics save is issued. A null `repertoireId` means "create the personal entry first". */
export interface LyricsSaveTarget {
  repertoireId: string | null
  /** The `bandId` argument of `updateLyrics`; null for a personal row. */
  bandId: string | null
  /** True when the saved text belongs to the page's `personalEntry` state rather than `entry`. */
  toPersonalEntry: boolean
}

export function resolveLyricsSaveTarget(args: {
  entryId: string
  entryBandId: string | null
  personalRepertoireId: string | null
  showPersonalLyrics: boolean
}): LyricsSaveTarget

/** Everything `useLyricsEditor` exposes, declared here so the components never import `src/hooks`. */
export interface LyricsEditorController {
  /** `entry.band_id` is set: drives the Band/Personal badge. */
  isBandEntry: boolean
  displayedLyrics: string | null
  hasDifferentPersonalLyrics: boolean
  showPersonalLyrics: boolean
  toggleVersion: () => void
  isEditing: boolean
  draft: string
  setDraft: (text: string) => void
  startEditing: () => void
  cancelEditing: () => void
  saving: boolean
  save: () => Promise<void>
  fetching: boolean
  autoImport: () => Promise<void>
  isStageOpen: boolean
  openStage: () => void
  closeStage: () => void
  fontSize: number
  increaseFont: () => void
  decreaseFont: () => void
  isDarkMode: boolean
  toggleDarkMode: () => void
}
```

Semantics, transcribed from the page:

- `hasDifferentPersonalLyrics` is page line 272 verbatim, with a null `entry`
  yielding `false`.
- `selectDisplayedLyrics` is page line 273 verbatim, with a null `entry` yielding
  `null`.
- `resolveLyricsSaveTarget` is page lines 281-292: when `entryBandId` is set
  **and** `showPersonalLyrics` is true it returns
  `{ repertoireId: personalRepertoireId, bandId: null, toPersonalEntry: true }`
  (a null `personalRepertoireId` being the "create it" signal), otherwise
  `{ repertoireId: entryId, bandId: entryBandId, toPersonalEntry: false }`.

Note the deliberate naming: the controller field is `isStageOpen`, not
`isStageMode`, and `fontSize`, not `lyricsFontSize`. That is what lets ER6 assert
a flat `0` for the page's Stage Mode greps instead of an unfalsifiable
"the remaining matches are only prop names".

Tests: `src/lib/__tests__/lyricsEditor.test.ts`, default `node` environment,
eighteen tests, names in ER3.

### 3. `src/hooks/useLyricsEditor.ts` (new) - the single controller

```ts
/**
 * The lyrics Server Actions the controller calls. Injected rather than imported,
 * so `src/hooks` never points back into the App Router tree (F21).
 * Required and never defaulted - a default would have to import that tree.
 */
export interface LyricsEditorActions {
  updateLyrics: (repertoireId: string, lyrics: string, bandId: string | null) => Promise<void>
  fetchLyrics: (artist: string, title: string) => Promise<string | null>
  /** Creates the member's own entry the first time they save personal lyrics. */
  addSong: (songId: string) => Promise<Repertoire>
}

export interface UseLyricsEditorOptions {
  /** The route's entry; null until it loads. Owned by the page (RH-52). */
  entry: Repertoire | null
  /** The member's own entry in band context, else null. Owned by the page (RH-52). */
  personalEntry: Repertoire | null
  /** `entry.song?.title ?? '(untitled)'` - the auto-import query and its toast. */
  songTitle: string
  /** `entry.song?.artist ?? ''` - the auto-import query and its toast. */
  artist: string
  /** Required, never defaulted - see `src/app/fastViewLyricsActions.ts` (F21). */
  actions: LyricsEditorActions
  onEntryLyricsSaved: (lyrics: string) => void
  onPersonalLyricsSaved: (lyrics: string) => void
  onPersonalEntryCreated: (entry: Repertoire) => void
  /** `showToast` from the page's `useToast`. */
  notify: (message: string, tone: ToastTone) => void
}

export function useLyricsEditor(options: UseLyricsEditorOptions): LyricsEditorController
```

Internal state, one per page state it replaces: `isEditing`, `draft`, `saving`,
`fetching`, `showPersonalLyrics`, `isStageOpen`, `fontSize` (initial
`LYRICS_FONT_DEFAULT`, i.e. 18) and `isDarkMode`. Derived, per render:
`const displayed = selectDisplayedLyrics(entry, personalEntry, showPersonalLyrics)`.

`save()` is page lines 276-308 with the target choice delegated:

```ts
if (!entry) return
try {
  setSaving(true)
  const target = resolveLyricsSaveTarget({
    entryId: entry.id,
    entryBandId: entry.band_id,
    personalRepertoireId: personalEntry?.id ?? null,
    showPersonalLyrics,
  })
  let repertoireId = target.repertoireId
  if (repertoireId === null) {
    const created = await actions.addSong(entry.song_id)
    onPersonalEntryCreated(created)
    repertoireId = created.id
  }
  await actions.updateLyrics(repertoireId, draft, target.bandId)
  if (target.toPersonalEntry) onPersonalLyricsSaved(draft)
  else onEntryLyricsSaved(draft)
  setIsEditing(false)
  notify('Lyrics saved successfully!', 'success')
} catch {
  notify('Failed to save lyrics', 'error')
} finally {
  setSaving(false)
}
```

`autoImport()` is page lines 311-330 with `actions.fetchLyrics` in place of the
direct import. All six Toast strings are preserved character for character,
tone included:

| Message | Tone | Where |
|---|---|---|
| `Lyrics saved successfully!` | `success` | `save`, page 302 |
| `Failed to save lyrics` | `error` | `save`, page 304 |
| `Artist name is required to search for lyrics.` | `warning` | `autoImport`, page 313 |
| `Lyrics imported online!` | `success` | `autoImport`, page 321 |
| `` Lyrics not found online for "${songTitle}" by "${artist}". You can still paste them below. `` | `warning` | `autoImport`, page 323 |
| `Failed to import lyrics from web. You can still paste them below.` | `error` | `autoImport`, page 326 |

Stage Mode, reusing `@/lib/stageHistory` exactly as `usePdfStage` does and with
no change to that module:

```ts
const openStage = useCallback(() => setIsStageOpen(true), [])

const closeStage = useCallback(() => {
  setIsStageOpen(false)
  if (isStageHistoryEntry(window.history.state)) window.history.back()
}, [])

useEffect(() => {
  if (!isStageOpen) return
  window.history.pushState(stageHistoryState(), '')
  const handlePopState = () => setIsStageOpen(false)
  window.addEventListener('popstate', handlePopState)
  return () => {
    window.removeEventListener('popstate', handlePopState)
  }
}, [isStageOpen])
```

This is the lyrics half RH-50 left on the page, moved unchanged; after this task
the literal `{ stageMode: true }` still exists only in `src/lib/stageHistory.ts`
and its test, and both stage controllers push and test the same marker.

The remaining members are one-liners: `startEditing` sets `draft` to
`displayed ?? ''` then `isEditing` true; `cancelEditing` does the same and sets
`isEditing` false (page 754-757); `toggleVersion` flips `showPersonalLyrics`
(page 713); `increaseFont` / `decreaseFont` are
`setFontSize(prev => stepLyricsFontSize(prev, +/- LYRICS_FONT_STEP))`, which is
`Math.min(36, prev + 2)` / `Math.max(12, prev - 2)`; `toggleDarkMode` flips
`isDarkMode` (page 857). `isBandEntry` is `!!entry?.band_id`.

Tests: `src/hooks/__tests__/useLyricsEditor.test.tsx`, first line exactly
`// @vitest-environment jsdom`, `afterEach(cleanup)` plus
`afterEach(() => vi.restoreAllMocks())`, built with `renderHook` from
`@testing-library/react`, following `src/hooks/__tests__/usePdfStage.test.tsx`.
Stubbing, exactly:

- **actions**: a `makeActions()` factory returning
  `{ updateLyrics: vi.fn().mockResolvedValue(undefined), fetchLyrics: vi.fn().mockResolvedValue('imported'), addSong: vi.fn().mockResolvedValue(PERSONAL_ENTRY) }`.
  Nothing under `@/app/actions` is imported by the test.
- **entries**: plain `Repertoire` literals; the band case is
  `{ id: 'band-rep', band_id: 'band-1', song_id: 'song-1', lyrics: 'band words', ... }`
  with a personal entry `{ id: 'personal-rep', band_id: null, lyrics: 'my words', ... }`.
- **callbacks**: `vi.fn()` for `notify` and the three save callbacks; the Toast
  strings are asserted off `notify.mock.calls`.
- **history**: jsdom's real `window.history`; `vi.spyOn(window.history, 'pushState')`
  counts the pushes, a back press is
  `act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })`, and the
  "close from the toolbar" case spies on `window.history.back` and drives the two
  branches by leaving the pushed entry in place versus calling
  `window.history.replaceState({}, '')` first.

Eighteen tests, names in ER4.

### 4. `src/components/fastview/LyricsSection.tsx` (new)

`'use client'`, presentational: no `useState`, no `useEffect`, no `useRef`, no
Server Action import, no `@/app/*` import.

```ts
export interface LyricsSectionProps {
  controller: LyricsEditorController
  /** True while the member's own entry is still loading. Page state (RH-52). */
  loadingPersonal: boolean
}
```

It carries page lines 666-720 and 784-801 verbatim: the `aria-label="Lyrics"`
section, the heading, the `👤 Personal` / `👥 Band` badge (rendered only when
`controller.isBandEntry`), the `🔍 Stage Mode` button (rendered only when
`controller.displayedLyrics && !controller.isEditing`), the `Edit`/`Add` button,
the blue version-switcher banner (rendered only when
`controller.hasDifferentPersonalLyrics && !controller.isEditing`), and, when not
editing, the white card holding either the `dangerouslySetInnerHTML` lyrics, the
five-bar skeleton (`loadingPersonal`) or `No lyrics added yet.`. When
`controller.isEditing` it renders `<LyricsEditorPanel controller={controller} />`.

It takes the controller object rather than flat props for the same reason
`TabLibrarySection` does (RH-49): the controller type is declared in
`src/lib/lyricsEditor.ts`, so `src/components` types it without ever importing
`src/hooks`.

### 5. `src/components/fastview/LyricsEditorPanel.tsx` (new)

`'use client'`, presentational, props `{ controller: LyricsEditorController }`.
Page lines 722-783 verbatim: the textarea bound to `controller.draft` /
`controller.setDraft` and disabled while `controller.saving`, the
`✨ Auto-import` button (disabled while `controller.fetching || controller.saving`,
showing `Importing...` with its spinner), and the `Cancel` / `Save` pair (`Save`
showing `Saving...` with its spinner).

The two spinner `<svg>`s in those buttons are byte-identical apart from their
colour class, so they are rendered by a module-local
`function ButtonSpinner({ className }: { className: string })` emitting
`className={\`animate-spin h-3.5 w-3.5 ${className}\`}` and the same two paths.
The rendered DOM is unchanged; the point is that moving two 8-line identical
blocks into one file must not hand `jscpd` a new clone (ER8 pins the duplication
budget).

### 6. `src/components/fastview/LyricsStageOverlay.tsx` (new)

`'use client'`, presentational:

```ts
export interface LyricsStageOverlayProps {
  controller: LyricsEditorController
  songTitle: string
  songKey?: string | null
}
```

Renders `null` unless `controller.isStageOpen && controller.displayedLyrics`,
which is page line 834's guard verbatim. Everything else is page lines 835-911
moved character for character: the root `fixed inset-0 z-50 ...` div with
`style={{ fontSize: \`${controller.fontSize}px\` }}` and the
`bg-gray-950 text-gray-100` / `bg-white text-gray-900` swap on
`controller.isDarkMode`; the sticky header with the truncated `songTitle` and
`Tom: {songKey}`; the `☀️ Claro` / `🌙 Escuro` toggle, the `A-` and `A+`
buttons and the red `✕` close button, wired to `controller.toggleDarkMode`,
`controller.decreaseFont`, `controller.increaseFont` and `controller.closeStage`;
and the `font-mono` body with
`dangerouslySetInnerHTML={{ __html: parseLyricsMarkdown(controller.displayedLyrics) }}`.

Tests for sections 4-6: `src/components/fastview/__tests__/LyricsSection.test.tsx`
(covering the section and the editor panel, thirteen tests) and
`src/components/fastview/__tests__/LyricsStageOverlay.test.tsx` (seven tests).
Both have `// @vitest-environment jsdom` as their literal first line and call
`afterEach(cleanup)`, per AGENTS.md. Each builds a `controller` fixture as a
plain object of `vi.fn()`s satisfying `LyricsEditorController`, so no hook and no
action is ever imported. Names in ER5.

### 7. `src/app/fastViewLyricsActions.ts` (new) - composition root

A new sibling rather than an extension of `fastViewTabActions.ts` or
`fastViewNavActions.ts`: those two wire `@/app/actions/tabs` and
`@/app/actions/playlists` respectively, while these three actions come from
`@/app/actions/repertoire`. Adding a third file keeps each composition root equal
to "one Fast View controller family, one actions module", which is the rule
RH-48/RH-49/RH-50 already follow.

```ts
import { updateLyricsAction, fetchLyricsAction, addSongAction } from '@/app/actions/repertoire'
import type { LyricsEditorActions } from '@/hooks/useLyricsEditor'

/**
 * The lyrics Server Actions injected into `useLyricsEditor` by the Fast View
 * page. Module-level, so the object identity is stable and no effect of the
 * controller can be restarted by a re-render (RH-51, following the
 * `src/app/bandAdminActions.ts` pattern from F21).
 */
export const LYRICS_EDITOR_ACTIONS: LyricsEditorActions = {
  updateLyrics: updateLyricsAction,
  fetchLyrics: fetchLyricsAction,
  addSong: addSongAction,
}
```

`updateLyricsAction(repertoireId, lyrics, bandId?)` and
`addSongAction(songId, bandId?)` have optional trailing parameters, so they
satisfy the stricter interface signatures directly; no wrapper lambda is needed
and none should be added (a lambda would break the stable identity).

### 8. `src/app/songs/[id]/fast-view/page.tsx` (modified)

After the move the page:

- drops `updateLyricsAction`, `fetchLyricsAction` and `addSongAction` from the
  line-8 import and the whole line-12 `@/lib/stageHistory` import;
- deletes `parseLyricsMarkdown` (30-40), the lyrics state (112-116), the three
  stage-mode states (136-138), `showPersonalLyrics` (143), the popstate effect
  and `closeStageMode` (178-201), line 215, the two derived constants (272-273)
  and both handlers (275-330);
- adds four imports (`useLyricsEditor`, `LYRICS_EDITOR_ACTIONS`, `LyricsSection`,
  `LyricsStageOverlay`) and one hook call, placed after the `usePlaylistNav` call
  so `entry`, `personalEntry` and `showToast` are all in scope:

```tsx
const lyrics = useLyricsEditor({
  entry,
  personalEntry,
  songTitle: entry?.song?.title ?? '(untitled)',
  artist: entry?.song?.artist ?? '',
  actions: LYRICS_EDITOR_ACTIONS,
  onEntryLyricsSaved: (saved) => setEntry(prev => prev ? { ...prev, lyrics: saved } : null),
  onPersonalLyricsSaved: (saved) => setPersonalEntry(prev => prev ? { ...prev, lyrics: saved } : null),
  onPersonalEntryCreated: setPersonalEntry,
  notify: showToast,
})
```

  The hook is called above the `if (loading)` / `if (notFound)` early returns,
  like every other hook on the page, which is why it accepts a null `entry`;

- replaces lines 665-802 with
  `<LyricsSection controller={lyrics} loadingPersonal={loadingPersonal} />` and
  lines 833-912 with
  `<LyricsStageOverlay controller={lyrics} songTitle={title} songKey={key} />`.

`songTitle` / `artist` are passed as already-resolved strings rather than read
off `entry` inside the hook so that the auto-import Toast keeps using exactly the
same `title` / `artist` values the page computes at lines 266-267.

### 9. Conventions

Import direction (F21): none of `src/lib/lyricsMarkdown.ts`,
`src/lib/lyricsEditor.ts`, `src/hooks/useLyricsEditor.ts`,
`src/components/fastview/LyricsSection.tsx`,
`src/components/fastview/LyricsEditorPanel.tsx` or
`src/components/fastview/LyricsStageOverlay.tsx` may import from `@/app/*`, and
nothing under `src/components` or `src/lib` may import `@/hooks/useLyricsEditor`;
the actions arrive through `LYRICS_EDITOR_ACTIONS`. Error handling: both `catch`
blocks are the existing binding-less form feeding a Toast (pattern P1 with the
message fixed at the call site, exactly as today) - no `catch (x: any)`, no
`console.error`. No native browser dialog is introduced anywhere, test fixtures
included. No landing-page copy change: this is an internal refactor with no new
selling point, so `LandingPage.tsx` and both dictionaries stay untouched (ER12).

## Expected Results

ER1 - From the project root all twelve of these files exist and are non-empty: `src/lib/lyricsMarkdown.ts`, `src/lib/__tests__/lyricsMarkdown.test.ts`, `src/lib/lyricsEditor.ts`, `src/lib/__tests__/lyricsEditor.test.ts`, `src/hooks/useLyricsEditor.ts`, `src/hooks/__tests__/useLyricsEditor.test.tsx`, `src/components/fastview/LyricsSection.tsx`, `src/components/fastview/LyricsEditorPanel.tsx`, `src/components/fastview/LyricsStageOverlay.tsx`, `src/components/fastview/__tests__/LyricsSection.test.tsx`, `src/components/fastview/__tests__/LyricsStageOverlay.test.tsx`, `src/app/fastViewLyricsActions.ts`. `grep -rn "@/app/" src/lib/lyricsMarkdown.ts src/lib/lyricsEditor.ts src/hooks/useLyricsEditor.ts src/components/fastview/LyricsSection.tsx src/components/fastview/LyricsEditorPanel.tsx src/components/fastview/LyricsStageOverlay.tsx` prints nothing and exits with status 1. `grep -rln "from '@/hooks/useLyricsEditor'" src` lists exactly these three paths and no others, in any order: `src/hooks/__tests__/useLyricsEditor.test.tsx`, `src/app/fastViewLyricsActions.ts`, `src/app/songs/[id]/fast-view/page.tsx` (the check matches import specifiers only, so naming the identifier in a doc comment is never a match). `grep -rln "@/hooks/useLyricsEditor" src/components src/lib` prints nothing and exits with status 1, and `grep -rln "LyricsEditorController" src/components/fastview` lists at least `src/components/fastview/LyricsSection.tsx` and `src/components/fastview/LyricsStageOverlay.tsx`, which therefore type the controller through `@/lib/lyricsEditor`. `grep -c "LYRICS_EDITOR_ACTIONS" src/app/fastViewLyricsActions.ts` and `grep -c "LYRICS_EDITOR_ACTIONS" "src/app/songs/[id]/fast-view/page.tsx"` each print a number greater than 0, and `grep -c "updateLyricsAction\|fetchLyricsAction\|addSongAction" src/app/fastViewLyricsActions.ts` prints a number greater than 0.

ER2 - `npx vitest run src/lib/__tests__/lyricsMarkdown.test.ts --reporter=verbose` exits 0 and reports at least 11 passed and 0 failed tests, among which these exact names all appear and pass: `parseLyricsMarkdown escapes an ampersand before any markup is emitted`, `parseLyricsMarkdown escapes a less-than sign so raw HTML stays inert`, `parseLyricsMarkdown escapes a greater-than sign so raw HTML stays inert`, `parseLyricsMarkdown neutralises an injected script tag`, `parseLyricsMarkdown neutralises an injected img tag with an inline event handler`, `parseLyricsMarkdown wraps a double-asterisk run in strong`, `parseLyricsMarkdown wraps a single-asterisk run in em`, `parseLyricsMarkdown wraps a double-underscore run in u`, `parseLyricsMarkdown renders a bracketed chord as the emerald badge`, `parseLyricsMarkdown spans a line break inside a bold run`, `parseLyricsMarkdown returns an empty string for empty input`. The script-tag test asserts that the output of `parseLyricsMarkdown("<script>document.title = 'pwned'</script>")` contains `&lt;script&gt;` and contains neither the substring `<script` nor the substring `</script`. The file `src/lib/__tests__/lyricsMarkdown.test.ts` does not contain the string `@vitest-environment` at all, which proves the module runs in the default node environment and touches no DOM, and `grep -c "window\.\|document\.createElement" src/lib/lyricsMarkdown.ts` prints `0`.

ER3 - `npx vitest run src/lib/__tests__/lyricsEditor.test.ts --reporter=verbose` exits 0 and reports at least 18 passed and 0 failed tests, among which these exact names all appear and pass: `clampLyricsFontSize keeps a size inside the range untouched`, `clampLyricsFontSize clamps at the lower bound of 12`, `clampLyricsFontSize clamps at the upper bound of 36`, `stepLyricsFontSize increases by two up to the upper bound and no further`, `stepLyricsFontSize decreases by two down to the lower bound and no further`, `hasDifferentPersonalLyrics is false outside a band`, `hasDifferentPersonalLyrics is false when there is no personal entry`, `hasDifferentPersonalLyrics is false when the personal lyrics are empty`, `hasDifferentPersonalLyrics is false when the personal lyrics match the band ones`, `hasDifferentPersonalLyrics is true when a band member has their own different version`, `selectDisplayedLyrics shows the entry lyrics outside a band`, `selectDisplayedLyrics shows the band lyrics while the band version is selected`, `selectDisplayedLyrics shows the personal lyrics while the personal version is selected`, `selectDisplayedLyrics falls back to the band lyrics when no personal entry has loaded`, `resolveLyricsSaveTarget targets the entry itself outside a band`, `resolveLyricsSaveTarget targets the band entry while the band version is selected`, `resolveLyricsSaveTarget targets the personal entry with a null band id while the personal version is selected`, `resolveLyricsSaveTarget asks for a personal entry to be created when the member has none`. The two clamp-bound tests assert exact values: `clampLyricsFontSize(4)` is `12` and `clampLyricsFontSize(99)` is `36`; the two step tests assert `stepLyricsFontSize(34, 2)` is `36`, `stepLyricsFontSize(36, 2)` is `36`, `stepLyricsFontSize(14, -2)` is `12` and `stepLyricsFontSize(12, -2)` is `12`. This file too does not contain the string `@vitest-environment`.

ER4 - `npx vitest run src/hooks/__tests__/useLyricsEditor.test.tsx --reporter=verbose` exits 0 and reports at least 18 passed and 0 failed tests, among which these exact names all appear and pass: `starts with the band lyrics, not editing and not in Stage Mode`, `seeds the draft from the displayed lyrics when editing starts`, `cancelling editing restores the draft from the displayed lyrics`, `saves the band lyrics against the entry id and its band id`, `saves the personal lyrics against the personal entry with a null band id`, `creates the personal entry before saving when the member has none`, `reports a save failure with the Failed to save lyrics toast`, `refuses to auto-import without an artist and says so`, `auto-imports lyrics into the draft and reports success`, `reports lyrics not found online with the song title and artist in the toast`, `reports an auto-import failure and keeps the draft`, `switches between the band and the personal lyrics version`, `raises the stage font size by two up to 36 and no further`, `lowers the stage font size by two down to 12 and no further`, `toggles the stage dark mode`, `pushes exactly one history entry when the lyrics stage opens`, `exits the lyrics stage when the browser back button fires popstate`, `closing the lyrics stage goes back only when the Stage Mode history entry is on top`. The six Toast strings are asserted verbatim against the injected `notify` spy: `Lyrics saved successfully!` with tone `success`, `Failed to save lyrics` with tone `error`, `Artist name is required to search for lyrics.` with tone `warning`, `Lyrics imported online!` with tone `success`, `Lyrics not found online for "Song Title" by "Artist Name". You can still paste them below.` with tone `warning` for a fixture whose title is `Song Title` and whose artist is `Artist Name`, and `Failed to import lyrics from web. You can still paste them below.` with tone `error`. The save tests assert the exact `updateLyrics` argument tuples: the band case receives `(<the entry id>, <the draft>, <the entry band id>)` and the personal case receives `(<the personal entry id>, <the draft>, null)`. The first line of the test file is exactly `// @vitest-environment jsdom`, it contains `afterEach(cleanup)`, it calls `renderHook`, it simulates the back button with `new PopStateEvent('popstate')`, and `grep -c "@/app/actions" src/hooks/__tests__/useLyricsEditor.test.tsx` prints `0` because all three actions are passed in as test doubles.

ER5 - `npx vitest run src/components/fastview --reporter=verbose` exits 0 and reports 0 failed tests across at least ten files, including `src/components/fastview/__tests__/LyricsSection.test.tsx` with at least 13 tests whose names include exactly `LyricsSection renders the lyrics it is given as markup`, `LyricsSection shows the empty state when there are no lyrics`, `LyricsSection shows the loading skeleton while the personal entry loads`, `LyricsSection shows the Band badge for a band entry on the band version`, `LyricsSection shows the Personal badge for a band entry on the personal version`, `LyricsSection shows no ownership badge outside a band`, `LyricsSection offers the version switcher only when a different personal version exists`, `LyricsSection reports the Stage Mode button press`, `LyricsSection reports the Edit button press and labels it Add without lyrics`, `LyricsEditorPanel reports every draft keystroke`, `LyricsEditorPanel reports the auto-import press and shows the importing state`, `LyricsEditorPanel reports the save press and shows the saving state`, `LyricsEditorPanel reports the cancel press`, and including `src/components/fastview/__tests__/LyricsStageOverlay.test.tsx` with at least 7 tests whose names include exactly `LyricsStageOverlay renders nothing while the stage is closed`, `LyricsStageOverlay renders nothing when there are no lyrics`, `LyricsStageOverlay shows the song title and the key in the header`, `LyricsStageOverlay applies the font size it is given to the overlay root`, `LyricsStageOverlay switches between the light and the dark surface`, `LyricsStageOverlay renders the lyrics as markup`, `LyricsStageOverlay reports the font, dark mode and close button presses`. Both files have `// @vitest-environment jsdom` as their literal first line and call `afterEach(cleanup)`. The three components carry no logic and no data access: `grep -c "useState\|useEffect\|useRef\|addEventListener\|history\.\|@/app/\|@/hooks/" src/components/fastview/LyricsSection.tsx src/components/fastview/LyricsEditorPanel.tsx src/components/fastview/LyricsStageOverlay.tsx` prints exactly the three lines `src/components/fastview/LyricsSection.tsx:0`, `src/components/fastview/LyricsEditorPanel.tsx:0` and `src/components/fastview/LyricsStageOverlay.tsx:0`.

ER6 - The page no longer holds any lyrics logic: `grep -c "parseLyricsMarkdown\|updateLyricsAction\|fetchLyricsAction\|lyricsFontSize\|isStageMode\|popstate" "src/app/songs/[id]/fast-view/page.tsx"` prints `0` (it prints `14` at `bf0c97e`), and `grep -c "addSongAction\|displayedLyrics\|hasDifferentPersonalLyrics\|showPersonalLyrics\|lyricsText\|isEditingLyrics\|savingLyrics\|fetchingLyrics\|isStageDarkMode\|closeStageMode\|dangerouslySetInnerHTML\|stageHistoryState\|isStageHistoryEntry\|@/lib/stageHistory" "src/app/songs/[id]/fast-view/page.tsx"` also prints `0`. Each of those identifiers now lives with its owner: `grep -c "popstate" src/hooks/useLyricsEditor.ts` prints `2` (one `addEventListener`, one `removeEventListener`), `grep -c "stageHistoryState\|isStageHistoryEntry" src/hooks/useLyricsEditor.ts` prints a number greater than 0, `grep -c "dangerouslySetInnerHTML" src/components/fastview/LyricsSection.tsx` and `grep -c "dangerouslySetInnerHTML" src/components/fastview/LyricsStageOverlay.tsx` each print `1`, and the history marker is still in exactly one place: `grep -rln "stageMode: true" src` prints only paths drawn from the closed set `src/lib/stageHistory.ts` and `src/lib/__tests__/stageHistory.test.ts`, listing neither the page nor `src/hooks/useLyricsEditor.ts`. The page still renders both new components: `grep -c "LyricsSection\|LyricsStageOverlay" "src/app/songs/[id]/fast-view/page.tsx"` prints a number greater than 0.

ER7 - `rtk proxy npx eslint src/lib/lyricsMarkdown.ts src/lib/lyricsEditor.ts src/hooks/useLyricsEditor.ts src/components/fastview/LyricsSection.tsx src/components/fastview/LyricsEditorPanel.tsx src/components/fastview/LyricsStageOverlay.tsx src/app/fastViewLyricsActions.ts --rule '{"complexity":["error",15],"max-lines-per-function":["error",200]}'` exits 0 and prints no output at all. `wc -l` on each of the twelve files listed in ER1 prints a number strictly less than 400. `wc -l "src/app/songs/[id]/fast-view/page.tsx"` prints a number strictly less than 720 (it prints `964` at `bf0c97e`; a throwaway copy with exactly this spec's regions removed and its wiring added measures 674). The raw output of `rtk proxy npx eslint "src/app/songs/[id]/fast-view/page.tsx" --rule '{"complexity":["error",15]}'` contains exactly one line matching `Function 'FastViewPage' has a complexity of N`, and N is at most 34 (it is 54 at `bf0c97e`; the same throwaway copy measures 30). That command's other output lines are not constrained here: `--rule` adds to the flat config rather than replacing it, so the command also reports the page's ordinary problems, which ER8 pins separately.

ER8 - `rtk proxy npx eslint .` prints the summary line `25 problems (11 errors, 14 warnings)` and nothing worse, one error fewer than the `26 problems (12 errors, 14 warnings)` at `bf0c97e` because `parseLyricsMarkdown` no longer uses a `let` binding. `rtk proxy npx eslint "src/app/songs/[id]/fast-view/page.tsx"` prints the summary line `1 problem (1 error, 0 warnings)`, that single problem being the `@typescript-eslint/no-explicit-any` error inside the status dropdown (RH-52's, at a possibly shifted line number), and its output contains no `prefer-const` line. `./node_modules/.bin/tsc --noEmit` exits 0 and prints nothing. `npm run lint:dead` exits 0 and reports no unused files, exports, types or dependencies. `npm run lint:dup` exits 0 and prints `Found N clones.` with N at most 20, and the `Total:` row of its table shows a duplicated-lines percentage of at most 0.90% (18 clones, 230 lines, 0.76% at `bf0c97e`). `npm run audit` exits 0 and reports 0 vulnerabilities.

ER9 - Nothing owned by RH-20, RH-28, RH-49 or RH-50 changed: `git diff bf0c97e -- src/lib/stageHistory.ts src/lib/__tests__/stageHistory.test.ts src/lib/scrollHost.ts src/lib/__tests__/scrollHost.test.ts src/hooks/usePdfStage.ts src/hooks/__tests__/usePdfStage.test.tsx src/components/fastview/PdfStageOverlay.tsx src/components/fastview/__tests__/PdfStageOverlay.test.tsx src/lib/tabLibrary.ts src/hooks/useTabLibrary.ts src/components/tabs/TabDrawingStage.tsx src/lib/stageInteraction.ts src/lib/annotationMath.ts src/lib/__tests__/erasePersistence.test.ts src/lib/__tests__/stageInteraction.test.ts src/lib/__tests__/annotationMath.test.ts src/lib/__tests__/pdfWorkerAsset.test.ts src/lib/__tests__/noBrowserDialogs.test.ts src/lib/__tests__/errorHandlingStyle.test.ts src/components/tabs/__tests__/TabDrawingStage.test.tsx` prints nothing, and `npx vitest run src/lib/__tests__/stageHistory.test.ts src/lib/__tests__/scrollHost.test.ts src/hooks/__tests__/usePdfStage.test.tsx src/lib/__tests__/erasePersistence.test.ts src/lib/__tests__/stageInteraction.test.ts src/lib/__tests__/annotationMath.test.ts src/lib/__tests__/pdfWorkerAsset.test.ts src/lib/__tests__/noBrowserDialogs.test.ts src/lib/__tests__/errorHandlingStyle.test.ts src/components/tabs/__tests__/TabDrawingStage.test.tsx` exits 0 with 0 failed tests.

ER10 - With a live Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with all migrations applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` exported into the environment (for example `set -a; . ./.env.local; set +a`), `npx vitest run` exits 0 and its summary reports at least 79 test files passed, 0 test files failed, at least 951 tests passed, 0 tests failed and 0 tests skipped (the same command at `bf0c97e` reports 74 files and 884 tests, 0 skipped; this task adds 5 files and at least 67 tests). Under the same precondition, `npm run test:coverage` exits 0 with no threshold error (the configured gates are statements 80, branches 65, functions 78, lines 80) and its `All files` row shows statements at least 90, branches at least 74, functions at least 92 and lines at least 90.

ER11 - Under the same Postgres and `SUPABASE_SERVICE_ROLE_KEY` precondition as ER10, `npx vitest run --coverage --coverage.reporter=json-summary` exits 0 and, in the resulting `coverage/coverage-summary.json`, the entry whose key ends with `src/lib/lyricsMarkdown.ts` reports `statements.pct` 100, `functions.pct` 100, `lines.pct` 100 and `branches.pct` at least 90; the entry whose key ends with `src/lib/lyricsEditor.ts` reports `statements.pct` 100, `functions.pct` 100, `lines.pct` 100 and `branches.pct` at least 90; and the entry whose key ends with `src/hooks/useLyricsEditor.ts` reports `statements.pct` at least 90, `functions.pct` at least 90, `lines.pct` at least 90 and `branches.pct` at least 75. The per-file floors are read from this JSON rather than from the text table because the table can omit a fully covered file.

ER12 - `npx next build` exits 0 and its route table lists `/songs/[id]/fast-view` marked `f` (Dynamic, server-rendered on demand). Immediately afterwards, `set -a; . ./.env.local; set +a; PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" npx playwright test e2e/ssr-smoke.spec.ts --project=chromium` prints `4 passed` and exits 0. `e2e/fast-view-mobile.spec.ts` and `e2e/songs-crud.spec.ts` are not gates here: both are red at `bf0c97e` for the RH-44 `addSong` helper reason (`e2e/helpers.ts`), so their result is recorded but never blocks this task.

ER13 - The `version` field in `package.json` matches `0.1.79-` followed by exactly twelve digits (it is `0.1.78-202609071945` at `bf0c97e`, and the version may only ever go up). `git diff bf0c97e -- src/components/landing/LandingPage.tsx src/i18n/dictionaries/en.json src/i18n/dictionaries/pt-BR.json` prints nothing, and `npx vitest run src/lib/__tests__/landingCopy.test.ts` exits 0 with 0 failed tests. `git diff --name-only bf0c97e` lists only paths drawn from this closed set and nothing else: `AGENTS.md`, `package.json`, `docs/tasks/RH-51-spec.md`, `docs/suggestions-log.md`, `src/app/songs/[id]/fast-view/page.tsx`, `src/app/fastViewLyricsActions.ts`, `src/lib/lyricsMarkdown.ts`, `src/lib/__tests__/lyricsMarkdown.test.ts`, `src/lib/lyricsEditor.ts`, `src/lib/__tests__/lyricsEditor.test.ts`, `src/hooks/useLyricsEditor.ts`, `src/hooks/__tests__/useLyricsEditor.test.tsx`, `src/components/fastview/LyricsSection.tsx`, `src/components/fastview/LyricsEditorPanel.tsx`, `src/components/fastview/LyricsStageOverlay.tsx`, `src/components/fastview/__tests__/LyricsSection.test.tsx`, `src/components/fastview/__tests__/LyricsStageOverlay.test.tsx`. In particular that list contains no path under `migrations/`, no `eslint.config.mjs`, no `vitest.config.ts`, no `src/lib/songs.ts`, no path under `src/app/actions/` and no path under `src/components/tabs/`.

## Out of Scope

- The page's `entry` / `personalEntry` / `loading` / `notFound` state, the entry
  load effect, the status dropdown, the links section, the tags section and the
  page shell: all RH-52 (part 5).
- The page's remaining `@typescript-eslint/no-explicit-any` error in the status
  dropdown - it belongs to the status slice, and fixing it here would move an
  RH-52 review question into this task.
- Any change to `src/app/actions/repertoire.ts`, including the shape of
  `updateLyricsAction`, `fetchLyricsAction` or `addSongAction`, and any change to
  `src/lib/songs.ts` or the lyrics.ovh integration.
- Any change to `src/lib/stageHistory.ts`, `usePdfStage`, `useTabLibrary`,
  `TabDrawingStage` or any RH-20 / RH-28 guard test; this task consumes
  `stageHistory.ts` exactly as RH-50 shipped it.
- Sanitising the lyrics HTML beyond today's three escapes (no DOMPurify, no
  allow-list rewrite): the task is to test the existing escaping, not to change
  the rendering contract.
- The two red RH-44 e2e specs, any landing-page copy, and any migration, ESLint
  or Vitest configuration change.

## Post-merge checks (orchestrator)

Manual smoke on a phone-sized viewport, matching the task's own last draft
result: open a song in Fast View, press Add/Edit on the Lyrics section, press
Auto-import and confirm the toast, type and Save, then reopen and confirm the
text survived; in a band song with a different personal version, flip the
`View my lyrics (👤)` / `View Band lyrics (👥)` switch and confirm the badge and
the body follow; open the lyrics Stage Mode, press `A+` and `A-` past both ends
to confirm the font stops at 36 and 12, toggle dark mode, and leave with the
hardware/browser back button rather than the `✕`.

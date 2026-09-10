# RH-70 — PlaylistDetailPage part 5/6: extract the header and the Spotify sync, delete the focus effect, replace the panel flags with a reducer

Baseline for every measurement in this document: `a79abef`
(`refactor(RH-69): unify tag editing in useTagEditor and extract the tag bars`),
tree clean, `package.json` version `0.1.104-202609100536`.

Parent: RH-53. Predecessor: RH-69 (done). Successor: RH-71.

## Scope

Move the last large JSX block of `/playlists/[id]` — the sticky header — and the
Spotify sync path out of the page, delete the page's remaining focus effect, and
collapse its three surviving panel flags into one `useReducer` over an explicit
union, so at most one panel can be open by construction.

In scope, and nothing else:

- `src/components/playlists/PlaylistDetailHeader.tsx` (new) — page lines
  276-453: back link, cover, the inline rename input with its Save/Cancel pair,
  the action buttons (add-song toggle, rename, delete confirmation) and the
  Spotify strip.
- `src/components/playlists/PlaylistSpotifyStrip.tsx` (new) — page lines
  425-452, the strip itself. See "Why a second component".
- `src/hooks/useSpotifySync.ts` (new) — `handleSync` (181-200) and
  `autoPushIfNeeded` (133-144), plus the `syncing` state (70).
- `src/lib/playlistSync.ts` (new) — the pure request/response shape behind them,
  and `timeAgo` (42-50), which exists only to label `last_synced_at`.
- `src/lib/playlistPanels.ts` (new) — the panel union and its reducer, replacing
  `editing` (71), `editName` (72), `confirmDelete` (73) and `showSearch` (79).
- The page: the header JSX, the two sync functions, the five `useState` above,
  `editInputRef` (83) and the focus effect (85-87) leave; one `useReducer`, one
  `useSpotifySync` call site and one `<PlaylistDetailHeader>` arrive.
- Four new test files, the page's `complexity-budget/override` entry re-pinned,
  and the version bump.

Not in scope: the mount effect (104-117) and its `eslint-disable`,
`refreshPlaylist`, the Server Component conversion, the override deletion and
the ratchet count — all RH-71. See "Out of Scope".

## Audit at a79abef

### The page

`grep -c "" 'src/app/playlists/[id]/page.tsx'` prints `541`.
`rtk proxy npx eslint 'src/app/playlists/[id]/page.tsx'` exits 0 printing
nothing: its violations are absorbed by the entry at `eslint.config.mjs:74`,
pinned by RH-69 at `complexity 20`, `max-lines-per-function 486`,
`max-lines 541`. Measured with the budget rules forced, `PlaylistDetailPage` at
line 56 is **complexity 20, 486 lines**. `grep -c "useState"` prints `13`
(the `react` import line plus twelve declarations), `grep -c "useEffect("`
prints `2`, `grep -c "useRef"` prints `2`, `grep -c "useMemo"` prints `3`.

### What belongs to this slice, by line

| Lines | What | Destination |
|---|---|---|
| 42-50 | `timeAgo`, a `const` arrow used once | `formatSyncedAgo` in `playlistSync.ts` |
| 70 | `syncing` | `useSpotifySync` |
| 71-73 | `editing`, `editName`, `confirmDelete` | the panel union |
| 79 | `showSearch` | the panel union |
| 83 | `editInputRef` | deleted — a callback ref replaces it |
| 85-87 | the rename focus effect | deleted |
| 133-144 | `autoPushIfNeeded` | `useSpotifySync().pushIfNeeded` |
| 153, 161 | its two call sites (picker `afterAdd`, `handleRemoveSong`) | rewired |
| 181-200 | `handleSync` | `useSpotifySync().pull` |
| 202-216 | `handleRename` | stays on the page, reads the draft from the union |
| 253-261 | `handleDelete` | stays on the page, injected into the header |
| 276-453 | the whole `<header>` | `PlaylistDetailHeader.tsx` |
| 425-452 | the Spotify strip inside it | `PlaylistSpotifyStrip.tsx` |
| 538 | `{showSearch && <SongPicker …>}` | `{panel.kind === "picker" && …}` |

### How many focus effects are actually left: one

The parent plan says four (page lines 322-333 at `c8fffd1`). Three are already
gone: RH-67 took the picker's with the picker, RH-69 took both tag inputs' into
`useTagEditor`. At `a79abef` `grep -c "useEffect("` prints `2` — the rename
focus effect (85-87) and the mount load effect (104-117). Only the first belongs
to this task. The second, and the
`// eslint-disable-next-line react-hooks/set-state-in-effect` above it, are
RH-71's and must survive this task byte for byte, which is why the target is
`grep -c "useEffect("` printing `1` rather than `0`.

### What `handleSync` and `autoPushIfNeeded` actually do

Both POST to the same route handler, `/api/spotify/playlists/<id>/sync`, with a
JSON body of `{ direction }` — `"pull"` for the button, `"push"` after a local
edit — and both raise `body.error ?? <fallback>` when the response is not ok.
Neither is a Server Action: they are `fetch` calls to `src/app/api/**`, so
nothing here crosses the F21 import-direction line (see "No actions bundle").

They differ in three ways, and all three are preserved:

- **`syncing`.** `handleSync` sets it around the whole round trip (the Sync
  button is `disabled={syncing}` and swaps its icon for a `Spinner`);
  `autoPushIfNeeded` never touches it, so an auto-push after an add or a remove
  leaves the button alone.
- **How failure travels.** `handleSync` catches and reports through the page's
  error banner (`setError`), so it settles; `autoPushIfNeeded` throws, and its
  two callers report it — the picker records it against the row it was adding
  (`useSongPicker`'s `afterAdd`), `handleRemoveSong` puts it in the banner. A
  push that reported itself would silently change both.
- **The gate.** `autoPushIfNeeded` returns early unless
  `playlist.sync_with_spotify` and `playlist.spotify_playlist_id` are both set;
  `handleSync` is only reachable from a button the strip renders only when
  `spotify_playlist_id` is set.

`handleSync` also awaits `refreshPlaylist()` on success — the pull rewrites the
playlist server-side, so the page reloads it.

### The e2e net, verbatim

`e2e/playlist-detail.spec.ts` (11 tests) and `e2e/helpers.ts` are the only
coverage this page has, and this slice owns six of their locators. Listed as
they are written today, because each is a contract this task keeps byte for
byte:

- `page.getByRole('heading', { name: playlistName })` — spec line 104 and 147,
  used by `reopenPlaylist` on every test, and by `openPlaylist` in
  `helpers.ts:246`. The `<h1>` renders only while the rename panel is closed.
- `page.getByRole('button', { name: 'Add songs' })` — spec line 154, the
  `SongPickerToggle`'s `aria-label`, followed at 155 and 171 by
  `page.getByPlaceholder('Search catalog and Spotify')` appearing on the first
  click and reaching `toHaveCount(0)` on the second: the toggle must still open
  and close the panel.
- `page.getByRole('button', { name: 'Rename playlist' })` — spec line 332.
- `page.getByRole('textbox', { name: 'Playlist name' })` — spec line 333, filled
  at 335, so the input must accept a `fill` (it is controlled) and must already
  hold the current name.
- `page.getByRole('button', { name: 'Save', exact: true })` — spec line 336.
- `helpers.ts:254-258` (`deletePlaylistFromDetail`) —
  `getByRole('button', { name: 'Delete playlist' })`, then
  `getByRole('button', { name: 'Yes', exact: true })`, then a wait for the
  `/playlists` URL. This is why the inline `Sure? / Yes / No` markup moves
  verbatim and is **not** swapped for `src/components/ui/ConfirmPanel.tsx`:
  `ConfirmPanel` renders a `confirmLabel` button and a `Cancel` button, focuses
  Cancel on mount and binds Escape, so adopting it would rename `Yes`/`No`, move
  focus and change three behaviours inside a refactor whose net cannot be edited.

`Back to playlists` (page line 282) and `Sync with Spotify` (445) are not
reached by any test; they move unchanged and are pinned by the new component
test instead.

### Reference measurement of the result

The extraction described below was written out in full against `a79abef`,
type-checked (`./node_modules/.bin/tsc --noEmit` clean) and linted with the
budget rules forced. Measured:

| File | Lines | Worst function | Complexity |
|---|---|---|---|
| `src/app/playlists/[id]/page.tsx` | **338** | `PlaylistDetailPage` **287** | **10** |
| `PlaylistDetailHeader.tsx` | 198 | 167 | 5 |
| `PlaylistSpotifyStrip.tsx` | 47 | 31 | 5 |
| `useSpotifySync.ts` | 68 | 40 | 3 (worst arrow) |
| `playlistSync.ts` | 38 | 9 | 4 |
| `playlistPanels.ts` | 44 | 19 | 8 |

Under the real config the only violation left anywhere is
`Function 'PlaylistDetailPage' has too many lines (287)`. Every new file is
under the base budget on its own, so no new override is needed — which the
ratchet forbids in any case.

Three of the parent plan's five targets are met with room, and two are pinned at
the measured value:

- **Page `<= 460` lines: met**, at 338.
- **`complexity <= 15`: met**, at 10 (20 at `a79abef`). The ten decision points
  that leave are the header's: `cover_url &&`, the `editing ? :`, `!editing &&`,
  the `confirmDelete ? :`, `spotify_playlist_id &&`, `sync_with_spotify ? :`,
  `last_synced_at &&`, `syncing ? :` and the two `if`s of the rename `onKeyDown`.
- **`useEffect(` down to 1: met.**
- **`useState <= 5` is pinned at 8** (`13` at `a79abef`). Five declarations
  leave — `syncing`, `editing`, `editName`, `confirmDelete`, `showSearch` — and
  seven remain: `playlist`, `songs`, `repertoireMap`, `loading`, `error`,
  `activeTagFilter`, `songFilterQuery`, plus the `react` import line that
  `grep -c` also counts. The plan's 5 is the five load states exactly; reaching
  it would mean deleting `loading` (RH-71 does, with the Server Component
  conversion) and inventing an owner for the two filter selections, which are
  not panels and must not join a union whose whole point is mutual exclusion.
- **`PlaylistDetailPage <= 260` lines is pinned at 287.** The slice removes 199
  lines from the function and gives back none: what is left is the hook preamble
  (30), `refreshPlaylist` and the mount effect (28), the two memos (18), the two
  controller call sites (15), five handlers (47), the two `useTagEditor` blocks
  RH-69 put there (40) and 109 lines of surviving JSX — the tag bar, the
  summary, the error banner, the in-playlist filter input, the filter bar, the
  song list and the picker mount. Getting to 260 means extracting the filter
  input as well, which is a sixth component and a fifth test file for 30 lines
  that RH-71 dissolves anyway when the body moves into an island.

### The override entry changes shape, and that is the point

Because the file falls to 338 lines (base `max-lines` is 400) and complexity 10
(base 15), two of the entry's three keys must be **deleted**, not re-pinned:
`complexityBudget.test.ts:167` treats a ceiling that is not *above* the base
threshold as an offender, so `max-lines: ["error", 338]` would fail the guard.
The entry survives on `max-lines-per-function` alone, which is exactly the shape
`src/app/join/[code]/page.tsx` already has. The guard's "pins every override
ceiling" test iterates over the keys an entry declares, so an entry with one key
is accepted (`src/lib/linkFetcher.ts` has one too). The entry is **not** deleted
here — that, and taking `MAX_OVERRIDES` to 19, is RH-71's, and doing it early
would leave the ratchet count and the guard's bound out of step.

### Why a second component

Inlined, the header function measures **186 lines against a 200-line base
budget** — 14 lines of headroom on a file that may never take an override, since
the ratchet may only shrink. Splitting the strip off takes it to 167 and gives
the sync surface its own testable component: three of its four states (unlinked,
auto-sync on versus linked only, never synced versus synced) are decisions no
header test would otherwise reach. This is the same call RH-68 made for
`PlaylistSongIdentity` and RH-69 for `TagEditRow`.

## Approach

### Behavior

The header looks and behaves as it does today: the back arrow, the cover when
there is one, the title as an `<h1>`, the three action buttons, the inline
rename input pre-filled with the current name and focused on open, committing on
Enter and on `Save` and closing on Escape and on `Cancel`, the `Sure? / Yes / No`
delete confirmation, and the Spotify strip with its `Auto-sync on` /
`Synced with Spotify` label, its `Nm/Nh/Nd ago` suffix and its `Sync` button that
disables itself and shows a spinner while a pull runs. A pull still reloads the
playlist on success and reports a failure in the page's error banner; a local
add or remove still pushes to Spotify only when the playlist auto-syncs, and
still reports its failure through the caller.

Five deliberate differences, all named:

1. **The panels are mutually exclusive.** Opening the rename input or arming the
   delete confirmation now closes the add-song panel, and opening the add-song
   panel disarms the confirmation. Today the three booleans are independent, and
   the only reason it is hard to notice is that the action row is hidden while
   `editing`: a confirmation armed and then left by a rename came back armed on
   Cancel, and the picker panel stayed open underneath a rename. Both are the
   bug the union removes. No e2e test opens two panels at once.
2. **The rename draft lives in the panel state**, so closing discards it.
   Unobservable: the current code overwrites `editName` with `playlist.name` on
   every open.
3. **Focus moves from an effect to a callback ref** on the input, which runs
   when the input mounts — which is exactly when the effect used to run, since
   the input renders only while `panel.kind === "rename"`. The ref is memoized
   with `useCallback` and an empty dependency list, so React attaches it once
   per mount instead of detaching and re-attaching on every render of the
   header, which an inline arrow would do and which could pull focus back to
   the input after the user has tabbed to `Save`. The `editInputRef` and the
   effect both disappear; `autoFocus` is still not used, for the accessibility
   reason the current comment records.
4. **An empty or non-string `error` in a failed sync response** now falls back to
   `Sync failed` / `Auto-sync to Spotify failed` instead of rendering an empty
   banner. Today's `body.error ?? fallback` only falls back on `null` and
   `undefined`.
5. **`pushIfNeeded` changes identity less often** than `autoPushIfNeeded` does:
   it depends on one boolean rather than on two playlist fields, so the picker's
   `useCallback` chain settles sooner. Nothing observable, but it is a real
   difference a reviewer will see in the dependency arrays.

### Shape

`src/lib/playlistPanels.ts` — pure, no React import. The union is
`{ kind: "none" } | { kind: "rename"; draft: string } | { kind: "delete-confirm" } | { kind: "picker" }`,
so "at most one panel is open" is a property of the type, not of the reducer.
Actions: `open-rename` (carrying the name the draft starts from),
`change-rename-draft`, `open-delete-confirm`, `toggle-picker` and `close`. The
module exports `NO_PANEL` (the initial state, so the page needs no literal),
`playlistPanelReducer` and `renameDraft(state)`, which answers `""` unless the
rename panel is open — that is what keeps the `kind` narrowing out of both the
page and the header. Exports are `export function` declarations, per the
`src/lib` naming guard.

`src/lib/playlistSync.ts` — pure, and free of `@/lib/db`, because a
`"use client"` file reaches it: `syncEndpoint(playlistId)`,
`syncRequestInit(direction)`, `shouldAutoPush(playlist)`,
`syncErrorMessage(body, fallback)` and `formatSyncedAgo(isoString)`. It is the
**client** side of the sync and must not be confused with the existing
`src/lib/spotifyPlaylistSync.ts`, which is the server side that the route
handler runs and which imports `@/lib/db`; the new module imports neither it nor
`pg`, and `namingConventions.test.ts` fails the run if that ever changes.

`src/hooks/useSpotifySync.ts` — `useSpotifySync(options): SpotifySyncController`.
Options: `playlistId`, `playlist` (the loaded row or `null`, read only for the
two sync fields), `onError` (the page's `setError`; `null` clears the banner, as
`handleSync` does on entry) and `onSynced` (the page's `refreshPlaylist`).
Controller: `syncing`, `pull` and `pushIfNeeded` — commands, no setter. The
asymmetry of the audit is preserved literally: `pull` settles and reports,
`pushIfNeeded` rejects.

`src/components/playlists/PlaylistDetailHeader.tsx` takes `playlist`, `panel`,
`dispatch`, `syncing`, `onRename`, `onDelete` and `onSync` — seven named props,
not the controller object, so the page writes `syncing={sync.syncing}` and
`onSync={sync.pull}` at the call site; that one surviving `syncing` on the page
is what ER3 pins. It receives the
panel state and the dispatch rather than seven booleans and seven callbacks, for
the reason RH-69 passed a whole `TagEditorController` into the row: unpacking
the union at the page boundary would put `panel.kind === …` back on the page,
which is what this part removes. `PlaylistSpotifyStrip` takes `playlist`,
`syncing` and `onSync`, and returns `null` for an unlinked playlist. Both open
on `"use client"`.

**No actions bundle.** `src/app/playlistSyncActions.ts` is not created and would
carry nothing: the sync path is two `fetch` calls to a route handler, not a
Server Action, so `src/hooks/useSpotifySync.ts` imports no `@/app/*` and F21
holds without an injection point. The two Server Actions this slice touches —
`updatePlaylistAction` for the rename, `deletePlaylistAction` for the delete —
stay called by the page, which is inside `src/app` and may import them; the
header receives them already bound, as `onRename` and `onDelete`. That is the
same call RH-69 made, and the opposite of RH-67's, which needed
`songPickerActions.ts` because a hook was calling five actions by name.

### Files touched

- `src/lib/playlistPanels.ts` — new; the union, the reducer, `renameDraft`.
- `src/lib/playlistSync.ts` — new; the five pure sync functions.
- `src/hooks/useSpotifySync.ts` — new; the controller.
- `src/components/playlists/PlaylistDetailHeader.tsx` — new; the header.
- `src/components/playlists/PlaylistSpotifyStrip.tsx` — new; the strip.
- `src/app/playlists/[id]/page.tsx` — the deletions in the audit table, one
  `useReducer`, one `useSpotifySync` call site, one `<PlaylistDetailHeader>`,
  `handleRename` reading `renameDraft(panel)`, and the picker mount keyed on
  `panel.kind`. `next/image`, `next/link` and `SongPickerToggle` stop being
  imported here; `Spinner` stays, for the loading state.
- `src/lib/__tests__/playlistPanels.test.ts` — new; 10 tests, node.
- `src/lib/__tests__/playlistSync.test.ts` — new; 12 tests, node.
- `src/hooks/__tests__/useSpotifySync.test.tsx` — new; 12 tests, jsdom.
- `src/components/playlists/__tests__/playlistHeader.test.tsx` — new; 15 tests,
  jsdom; both components in one file, the `tagBars.test.tsx` precedent.
- `eslint.config.mjs` — the page's override entry re-pinned, and reduced to its
  `max-lines-per-function` key. No entry added, none removed.
- `package.json` — version `0.1.105-YYYYMMDDHHmm`.
- `docs/tasks/RH-70-spec.md` — this file. `docs/suggestions-log.md` optionally,
  and if it is written, with one entry recording that the parent plan's
  `useState <= 5` and `PlaylistDetailPage <= 260` targets are **deferred to
  RH-71**, not dropped, so the plan's five targets stay auditable.

### Test criteria

The reducer is proved by folding every action sequence over it rather than by
listing cases: the union makes "at most one open" true by construction, so the
test that matters is the exhaustive one — every reachable state is a member of
the union, only `rename` carries a draft, and appending `close` to any sequence
yields `NO_PANEL`. The pure sync functions are unit-tested directly. The hook is
tested with `renderHook` over a stubbed `fetch`, which is the only place the
`syncing` window, the settle-versus-reject asymmetry, the auto-push gate and the
three fallback paths can be proved. The two components are tested with Testing
Library against plain props and a `vi.fn()` dispatch, pinning every accessible
name the e2e net reaches for plus the focus-on-open.
`e2e/playlist-detail.spec.ts` is the end-to-end proof and must pass with no edit.

**Landing Page Rule decision.** Internal refactor: renaming a playlist, deleting
one and syncing with Spotify all already exist, and nothing here adds a
capability a musician would choose the app for. The landing copy and both
dictionaries must not change.

## Expected Results

ER1 - The extraction exists, in the layers AGENTS.md prescribes. `test -f src/lib/playlistPanels.ts && test -f src/lib/playlistSync.ts && test -f src/hooks/useSpotifySync.ts && test -f src/components/playlists/PlaylistDetailHeader.tsx && test -f src/components/playlists/PlaylistSpotifyStrip.tsx` exits `0`; none of those five files exists at `a79abef`. `grep -c "export function playlistPanelReducer\|export function renameDraft" src/lib/playlistPanels.ts` prints `2`, `grep -c "export const NO_PANEL" src/lib/playlistPanels.ts` prints `1`, and `grep -c "export function syncEndpoint\|export function syncRequestInit\|export function shouldAutoPush\|export function syncErrorMessage\|export function formatSyncedAgo" src/lib/playlistSync.ts` prints `5` - `src/lib` exports are function declarations, never arrow consts, and `NO_PANEL` is a value, not a function. Both lib files are pure: `grep -cE "from ['\"]react['\"]|useState|useEffect|@/lib/db|spotifyPlaylistSync|fetch\(" src/lib/playlistPanels.ts src/lib/playlistSync.ts` prints `0` for each, so the client half of the sync never reaches the server half. `grep -c "export function useSpotifySync\|export interface SpotifySyncController\|export interface SpotifySyncOptions" src/hooks/useSpotifySync.ts` prints `3`, and `grep -cE "^\s+set[A-Z][A-Za-z]*:" src/hooks/useSpotifySync.ts` prints `0` while `grep -c "syncing\|pull\|pushIfNeeded" src/hooks/useSpotifySync.ts` prints a number greater than or equal to `6`: the controller exposes commands, never a setter. `head -1` of each of the two new component files prints exactly `"use client";` or `'use client'`, and `grep -c "'use client'\|\"use client\"" src/hooks/useSpotifySync.ts` prints `0`, like every other file in `src/hooks`.

ER2 - The import direction rule (F21) holds and no actions bundle was created. `grep -rn "@/app/" src/components src/lib src/hooks | grep -v __tests__` prints nothing at all, exactly as at `a79abef`. `test -f src/app/playlistSyncActions.ts` exits non-zero: the sync path is two `fetch` calls to the route handler `src/app/api/spotify/playlists/[id]/sync/route.ts`, not a Server Action, and the rename and delete arrive at the header as the bound `onRename` and `onDelete` callbacks, so nothing crosses the line and no bundle would carry anything. `grep -c "updatePlaylistAction\|deletePlaylistAction\|@/app/actions" src/hooks/useSpotifySync.ts src/lib/playlistSync.ts src/lib/playlistPanels.ts src/components/playlists/PlaylistDetailHeader.tsx src/components/playlists/PlaylistSpotifyStrip.tsx` prints `0` for every one of the five files, while in `src/app/playlists/[id]/page.tsx` `grep -c "updatePlaylist"` prints a number greater than or equal to `3` and `grep -c "deletePlaylist"` prints `2`. `rtk proxy npx eslint src/lib/playlistPanels.ts src/lib/playlistSync.ts src/hooks/useSpotifySync.ts src/components/playlists/PlaylistDetailHeader.tsx src/components/playlists/PlaylistSpotifyStrip.tsx` exits `0` with no output: no new file needs an override, and none trips `no-restricted-imports`.

ER3 - The header, the sync path and the four panel flags are gone from the page, and only they. In `src/app/playlists/[id]/page.tsx`, `grep -c` prints `0` for each of these names on its own: `timeAgo`, `handleSync`, `autoPushIfNeeded`, `setSyncing`, `setEditing`, `editName`, `setEditName`, `confirmDelete`, `showSearch`, `editInputRef`, `useRef`, `next/image`, `next/link`, `SongPickerToggle`, `Back to playlists`, `Rename playlist`, `Delete playlist`, `Sync with Spotify`, `Playlist name`, `api/spotify`, `last_synced_at` and `spotify_playlist_id`; so does `grep -c "\[editing"`. Each of those prints a number greater than or equal to `1` at `a79abef` (`setSyncing` `3`, `setEditing` `6`, `\[editing` `2`). The two bare words `syncing` and `editing` are deliberately **not** in that zero-list, because a faithful implementation keeps exactly one occurrence of each and neither is state: `grep -n "syncing" 'src/app/playlists/[id]/page.tsx'` prints exactly one line, the `syncing={sync.syncing}` prop of `<PlaylistDetailHeader>` that "Shape" prescribes (the page holds the controller, so it hands the flag down), and `grep -n "editing" 'src/app/playlists/[id]/page.tsx'` prints exactly one line, the RH-69 comment `// The two tag editing sites, on one controller each: the playlist's own bar` at `a79abef` line 218, which belongs to the surviving `useTagEditor` block and must **not** be reworded to satisfy a grep. `grep -c "PlaylistDetailHeader" 'src/app/playlists/[id]/page.tsx'` prints `2` and `grep -c "useSpotifySync"` prints `2` (an import and a call site each); `grep -c "useReducer"` prints `2` and `grep -o "playlistPanelReducer\|NO_PANEL\|renameDraft" 'src/app/playlists/[id]/page.tsx' | wc -l` prints a number greater than or equal to `4` - occurrences, not lines, so a one-line import does not defeat it (the reference extraction prints `6`). What must survive does: `grep -c "useEffect("` prints `1` - the mount load effect, whose body is unchanged - and `grep -c "react-hooks/set-state-in-effect"` prints `1`, both of which belong to RH-71; `grep -c "refreshPlaylist"`, `grep -c "handleRemoveSong"`, `grep -c "handleStatusCycle"`, `grep -c "handleRename"`, `grep -c "handleDelete"`, `grep -c "useTagEditor"` and `grep -c "SongPicker"` each print a number greater than or equal to `2`. `git diff a79abef -- src/app/actions src/app/api src/store src/lib/playlists.ts src/lib/playlistDetail.ts src/lib/tagEditor.ts src/lib/spotifyPlaylistSync.ts src/hooks/useSongPicker.ts src/hooks/useTagEditor.ts src/app/songPickerActions.ts src/components/playlists/SongPickerToggle.tsx src/components/playlists/SongPicker.tsx src/components/playlists/PlaylistSongRow.tsx src/components/playlists/PlaylistSongList.tsx src/components/playlists/PlaylistSummary.tsx src/components/playlists/PlaylistTagBar.tsx src/components/playlists/TagFilterBar.tsx src/components/ui` prints nothing at all.

ER4 - The panel state is one reducer over one union, and the page's measured budget numbers fall. `grep -c "useState" 'src/app/playlists/[id]/page.tsx'` prints `8` (`13` at `a79abef`): the `react` import line plus seven declarations - `playlist`, `songs`, `repertoireMap`, `loading`, `error`, `activeTagFilter`, `songFilterQuery` - the five departures being `syncing`, `editing`, `editName`, `confirmDelete` and `showSearch`. The parent plan's `<= 5` is pinned here at the measured `8` for the reason written into this spec's "Reference measurement of the result": the five it names are the load states, `loading` leaves with RH-71's Server Component conversion, and the two filter selections are not panels and must not enter a union whose purpose is mutual exclusion. `grep -c "" 'src/app/playlists/[id]/page.tsx'` prints a number less than or equal to `360` (`541` at `a79abef`; the reference extraction measures `338`, and the plan's ceiling of `460` is cleared with room). `rtk proxy npx eslint 'src/app/playlists/[id]/page.tsx' --rule '{"complexity":["error",1],"max-lines-per-function":["error",300]}'` prints, among its lines, exactly one line containing `Function 'PlaylistDetailPage' has a complexity of` and that number is at most `12` (`20` at `a79abef`; the reference extraction measures `10`), and no line containing `Function 'PlaylistDetailPage' has too many lines`. `rtk proxy npx eslint 'src/app/playlists/[id]/page.tsx' --rule '{"max-lines-per-function":["error",1]}'` prints exactly one line containing `Function 'PlaylistDetailPage' has too many lines` and that number is at most `295` (`486` at `a79abef`; the reference extraction measures `287`); the plan's `<= 260` is pinned at that measured number, because reaching 260 requires extracting the in-playlist filter input, which is a sixth component this task does not add and which RH-71 dissolves anyway.

ER5 - The override entry is re-pinned and now carries exactly one rule, and the ratchet did not grow. `grep -n "src/app/playlists" eslint.config.mjs` prints exactly one line. That line declares `max-lines-per-function` and nothing else: it contains `"max-lines-per-function": ["error", N]` where `N` is exactly the number ER4's forced lint reports, it does not contain the substring `"max-lines":`, and the only occurrence of `complexity` on it is the entry's own name, `complexity-budget/override` - so `grep -n "src/app/playlists" eslint.config.mjs | grep -c "complexity:"` prints `0` and `grep -n "src/app/playlists" eslint.config.mjs | grep -c '"max-lines":'` prints `0`. Both deletions are required, not cosmetic: `src/lib/__tests__/complexityBudget.test.ts` fails any ceiling that is not strictly above the base budget, and at 338 lines and complexity 10 the file is under the base `max-lines` 400 and `complexity` 15. `rtk proxy npx eslint 'src/app/playlists/[id]/page.tsx'` (no `--rule`) exits `0` printing nothing. `grep -c "complexity-budget/override" eslint.config.mjs` prints `20`, exactly as at `a79abef` - no entry added for any of the five new files, none removed - and `grep -c "src/app/playlists" eslint.config.mjs` prints `1`, so the entry was re-pinned and not deleted (RH-71 deletes it and takes `MAX_OVERRIDES` to 19). `grep -c "src/components/playlists\|src/hooks/useSpotifySync\|src/lib/playlistSync\|src/lib/playlistPanels" eslint.config.mjs` prints `0`. `grep -c "MAX_OVERRIDES = 20" src/lib/__tests__/complexityBudget.test.ts` prints `1`, and `git diff a79abef -- src/lib/__tests__/complexityBudget.test.ts AGENTS.md docs/plans/code-quality-review.md` prints nothing at all. `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts src/lib/__tests__/namingConventions.test.ts src/lib/__tests__/errorHandlingStyle.test.ts` exits `0` with `0` failed tests.

ER6 - The panel union is proved to admit one open panel at a time. `rtk proxy npx vitest run src/lib/__tests__/playlistPanels.test.ts` exits `0` printing `Test Files  1 passed (1)` and `Tests  10 passed (10)`, its tests named exactly: `starts from NO_PANEL, which is the none state`, `opens the rename panel with the current name as its draft`, `records what is typed into the rename draft`, `ignores a draft change while the rename panel is closed`, `opens the delete confirmation from any other panel`, `toggles the picker open and closed again`, `switches directly from one panel to another without closing first`, `closes back to none from every reachable panel`, `leaves at most one panel open after every sequence of up to four actions`, `reports the rename draft only while the rename panel is open`. The ninth folds every sequence of up to four actions drawn from the full action alphabet over the reducer and asserts of every resulting state that its `kind` is one of `none`, `rename`, `delete-confirm`, `picker`, that a `draft` key is present only when the kind is `rename`, and that appending a `close` action to that same sequence yields a state deep-equal to `NO_PANEL`. The file needs no `// @vitest-environment` line.

ER7 - The pure sync decisions are unit-tested. `rtk proxy npx vitest run src/lib/__tests__/playlistSync.test.ts` exits `0` printing `Test Files  1 passed (1)` and `Tests  12 passed (12)`, its tests named exactly: `builds the sync endpoint for a playlist id`, `builds a POST request init carrying the direction as JSON`, `sends the same headers for a pull and for a push`, `pushes when the playlist auto-syncs and carries a Spotify id`, `does not push when auto-sync is off`, `does not push when the playlist carries no Spotify id`, `does not push when there is no playlist yet`, `reads the error message out of a failed sync response body`, `falls back when the body carries no error string`, `falls back when the body is empty, null or not an object`, `formats a sync under a minute old as just now`, `formats a sync in minutes, in hours and in days`. The endpoint test asserts the literal path `/api/spotify/playlists/<id>/sync`, which is the route handler this task must keep posting to. The file needs no `// @vitest-environment` line.

ER8 - The sync controller is tested where only a hook test can reach: the syncing window, the settle-versus-reject asymmetry and the auto-push gate. `rtk proxy npx vitest run src/hooks/__tests__/useSpotifySync.test.tsx` exits `0` printing `Test Files  1 passed (1)` and `Tests  12 passed (12)`. Its literal first line is `// @vitest-environment jsdom`, it calls `afterEach(cleanup)`, it imports nothing from `@/app/`, it drives the hook through `renderHook` against a stubbed `global.fetch` and `vi.fn()` options, and its tests are named exactly: `starts idle and issues no request`, `posts a pull to the sync endpoint and reloads the playlist`, `clears the error banner when a pull starts`, `reports syncing while the pull is in flight and idle again once it settles`, `reports the server error message when a pull fails`, `falls back to Sync failed when the failed response carries no message`, `falls back to Sync failed when the response body is not JSON`, `does not reload the playlist after a failed pull, and still stops syncing`, `posts a push for a playlist that auto-syncs`, `issues no request and resolves when the playlist does not auto-sync`, `rejects with the server message when a push fails, so the caller can report it`, `never enters the syncing state for a push`. The fifth and the eleventh together pin the asymmetry the page depends on: `pull` settles and reports through `onError`, `pushIfNeeded` rejects and reports nothing, which is what lets `useSongPicker` record a failed auto-push against the row it was adding.

ER9 - The header and the strip render every state, and every accessible name the e2e net reaches for. `rtk proxy npx vitest run src/components/playlists/__tests__/playlistHeader.test.tsx` exits `0` printing `Test Files  1 passed (1)` and `Tests  15 passed (15)`. Its literal first line is `// @vitest-environment jsdom`, it calls `afterEach(cleanup)`, it imports nothing from `@/app/`, it passes a `vi.fn()` dispatch and plain panel states, and its tests are named exactly: `renders the playlist name as a heading and a back link to the playlists page`, `renders the cover image only when the playlist carries one`, `dispatches open-rename with the current name when Rename playlist is clicked`, `focuses the rename input as soon as it renders`, `renders the draft in the input and dispatches what is typed`, `commits the rename on Enter and on the Save button`, `closes the rename panel on Escape and on Cancel`, `renders no action buttons while the rename panel is open`, `toggles the add-song panel and reports it pressed while it is open`, `asks Sure? and calls the delete only after Yes`, `closes the delete confirmation on No`, `renders no Spotify strip for a playlist that is not linked`, `renders the auto-sync label and the last-synced suffix only when they apply`, `disables the Sync button while a sync is in flight`, `calls onSync when the Sync button is clicked`. Between them these tests assert, mechanically, the six locators of this slice: a heading whose accessible name is the playlist name, a link named `Back to playlists`, buttons named exactly `Add songs`, `Rename playlist`, `Delete playlist`, `Save`, `Cancel`, `Yes`, `No` and `Sync with Spotify`, and a textbox named `Playlist name`. The fourth asserts `document.activeElement` is that textbox on the first render with the rename panel open, which is what replaces the deleted focus effect; the tenth asserts the delete callback is not called before `Yes` is clicked, which is what `deletePlaylistFromDetail` in `e2e/helpers.ts` walks through.

ER10 - The characterization net passes untouched. `git diff a79abef -- e2e playwright.config.ts` prints nothing at all: not one assertion, locator, helper or timeout was edited to accommodate the refactor. `npx playwright test --list` prints `Total: 33 tests in 7 files`, as at `a79abef`. With Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (migrations applied), `.env.local` present, nothing listening on port 3000 and a fresh production build, `PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" npx playwright test --workers=1 --reporter=list` exits `0` and prints `33 passed`, with no `failed` and no `flaky` line. In particular the three tests of `e2e/playlist-detail.spec.ts` that walk this slice are among them: `adds two catalog songs to the playlist through the picker`, which opens the add-song panel from the header toggle and closes it again; `renames the playlist inline`, which clicks `Rename playlist`, fills the `Playlist name` textbox, clicks `Save` and re-asserts the heading after a reload; and `deletes the playlist and the seeded songs`, which goes through `Delete playlist` then `Yes` and waits for the redirect to `/playlists`.

ER11 - The new lib modules and hook are covered, and every repository gate holds at its `a79abef` value. With Postgres up and a non-empty `SUPABASE_SERVICE_ROLE_KEY`: `rtk proxy npx vitest run` exits `0` printing `Test Files  121 passed (121)` (`117` at `a79abef`) and `Tests` passed at least `1375` (`1326` at `a79abef`, plus 10 + 12 + 12 + 15 new), with `0` failed and `0` skipped. `npm run test:coverage` exits `0` with all four thresholds met (statements at least `80`, branches at least `65`, functions at least `78`, lines at least `80`), and `node -e "const c=require('./coverage/coverage-final.json');const pct=a=>a.length?Math.round(1000*a.filter(x=>x>0).length/a.length)/10:100;for (const k of Object.keys(c)) if (k.endsWith('/src/lib/playlistPanels.ts')||k.endsWith('/src/lib/playlistSync.ts')||k.endsWith('/src/hooks/useSpotifySync.ts')) console.log(k.split('/src/').pop(), pct(Object.values(c[k].f)), pct(Object.values(c[k].s)))"` prints exactly three lines, `lib/playlistPanels.ts`, `lib/playlistSync.ts` and `hooks/useSpotifySync.ts`, each followed by a function percentage and a statement percentage of at least `90`. `rtk proxy npx eslint .` prints `22 problems (8 errors, 14 warnings)`, identical to `a79abef`. `./node_modules/.bin/tsc --noEmit` exits `0` printing nothing. `npm run lint:dead` exits `0` reporting no unused file, export or dependency - every export of the three new modules has a caller under `src`. `npm run lint:dup` exits `0` with its `Total:` row reporting at most `16` clones and at most `0.50 %` - the `a79abef` numbers - and its output naming no file under `components/playlists` (jscpd prints paths without the `src/` prefix). `npm run audit` exits `0` with no high or critical advisory.

ER12 - Release hygiene and a closed change set. `git diff --name-only a79abef | sort` lists only paths drawn from this closed set and no others: `docs/suggestions-log.md`, `docs/tasks/RH-70-spec.md`, `eslint.config.mjs`, `package.json`, `src/app/playlists/[id]/page.tsx`, `src/components/playlists/PlaylistDetailHeader.tsx`, `src/components/playlists/PlaylistSpotifyStrip.tsx`, `src/components/playlists/__tests__/playlistHeader.test.tsx`, `src/hooks/__tests__/useSpotifySync.test.tsx`, `src/hooks/useSpotifySync.ts`, `src/lib/__tests__/playlistPanels.test.ts`, `src/lib/__tests__/playlistSync.test.ts`, `src/lib/playlistPanels.ts`, `src/lib/playlistSync.ts`. Any other path fails this result; in particular the list contains no file under `e2e/`, no `AGENTS.md`, no `docs/plans/code-quality-review.md`, no `src/lib/__tests__/complexityBudget.test.ts`, no `src/app/actions/`, no `src/app/api/`, no `src/store/` and no deleted file. The `version` field of `package.json` is `0.1.105-YYYYMMDDHHmm` with a real local timestamp, up from `0.1.104-202609100536`. `git diff a79abef -- src/components/landing src/i18n/dictionaries` prints nothing at all: moving an existing header into a component is not a selling point.

## Out of Scope

- **The mount effect, `refreshPlaylist` and the `eslint-disable`.** Lines 104-117 and the `// eslint-disable-next-line react-hooks/set-state-in-effect` above them stay byte for byte; `refreshPlaylist` keeps its load role and is passed to `useSpotifySync` as `onSynced`. RH-71 deletes all three with the Server Component conversion, which is why the `useEffect(` target here is 1 and not 0.
- **The Server Component conversion, the override deletion and the ratchet count.** RH-71 deletes the page's override entry, takes `MAX_OVERRIDES` to 19 and edits the AGENTS.md sentence that names the bound. This task re-pins one entry and must not touch `src/lib/__tests__/complexityBudget.test.ts` or `AGENTS.md` - including the Naming Conventions paragraph about combined test files, which now has a third case (`playlistHeader.test.tsx`, after `feedbackSurfaces.test.tsx` and `tagBars.test.tsx`) for RH-71's manifest pass to record.
- **The `Status:` lines in `docs/plans/code-quality-review.md`.** RH-66 wrote F13's; RH-71 writes F11's. This task writes neither and must not touch that file.
- **The in-playlist text filter input, the error banner and the two filter states.** Lines 466-521 stay on the page, and `activeTagFilter` / `songFilterQuery` stay as `useState`: they are filter selection, not panels, and a union that made them mutually exclusive with the picker would be wrong. Extracting them is what the plan's `useState <= 5` and `PlaylistDetailPage <= 260` would need, and it belongs with RH-71's island.
- **`ConfirmPanel`.** The delete confirmation keeps its inline `Sure? / Yes / No` markup verbatim. Adopting `src/components/ui/ConfirmPanel.tsx` would rename the buttons, move focus on mount and bind Escape - three behaviour changes under a net this task may not edit.
- **The route handler and the server side of the sync.** No change to `src/app/api/spotify/**` or `src/lib/spotifyPlaylistSync.ts`. The new `src/lib/playlistSync.ts` describes the request the client sends and must never import either.
- **Rollback on a failed write, and the `.catch(console.error)` call sites.** The optimistic paths RH-69 recorded stay as they are, and the three `.catch(console.error)` handlers move with their JSX unchanged; tightening either would change what the e2e net observes and would move the repository's `22 problems` figure.
- **The e2e suite.** Not one line under `e2e/` may change; it is the regression net, and editing it would remove the only evidence this refactor preserves behaviour.

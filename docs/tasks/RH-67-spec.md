# RH-67 — PlaylistDetailPage part 2/6: extract the dual-source SongPicker into lib, hook and components

Baseline for every measurement in this document: `882806a`
(`test(RH-66): characterization e2e for /playlists/[id] and derived currentUserId (F13)`),
tree clean, `package.json` version `0.1.101-202609100226`.

Parent: RH-53. Predecessor: RH-66 (done). Successors: RH-68..RH-71.

## Scope

Move the add-song panel of `src/app/playlists/[id]/page.tsx` — the whole vertical
slice: its six `useState`, its two `useRef`, the 500 ms debounce effect, the
parallel catalog + Spotify search with its stale-response guard, the three dedup
memos, the two add handlers, the `PickerRow` component and the panel JSX — out of
the page into a pure lib module, a controller hook, three components and one
injected Server Action bundle, preserving behaviour exactly.

In scope, and nothing else:

- `src/lib/songPicker.ts` (new) — the pure decisions: minimum-query length,
  the visible-catalog filter against the playlist's current song ids, the
  catalog/Spotify dedup key and key set, the per-row error map add/clear, the
  "already in your repertoire" recognition and the repertoire lookup by
  title+artist that `resolveTrackId` performs today. Also the exported
  `SongPickerController` type, following `SongStatusController` in
  `src/lib/songStatus.ts`.
- `src/hooks/useSongPicker.ts` (new) — the controller: query, debounce, search,
  results, per-row errors, the two add commands. Declares `SongPickerActions`,
  following `SongStatusActions` in `src/hooks/useSongStatus.ts`.
- `src/components/playlists/SongPicker.tsx` and
  `src/components/playlists/PickerRow.tsx` (new) — the panel and its result row.
- `src/components/playlists/SongPickerToggle.tsx` (new) — the header `+` button
  that opens the panel. It moves with the panel because it carries the panel's
  `aria-pressed` state and its `showSearch ? … : …` class ternary, which is one
  of the five decision points that have to leave `PlaylistDetailPage` for its
  complexity to reach 30.
- `src/components/ui/Spinner.tsx` (new) — the page's local `Spinner`
  (lines 57-79) moved verbatim to the one cross-area component directory,
  because the panel and the page both render it and copying it would create a
  jscpd clone.
- `src/app/songPickerActions.ts` (new) — the `SONG_PICKER_ACTIONS` bundle, F21
  pattern, exactly like `src/app/fastViewEntryActions.ts`.
- Three test files, the page itself, the page's `complexity-budget/override`
  entry in `eslint.config.mjs` re-pinned to the newly measured numbers, and the
  version bump.

Not in scope: everything else on that page (the song list and its
complexity-29 row arrow, `PlaylistSummary`, the tag editing, the header, the
Spotify sync path, the panel reducer, the Server Component conversion) — those
are RH-68..RH-71. See "Out of Scope".

## Audit at 882806a

### The page

`grep -c "" 'src/app/playlists/[id]/page.tsx'` prints `1343`.
`rtk proxy npx eslint 'src/app/playlists/[id]/page.tsx'` exits 0 printing
nothing: its violations are absorbed by `eslint.config.mjs:74`, pinned by RH-66
at `complexity 35`, `max-lines-per-function 1071`, `max-lines 1343`. Measured
with the budget rules forced (`--rule '{"complexity":["error",1],"max-lines-per-function":["error",40]}'`),
`PlaylistDetailPage` at line 273 is **complexity 35, 1071 lines**; the file's
other worst function is the song-row arrow at 1076 (complexity 29), which RH-68
owns. `grep -c "useState"` prints `23`, `grep -c "useEffect"` prints `7` and
`grep -c "useRef"` prints `7` (each count includes the `react` import line;
the six `useRef(` calls are at 313, 314, 317, 318, 319, 320).

### What belongs to the picker, by line

| Lines | What | Destination |
|---|---|---|
| 11, 17-19, 21, 27 | imports `addSongToPlaylistAction`, `searchGlobalSongsAction`, `addSongAction`, `createAndAddSongAction`, `searchSpotify`/`SpotifyTrack`, `GlobalSong` | actions bundle / hook |
| 57-79 | `Spinner` | `src/components/ui/Spinner.tsx` |
| 81-141 | `PickerRowProps` + `PickerRow` | `src/components/playlists/PickerRow.tsx` |
| 299-314 | `showSearch` (**stays**) plus `pickerQuery`, `pickerCatalogResults`, `pickerSpotifyResults`, `pickerLoading`, `pickerAddingId`, `pickerRowErrors`, `pickerDebounce`, `pickerLatestQuery` | hook |
| 320, 331-333 | `searchInputRef` and its focus effect | `SongPicker.tsx` |
| 361-392 | `runPickerSearch` (2-char gate, `Promise.all` over catalog + Spotify each with its own `.catch(() => [])`, stale-response guard on `pickerLatestQuery`) and the 500 ms debounce effect | hook |
| 394-397 | `currentSongIds` — used only at 427, by the picker | hook |
| 425-446 | `pickerVisibleCatalog`, `pickerCatalogKeys`, `pickerVisibleSpotify` | lib + hook |
| 461-541 | `addSongIdToPlaylist`, `handlePickerAddCatalog`, `handlePickerAddSpotify` (with the complexity-7 `resolveTrackId` fallback) | hook |
| 776-801 | the `Add songs` toggle button | `SongPickerToggle.tsx` |
| 1275-1340 | the panel JSX: input, prompt / loading / empty / results `ul[aria-live="polite"]` | `SongPicker.tsx` |

`autoPushIfNeeded` (448-459) **stays**: `handleRemoveSong` (543) calls it at 548.
`setSongs` stays with the page, which owns `songs`.

### The search transport

`searchSpotify` is `src/lib/spotify.ts`, a client-side `fetch` of
`/api/spotify/search` that already swallows every failure and returns `[]`; it
imports no `pg`, so the hook imports it directly and no F21 problem arises. The
catalog half is `searchGlobalSongsAction`, a Server Action, so it can only reach
the hook through the injected bundle. That asymmetry is why the bundle carries
five members and not six.

### The regression net

`e2e/playlist-detail.spec.ts` (RH-66, 11 tests) is the only test covering this
page. Its picker test pins the locator contract that must survive byte-for-byte:
a button with accessible name `Add songs`; an input whose placeholder starts
`Search catalog and Spotify`; result rows as `<li>` inside
`ul[aria-live="polite"]`; a button named exactly `Add` in each row; and the
panel **unmounting** when the toggle is clicked again (`toHaveCount(0)`).

### Reference measurement of the result

The extraction described below was simulated line by line against `882806a` and
linted with the budget rules forced. The resulting page is **1019 lines**, with
`PlaylistDetailPage` at **834 lines and complexity 30**, `grep -c "useState"`
at **17**, `useEffect` at `5` and `useRef` at `4`.

Note on the parent plan's targets: `.meridian/reports/RH-53-spec-1.md` predicts
`PlaylistDetailPage <= 810` lines. That figure double-counts `PickerRow`
(61 lines) and `Spinner` (23 lines), both of which sit **outside**
`PlaylistDetailPage` and therefore shrink the file without shrinking the
function. The page target (1080) and the complexity target (30) are met exactly
as planned; the function-length result below is stated at the measured value
plus a small margin, `840`.

## Approach

### Behavior

Nothing a user can observe changes. The panel still opens from the header `+`
button, still focuses its input on open, still waits 500 ms after the last
keystroke, still refuses to search below two trimmed characters, still queries
the catalog and Spotify in parallel and ignores the response of a query that is
no longer the latest, still hides catalog rows already in the playlist and
Spotify rows the catalog already covers, still adds a catalog song (adding it to
the repertoire first when it is not there), still creates a Spotify track as a
song and falls back to the existing repertoire entry when the create reports
"already in your repertoire", still reloads the playlist songs and runs the
Spotify auto-push after each add, and still shows one error under the row that
failed while the other rows stay usable.

Two internal contracts make that testable:

- The controller's two add commands **never reject**. A failure — from the
  repertoire write, the playlist write, the reload or the auto-push — is
  recorded in `rowErrors` under that row's id and cleared when that row is tried
  again, exactly as lines 473-541 do today.
- The debounce effect never calls `console.error`; a rejection routes through
  `logger.error` (`@/lib/logger`, already used by `src/hooks/useSongEntry.ts`),
  per the P1 convention.

### Shape

`src/lib/songPicker.ts` exports pure functions only — no React, no fetch, no
`@/lib/db` — plus the controller type. Every function export is written
`export function`, never an arrow const: `namingConventions.test.ts` enforces
that for `src/lib`. The exports:

- `MIN_PICKER_QUERY_LENGTH` and `shouldSearchPicker(query)` (the 2-char gate at
  364 and 1290),
- `visiblePickerCatalog(results, playlistSongIds)`,
- `pickerDedupKey({ title, artist })`, `pickerCatalogKeys(songs)`,
  `visiblePickerSpotify(tracks, catalogKeys)`,
- `withPickerRowError(errors, rowId, error)` (including the
  `error instanceof Error ? error.message : "Failed to add"` narrowing) and
  `withoutPickerRowError(errors, rowId)`,
- `isAlreadyInRepertoireError(error)` and
  `findRepertoireSongIdByTrack(entries, track)` — the two halves of
  `resolveTrackId`'s catch,
- `interface SongPickerController` with **data plus intent commands and no
  `set*` member** (the RH-64 rule): `query`, `loading`, `addingId`, `rowErrors`,
  `catalogResults`, `spotifyResults`, `changeQuery(query)`,
  `addCatalogSong(song)`, `addSpotifyTrack(track)`. `catalogResults` and
  `spotifyResults` are the already-filtered, already-deduped lists, so the
  component holds no filtering decision.

`src/hooks/useSongPicker.ts` exports `SongPickerActions` (`searchCatalog`,
`addToRepertoire`, `createAndAddSong`, `addSongToPlaylist`,
`getPlaylistWithSongs`), `UseSongPickerOptions` (`playlistId`, `actions`,
`repertoire`, `songs`, `onSongsChanged`, `afterAdd`) and
`useSongPicker(options): SongPickerController`. It owns the six states, the two
refs, the debounce effect and the memos; it imports `searchSpotify` from
`@/lib/spotify` and everything else from `@/lib/songPicker`; it imports nothing
from `@/app/*`.

`src/components/playlists/SongPicker.tsx` takes exactly one prop,
`picker: SongPickerController`, owns the input ref and the on-mount focus, and
renders the four states in today's order (prompt / loading / empty / rows) with
today's markup and class names. `PickerRow.tsx` keeps `PickerRowProps` and the
markup unchanged. `SongPickerToggle.tsx` takes `open` and `onToggle` and keeps
the button's markup, `aria-label="Add songs"` and `aria-pressed`.

The page keeps `showSearch` (RH-70 folds it into the panel reducer), renders
`<SongPickerToggle open={showSearch} onToggle={…} />` in the header and
`{showSearch && <SongPicker picker={picker} />}` where the panel is today, and
calls `useSongPicker` with `SONG_PICKER_ACTIONS`, `repertoireMap`, `songs`,
`setSongs` and `autoPushIfNeeded`.

The complexity budget lands on exactly 30, with no margin: one added `&&`, `?:`
or `??` anywhere in `PlaylistDetailPage`'s own body puts it at 31 and fails ER4.
The two new call sites must stay as written — `{showSearch && <SongPicker …/>}`
is the single decision point the extraction budgets for, and the toggle's own
ternary must travel into `SongPickerToggle` rather than stay behind as a prop
expression.

### Files touched

- `src/lib/songPicker.ts` — new; the pure decisions and `SongPickerController`.
- `src/hooks/useSongPicker.ts` — new; the controller hook and `SongPickerActions`.
- `src/components/playlists/SongPicker.tsx` — new; the panel.
- `src/components/playlists/PickerRow.tsx` — new; the result row, moved.
- `src/components/playlists/SongPickerToggle.tsx` — new; the header `+` button, moved.
- `src/components/ui/Spinner.tsx` — new; the page's `Spinner`, moved verbatim.
- `src/app/songPickerActions.ts` — new; `SONG_PICKER_ACTIONS`.
- `src/app/playlists/[id]/page.tsx` — the deletions listed in the audit table,
  four new imports, one `useSongPicker` call, two JSX call sites.
- `src/lib/__tests__/songPicker.test.ts` — new; 15 tests, node environment.
- `src/hooks/__tests__/useSongPicker.test.tsx` — new; 13 tests, jsdom.
- `src/components/playlists/__tests__/SongPicker.test.tsx` — new; 10 tests, jsdom:
  the nine panel tests plus one that renders `SongPickerToggle` directly.
- `eslint.config.mjs` — the three numbers of the page's override entry re-pinned.
  No entry added, none removed.
- `package.json` — version `0.1.102-YYYYMMDDHHmm`.
- `docs/tasks/RH-67-spec.md` — this file. `docs/suggestions-log.md` optionally.

### Test criteria

The pure lib is unit-tested directly. The hook is tested with
`renderHook` + fake timers: that nothing is searched below two characters, that
the search fires once 500 ms after the last keystroke, that an out-of-order
response is discarded, that the dedup and the playlist filter apply, that each
add path calls exactly the actions it should, and that a failure lands in
`rowErrors` and is cleared on retry. The components are tested with Testing
Library against a hand-built controller object: the four panel states, the
locator contract the e2e net depends on, and that clicking `Add` calls the
controller command. The same file also renders `SongPickerToggle` on its own,
because the page - not `SongPicker` - is what renders the toggle, and the
`Add songs` locator is one of the four the e2e net depends on. `e2e/playlist-detail.spec.ts` is the end-to-end proof and
must pass with no edit at all.

**Landing Page Rule decision.** Internal refactor: the add-song picker already
exists and this task adds no capability a musician would choose the app for. The
landing copy and both dictionaries must not change.

## Expected Results

ER1 - The extraction exists, in the layers AGENTS.md prescribes. `test -f src/lib/songPicker.ts && test -f src/hooks/useSongPicker.ts && test -f src/components/playlists/SongPicker.tsx && test -f src/components/playlists/PickerRow.tsx && test -f src/components/playlists/SongPickerToggle.tsx && test -f src/components/ui/Spinner.tsx && test -f src/app/songPickerActions.ts` exits `0`; none of those seven files exists at `882806a`. `grep -c "export function\|export interface\|export const" src/lib/songPicker.ts` prints a number greater than or equal to `9`, and `grep -c "export interface SongPickerController" src/lib/songPicker.ts`, `grep -c "export function useSongPicker" src/hooks/useSongPicker.ts`, `grep -c "export interface SongPickerActions" src/hooks/useSongPicker.ts` and `grep -c "SONG_PICKER_ACTIONS" src/app/songPickerActions.ts` each print a number greater than or equal to `1`. `grep -cE "from ['\"]react['\"]|useState|useEffect|useRef" src/lib/songPicker.ts` prints `0` and `grep -c "@/lib/db" src/lib/songPicker.ts src/hooks/useSongPicker.ts` prints `0` for both files, so the lib is pure and neither new module pulls in `pg`. The controller carries no raw setter (the RH-64 rule): between the line matching `export interface SongPickerController` and the closing `}` of that interface, no member name begins with `set`, and `grep -cE "^\s*set[A-Z]" src/lib/songPicker.ts` prints `0`.

ER2 - The import direction rule (F21) still holds and the actions arrive by injection. `grep -rn "@/app/" src/components src/lib src/hooks | grep -v __tests__` prints nothing at all (as at `882806a`). `rtk proxy npx eslint src/lib/songPicker.ts src/hooks/useSongPicker.ts src/components/playlists/SongPicker.tsx src/components/playlists/PickerRow.tsx src/components/playlists/SongPickerToggle.tsx src/components/ui/Spinner.tsx src/app/songPickerActions.ts` exits `0` with no output, so no new file needed an override or trips `no-restricted-imports`. `grep -c "from '@/lib/spotify'\|from \"@/lib/spotify\"" src/hooks/useSongPicker.ts` prints `1` (the Spotify half is a client fetch in `src/lib`, not a Server Action, so it is imported and not injected), while `grep -c "searchGlobalSongsAction\|addSongAction\|createAndAddSongAction\|addSongToPlaylistAction\|getPlaylistWithSongsAction" src/hooks/useSongPicker.ts src/components/playlists/SongPicker.tsx` prints `0` for both files and `grep -c "@/app/actions/" src/app/songPickerActions.ts` prints a number greater than or equal to `1`. `head -1 src/components/playlists/SongPicker.tsx`, `head -1 src/components/playlists/PickerRow.tsx` and `head -1 src/components/playlists/SongPickerToggle.tsx` each print exactly `"use client";` or `'use client'` (the hook carries no directive: all eleven files in `src/hooks/`, `useSongStatus.ts` included, open on an `import` line, and this task does not make RH-67 the odd one out).

ER3 - The picker is gone from the page, and only the picker. In `src/app/playlists/[id]/page.tsx`: `grep -c "pickerQuery\|pickerCatalogResults\|pickerSpotifyResults\|pickerLoading\|pickerAddingId\|pickerRowErrors\|pickerDebounce\|pickerLatestQuery\|runPickerSearch\|handlePickerAddCatalog\|handlePickerAddSpotify\|pickerVisibleCatalog\|pickerVisibleSpotify\|pickerCatalogKeys\|PickerRow\|searchInputRef\|currentSongIds\|addSongIdToPlaylist" 'src/app/playlists/[id]/page.tsx'` prints `0` (it prints a number greater than `40` at `882806a`); `grep -c "searchSpotify\|SpotifyTrack\|searchGlobalSongsAction\|addSongAction\|createAndAddSongAction\|addSongToPlaylistAction\|const Spinner" 'src/app/playlists/[id]/page.tsx'` prints `0`; `grep -c "useSongPicker" 'src/app/playlists/[id]/page.tsx'` prints `2` (the import and the call) and `grep -c "SONG_PICKER_ACTIONS" 'src/app/playlists/[id]/page.tsx'` prints `2`. What must survive does: `grep -c "showSearch" 'src/app/playlists/[id]/page.tsx'` prints a number greater than or equal to `3` (the state, the toggle, the panel gate - RH-70 owns it, not this task), `grep -c "autoPushIfNeeded" 'src/app/playlists/[id]/page.tsx'` prints a number greater than or equal to `3`, and `git diff 882806a -- src/app/actions src/lib/playlists.ts src/lib/spotify.ts src/app/api` prints nothing at all.

ER4 - The page's measured budget numbers fall, and its override entry states them exactly. `grep -c "" 'src/app/playlists/[id]/page.tsx'` prints a number less than or equal to `1080` (`1343` at `882806a`; the reference extraction measures `1019`). `grep -c "useState" 'src/app/playlists/[id]/page.tsx'` prints `17` (`23` at `882806a`), `grep -c "useEffect"` prints `5` (`7`) and `grep -c "useRef"` prints `4` (`7` at
`882806a`: the `react` import line plus six `useRef(` calls; three of them - 313,
314 and 320 - leave with the picker). `rtk proxy npx eslint 'src/app/playlists/[id]/page.tsx' --rule '{"complexity":["error",1],"max-lines-per-function":["error",300]}'` prints, among its lines, exactly one line containing `Function 'PlaylistDetailPage' has a complexity of` and that number is at most `30` (`35` at `882806a`), and exactly one line containing `Function 'PlaylistDetailPage' has too many lines` and that number is at most `840` (`1071` at `882806a`; the reference extraction measures `834` - the parent plan's `810` double-counts the 61 lines of `PickerRow` and the 23 lines of `Spinner`, which leave the file but were never inside the function). The `complexity-budget/override` entry for `src/app/playlists/\[id\]/page.tsx` in `eslint.config.mjs` carries those three measured values verbatim as its `complexity`, `max-lines-per-function` and `max-lines` ceilings, and `rtk proxy npx eslint 'src/app/playlists/[id]/page.tsx'` (no `--rule`) exits `0` printing nothing.

ER5 - The ratchet did not grow and its guard is green. `grep -c "complexity-budget/override" eslint.config.mjs` prints `20`, exactly as at `882806a`: no entry added for any of the seven new files, none removed. `grep -c "MAX_OVERRIDES = 20" src/lib/__tests__/complexityBudget.test.ts` prints `1` and `git diff 882806a -- src/lib/__tests__/complexityBudget.test.ts AGENTS.md docs/plans/code-quality-review.md` prints nothing at all (RH-71 owns the ratchet count, the manifest sentence and the F11 `Status:` line). `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts src/lib/__tests__/namingConventions.test.ts src/lib/__tests__/errorHandlingStyle.test.ts` exits `0` with `0` failed tests - the last two prove the new files match the naming and error-handling conventions, and `grep -rn "console.error" src/hooks/useSongPicker.ts src/components/playlists/SongPicker.tsx` prints nothing at all.

ER6 - The pure decisions are unit-tested. `rtk proxy npx vitest run src/lib/__tests__/songPicker.test.ts` exits `0` printing `Test Files  1 passed (1)` and `Tests  15 passed (15)`, its tests named exactly: `treats a blank or one-character query as too short to search`, `accepts a two-character query once trimmed`, `hides catalog results whose song id is already in the playlist`, `keeps every catalog result when the playlist holds no songs`, `builds a dedup key from the lowercased title and artist`, `collects one dedup key per visible catalog song`, `drops a Spotify track the catalog already covers, ignoring case`, `keeps a Spotify track whose artist differs from the catalog result`, `records an Error message under the failing row id`, `records the fallback message when the thrown value is not an Error`, `leaves the other rows untouched when recording an error`, `clears only the given row id from the error map`, `recognises the already-in-your-repertoire message`, `finds the repertoire song id matching the track title and artist, ignoring case`, `returns null when no repertoire entry matches the track`. The file needs no `// @vitest-environment` line, because the module under test imports no DOM API.

ER7 - The controller is tested, including the two behaviours that only a hook test can prove. `rtk proxy npx vitest run src/hooks/__tests__/useSongPicker.test.tsx` exits `0` printing `Test Files  1 passed (1)` and `Tests  13 passed (13)`. Its literal first line is `// @vitest-environment jsdom`, it calls `afterEach(cleanup)`, it imports nothing from `@/app/`, and its tests are named exactly: `runs no search while the query is shorter than two characters`, `searches once, 500 ms after the last keystroke`, `queries the catalog and Spotify in parallel and exposes both lists`, `keeps the results of the latest query when an earlier search resolves last`, `clears both result lists when the query falls back below two characters`, `hides a catalog result already in the playlist`, `hides a Spotify track the catalog already covers`, `leaves the catalog list empty when the catalog search rejects`, `adds a catalog song already in the repertoire straight to the playlist`, `adds a catalog song missing from the repertoire to the repertoire first`, `creates a Spotify track as a song and adds it to the playlist`, `reuses the existing repertoire entry when the create reports the song is already in the repertoire`, `records a per-row error when an add fails and clears it on the next attempt`. The fourth test resolves two searches out of order and asserts the older one is discarded; the ninth asserts `addToRepertoire` was **not** called; the last asserts that the returned promise resolved rather than rejected and that `rowErrors` names only the failing row.

ER8 - The panel and its toggle render every state and keep the locator contract the e2e net depends on. `rtk proxy npx vitest run src/components/playlists/__tests__/SongPicker.test.tsx` exits `0` printing `Test Files  1 passed (1)` and `Tests  10 passed (10)`. Its literal first line is `// @vitest-environment jsdom`, it calls `afterEach(cleanup)`, it imports nothing from `@/app/`, it builds its `SongPickerController` by hand (no Server Action, no fetch), and its tests are named exactly: `renders a search input whose placeholder names the catalog and Spotify`, `focuses the search input when the panel mounts`, `prompts the user to type while the query is below two characters`, `renders the searching state while the controller reports loading`, `renders the no-results state when both result lists are empty`, `renders one list item per catalog result and per Spotify result`, `calls the controller add command for the clicked catalog row`, `calls the controller add command for the clicked Spotify row`, `disables the Add button of the row being added and shows that row's error`, `renders the Add songs toggle with its pressed state and calls back when clicked`. The tenth test renders `SongPickerToggle` directly from this same file - the page, not `SongPicker`, is the component that renders the toggle, so it cannot be reached through `SongPicker` - and asserts that `getByRole('button', { name: 'Add songs' })` finds it, that its `aria-pressed` attribute reads `false` when `open` is `false` and `true` when `open` is `true`, and that clicking it calls `onToggle` exactly once. Between them the ten tests assert, mechanically, the four locators `e2e/playlist-detail.spec.ts` uses: a placeholder beginning `Search catalog and Spotify`, a `ul` carrying `aria-live="polite"` whose children are `listitem`s, a button named exactly `Add` per row, and a button with accessible name `Add songs` carrying `aria-pressed`.

ER9 - The characterization net passes untouched. `git diff 882806a -- e2e playwright.config.ts` prints nothing at all: not one assertion, locator, helper or timeout was edited to accommodate the refactor. `npx playwright test --list` prints `Total: 33 tests in 7 files`, as at `882806a`. With Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (migrations applied), `.env.local` present, nothing listening on port 3000 and a fresh production build, `PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" npx playwright test --workers=1 --reporter=list` exits `0` and prints `33 passed`, with no `failed` and no `flaky` line; in particular the eleven tests of `e2e/playlist-detail.spec.ts` are among them, including `adds two catalog songs to the playlist through the picker`, which types into the picker, waits out the 500 ms debounce, clicks `Add` on a catalog row, closes the panel and asserts the input is gone (`toHaveCount(0)`, so the panel must unmount, not hide) and that the two adds survive a reload.

ER10 - The new modules are covered and every repository gate holds at its `882806a` value. With Postgres up and a non-empty `SUPABASE_SERVICE_ROLE_KEY`: `rtk proxy npx vitest run` exits `0` printing `Test Files  111 passed (111)` (`108` at `882806a`) and `Tests` passed at least `1249` (`1211` at `882806a`, plus 15 + 13 + 10 new), with `0` failed and `0` skipped. `npm run test:coverage` exits `0` with all four thresholds met (statements at least `80`, branches at least `65`, functions at least `78`, lines at least `80`), and `node -e "const c=require('./coverage/coverage-final.json');const pct=a=>a.length?Math.round(1000*a.filter(x=>x>0).length/a.length)/10:100;for (const k of Object.keys(c)) if (k.endsWith('/src/lib/songPicker.ts')||k.endsWith('/src/hooks/useSongPicker.ts')) console.log(k.split('/src/').pop(), pct(Object.values(c[k].f)), pct(Object.values(c[k].s)))"` prints exactly two lines, `lib/songPicker.ts` and `hooks/useSongPicker.ts` in some order, each followed by a function percentage and a statement percentage of at least `90`. `rtk proxy npx eslint .` prints `22 problems (8 errors, 14 warnings)`, identical to `882806a`. `./node_modules/.bin/tsc --noEmit` exits `0` printing nothing. `npm run lint:dead` exits `0` reporting no unused file, export or dependency (so no lib export is speculative). `npm run lint:dup` exits `0` with its `Total:` row reporting at most `18` clones and at most `0.61 %` - the `882806a` numbers, unmoved, because `PickerRow` and `Spinner` are moved and not copied. `npm run audit` exits `0` with no high or critical advisory.

ER11 - Release hygiene and a closed change set, with git state untouched. `git diff --name-only 882806a | sort` lists only paths drawn from this closed set and no others: `docs/suggestions-log.md`, `docs/tasks/RH-67-spec.md`, `eslint.config.mjs`, `package.json`, `src/app/playlists/[id]/page.tsx`, `src/app/songPickerActions.ts`, `src/components/playlists/PickerRow.tsx`, `src/components/playlists/SongPicker.tsx`, `src/components/playlists/SongPickerToggle.tsx`, `src/components/playlists/__tests__/SongPicker.test.tsx`, `src/components/ui/Spinner.tsx`, `src/hooks/__tests__/useSongPicker.test.tsx`, `src/hooks/useSongPicker.ts`, `src/lib/__tests__/songPicker.test.ts`, `src/lib/songPicker.ts`. Any other path fails this result; in particular the list contains no file under `e2e/`, no `AGENTS.md`, no `docs/plans/code-quality-review.md`, no `src/lib/__tests__/complexityBudget.test.ts`, no `src/store/`, no `src/app/actions/` and no deleted file. The `version` field of `package.json` is `0.1.102-YYYYMMDDHHmm` with a real local timestamp, up from `0.1.101-202609100226`. `git diff 882806a -- src/components/landing src/i18n/dictionaries` prints nothing at all: moving an existing panel between files is not a selling point.

## Out of Scope

- **The rest of the page.** The song list and its complexity-29 row arrow, `PlaylistSummary`, `formatDuration`, `timeAgo`, the tag editing (playlist tags, song tags, tag filter), the header and its rename input, the Spotify pull/push sync path, `refreshPlaylist` and the mount effect all stay exactly where they are. They belong to RH-68, RH-69, RH-70 and RH-71.
- **`showSearch` and the other three focus effects.** Only the picker's focus effect (331-333) leaves, into `SongPicker`. `showSearch` stays a page `useState` because RH-70 folds it, `editing` and `confirmDelete` into one panel reducer; moving it into the controller now would have to be undone there.
- **The Server Component conversion, the override deletion and the ratchet count.** RH-71 deletes the override entry and takes `MAX_OVERRIDES` to 19; this task only re-pins three numbers.
- **The `Status:` lines in `docs/plans/code-quality-review.md`.** RH-66 wrote F13's; RH-71 writes F11's. This task writes none and must not touch that file.
- **Server-side code.** No change to `src/app/actions/*`, `src/lib/playlists.ts`, `src/lib/spotify.ts`, `src/app/api/**` or `src/store/**`. The picker's five Server Actions are re-exported through a bundle, never modified.
- **The e2e suite.** Not one line under `e2e/` may change; the suite is the regression net, and editing it would remove the only evidence this refactor preserves behaviour.

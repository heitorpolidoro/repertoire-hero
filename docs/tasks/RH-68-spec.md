# RH-68 — PlaylistDetailPage part 3/6: retire the complexity-29 row arrow into PlaylistSongRow, PlaylistSongList and PlaylistSummary

Baseline for every measurement in this document: `5c38206`
(`refactor(RH-67): extract the dual-source SongPicker from PlaylistDetailPage`),
tree clean, `package.json` version `0.1.102-202609100329`.

Parent: RH-53. Predecessor: RH-67 (done). Successors: RH-69, RH-70, RH-71.

## Scope

Move the song list of `src/app/playlists/[id]/page.tsx` — the 196-line,
complexity-29 arrow that renders one playlist row, the three list states around
it, and the mastery summary above it — out of the page into one pure lib module
and four components, preserving behaviour exactly. `handleRemoveSong` and
`handleStatusCycle` stay on the page and arrive at the row as injected
callbacks.

In scope, and nothing else:

- `src/lib/playlistDetail.ts` (new) — the pure decisions: the tag collection
  (`allTags`, lines 260-266), the tag + text filter (`filteredSongs`, 268-284),
  the position sort (818-819), the mastery-count / duration / score aggregation
  from `PlaylistSummary`'s `useMemo` (84-118, with `STATUS_SCORES`), and the
  optimistic status-cycle transition (320-341).
- `src/components/playlists/PlaylistSongRow.tsx` (new) — the row: duration,
  status badge with its band-mode read-only branch, remove button, and the
  per-song tag row (chips, remove-chip buttons, inline `new tag` input, `+ tag`
  button) moved **as-is**, receiving its handlers as props. RH-69's
  `useTagEditor` lands inside this component; this task must not anticipate it.
- `src/components/playlists/PlaylistSongIdentity.tsx` (new) — the cover +
  title/artist/album block the row renders twice today (836-865 and 867-896,
  identical but for one hover class). See "Why a fourth component" below: without
  it `PlaylistSongRow` measures complexity 29 and would need a new override
  entry, which the ratchet forbids.
- `src/components/playlists/PlaylistSongList.tsx` (new) — the
  `<section aria-label="Songs in this playlist">` and its three states (no songs
  / no match / rows).
- `src/components/playlists/PlaylistSummary.tsx` (new) — lines 56-180, taking
  `STATUS_BAR_COLORS` with it; `STATUS_SCORES` leaves the page too, into
  `playlistDetail.ts`, because the score computation is its only reader and that
  computation is pure.
- Three test files, the page itself, the page's `complexity-budget/override`
  entry in `eslint.config.mjs` re-pinned to the newly measured numbers, and the
  version bump.

Not in scope: the header and its rename input, the Spotify strip and sync path,
the playlist-level tag bar, the in-playlist text filter input, the tag filter
bar, the three focus effects, the mount effect and its `eslint-disable`, and the
Server Component conversion. Those are RH-69, RH-70 and RH-71. See "Out of
Scope".

## Audit at 5c38206

### The page

`grep -c "" 'src/app/playlists/[id]/page.tsx'` prints `1024`.
`rtk proxy npx eslint 'src/app/playlists/[id]/page.tsx'` exits 0 printing
nothing: its three violations are absorbed by `eslint.config.mjs:74`, pinned by
RH-67 at `complexity 30`, `max-lines-per-function 839`, `max-lines 1024`.
Measured with the budget rules forced
(`--rule '{"complexity":["error",1],"max-lines-per-function":["error",1]}'`),
`PlaylistDetailPage` at line 186 is **complexity 30, 839 lines**, and the song-row
arrow at line 820 is **complexity 29, 196 lines** — the worst nested function in
the tree, and the only arrow in the file above complexity 8
(`autoPushIfNeeded`, 286, complexity 7, is the runner-up).
`grep -c "useState"` prints `17`, `useEffect` `5`, `useRef` `4`, `useMemo` `4`,
`useCallback` `3` (each count includes the `react` import line).

### What belongs to this slice, by line

| Lines | What | Destination |
|---|---|---|
| 3 | `Image` import (**stays**: the header cover uses it too) | - |
| 22 | `STATUS_CONFIG, STATUS_ORDER, nextStatus` from `@/lib/statusConfig` | components + lib |
| 29 | the `SongStatus` type import | components + lib |
| 37-44 | `formatDuration` | deleted; `formatPlaylistDuration` (`@/lib/playlistList`, RH-63) is byte-for-byte the same function and both new readers import it |
| 56-76 | `STATUS_SCORES`, `STATUS_BAR_COLORS` | `playlistDetail.ts` / `PlaylistSummary.tsx` |
| 78-180 | `PlaylistSummaryProps` + `PlaylistSummary` | `PlaylistSummary.tsx` |
| 260-266 | the `allTags` memo body | `collectPlaylistTags` |
| 268-284 | the `filteredSongs` memo body | `filterPlaylistSongs` |
| 320-341 | `handleStatusCycle`'s `nextStatus` call and its two `new Map(prev)` clones (the body **stays**, the transition leaves) | `cycleSongStatus` + `withRepertoireEntry` |
| 801-819 | the `<section>`, the three states, the `[...filteredSongs].sort(...)` | `PlaylistSongList.tsx` + `sortPlaylistSongs` |
| 820-1015 | the row arrow | `PlaylistSongRow.tsx` + `PlaylistSongIdentity.tsx` |

`handleRemoveSong` (309-318), `handleStatusCycle` (320-341), `handleAddSongTag`
(401-424), `handleRemoveSongTag` (426-440), `addingTagForSong`, `newTagInput`,
`songTagInputRef` and its focus effect (226-228) all **stay on the page** and are
passed down; RH-69 owns them. The mount effect (245-258) and its
`// eslint-disable-next-line react-hooks/set-state-in-effect` are untouched;
RH-71 owns them.

### Why a fourth component

Moved verbatim into a component of its own, the row measures **complexity 29,
199 lines** — over the base budget of 15 and within one line of the 200-line
budget. A new `complexity-budget/override` entry is forbidden (the list is a
ratchet and may only shrink), so the row has to come under 15 on its own.
Lines 836-865 and 867-896 are the same cover + title/artist/album block written
twice, differing only in the `group-hover:text-emerald-600 transition-colors`
class on the title, and they are also two of the eighteen clones `npm run
lint:dup` reports today
(`app/playlists/[id]/page.tsx [836:25 - 853:42] / [867:26 - 884:42]` and
`[853:133 - 865:27] / [884:86 - 896:27]`). Rendering that block once, through
`PlaylistSongIdentity` with a `linked` boolean that selects between the two
className strings verbatim, takes the row to **complexity 13, 143 lines** and the
identity to **complexity 10, 39 lines** — both under budget, with no override, and
those two clones gone.

### The regression net

`e2e/playlist-detail.spec.ts` (RH-66, 11 tests) is the only test covering this
page. Every locator it uses that touches this slice is a contract this task must
keep byte-for-byte:

- `getByRole('region', { name: 'Songs in this playlist' })` (line 74) — the
  `<section aria-label>`;
- `.getByRole('listitem')` inside that region (78, 172, 176, 235, 241, 246, 250,
  255, 261, 266, 349, 355, 358) — exactly one `<li>` per song and no other list
  item inside a row;
- `getByRole('button', { name: 'Status: Unknown. Click to advance.', exact: true })`
  and its `Learning` variant (182-196) — the `aria-label` template;
- `getByRole('button', { name: 'Remove <title> from playlist' })` (352);
- `getByRole('button', { name: 'Add tag', exact: true })` scoped to a row (209) —
  named exactly, because `Add tag to playlist` starts with the same words;
- `row.getByPlaceholder('new tag')` (210) and the global
  `expect(getByPlaceholder('new tag')).toHaveCount(1)` after opening the
  playlist-level input (308-309) — so the row's input must still render only
  when `addingTagForSong` names that song;
- `getByRole('button', { name: 'Remove tag <tag>' })` scoped to a row (219, 227,
  274, 286, 293);
- `getByText('No songs yet')` (148) and
  `getByText('No songs matching "<q>".')` (247);
- `getByRole('button', { name: <tag>, exact: true })` (222, 230, 260, 287, 294) —
  the tag filter bar, which stays on the page, and which must not collide with the
  row chips' `Remove tag <tag>` buttons.

The playlist-level tag bar locator (`playlistTagBar`, 88-89, an `xpath=..` off
`Add tag to playlist`), the text filter placeholder (238) and the
`heading` name (104) belong to blocks this task does not touch.

### Reference measurement of the result

The extraction described below was simulated file by file against `5c38206` and
linted with the budget rules forced. The resulting page is **666 lines**, with
`PlaylistDetailPage` at **614 lines and complexity 27**; the page's worst
remaining arrow is `autoPushIfNeeded` at complexity 7. The four new components
lint clean under the base budget with no override: `PlaylistSongRow` 143 lines /
complexity 13, `PlaylistSongIdentity` 39 / 10, `PlaylistSongList` 58 / 4,
`PlaylistSummary` 71 / 3.

Two of the parent plan's three targets for this part are unreachable as stated,
for the same reason RH-67's `810 -> 840` was, and are pinned at the measured
values:

- **`PlaylistDetailPage <= 600` lines is pinned at 614.** The plan derived 600
  from an assumed 810-line function after part 2; part 2 measured **839**,
  because `PickerRow` (61 lines) and `Spinner` (23) left the file without ever
  having been inside the function. This part removes **225** function lines,
  more than the 210 the plan budgeted, and still lands 14 lines above a target
  computed from a number that was 29 too low. The 125 lines of `PlaylistSummary`
  and the 8 of `formatDuration` shrink the file, not the function, exactly as
  `PickerRow` did.
- **`complexity <= 26` is pinned at 27.** The song-list slice contains exactly
  three of the page body's own decision points — `songs.length === 0 ?`,
  `filteredSongs.length === 0 ?` and the `activeTagFilter ? : ` inside the
  no-match message — so 30 - 3 = 27. The fourth would have to come from the
  playlist tag bar or the tag filter bar (RH-69) or the header (RH-70); taking
  one now would pre-empt those parts for a single point.

The plan's other targets are met with margin: the page at 666 is well under 830,
and no arrow anywhere in the file is above complexity 7, well under 10.

## Approach

### Behavior

Nothing a user can observe changes. The list still shows `No songs yet` for an
empty playlist, still shows the tag-scoped or query-scoped no-match message when
a filter hides everything, still renders the rows ordered by `position`, and
still renders one row per song. A row still links to that song's Fast View when
the user has a repertoire entry for it (carrying `returnTo` and, in band
context, `bandId`) and renders the same block unlinked when they do not; still
shows the cover or the emerald placeholder, the title, the artist and the album
when present; still shows the duration when the song carries one; still renders
the mastery status as a read-only badge in band context and as a cycling button
in personal context; still removes the song from the playlist through the same
`Remove <title> from playlist` button; and still carries the same per-song tag
chips, remove-chip buttons, inline `new tag` input and `+ tag` button, with the
same Enter / Escape / blur behaviour. The summary above the list still hides
itself for an empty playlist and otherwise renders the same score, label, total
duration, stacked bar and legend.

Two internal contracts make that testable:

- `handleRemoveSong` and `handleStatusCycle` stay on the page and reach the row
  as props. The row calls them and keeps today's `.catch(console.error)` at each
  call site, so a prop is typed `(songId: string) => Promise<void>` and a failure
  still surfaces through the page's error banner, not through an unhandled
  rejection.
- The status cycle stays optimistic in exactly today's order: the map is updated
  before the Server Action is awaited, and on failure the **originally captured**
  entry is put back. `cycleSongStatus` returns that original entry alongside the
  updated one so the revert restores it rather than recomputing it.

### Shape

`src/lib/playlistDetail.ts` exports pure functions only — no React, no fetch, no
`@/lib/db` — written as `export function` declarations, never arrow consts
(`namingConventions.test.ts` enforces that for `src/lib`), plus one exported
lookup table and three exported types:

- `STATUS_SCORES` (the `Record<SongStatus, number>` from page line 56),
- `collectPlaylistTags(songs, repertoire)` — unique tags, `localeCompare` sorted,
- `PlaylistSongFilter { tag: string | null; query: string }` and
  `filterPlaylistSongs(songs, repertoire, filter)`,
- `sortPlaylistSongs(songs)` — by `position`, on a copy,
- `PlaylistMasterySummary { counts, totalSeconds, total, score, scoreStatus }`
  and `summarisePlaylistMastery(songs, repertoire)`, which must return
  `total: 0` for an empty playlist without dividing by zero,
- `SongStatusCycle { entry, status, updated }` and
  `cycleSongStatus(repertoire, songId)`, returning `null` when the song has no
  entry,
- `withRepertoireEntry(repertoire, songId, entry)` — the `new Map(prev)` + `set`
  clone, used by the status cycle's two branches and by the two song-tag
  handlers that stay on the page.

`PlaylistSummary.tsx` keeps `STATUS_BAR_COLORS` (a presentation table: raw hex,
because Tailwind classes cannot drive an inline `width`) and calls
`summarisePlaylistMastery` inside its existing `useMemo`. `PlaylistSongList.tsx`
takes the three states and maps `sortPlaylistSongs(filteredSongs)` to
`PlaylistSongRow`, forwarding the row props unchanged; it holds no filtering
decision. `PlaylistSongRow.tsx` takes one props object (`max-params` is 4, so
props stay a single object) carrying `playlistSong`, `entry`, `playlistId`,
`bandId`, the three tag-editing values (`isAddingTag`, `newTagInput`,
`tagInputRef`) and the six callbacks; it renders `PlaylistSongIdentity` in both
branches of the `entry ? <Link> : <>` test. All four components open on
`"use client"`, like every other file in `src/components/playlists/`.

The page keeps `songs`, `repertoireMap`, `activeTagFilter`, `songFilterQuery`,
`addingTagForSong`, `newTagInput` and `songTagInputRef`, replaces the two memo
bodies with lib calls, replaces the whole `<section>` with one
`<PlaylistSongList ... />` element, and imports `formatPlaylistDuration` nowhere
— `formatDuration` is deleted and its two readers (the summary and the row)
import `formatPlaylistDuration` from `@/lib/playlistList` instead, so no third
copy of that function is created.

### Files touched

- `src/lib/playlistDetail.ts` — new; the pure decisions.
- `src/components/playlists/PlaylistSongRow.tsx` — new; the row.
- `src/components/playlists/PlaylistSongIdentity.tsx` — new; the cover + title
  block, rendered once instead of twice.
- `src/components/playlists/PlaylistSongList.tsx` — new; the section and its
  three states.
- `src/components/playlists/PlaylistSummary.tsx` — new; the summary, moved with
  `STATUS_BAR_COLORS`.
- `src/app/playlists/[id]/page.tsx` — the deletions listed in the audit table,
  the new imports, two lib-backed memos, a shorter `handleStatusCycle`, and one
  `<PlaylistSongList ... />` call site.
- `src/lib/__tests__/playlistDetail.test.ts` — new; 17 tests, node environment.
- `src/components/playlists/__tests__/PlaylistSongList.test.tsx` — new; 14 tests,
  jsdom; covers the list, the row and the identity block, which are only
  reachable through the list.
- `src/components/playlists/__tests__/PlaylistSummary.test.tsx` — new; 6 tests,
  jsdom.
- `eslint.config.mjs` — the three numbers of the page's override entry re-pinned.
  No entry added, none removed.
- `package.json` — version `0.1.103-YYYYMMDDHHmm`. Note that `0.1.103` is a patch
  bump above `0.1.102`: three-digit patches sort lower as plain strings but are
  numerically higher, which is what AGENTS.md's "must only ever go up" means.
- `docs/tasks/RH-68-spec.md` — this file. `docs/suggestions-log.md` optionally.

### Test criteria

The pure lib is unit-tested directly, in the node environment, against
hand-built `PlaylistSong[]` and `Map<string, Repertoire>` fixtures. The
components are tested with Testing Library against plain props and `vi.fn()`
callbacks: the list's three states, the row's link / no-link branches, its
duration, its band-mode and personal-mode status affordances, its remove button
and its whole tag row, and the summary's empty, duration, score, bar and legend
paths. Between them the component tests pin, mechanically, every locator
`e2e/playlist-detail.spec.ts` reaches into this slice for.
`e2e/playlist-detail.spec.ts` is the end-to-end proof and must pass with no edit
at all.

**Landing Page Rule decision.** Internal refactor: the playlist song list already
exists and this task adds no capability a musician would choose the app for. The
landing copy and both dictionaries must not change.

## Expected Results

ER1 - The extraction exists, in the layers AGENTS.md prescribes. `test -f src/lib/playlistDetail.ts && test -f src/components/playlists/PlaylistSongRow.tsx && test -f src/components/playlists/PlaylistSongIdentity.tsx && test -f src/components/playlists/PlaylistSongList.tsx && test -f src/components/playlists/PlaylistSummary.tsx` exits `0`; none of those five files exists at `5c38206`. `grep -c "export function\|export interface\|export const" src/lib/playlistDetail.ts` prints a number greater than or equal to `10`, and `grep -c "export function collectPlaylistTags\|export function filterPlaylistSongs\|export function sortPlaylistSongs\|export function summarisePlaylistMastery\|export function cycleSongStatus\|export function withRepertoireEntry" src/lib/playlistDetail.ts` prints `6`. `grep -c "STATUS_SCORES" src/lib/playlistDetail.ts` prints a number greater than or equal to `2` and `grep -c "STATUS_BAR_COLORS" src/components/playlists/PlaylistSummary.tsx` prints a number greater than or equal to `3`: both tables left the page with the summary, the scoring one landing beside the pure score computation that is its only reader and the colour one staying with the markup it styles. `grep -cE "from ['\"]react['\"]|useState|useEffect|useMemo" src/lib/playlistDetail.ts` prints `0` and `grep -c "@/lib/db" src/lib/playlistDetail.ts` prints `0`, so the lib is pure and pulls in no `pg`. `head -1` of each of the four new component files prints exactly `"use client";` or `'use client'`.

ER2 - The import direction rule (F21) still holds and the two page handlers arrive by injection. `grep -rn "@/app/" src/components src/lib src/hooks | grep -v __tests__` prints nothing at all (as at `5c38206`). `rtk proxy npx eslint src/lib/playlistDetail.ts src/components/playlists/PlaylistSongRow.tsx src/components/playlists/PlaylistSongIdentity.tsx src/components/playlists/PlaylistSongList.tsx src/components/playlists/PlaylistSummary.tsx` exits `0` with no output, so no new file needed an override and none trips `no-restricted-imports`. `grep -c "updateSongStatusAction\|removeSongFromPlaylistAction\|updateSongTagsAction\|@/app/actions" src/components/playlists/PlaylistSongRow.tsx src/components/playlists/PlaylistSongList.tsx` prints `0` for both files, while `grep -c "onStatusCycle" src/components/playlists/PlaylistSongRow.tsx` and `grep -c "onRemoveSong" src/components/playlists/PlaylistSongRow.tsx` each print a number greater than or equal to `2` (the prop declaration and its call site): the row cycles a status and removes a song only through callbacks the page hands it. `grep -c "formatPlaylistDuration" src/components/playlists/PlaylistSummary.tsx src/components/playlists/PlaylistSongRow.tsx` prints a number greater than or equal to `2` for each file and `grep -rc "formatDuration" 'src/app/playlists/[id]/page.tsx'` prints `0`: the page's local copy of that helper is deleted rather than moved, both readers importing the identical `formatPlaylistDuration` from `@/lib/playlistList` (RH-63), so no third copy of it exists anywhere under `src`.

ER3 - The list, the row and the summary are gone from the page, and only they. In `src/app/playlists/[id]/page.tsx`: `grep -c "Songs in this playlist\|No songs yet\|No songs matching\|No songs tagged\|Click to advance\|isAddingTag\|fast-view\|from playlist" 'src/app/playlists/[id]/page.tsx'` prints `0` (it prints `9` at `5c38206`; the count is case-sensitive, so the surviving `removeSongFromPlaylist` calls do not match it), and `grep -c "STATUS_SCORES\|STATUS_BAR_COLORS\|STATUS_CONFIG\|STATUS_ORDER\|nextStatus\|PlaylistSummaryProps\|formatDuration\|@/lib/statusConfig" 'src/app/playlists/[id]/page.tsx'` prints `0` (it prints `22` at `5c38206`). `grep -c "PlaylistSongList" 'src/app/playlists/[id]/page.tsx'` prints `2` (the import and the one call site, `0` at `5c38206`), `grep -c "PlaylistSummary" 'src/app/playlists/[id]/page.tsx'` prints `2` (`3` at `5c38206`, where it was an interface, a component and a call site) and `grep -c "@/lib/playlistDetail" 'src/app/playlists/[id]/page.tsx'` prints `1`. What must survive does: `grep -c "addingTagForSong"` prints a number greater than or equal to `3`, `grep -c "songTagInputRef"` a number greater than or equal to `3`, `grep -c "newTagInput"` a number greater than or equal to `2`, and `grep -c "handleRemoveSong"`, `grep -c "handleStatusCycle"`, `grep -c "handleAddSongTag"` and `grep -c "handleRemoveSongTag"` each a number greater than or equal to `2` - the page still owns the four handlers and the per-song tag state, which RH-69 takes. `grep -c "react-hooks/set-state-in-effect" 'src/app/playlists/[id]/page.tsx'` prints `1`, unchanged: the mount effect and its disable comment belong to RH-71. `git diff 5c38206 -- src/app/actions src/lib/playlists.ts src/lib/playlistList.ts src/lib/statusConfig.ts src/app/api src/hooks` prints nothing at all.

ER4 - The page's measured budget numbers fall, the complexity-29 arrow is gone, and the override entry states the new numbers exactly. `grep -c "" 'src/app/playlists/[id]/page.tsx'` prints a number less than or equal to `700` (`1024` at `5c38206`; the reference extraction measures `666`, and the parent plan's ceiling of `830` is cleared with room). `rtk proxy npx eslint 'src/app/playlists/[id]/page.tsx' --rule '{"complexity":["error",10]}'` prints exactly one line containing `has a complexity of`, and that line names `Function 'PlaylistDetailPage'`; no line of that output contains `Arrow function has a complexity of`. At `5c38206` the same command prints two such lines, the second being `820:25  error  Arrow function has a complexity of 29`. `rtk proxy npx eslint 'src/app/playlists/[id]/page.tsx' --rule '{"complexity":["error",1],"max-lines-per-function":["error",300]}'` prints, among its lines, exactly one line containing `Function 'PlaylistDetailPage' has a complexity of` and that number is at most `27` (`30` at `5c38206`), and exactly one line containing `Function 'PlaylistDetailPage' has too many lines` and that number is at most `620` (`839` at `5c38206`; the reference extraction measures `614`). The parent plan's `600` and `26` are pinned here at the measured `614` and `27` for the reasons written into this spec's "Reference measurement of the result": the plan's `600` was derived from an assumed 810-line function that part 2 actually measured at 839, and only three of the page body's decision points live in the song-list slice. The `complexity-budget/override` entry for `src/app/playlists/\[id\]/page.tsx` in `eslint.config.mjs` carries the three newly measured values verbatim as its `complexity`, `max-lines-per-function` and `max-lines` ceilings, and `rtk proxy npx eslint 'src/app/playlists/[id]/page.tsx'` (no `--rule`) exits `0` printing nothing.

ER5 - The ratchet did not grow and its guards are green. `grep -c "complexity-budget/override" eslint.config.mjs` prints `20`, exactly as at `5c38206`: no entry added for any of the five new files - each of them is under the base budget of complexity 15, 200 lines per function and 400 lines per file on its own - and none removed. `grep -c "src/components/playlists" eslint.config.mjs` prints `0`. `grep -c "MAX_OVERRIDES = 20" src/lib/__tests__/complexityBudget.test.ts` prints `1` and `git diff 5c38206 -- src/lib/__tests__/complexityBudget.test.ts AGENTS.md docs/plans/code-quality-review.md` prints nothing at all (RH-71 owns the ratchet count, the manifest sentence and the F11 `Status:` line). `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts src/lib/__tests__/namingConventions.test.ts src/lib/__tests__/errorHandlingStyle.test.ts` exits `0` with `0` failed tests - the last two prove the five new files match the naming and error-handling conventions.

ER6 - The pure decisions are unit-tested. `rtk proxy npx vitest run src/lib/__tests__/playlistDetail.test.ts` exits `0` printing `Test Files  1 passed (1)` and `Tests  17 passed (17)`, its tests named exactly: `collects every tag of the playlist songs without repeating one`, `sorts the collected tags with localeCompare`, `collects nothing when no song has a repertoire entry`, `returns every song when neither a tag nor a query is set`, `keeps only the songs carrying the active tag`, `matches the query against the song title, ignoring case`, `matches the query against the song artist, ignoring case`, `treats a whitespace-only query as no query at all`, `applies the tag filter and the text query together`, `orders the songs by position without mutating the input array`, `counts one song per status and reads a song with no repertoire entry as unknown`, `sums the duration of the songs that carry one and ignores the ones that do not`, `scores an all-mastered playlist at 100 and an all-unknown playlist at 0`, `reports a total of zero for an empty playlist without dividing by zero`, `advances the song status one step and returns the original entry alongside the updated one`, `returns null when the song has no repertoire entry`, `replaces one repertoire entry and leaves the other entries and the source map untouched`. The file needs no `// @vitest-environment` line, because the module under test imports no DOM API.

ER7 - The list, the row and the identity block render every state and keep the locator contract the e2e net depends on. `rtk proxy npx vitest run src/components/playlists/__tests__/PlaylistSongList.test.tsx` exits `0` printing `Test Files  1 passed (1)` and `Tests  14 passed (14)`. Its literal first line is `// @vitest-environment jsdom`, it calls `afterEach(cleanup)`, it imports nothing from `@/app/`, it passes plain props and `vi.fn()` callbacks (no Server Action, no fetch), and its tests are named exactly: `renders the empty state when the playlist holds no songs`, `renders the no-match state naming the active tag when the tag filter hides every song`, `renders the no-match state quoting the query when the text filter hides every song`, `renders one list item per filtered song inside the Songs in this playlist region`, `orders the rows by playlist position`, `links a row that has a repertoire entry to that entry Fast View, carrying the band id`, `renders a row without a repertoire entry with no link`, `renders the song duration when the song carries one`, `renders the status as a button that calls onStatusCycle in personal mode`, `renders the status as a read-only badge with no button in band mode`, `calls onRemoveSong with the song id when the remove button is clicked`, `renders one Remove tag button per tag and calls onRemoveTag when it is clicked`, `renders the tag input only for the song named by addingTagForSong`, `calls onAddTag with the row song id and the typed tag when Enter is pressed`. Between them these tests assert, mechanically, the locators `e2e/playlist-detail.spec.ts` uses on this slice: a region whose accessible name is `Songs in this playlist`, one `listitem` per song inside it, a button whose accessible name is exactly `Status: Unknown. Click to advance.` in personal mode and no such button in band mode, a button named `Remove <title> from playlist`, a button named exactly `Add tag`, an input with placeholder `new tag` present for exactly one row at a time, a button named `Remove tag <tag>` per chip, the text `No songs yet` and the text `No songs matching "<query>".`.

ER8 - The mastery summary renders every state. `rtk proxy npx vitest run src/components/playlists/__tests__/PlaylistSummary.test.tsx` exits `0` printing `Test Files  1 passed (1)` and `Tests  6 passed (6)`. Its literal first line is `// @vitest-environment jsdom`, it calls `afterEach(cleanup)`, it imports nothing from `@/app/`, and its tests are named exactly: `renders nothing for an empty playlist`, `renders the playlist level with the total duration formatted`, `renders no duration when no song carries one`, `labels the score with the nearest status and its percentage`, `renders one distribution segment per status present under the Status distribution label`, `renders one legend entry per status present and none for a status with no song`. The first asserts the component returns `null` rather than an empty wrapper; the fifth reaches the bar through its `aria-label="Status distribution"`.

ER9 - The characterization net passes untouched. `git diff 5c38206 -- e2e playwright.config.ts` prints nothing at all: not one assertion, locator, helper or timeout was edited to accommodate the refactor. `npx playwright test --list` prints `Total: 33 tests in 7 files`, as at `5c38206`. With Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (migrations applied), `.env.local` present, nothing listening on port 3000 and a fresh production build, `PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" npx playwright test --workers=1 --reporter=list` exits `0` and prints `33 passed`, with no `failed` and no `flaky` line; in particular the eleven tests of `e2e/playlist-detail.spec.ts` are among them, including `removes a song from the playlist`, `cycles the mastery status of a playlist song`, `filters the playlist by title text` and `filters the playlist by tag`, each of which reloads the page and re-asserts against the freshly rendered list.

ER10 - The new lib module is covered and every repository gate holds at its `5c38206` value. With Postgres up and a non-empty `SUPABASE_SERVICE_ROLE_KEY`: `rtk proxy npx vitest run` exits `0` printing `Test Files  114 passed (114)` (`111` at `5c38206`) and `Tests` passed at least `1286` (`1249` at `5c38206`, plus 17 + 14 + 6 new), with `0` failed and `0` skipped. `npm run test:coverage` exits `0` with all four thresholds met (statements at least `80`, branches at least `65`, functions at least `78`, lines at least `80`), and `node -e "const c=require('./coverage/coverage-final.json');const pct=a=>a.length?Math.round(1000*a.filter(x=>x>0).length/a.length)/10:100;for (const k of Object.keys(c)) if (k.endsWith('/src/lib/playlistDetail.ts')) console.log(k.split('/src/').pop(), pct(Object.values(c[k].f)), pct(Object.values(c[k].s)))"` prints exactly one line, `lib/playlistDetail.ts`, followed by a function percentage and a statement percentage each of at least `90`. `rtk proxy npx eslint .` prints `22 problems (8 errors, 14 warnings)`, identical to `5c38206`. `./node_modules/.bin/tsc --noEmit` exits `0` printing nothing. `npm run lint:dead` exits `0` reporting no unused file, export or dependency, so no lib export is speculative. `npm run lint:dup` exits `0` with its `Total:` row reporting at most `18` clones and at most `0.60 %` - the `5c38206` numbers - and its output no longer names `app/playlists/[id]/page.tsx` at all, because the two clones it reports there today are the twice-written cover-and-title block that `PlaylistSongIdentity` now renders once. `npm run audit` exits `0` with no high or critical advisory.

ER11 - Release hygiene and a closed change set, with git state untouched. `git diff --name-only 5c38206 | sort` lists only paths drawn from this closed set and no others: `docs/suggestions-log.md`, `docs/tasks/RH-68-spec.md`, `eslint.config.mjs`, `package.json`, `src/app/playlists/[id]/page.tsx`, `src/components/playlists/PlaylistSongIdentity.tsx`, `src/components/playlists/PlaylistSongList.tsx`, `src/components/playlists/PlaylistSongRow.tsx`, `src/components/playlists/PlaylistSummary.tsx`, `src/components/playlists/__tests__/PlaylistSongList.test.tsx`, `src/components/playlists/__tests__/PlaylistSummary.test.tsx`, `src/lib/__tests__/playlistDetail.test.ts`, `src/lib/playlistDetail.ts`. Any other path fails this result; in particular the list contains no file under `e2e/`, no `AGENTS.md`, no `docs/plans/code-quality-review.md`, no `src/lib/__tests__/complexityBudget.test.ts`, no `src/hooks/`, no `src/store/`, no `src/app/actions/` and no deleted file. The `version` field of `package.json` is `0.1.103-YYYYMMDDHHmm` with a real local timestamp, up from `0.1.102-202609100329` (`0.1.103` is numerically the next patch even though it sorts lower as a plain string). `git diff 5c38206 -- src/components/landing src/i18n/dictionaries` prints nothing at all: moving an existing list between files is not a selling point.

## Out of Scope

- **The rest of the page.** The header, the inline rename input, the Spotify strip and both sync paths, `refreshPlaylist` and the mount effect, the playlist-level tag bar, the in-playlist text filter input and the tag filter bar all stay exactly where they are. They belong to RH-69, RH-70 and RH-71.
- **`useTagEditor` and the per-song tag affordance.** The row's tag chips, remove-chip buttons, `new tag` input and `+ tag` button move **as-is** into `PlaylistSongRow` and receive `addingTagForSong`, `newTagInput`, `songTagInputRef` and their four handlers as props from the page, which still owns all of them. RH-69 replaces that prop set with its hook, inside the row this task creates; this task must not introduce the hook, the normalisation helper or a `src/lib/tagEditor.ts`.
- **The three focus effects and the mount effect.** Lines 220-228 and 245-258 are untouched, including the `// eslint-disable-next-line react-hooks/set-state-in-effect` RH-67 added. RH-70 deletes the focus effects; RH-71 deletes the mount effect.
- **The Server Component conversion, the override deletion and the ratchet count.** RH-71 deletes the override entry and takes `MAX_OVERRIDES` to 19; this task only re-pins three numbers.
- **The `Status:` lines in `docs/plans/code-quality-review.md`.** RH-66 wrote F13's; RH-71 writes F11's. This task writes none and must not touch that file.
- **Server-side code.** No change to `src/app/actions/*`, `src/lib/playlists.ts`, `src/lib/playlistList.ts`, `src/lib/statusConfig.ts`, `src/app/api/**`, `src/hooks/**` or `src/store/**`. `formatPlaylistDuration`, `STATUS_CONFIG`, `STATUS_ORDER` and `nextStatus` are imported, never edited.
- **The e2e suite.** Not one line under `e2e/` may change; the suite is the regression net, and editing it would remove the only evidence this refactor preserves behaviour.

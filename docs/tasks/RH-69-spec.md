# RH-69 — PlaylistDetailPage part 4/6: unify tag editing in useTagEditor and extract the tag bars

Baseline for every measurement in this document: `acbbf83`
(`refactor(RH-68): extract the song row, list and summary from PlaylistDetailPage`),
tree clean, `package.json` version `0.1.103-202609100437`.

Parent: RH-53. Predecessor: RH-68 (done). Successors: RH-70, RH-71.

## Scope

Replace the two tag-editing sites of `/playlists/[id]` — the playlist's own tag
bar and the per-song tag row inside `PlaylistSongRow` — with one shared
controller hook over one pure lib module, and move the two tag bars out of the
page into components. Behaviour is preserved; the one deliberate difference is
named in "Approach / Behavior" below.

In scope, and nothing else:

- `src/lib/tagEditor.ts` (new) — the pure decisions: the normalisation the two
  sites write inline today (trim, lowercase, strip trailing commas, trim again),
  already-present detection, add and remove.
- `src/hooks/useTagEditor.ts` (new) — `useTagEditor(options): TagEditorController`,
  one instance per editing site: the open/close/draft state, the focus effect,
  and the optimistic-then-await write path.
- `src/components/playlists/PlaylistTagBar.tsx` (new) — page lines 490-559: the
  playlist tag bar with its ownership gate over the derived `currentUserId`
  (RH-66).
- `src/components/playlists/TagFilterBar.tsx` (new) — page lines 615-644: the
  tag filter above the song list.
- `src/components/playlists/TagEditRow.tsx` (new) — the chips, their remove
  buttons and the inline `new tag` input, rendered by both editing sites. See
  "Why a third component".
- `src/components/playlists/PlaylistSongRow.tsx` and `PlaylistSongList.tsx`
  (edited) — the row's seven tag props collapse to one `tagEditor` prop and its
  tag markup becomes one `TagEditRow`; the list stops drilling the six it was
  forwarding.
- The page: the four handlers `handleTagsChange`, `handleAddPlaylistTag`,
  `handleAddSongTag`, `handleRemoveSongTag`, the helper `handleEditTagsFor`, the
  four states `addingTagForSong`, `newTagInput`, `addingPlaylistTag`,
  `newPlaylistTagInput`, the two tag input refs and their two focus effects all
  leave; two `useTagEditor` call sites and two JSX elements arrive.
- Three new test files, one edited test file, the page's
  `complexity-budget/override` entry re-pinned to the newly measured numbers,
  and the version bump.

Not in scope: the header and its rename input and focus effect, the Spotify
strip and both sync paths, the in-playlist text filter input, `refreshPlaylist`,
the mount effect and its `eslint-disable`, the panel reducer and the Server
Component conversion. Those are RH-70 and RH-71. See "Out of Scope".

## Audit at acbbf83

### The page

`grep -c "" 'src/app/playlists/[id]/page.tsx'` prints `670`.
`rtk proxy npx eslint 'src/app/playlists/[id]/page.tsx'` exits 0 printing
nothing: its three violations are absorbed by `eslint.config.mjs:74`, pinned by
RH-68 at `complexity 27`, `max-lines-per-function 618`, `max-lines 670`. Measured
with the budget rules forced
(`--rule '{"complexity":["error",1],"max-lines-per-function":["error",1]}'`),
`PlaylistDetailPage` at line 53 is **complexity 27, 618 lines**; the worst arrow
in the file is `autoPushIfNeeded` at complexity 7.
`grep -c "useState"` prints `17`, `useEffect` `5`, `useRef` `4`, `useMemo` `3`
(each count includes the `react` import line).

### What belongs to this slice, by line

| Lines | What | Destination |
|---|---|---|
| 74-77 | `addingTagForSong`, `newTagInput`, `addingPlaylistTag`, `newPlaylistTagInput` | `useTagEditor` state |
| 84-85 | `playlistTagInputRef`, `songTagInputRef` | the hook's single `inputRef` |
| 90-95 | the two tag focus effects | the hook's focus effect |
| 226-233 | `handleTagsChange` | the playlist editor's `applyTags` + `saveTags` |
| 235-245 | `handleAddPlaylistTag` (the only trailing-comma strip in the tree) | `normalizeTag` + `commitDraft` |
| 247-251 | `handleEditTagsFor` | `open` / `close` |
| 253-272 | `handleAddSongTag` | `commitDraft` over the song editor |
| 274-286 | `handleRemoveSongTag` | `removeTag` over the song editor |
| 490-559 | the playlist tag bar, ownership gate at 491-492 | `PlaylistTagBar.tsx` + `TagEditRow.tsx` |
| 615-644 | the tag filter bar | `TagFilterBar.tsx` |
| 655-663 | six tag props on the `PlaylistSongList` call | one `tagEditor` prop |

`PlaylistSongRow.tsx` lines 17-37 (the `PlaylistSongHandlers` /
`PlaylistSongRowProps` interfaces) and 126-174 (the tag row) are the second
editing site; `PlaylistSongList.tsx` forwards `addingTagForSong`, `newTagInput`,
`tagInputRef`, `onAddTag`, `onRemoveTag`, `onEditTagsFor` and `onTagInputChange`
straight through and reads none of them except `addingTagForSong === ps.song_id`.

### Is the normalisation duplicated?

Not byte for byte, and that asymmetry is the finding. The playlist path
(235-238) trims, lowercases, strips **every trailing comma** and trims again; the
song path (254) trims and lowercases only. The already-present check is written
twice (243 and 258), the append twice (244 and 262), the filter-out twice (504
and 277). Unifying them is what `src/lib/tagEditor.ts` is for, and it widens the
song path by the trailing-comma strip — the one behaviour difference this task
ships, stated again in "Behavior".

### Which of the 17 `useState` lines leave

The four named in the task (`addingTagForSong`, `newTagInput`,
`addingPlaylistTag`, `newPlaylistTagInput`) and no others, taking the count to
**13** (the `react` import line plus twelve declarations). The parent plan's
`<= 11` is unreachable inside this slice and is pinned at 13: of the twelve
survivors, five are the load state (`playlist`, `songs`, `repertoireMap`,
`loading`, `error`), two are the filter *selection* (`activeTagFilter`,
`songFilterQuery`) which the page still needs to compute `filteredSongs` and
which no tag *editor* can own, and five (`syncing`, `editing`, `editName`,
`confirmDelete`, `showSearch`) are the panel flags RH-70 collapses into its
`useReducer` — which is precisely where the plan's own part-5 target of `<= 5`
comes from. Reaching 11 here would mean doing two of RH-70's states early.

### The regression net

`e2e/playlist-detail.spec.ts` (RH-66, 11 tests) is the only end-to-end coverage
of this page, and four of its tests are this slice: `adds a tag to a playlist
song`, `removes the tag from the playlist song`, `adds a tag to the playlist
itself` and `filters the playlist by tag`. Every locator they use is a contract
this task keeps byte for byte:

- `getByRole('button', { name: 'Add tag', exact: true })` scoped to a song row
  (line 209) — named exactly, because `Add tag to playlist` starts with the same
  words;
- `getByRole('button', { name: 'Add tag to playlist' })` (307) and
  `playlistTagBar` (88-89), which is an `xpath=..` off that button — so the add
  button must stay a **direct child** of the bar's wrapper `div`, next to the
  chips;
- `row.getByPlaceholder('new tag')` (210) and the global
  `expect(getByPlaceholder('new tag')).toHaveCount(1)` after opening the
  playlist input (308-309) — at most one input open across both sites;
- `getByRole('button', { name: 'Remove tag <tag>' })` scoped to a row (219, 227,
  274, 286, 293) and scoped to the playlist bar (316, 323);
- `getByRole('button', { name: <tag>, exact: true })` (222, 230, 260, 287, 294) —
  the filter bar's toggle, which must not collide with the chips' remove buttons;
- `getByRole('button', { name: 'clear' })` (258) — the filter bar's `x clear`.

The spec's header comment also records that `handleAddSongTag`,
`handleRemoveSongTag` and `handleTagsChange` write optimistically before
awaiting, and three tests wait on `serverActionResponse(page)` because of it.
That ordering is therefore load-bearing for the net, not an implementation
detail.

### Why a third component

Under one controller the two tag markups become identical: today they already
share every className (chip, remove button, input, `+ tag` button) and differ
only in the handler names and in the add button's `aria-label`. Rewriting both
against the same `TagEditorController` would leave two byte-identical 30-line
blocks in `PlaylistTagBar.tsx` and `PlaylistSongRow.tsx` — a clone pair jscpd
does not report today (it reports 16 clones, none in `src/components/playlists`)
and would start reporting. `TagEditRow.tsx` renders that block once, taking
`subject`, `tags`, `editor` and an `addLabel` that is `"Add tag"` for a row and
`"Add tag to playlist"` for the bar, which is also what keeps the two e2e
locators verbatim. This is the same call RH-68 made for `PlaylistSongIdentity`,
for the same reason.

### Reference measurement of the result

The extraction described below was simulated file by file against `acbbf83` and
linted with the budget rules forced. The resulting page is **537 lines**, with
`PlaylistDetailPage` at **482 lines and complexity 20**. Every new and edited
component lints clean under the base budget with no override: `TagEditRow` 69
lines / complexity 2, `PlaylistTagBar` 31 / 4, `TagFilterBar` 46 / 3,
`useTagEditor` 90 lines / complexity 1, `tagEditor.ts` 32 lines / worst function
complexity 3, `PlaylistSongRow` 125 / 12 (down from 143 / 13),
`PlaylistSongList` 70 / 4 (down from 77 / 4).

Two of the parent plan's four targets are met as stated and two are pinned at
the measured values:

- **Page `<= 680` lines: met**, at 537.
- **`complexity <= 20`: met exactly**, at 20. The seven decision points that
  leave the page body are the ownership gate's `playlist &&`, `||` and trailing
  `&&`, the `addingPlaylistTag ? :` ternary, the `(playlist.tags ?? [])` of the
  chip map, and the filter bar's `allTags.length > 0 &&` and `activeTagFilter &&`.
- **`PlaylistDetailPage <= 470` lines is pinned at 482.** The slice removes 136
  lines from the function (618 -> 482) and gives back 32 for the two
  `useTagEditor` call sites, which are wiring the page must hold: each names its
  `readTags`, `applyTags`, `saveTags`, `onError` and its two failure messages.
  The plan's 470 was arithmetic on the tag-bar JSX alone and did not budget for
  that wiring. RH-70 is where the number falls again, because the focus effects
  and the panel flags it deletes are inside the function.
- **`useState <= 11` is pinned at 13**, for the reason set out in "Which of the
  17 `useState` lines leave".

## Approach

### Behavior

Nothing a user can observe changes, with one named exception. The playlist tag
bar still renders only for a band playlist or a personal playlist the signed-in
user owns, still shows one chip per tag with a `Remove tag <tag>` button that
disappears the chip and writes the shortened list, still swaps its `+ tag`
button for a `new tag` input that is focused on open, commits on Enter and on
blur, and closes on Escape. A song row still does all of the same, one row at a
time. The tag filter still renders one button per tag present in the playlist,
still toggles a tag off when it is clicked again, still shows `x clear` only
while a filter is active, and still renders nothing when no song carries a tag.
Both writes stay optimistic in exactly today's order: the new list is applied
locally **before** the Server Action is awaited, and a rejection surfaces
through the page's error banner. There is no rollback, because there is none
today — `handleStatusCycle` reverts, the three tag handlers do not — and adding
one would change what `e2e/playlist-detail.spec.ts` observes. That asymmetry is
worth a line in `docs/suggestions-log.md`, not a fix inside a refactor.

The one deliberate difference: a per-song tag typed with trailing commas
(`"rock,"`) is now stored as `rock`, because both sites share the playlist
path's normalisation. Nothing in the e2e net or in any unit test depends on the
old behaviour, and storing the comma was not intentional.

A second, smaller consequence of unifying the two: pressing Enter on an **empty**
per-song tag input now closes the input, which is what the playlist input
already does; today the song input stays open. Escape and blur already closed
it, and no test observes the difference.

### Shape

`src/lib/tagEditor.ts` exports pure functions only — no React, no fetch, no
`@/lib/db` — written as `export function` declarations, never arrow consts
(`namingConventions.test.ts` enforces that for `src/lib`):

- `normalizeTag(raw)` — trim, lowercase, strip every trailing comma, trim again;
- `hasTag(tags, tag)` — already-present detection;
- `addTag(tags, raw)` — the appended list, or `null` when the normalised tag is
  empty or already present, so the caller knows there is nothing to write;
- `removeTag(tags, tag)` — the list without that tag, on a copy.

`src/hooks/useTagEditor.ts` exports `TagEditorOptions`, `TagEditorController` and
`useTagEditor`. The options are how one site reaches its tags:
`readTags(subject)` (the current list, or `null` when there is nothing to edit —
which is how the song path's missing-repertoire-entry guard survives),
`applyTags(subject, tags)`, `saveTags(subject, tags)`, `onError(message)` and
the two failure messages, which differ per site and are preserved verbatim
(`Failed to update tags` for the playlist, `Failed to add tag` /
`Failed to remove tag` for a song). The controller is `openFor`, `draft`,
`inputRef`, `open`, `close`, `changeDraft`, `commitDraft`, `removeTag` — no
`set*` member, so no consumer can drive the state behind the hook's back. A
"subject" is whatever the site keys its tags by: the playlist id for the bar,
the song id for a row, which is what lets one instance serve every row.

**No new actions bundle.** The picker needed `src/app/songPickerActions.ts`
because a hook was calling five Server Actions by name. Here the page hands down
`saveTags` closures that already bind `playlistId` and the repertoire entry id,
so nothing crosses the F21 line but a callback: `src/hooks/useTagEditor.ts`
imports nothing from `@/app/*`, and `updatePlaylistAction` / `updateSongTagsAction`
stay imported by the page, which is inside `src/app` and may import them. A
`tagEditorActions.ts` would carry no action the page does not already hold.

**The row takes the controller.** `PlaylistSongRow`'s `isAddingTag`,
`newTagInput`, `tagInputRef`, `onAddTag`, `onRemoveTag`, `onEditTagsFor` and
`onTagInputChange` are replaced by one `tagEditor: TagEditorController` on
`PlaylistSongHandlers`, which `PlaylistSongList` passes through with the rest of
`rowProps`; the row's `isAddingTag` becomes `editor.openFor === subject`, decided
inside `TagEditRow`. The alternative — keeping the row's prop API and having the
page unpack the controller into seven props — would leave the prop drilling this
part exists to remove and would put `openFor === ps.song_id` back on the page.

`PlaylistTagBar` owns the ownership gate (`playlist.band_id === null &&
playlist.user_id !== currentUserId` returns `null`) so that the decision leaves
the page function with the markup, and receives `currentUserId` as a prop rather
than reading the session itself. `TagFilterBar` owns its own empty-list guard and
its toggle (`onChange(activeTag === tag ? null : tag)`), so the page passes
`setActiveTagFilter` directly. Both open on `"use client"`, like every other file
in `src/components/playlists/`.

### Files touched

- `src/lib/tagEditor.ts` — new; the four pure functions.
- `src/hooks/useTagEditor.ts` — new; the controller.
- `src/components/playlists/TagEditRow.tsx` — new; chips + inline input, shared.
- `src/components/playlists/PlaylistTagBar.tsx` — new; the gate + wrapper.
- `src/components/playlists/TagFilterBar.tsx` — new; the filter bar.
- `src/components/playlists/PlaylistSongRow.tsx` — seven tag props to one, tag
  markup to one `TagEditRow`.
- `src/components/playlists/PlaylistSongList.tsx` — stops forwarding six props.
- `src/app/playlists/[id]/page.tsx` — the deletions in the audit table, two
  `useTagEditor` call sites, two new JSX elements, the shorter list call.
- `src/lib/__tests__/tagEditor.test.ts` — new; 12 tests, node environment.
- `src/hooks/__tests__/useTagEditor.test.tsx` — new; 15 tests, jsdom.
- `src/components/playlists/__tests__/tagBars.test.tsx` — new; 13 tests, jsdom;
  both bars in one file, following the `feedbackSurfaces.test.tsx` precedent for
  two small sibling surfaces.
- `src/components/playlists/__tests__/PlaylistSongList.test.tsx` — edited; still
  14 tests, three of them rewired to a controller stub and renamed.
- `eslint.config.mjs` — the three numbers of the page's override entry re-pinned.
  No entry added, none removed.
- `package.json` — version `0.1.104-YYYYMMDDHHmm`.
- `docs/tasks/RH-69-spec.md` — this file. `docs/suggestions-log.md` optionally,
  for the missing rollback noted above.

### Test criteria

The pure lib is unit-tested directly in the node environment. The hook is tested
with `renderHook` against hand-built option spies, which is the only place the
optimistic ordering, the no-rollback behaviour, the two failure messages, the
focus-on-open and the one-instance-many-subjects property can be proved. The
components are tested with Testing Library against plain props and a stub
controller: the bar's three gate branches and its whole chip/input surface, the
filter bar's five behaviours, and the row's tag surface through the list test
that already exists. Between them the component tests pin every locator
`e2e/playlist-detail.spec.ts` reaches into this slice for.
`e2e/playlist-detail.spec.ts` is the end-to-end proof and must pass with no edit
at all.

**Landing Page Rule decision.** Internal refactor: tagging a playlist and tagging
a song both already exist, and this task adds no capability a musician would
choose the app for. The landing copy and both dictionaries must not change.

## Expected Results

ER1 - The extraction exists, in the layers AGENTS.md prescribes. `test -f src/lib/tagEditor.ts && test -f src/hooks/useTagEditor.ts && test -f src/components/playlists/TagEditRow.tsx && test -f src/components/playlists/PlaylistTagBar.tsx && test -f src/components/playlists/TagFilterBar.tsx` exits `0`; none of those five files exists at `acbbf83`. `grep -c "export function normalizeTag\|export function hasTag\|export function addTag\|export function removeTag" src/lib/tagEditor.ts` prints `4` and `grep -cE "from ['\"]react['\"]|useState|useEffect|@/lib/db" src/lib/tagEditor.ts` prints `0`, so the lib is pure. `grep -c "export function useTagEditor\|export interface TagEditorController\|export interface TagEditorOptions" src/hooks/useTagEditor.ts` prints `3`, `grep -c "@/lib/tagEditor" src/hooks/useTagEditor.ts` prints `1`, and `grep -cE "^\s+set[A-Z][A-Za-z]*:" src/hooks/useTagEditor.ts` prints `0` while `grep -c "openFor\|draft\|inputRef\|open:\|close:\|changeDraft\|commitDraft\|removeTag" src/hooks/useTagEditor.ts` prints a number greater than or equal to `8`: the controller exposes commands, never a setter. `head -1` of each of the three new component files prints exactly `"use client";` or `'use client'`, and `grep -c "'use client'\|\"use client\"" src/hooks/useTagEditor.ts` prints `0` (a hook carries no directive, like every other file in `src/hooks`).

ER2 - The import direction rule (F21) holds and no new actions bundle was created. `grep -rn "@/app/" src/components src/lib src/hooks | grep -v __tests__` prints nothing at all, exactly as at `acbbf83`. `test -f src/app/tagEditorActions.ts` exits non-zero: the page hands the hook `saveTags` closures that already bind the playlist id and the repertoire entry id, so no Server Action crosses the line and no bundle is needed. `grep -c "updatePlaylistAction\|updateSongTagsAction\|@/app/actions" src/hooks/useTagEditor.ts src/components/playlists/TagEditRow.tsx src/components/playlists/PlaylistTagBar.tsx src/components/playlists/TagFilterBar.tsx src/components/playlists/PlaylistSongRow.tsx src/components/playlists/PlaylistSongList.tsx` prints `0` for every one of the six files, while in `src/app/playlists/[id]/page.tsx` `grep -c "updatePlaylist"` prints a number greater than or equal to `3` and `grep -c "updateSongTags"` prints `2` - the page still owns both writes. `rtk proxy npx eslint src/lib/tagEditor.ts src/hooks/useTagEditor.ts src/components/playlists/TagEditRow.tsx src/components/playlists/PlaylistTagBar.tsx src/components/playlists/TagFilterBar.tsx src/components/playlists/PlaylistSongRow.tsx src/components/playlists/PlaylistSongList.tsx` exits `0` with no output, so no new file needs an override and none trips `no-restricted-imports`.

ER3 - The four handlers, the four states and the two tag refs are gone from the page, and only they. In `src/app/playlists/[id]/page.tsx`, `grep -c` prints `0` for each of these names on its own: `handleTagsChange`, `handleAddPlaylistTag`, `handleAddSongTag`, `handleRemoveSongTag`, `handleEditTagsFor`, `addingTagForSong`, `newTagInput`, `addingPlaylistTag`, `newPlaylistTagInput`, `songTagInputRef`, `playlistTagInputRef`, `Add tag to playlist`, `Remove tag`, `new tag`, `toLowerCase` and `endsWith(",")`. Each of those prints a number greater than or equal to `1` at `acbbf83`. `grep -c "useTagEditor" 'src/app/playlists/[id]/page.tsx'` prints `3` (the import and the two call sites), `grep -c "PlaylistTagBar"` prints `2` and `grep -c "TagFilterBar"` prints `2` (an import and a call site each). What must survive does: `grep -c "editInputRef"` prints a number greater than or equal to `3` and `grep -c "useEffect"` prints `3` (the import, the rename focus effect and the mount effect; `5` at `acbbf83`), `grep -c "react-hooks/set-state-in-effect"` prints `1`, unchanged - RH-67's disable comment and the mount effect belong to RH-71 - and `grep -c "handleRemoveSong"`, `grep -c "handleStatusCycle"`, `grep -c "activeTagFilter"` and `grep -c "songFilterQuery"` each print a number greater than or equal to `2`. `git diff acbbf83 -- src/app/actions src/lib/playlists.ts src/lib/playlistDetail.ts src/lib/playlistList.ts src/lib/statusConfig.ts src/app/api src/store src/components/playlists/PlaylistSummary.tsx src/components/playlists/PlaylistSongIdentity.tsx src/components/playlists/SongPicker.tsx src/hooks/useSongPicker.ts src/app/songPickerActions.ts` prints nothing at all.

ER4 - The page's measured budget numbers fall and the override entry states the new numbers exactly. `grep -c "" 'src/app/playlists/[id]/page.tsx'` prints a number less than or equal to `545` (`670` at `acbbf83`; the reference extraction measures `537`, and the parent plan's ceiling of `680` is cleared with room). `rtk proxy npx eslint 'src/app/playlists/[id]/page.tsx' --rule '{"complexity":["error",1],"max-lines-per-function":["error",300]}'` prints, among its lines, exactly one line containing `Function 'PlaylistDetailPage' has a complexity of` and that number is at most `20` (`27` at `acbbf83`), and exactly one line containing `Function 'PlaylistDetailPage' has too many lines` and that number is at most `490` (`618` at `acbbf83`; the reference extraction measures `482`). `rtk proxy npx eslint 'src/app/playlists/[id]/page.tsx' --rule '{"complexity":["error",10]}'` prints exactly one line containing `has a complexity of`, and that line names `Function 'PlaylistDetailPage'`. `grep -c "useState" 'src/app/playlists/[id]/page.tsx'` prints `13` (`17` at `acbbf83`), the four departures being `addingTagForSong`, `newTagInput`, `addingPlaylistTag` and `newPlaylistTagInput`; the parent plan's `470` lines and `<= 11` useState are pinned here at the measured `482` and `13` for the reasons written into this spec's "Reference measurement of the result" and "Which of the 17 useState lines leave" - the two states that would take the count to 11 are filter selection, not tag editing, and the five panel flags belong to RH-70's reducer. The `complexity-budget/override` entry for `src/app/playlists/\[id\]/page.tsx` in `eslint.config.mjs` carries the three newly measured values verbatim as its `complexity`, `max-lines-per-function` and `max-lines` ceilings, and `rtk proxy npx eslint 'src/app/playlists/[id]/page.tsx'` (no `--rule`) exits `0` printing nothing.

ER5 - The ratchet did not grow and its guards are green. `grep -c "complexity-budget/override" eslint.config.mjs` prints `20`, exactly as at `acbbf83`: no entry added for any of the five new files - each is under the base budget of complexity 15, 200 lines per function and 400 lines per file on its own - and none removed. `grep -c "src/components/playlists\|src/hooks/useTagEditor\|src/lib/tagEditor" eslint.config.mjs` prints `0`. `grep -c "MAX_OVERRIDES = 20" src/lib/__tests__/complexityBudget.test.ts` prints `1`, and `git diff acbbf83 -- src/lib/__tests__/complexityBudget.test.ts AGENTS.md docs/plans/code-quality-review.md` prints nothing at all (RH-71 owns the ratchet count, the manifest and the F11 `Status:` line). `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts src/lib/__tests__/namingConventions.test.ts src/lib/__tests__/errorHandlingStyle.test.ts` exits `0` with `0` failed tests - the last two prove the new lib exports are function declarations, the new hook is `use<Subject>` in a file of exactly that name, the new components are PascalCase one-per-file, and no new catch body breaks the error-handling conventions.

ER6 - The pure tag decisions are unit-tested. `rtk proxy npx vitest run src/lib/__tests__/tagEditor.test.ts` exits `0` printing `Test Files  1 passed (1)` and `Tests  12 passed (12)`, its tests named exactly: `trims the surrounding whitespace and lowercases the tag`, `strips every trailing comma and the whitespace behind it`, `normalises a tag of only whitespace and commas to the empty string`, `reports whether the list already carries the tag`, `appends the normalised tag to the list`, `returns null when the normalised tag is empty`, `returns null when the list already carries the tag`, `treats a tag that differs only in case or trailing commas as already present`, `does not mutate the list it appends to`, `removes the tag and leaves the other tags in their order`, `returns an equal list when the tag is not there`, `does not mutate the list it removes from`. The file needs no `// @vitest-environment` line, because the module under test imports no DOM API.

ER7 - The shared controller is tested where only a hook test can reach: the write ordering, the failure messages and the multi-subject property. `rtk proxy npx vitest run src/hooks/__tests__/useTagEditor.test.tsx` exits `0` printing `Test Files  1 passed (1)` and `Tests  15 passed (15)`. Its literal first line is `// @vitest-environment jsdom`, it calls `afterEach(cleanup)`, it imports nothing from `@/app/`, it drives the hook through `renderHook` with hand-built `vi.fn()` options, and its tests are named exactly: `starts closed with an empty draft`, `opens for a subject and clears the draft`, `closes and clears the draft`, `records what is typed into the draft`, `applies the new tag list before the save is awaited`, `saves the normalised tag and closes the input`, `writes nothing and closes when the draft normalises to empty`, `writes nothing and closes when the subject already carries the tag`, `writes nothing when the subject has no tags to edit`, `keeps the optimistic list and reports the rejection message through onError`, `falls back to the add message when the rejection is not an Error`, `removes a tag optimistically and saves the shortened list`, `reports a failed remove with the remove message`, `focuses the input when the editor opens`, `serves two subjects one at a time from a single instance`. The fifth asserts that `applyTags` has been called while `saveTags` is still pending, which is the optimistic contract three e2e tests depend on; the tenth asserts that `applyTags` is **not** called a second time after a rejection, pinning today's absence of a rollback.

ER8 - Both tag bars render every state, including the ownership gate. `rtk proxy npx vitest run src/components/playlists/__tests__/tagBars.test.tsx` exits `0` printing `Test Files  1 passed (1)` and `Tests  13 passed (13)`. Its literal first line is `// @vitest-environment jsdom`, it calls `afterEach(cleanup)`, it imports nothing from `@/app/`, it passes a plain stub `TagEditorController` built from `vi.fn()`s, and its tests are named exactly: `renders one chip per playlist tag, each with its Remove tag button`, `calls the editor to remove a playlist tag when the chip button is clicked`, `opens the editor for the playlist when Add tag to playlist is clicked`, `renders the new tag input only while the editor is open for the playlist`, `commits the draft on Enter and on blur, and closes it on Escape`, `renders nothing for a personal playlist owned by another user`, `renders the bar for a band playlist`, `renders the bar for a personal playlist the signed-in user owns`, `renders nothing when the playlist carries no tag`, `renders one filter button per tag, named exactly the tag`, `selects a tag when its filter button is clicked`, `clears the filter when the active tag button is clicked again`, `renders the clear control only while a tag is active and clears the filter when it is clicked`. Between them these tests assert, mechanically, the locators `e2e/playlist-detail.spec.ts` uses on this slice: a button whose accessible name is exactly `Add tag to playlist` rendered as a direct child of the bar wrapper (the spec reaches the bar by `xpath=..` off that button), an input with placeholder `new tag`, a button named `Remove tag <tag>` per chip, a button named exactly `<tag>` per filter entry, and a control whose accessible name contains `clear`.

ER9 - The row still renders its tag surface, now through the controller, and the list test still covers it. `rtk proxy npx vitest run src/components/playlists/__tests__/PlaylistSongList.test.tsx` exits `0` printing `Test Files  1 passed (1)` and `Tests  14 passed (14)` - the same count as at `acbbf83`. Eleven of its test names are unchanged; the three that named the retired props are renamed to exactly `renders one Remove tag button per tag and calls the tag editor when it is clicked`, `renders the tag input only for the song the tag editor is open for` and `commits the tag editor draft for that row when Enter is pressed`, and `grep -c "onAddTag\|onRemoveTag\|onEditTagsFor\|onTagInputChange\|addingTagForSong\|tagInputRef" src/components/playlists/__tests__/PlaylistSongList.test.tsx` prints `0`. In the components themselves, `grep -c "onAddTag\|onRemoveTag\|onEditTagsFor\|onTagInputChange\|isAddingTag\|tagInputRef\|newTagInput" src/components/playlists/PlaylistSongRow.tsx src/components/playlists/PlaylistSongList.tsx` prints `0` for both files, `grep -c "tagEditor" src/components/playlists/PlaylistSongRow.tsx` prints a number greater than or equal to `2`, and `grep -c "TagEditRow" src/components/playlists/PlaylistSongRow.tsx src/components/playlists/PlaylistTagBar.tsx` prints a number greater than or equal to `2` for each: one markup, two sites. `grep -c "Add tag" src/components/playlists/PlaylistSongRow.tsx` prints `1` and `grep -c "Add tag to playlist" src/components/playlists/PlaylistTagBar.tsx` prints `1` - the two accessible names arrive as the `addLabel` prop and are still distinguishable by an exact match.

ER10 - The characterization net passes untouched. `git diff acbbf83 -- e2e playwright.config.ts` prints nothing at all: not one assertion, locator, helper or timeout was edited to accommodate the refactor. `npx playwright test --list` prints `Total: 33 tests in 7 files`, as at `acbbf83`. With Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (migrations applied), `.env.local` present, nothing listening on port 3000 and a fresh production build, `PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" npx playwright test --workers=1 --reporter=list` exits `0` and prints `33 passed`, with no `failed` and no `flaky` line; in particular the four tag tests of `e2e/playlist-detail.spec.ts` are among them - `adds a tag to a playlist song`, `removes the tag from the playlist song`, `adds a tag to the playlist itself` and `filters the playlist by tag` - each of which reloads the page after awaiting the Server Action and re-asserts against the freshly rendered chips.

ER11 - The new lib and hook are covered and every repository gate holds at its `acbbf83` value. With Postgres up and a non-empty `SUPABASE_SERVICE_ROLE_KEY`: `rtk proxy npx vitest run` exits `0` printing `Test Files  117 passed (117)` (`114` at `acbbf83`) and `Tests` passed at least `1326` (`1286` at `acbbf83`, plus 12 + 15 + 13 new), with `0` failed and `0` skipped. `npm run test:coverage` exits `0` with all four thresholds met (statements at least `80`, branches at least `65`, functions at least `78`, lines at least `80`), and `node -e "const c=require('./coverage/coverage-final.json');const pct=a=>a.length?Math.round(1000*a.filter(x=>x>0).length/a.length)/10:100;for (const k of Object.keys(c)) if (k.endsWith('/src/lib/tagEditor.ts')||k.endsWith('/src/hooks/useTagEditor.ts')) console.log(k.split('/src/').pop(), pct(Object.values(c[k].f)), pct(Object.values(c[k].s)))"` prints exactly two lines, `lib/tagEditor.ts` and `hooks/useTagEditor.ts`, each followed by a function percentage and a statement percentage of at least `90`. `rtk proxy npx eslint .` prints `22 problems (8 errors, 14 warnings)`, identical to `acbbf83`. `./node_modules/.bin/tsc --noEmit` exits `0` printing nothing. `npm run lint:dead` exits `0` reporting no unused file, export or dependency. `npm run lint:dup` exits `0` with its `Total:` row reporting at most `16` clones and at most `0.51 %` - the `acbbf83` numbers - and its output naming no file under `src/components/playlists`, because the chips and the inline input are written once in `TagEditRow.tsx` rather than once per site. `npm run audit` exits `0` with no high or critical advisory.

ER12 - Release hygiene and a closed change set. `git diff --name-only acbbf83 | sort` lists only paths drawn from this closed set and no others: `docs/suggestions-log.md`, `docs/tasks/RH-69-spec.md`, `eslint.config.mjs`, `package.json`, `src/app/playlists/[id]/page.tsx`, `src/components/playlists/PlaylistSongList.tsx`, `src/components/playlists/PlaylistSongRow.tsx`, `src/components/playlists/PlaylistTagBar.tsx`, `src/components/playlists/TagEditRow.tsx`, `src/components/playlists/TagFilterBar.tsx`, `src/components/playlists/__tests__/PlaylistSongList.test.tsx`, `src/components/playlists/__tests__/tagBars.test.tsx`, `src/hooks/__tests__/useTagEditor.test.tsx`, `src/hooks/useTagEditor.ts`, `src/lib/__tests__/tagEditor.test.ts`, `src/lib/tagEditor.ts`. Any other path fails this result; in particular the list contains no file under `e2e/`, no `AGENTS.md`, no `docs/plans/code-quality-review.md`, no `src/lib/__tests__/complexityBudget.test.ts`, no `src/app/actions/`, no `src/store/` and no deleted file. The `version` field of `package.json` is `0.1.104-YYYYMMDDHHmm` with a real local timestamp, up from `0.1.103-202609100437`. `git diff acbbf83 -- src/components/landing src/i18n/dictionaries` prints nothing at all: unifying two existing tag inputs is not a selling point.

## Out of Scope

- **The rest of the page.** The header, the inline rename input and its focus effect, the Spotify strip and both sync paths, `refreshPlaylist`, the mount effect, the in-playlist text filter input and the error banner all stay exactly where they are. They belong to RH-70 and RH-71.
- **The panel reducer and the last two `useState` the plan wanted gone.** `activeTagFilter` and `songFilterQuery` stay on the page: they are filter selection, read by `filterPlaylistSongs` and by `PlaylistSongList`'s no-match message, and no tag *editor* can own them. `syncing`, `editing`, `editName`, `confirmDelete` and `showSearch` are RH-70's `useReducer`. This task does not introduce a reducer.
- **The mount effect and its `eslint-disable`.** RH-67's `// eslint-disable-next-line react-hooks/set-state-in-effect` and the effect under it are untouched; RH-71 deletes both with the Server Component conversion.
- **The Server Component conversion, the override deletion and the ratchet count.** RH-71 deletes the page's override entry and takes `MAX_OVERRIDES` to 19; this task only re-pins three numbers.
- **The `Status:` lines in `docs/plans/code-quality-review.md` and the AGENTS.md manifest.** RH-66 wrote F13's; RH-71 writes F11's and owns the manifest pass for this split, including the Naming Conventions sentence that names `feedbackSurfaces.test.tsx` as the only combined test file. This task writes neither and must not touch either file.
- **Rollback on a failed tag write.** Neither tag path reverts its optimistic update today, and this task does not add one - it would change what the e2e net observes. A line in `docs/suggestions-log.md` is the right place to record it.
- **Server-side code and the rest of the playlist slice.** No change to `src/app/actions/*`, `src/lib/playlists.ts`, `src/lib/playlistDetail.ts`, `src/lib/playlistList.ts`, `src/lib/statusConfig.ts`, `src/app/api/**`, `src/store/**`, `src/hooks/useSongPicker.ts`, `src/app/songPickerActions.ts`, `PlaylistSummary.tsx`, `PlaylistSongIdentity.tsx` or the `SongPicker` components. `updatePlaylistAction` and `updateSongTagsAction` are called, never edited.
- **The e2e suite.** Not one line under `e2e/` may change; it is the regression net, and editing it would remove the only evidence this refactor preserves behaviour.

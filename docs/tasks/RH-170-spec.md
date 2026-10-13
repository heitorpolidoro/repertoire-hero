# RH-170 — Start a practice session from a hand-picked selection

Part 3 of the split of RH-115. Decided in `docs/use-cases.md` § *Fast View navigation* (source table: "a hand-picked selection — as picked"; "Back goes to wherever the picker was opened"). This task only implements it. Mock: `docs/tasks/RH-170-mock.html`.

## Scope

Covers: a "Select songs" mode on the band screen (`/bands/[id]`) and the personal dashboard (`RepertoireDashboard`) in which songs are toggled, numbered in pick order, and counted; a confirm action that writes a `songQueue` (RH-133) in pick order and opens Fast View on the first picked song; a cancel action that leaves no queue.

Depends on RH-168 only for the queue shape and its `owner` / `originHref` / `label` conventions (`SongQueue`, `writeSongQueue` from `src/lib/songQueue.ts`, which this task does not change). It does not need RH-168's ordering, candidates read or "Start practice" button, and it must not edit any of those files.

Does not cover: computed ordering, a source choice, reordering after picking (the order is the order of taps), persisting a selection across reloads, selecting across several screens, "Show mode", finishing a session, any Fast View change, and any write other than the queue (`last_practiced`, `status`, anything server-side).

## Approach

**Behavior**

- Mode: a "Select songs" button on each screen enters picker mode. In picker mode a row tap toggles that song (it no longer opens the song), each picked row shows its 1-based pick number, and a bar shows "N picked", Cancel and "Start practice". Leaving the mode (Cancel, or confirming) clears the picks.
- Order: picks are an ordered list of version ids. Toggling an unpicked song appends it; toggling a picked song removes it and later picks shift down by one. A song can be picked once. Filters and search on the screen keep working in picker mode; picks survive a filter change, and rows hidden by a filter are still in the selection and counted.
- Confirm: "Start practice" is disabled while the count is 0. Otherwise it writes the queue with `writeSongQueue`: entries `{versionId, title, artist}` in pick order (title and artist taken from the rows on screen, no fetch); `owner` `{type:'band', bandId}` from the band screen and `{type:'personal'}` from the dashboard; `originHref` `/bands/<id>` for the band screen and `/` for the dashboard (the picker screen); `label` "Hand-picked selection". It replaces any previous queue, then navigates to `/songs/<first picked versionId>/fast-view` (with `?bandId=<id>` in band context). Back from Fast View already goes to `originHref` through the RH-133 chrome; no Fast View change.
- Cancel: leaves the mode, calls neither `writeSongQueue` nor `clearSongQueue`, so a pre-existing queue is untouched.
- No write: the path makes no server call at all and calls no `recordPractice`, `recordPracticeStatus` or status update; the queue in `sessionStorage` is the only side effect.
- Both screens share one controller and one presentational piece so the screens only mount them (no new logic or complexity override in `RepertoireDashboard.tsx` or the band page). The two rows' markup differ, so the shared piece exposes the row props (`picked`, `pickNumber`, `onToggle`) and a bar component; each screen wires its own row.

**Files touched**

- `src/lib/pickedSelection.ts` (new): pure `togglePick(picks, id)` and `buildPickedQueue(picks, rowsById, owner, originHref)` returning a `SongQueue`, plus the first Fast View href.
- `src/hooks/useSongPicker.ts` (new): controller (mode, ordered picks, count, confirm with `writeSongQueue` and `router.push`, cancel).
- `src/components/songs/SongPickerBar.tsx` (new): presentational bar (count, Cancel, "Start practice", disabled at 0) and the "Select songs" entry button.
- `src/components/songs/RepertoireDashboard.tsx` and `src/app/bands/[id]/page.tsx`: mount the controller and bar, switch the row tap between open and toggle, show the pick number. Minimal diff; coordinate placement with RH-168's button in the same header (the two buttons sit side by side).

**Test criteria** (Vitest, node env unless a DOM test opts in)

- `pickedSelection.test.ts`: toggling appends in tap order; un-toggling removes and renumbers; no duplicates; the built queue has entries of exactly `versionId`, `title`, `artist` in pick order; owner, `originHref` and `label` for band and personal.
- `useSongPicker.test.tsx`: confirm stores the queue in pick order and the router receives the first picked song's Fast View href (with `bandId` for a band); confirm is disabled at 0 picks and stores nothing; cancel stores nothing and leaves a pre-existing queue as it was; the test injects spies for `recordPractice`, status and update functions and asserts none is called.
- Component tests on both screens: entering the mode shows the count; a row tap toggles instead of navigating; the picker screen's origin is what was stored.

## Expected Results

- [ ] The band screen and the dashboard each offer a "Select songs" mode in which a row tap toggles the song, picked rows show their pick number, and the bar shows "N picked".
- [ ] Confirming writes a `songQueue` whose entries are the picked songs in the exact order they were tapped, asserted by a Vitest test that un-toggles and re-picks.
- [ ] The stored queue has `originHref` `/bands/<id>` from the band screen and `/` from the dashboard, and confirming opens Fast View on the first picked song.
- [ ] The stored queue has owner `band` with the band id from the band screen and owner `personal` from the dashboard.
- [ ] "Start practice" is disabled with zero picks, and Cancel stores no queue and leaves an existing queue untouched.
- [ ] Starting from a selection calls no `recordPractice`, status or update function and no server action, asserted by a test on the injected actions.

## Out of Scope

Computed ordering, reordering after picking, remembering a selection, Show mode, the end-of-session flow, any Fast View or `songQueue.ts` change.

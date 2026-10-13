# RH-169 — Finish a practice session through the review list

Part 2 of the split of RH-115 (part 1: RH-168, which writes the session queue). Decided in `docs/use-cases.md` § *Start a practice session*; this task only implements the finishing half.

## Scope

Covers: decoupling `PracticeReviewList` and `usePracticeReview` (RH-159) from `PlaylistSong[]` and the playlist detail page; an end-of-queue affordance in Fast View that opens that list over the queue entries; the read of the owner's levels and the write on Save, both through existing actions.

Does not cover: any change to `recordPracticeAction` / `recordPractice` (RH-114/RH-158) or its payload, any new server action or SQL, any change to `src/lib/songQueue.ts` or to how a queue is written (RH-168), a queue "kind" field, clearing the queue after saving, or the playlist page's behaviour (it must stay exactly as it is).

Decisions taken here, not asked:

- The affordance is keyed on **position in the queue**, not on queue origin: it shows on the last entry of any queue (a playlist queue included). `SongQueue` has no kind and this task must not add one.
- It is hidden offline (the write needs the network) and when there is no queue.
- Saving closes the list and shows the existing Fast View Toast; it does not navigate or clear the queue.
- The repertoire is read once, when the list opens, with `getRepertoireAction(bandId)`; an entry whose `version_id` is absent from the resulting map renders as `unknown` (unassessed), exactly as a playlist row does today.

## Approach

**Behavior**

- *Decoupling.* The list and its hook take plain rows `{ versionId, title, artist }` (artist nullable, as in `SongQueueEntry`) plus a level lookup `ReadonlyMap<string, { status: SongStatus }>`; neither imports `PlaylistSong`, `playlistPanels` or anything under `src/app`. The playlist page maps its `PlaylistSong[]` to rows through one small pure function and passes `repertoireMap` as the lookup, so its rendering, tick/level state, confirm payload and tests do not change. The panel-dispatch wrapper `usePracticeReviewPanel` (the only playlist-specific part) leaves `usePracticeReview.ts` for its own file, consumed by `usePlaylistDetail`. Because Fast View and the playlist area both render the list, the component moves to `src/components/ui/` (the one cross-area directory); existing tests change their import path only.
- *Fast View.* On the last queue entry (`nav.nextId === null`) and online, a "Finish practice" control appears. Tapping it loads the owner's repertoire map, resets the review state and opens the review list over `playlist.entries` (all queue entries in queue order, not only the visited ones). Levels come from the map; a missing song shows unassessed. Save sends one `recordPractice` call with the ticked rows (a `status` only where the user changed that row's level) and `bandId = queryBandId`, the page's only owner value. The action alone decides the owner from the role: a band admin writes the band's row plus their own; a band member gets the personal write with no error; the client never decides. A failure shows the error and writes nothing (one transaction, RH-159).
- *After a save.* The song-window cache entry of every submitted version id is invalidated (`invalidateSongWindow`), and if the current song's level was changed the page applies it through the existing `song.applyStatus` so the header does not go stale.
- *Wiring.* No hook or component imports an action (F21): the page injects a new typed bundle, `src/app/fastViewPracticeActions.ts`, exposing `getRepertoire` and `recordPractice`.

**Files touched**

- `src/components/playlists/PracticeReviewList.tsx` -> `src/components/ui/PracticeReviewList.tsx`: moved; props become `rows`, `levels` lookup, `readOnly`, `review`, `onClose`; drops the `PlaylistSong` import.
- `src/hooks/usePracticeReview.ts`: option `songs` becomes `rows`; no playlist imports; `usePracticeReviewPanel` removed from it.
- `src/hooks/usePracticeReviewPanel.ts` (new): the panel-dispatch wrapper, moved as is.
- `src/lib/practiceReviewRows.ts` (new): pure `PlaylistSong[]` -> rows mapping for the playlist page.
- `src/components/playlists/PlaylistDetailView.tsx`, `src/hooks/usePlaylistDetail.ts`: pass rows and the lookup; no behaviour change.
- `src/hooks/usePracticeFinish.ts` (new): Fast View controller (visibility, open/close, repertoire load, loading/error state, composes `usePracticeReview`, post-save invalidation).
- `src/components/fastview/PracticeFinishButton.tsx` (new): presentational control.
- `src/app/fastViewPracticeActions.ts` (new): the typed bundle over `getRepertoireAction` and `recordPracticeAction`.
- `src/app/songs/[versionId]/fast-view/page.tsx`: mounts the hook, the button and the list; adds no logic and no complexity override.
- `AGENTS.md`: one sentence under the RH-159 passage naming the decoupled list and the Fast View entry point.

**Test criteria** (Vitest; DOM tests opt in with the jsdom first line)

- `usePracticeReview.test.tsx` and `practiceReview.test.tsx`: every existing case kept, fed rows; same payload assertions (ticked rows only, `status` only when changed).
- A source guard test: `PracticeReviewList.tsx` and `usePracticeReview.ts` contain no `PlaylistSong`, `playlistPanels` or `@/app` import.
- `usePracticeFinish.test.tsx`: hidden when not on the last entry, offline, or without a queue; visible on the last; opening loads the map once and lists every queue entry; an entry absent from the map has status `unknown`; present entries show the map's level; Save calls `recordPractice(items, queryBandId)` with the exact item shape.
- Owner tests: with `bandId` set the hook passes it unchanged; a db-backed action test shows an admin session writes `last_practiced` on the band row and a member session in the same band writes only a personal row without throwing (extend `authzRepertoire.db.test.ts` only if not already asserted).
- `usePlaylistDetail.test.tsx` passes unchanged.

## Expected Results

- [ ] On the last song of a queue, online, Fast View shows a "Finish practice" control that opens the review list over every queue entry, asserted by a hook test.
- [ ] `PracticeReviewList` and `usePracticeReview` take `{ versionId, title, artist }` rows, and a guard test asserts neither imports `PlaylistSong`, `playlistPanels` or `@/app`.
- [ ] The playlist detail page's review list renders and confirms as before, with `practiceReview.test.tsx`, `usePracticeReview.test.tsx` and `usePlaylistDetail.test.tsx` passing.
- [ ] Saving from Fast View calls `recordPractice` once with the ticked rows, `status` only on changed rows, through the unchanged `recordPracticeAction`.
- [ ] A band admin session writes with the band id and a member session writes a personal record without error, asserted by tests.
- [ ] Levels for queue entries come from the repertoire map and an entry missing from the map renders as unassessed, asserted by a test.

## Out of Scope

A queue kind, auto-opening the list, navigating or clearing the queue after save, any change to practice-write semantics, ordering, or RH-168's start flow.

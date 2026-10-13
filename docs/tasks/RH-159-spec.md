# RH-159 — Add whole-playlist practice review list

> **Renamed 2026-10-13** to match its task id. Older text below may describe a "board id + 1" filename rule: that was a mistake copied between specs, not a convention. A spec is always `docs/tasks/<task id>-spec.md`.


Part 3 of the RH-114 split. File is RH-160 by the repo's id+1 filename offset. Parent spec: `docs/tasks/RH-114-spec.md` ("Whole-playlist list"); mock: `docs/tasks/RH-114-mock.html` (reused, no new mock). Depends on RH-158 (`docs/tasks/RH-158-spec.md`, done): `recordPracticeAction(items, bandId?)` already accepts `{ versionId, status? }[]`, applies the band-admin rule and runs in one transaction.

## Scope
A "Review practice" entry point in the playlist header opens a list of the playlist's songs. Rows start unticked; one control ticks all / unticks all; each row can carry an optional level; nothing is written until Confirm; Confirm sends one `recordPracticeAction` call containing only the ticked rows.

Not covered: the batch write itself and its band/ownership rules (RH-158), the per-song button, the edit-panel date field, the practice session, showing `last_practiced`, the offline snapshot, making `repertoireId: null` band entries owner-writable (they are listed and tickable and write the presser's personal row only).

## Approach

### Behavior
- **Entry point.** `PlaylistDetailHeader` gets a "Review practice" button, shown for any playlist with at least one song, wired through a callback prop; the open/closed state lives with the existing panel/modal state of the detail view, not in the header. Keep the header within its complexity budget (no new override entry or raised pin).
- **`usePracticeReview` (`src/hooks/usePracticeReview.ts`).** Takes the playlist's songs (all of them, not the tag/text-filtered subset), the injected `recordPractice` action, the playlist `bandId`, `setError` and `onRefresh`. Owns: tick state (a set of version ids, empty on open and re-emptied on every open), a map of levels the user has *explicitly changed* (empty on open), `allTicked`, `toggle(versionId)`, `toggleAll()` (ticks every row when any is unticked, otherwise unticks every row), `setLevel(versionId, status)`, `confirm()`, `submitting`. `confirm()` is a no-op at zero ticked; otherwise makes exactly one `recordPractice(items, bandId)` call whose items are the ticked rows only, each `{ versionId }` plus `status` only when that row is in the changed-level map. On success it calls `onRefresh` and closes; on failure it surfaces the thrown message through `setError`, keeps the list open with ticks intact, and (the batch being one transaction in RH-158) nothing was written.
- **`PracticeReviewList` (`src/components/playlists/PracticeReviewList.tsx`).** Presentational, receives the hook's controller. Renders a dialog with: a single tick-all/untick-all control (label flips with `allTicked`), one row per song (checkbox, title/artist, level control showing the row's current status via the existing `StatusNotes`, which displays the changed level once the user picks one), Confirm (disabled at zero ticked or while submitting) and Cancel/close. Cancel/close discards state and calls nothing. Rows with no owner row are listed and tickable. Band playlists: the level control follows the row's existing read-only rule (do not change it).
- **Wiring.** `usePlaylistDetail` exposes the hook's controller (or `PlaylistDetailView` composes it); `PractiseActions.recordPractice` in `src/hooks/usePractiseSong.ts` is widened to `{ versionId: string; status?: SongStatus }[]` (the page already injects `recordPracticeAction`; no change to the page unless types require it).
- **Complexity.** New modules stay within plain budgets; no new override entry; `complexityBudget` unchanged.

### Files touched
- `src/hooks/usePracticeReview.ts` — new: tick state, changed-level map, toggle-all, confirm.
- `src/components/playlists/PracticeReviewList.tsx` — new: the list dialog.
- `src/components/playlists/PlaylistDetailHeader.tsx` — "Review practice" button + callback prop.
- `src/components/playlists/PlaylistDetailView.tsx`, `src/hooks/usePlaylistDetail.ts` — open state and controller wiring.
- `src/hooks/usePractiseSong.ts` — `recordPractice` item type admits `status?`.
- `package.json` — version bump; `AGENTS.md` — one-line note of the review list if a practice-write rule already exists there.
- Tests: `src/components/playlists/__tests__/practiceReview.test.tsx` (jsdom), `src/hooks/__tests__/usePracticeReview.test.tsx`, a header test for the button, and a DB case in `src/lib/__tests__/practiceWrite.db.test.ts` (or `authzRepertoire.db.test.ts`) for a mixed batch.

### Test criteria
- jsdom/hook: on open every checkbox is unticked and Confirm is disabled; tick-all with some unticked ticks all; the same control with all ticked unticks all; re-opening resets ticks and levels; Confirm with two of four ticked calls the action once with exactly those two version ids; an untouched level sends no `status` key, a changed level sends it for that row only; Confirm with one rejected call shows the error and keeps the list open; Cancel calls nothing.
- DB (`RUN_DB_TESTS=1`): a batch of several items where one item fails (e.g. an unknown version id) leaves every `user_songs` row of the batch unwritten, through `recordPracticeAction`.
- `npm run lint` clean; `complexityBudget.test.ts` unchanged.

## Expected Results
- [ ] ER10 — The playlist-wide list opens with every row unticked.
- [ ] ER11 — The list's single control ticks every row when pressed with some unticked.
- [ ] ER12 — The same control unticks every row when pressed with all ticked.
- [ ] ER13 — Confirm writes only the ticked rows; unticked rows are not written.
- [ ] ER14 — If one item of a confirmed batch fails, no row of the batch is written.
- [ ] ER15 — Confirm sends `status` only for rows whose level the user changed.

## Out of Scope
Batch write internals and band rules (RH-158), per-song button, edit-panel date field, practice session, propagation to members, `GREATEST`, displaying `last_practiced`, offline snapshot.

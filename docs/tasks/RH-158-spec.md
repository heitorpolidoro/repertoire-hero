# RH-158 — Add batch practice write and per-song Practised button

> **Renamed 2026-10-13** to match its task id. Older text below may describe a "board id + 1" filename rule: that was a mistake copied between specs, not a convention. A spec is always `docs/tasks/<task id>-spec.md`.


Part 2 of the RH-114 split. Parent spec: `docs/tasks/RH-114-spec.md` ("Write path", "Actions", "Per-song button"). File is RH-159 by the repo's id+1 filename offset. Independent of RH-157 (edit-panel date): the practice write sets the column by its own SQL and does not use `OwnerSongPatch`.

## Scope
The write path that sets `last_practiced` to the server's `now()` for a list of versions, its status-only sibling, the Server Action(s) that expose them, and the "Practised" button on one playlist song row. The batch function is built list-shaped so the later whole-playlist review list (a separate part) reuses it unchanged.

Not covered: the whole-playlist list (`PracticeReviewList`, `usePracticeReview`, header button), the edit-panel date field, the practice session, any display of `last_practiced`, the offline snapshot, making band-row entries with `repertoireId: null` interactive.

## Approach

### Behavior
- **Lib (`src/lib/ownerSongs.ts`).** One exported function takes the presser's user id, an optional band id and `items: { versionId; status? }[]`. Inside a single `withTransaction` it upserts the presser's `user_songs` row per item (`ON CONFLICT (user_id, version_id) DO UPDATE`), setting `last_practiced = now()` and `status` only when the item carries one; a newly created row is born `unknown` when no status is given. When a band id is passed it also `UPDATE`s the band's existing `band_songs` row at that version with the same values. It never inserts a `band_songs` row and never touches another user's row (the key always includes the presser's id). An empty list is a no-op; any failing item rolls the whole batch back.
- **Status-only sibling.** Same owners, same band rule, same transaction; items require `status`; it writes `status` only and never mentions `last_practiced`. A missing user row is created with that status (and a null date). Used for the level chosen after the tap.
- **Actions (`src/app/actions/repertoire.ts`).** `recordPracticeAction(items, bandId?)` and a sibling `recordPracticeStatusAction(items, bandId?)` resolve the session user. With a `bandId` they call `assertBandMember` (non-member throws `Access denied: not a member of this band`), then decide admin from its returned role, not by throwing for a plain member: admin passes the band id to the lib, a plain member passes none (personal write only, no error). The band id reaches the lib only after admin is established. Both revalidate `/`.
- **Per-song button.** `PlaylistSongRow` gets a "Practised" button wired by an injected handler `onPractise(versionId)` (F21, same shape as `onStatusChange`; handler added to `PlaylistSongHandlers`, `usePlaylistDetail` actions bundle and `src/app/playlists/[id]/page.tsx`). Tapping calls the date-only action immediately, then reveals the existing status control for the optional level. Choosing a level issues the status-only action (never touching the date); dismissing leaves status as is. A failure of the date write surfaces through the existing error path and does not reveal the level control. On a band playlist the tap passes the band id, so the action applies the admin rule above; the level control there follows the row's existing read-only rule for band playlists, so a band level choice is out of reach unless that rule already allows it (do not change that rule here).
- **Complexity.** New code stays within plain budgets; `PlaylistSongRow` must not need a new override entry or a raised pin (extract the button/level reveal into a small component if needed).

### Files touched
- `src/lib/ownerSongs.ts` — batch practice write and status-only sibling.
- `src/app/actions/repertoire.ts` — `recordPracticeAction`, `recordPracticeStatusAction`.
- `src/hooks/usePlaylistDetail.ts` — action types, `practise` handler on the returned detail.
- `src/app/playlists/[id]/page.tsx` — injects the actions.
- `src/components/playlists/PlaylistSongRow.tsx` (+ small extracted button component) and `PlaylistDetailView.tsx` — button and handler wiring.
- `AGENTS.md` (practice-write rule), `package.json` version bump.

### Test criteria
- DB (`src/lib/__tests__/practiceWrite.db.test.ts`, `RUN_DB_TESTS=1`): tap writes the presser's row with `last_practiced` equal to the DB `now()` (not a client value); absent row created `unknown`; member call leaves `band_songs` unchanged; admin call updates the band's existing row; band with no row at the version stays without one (row count unchanged); another member's `user_songs` row unchanged; `status` untouched when omitted; one failing item rolls back the whole batch; status-only write changes `status` and leaves `last_practiced` unchanged.
- Action (`authzRepertoire.db.test.ts`): non-admin member passes, personal row written, no throw, band row unchanged; admin writes both; non-member throws; the guard tests `actionAuthorizationGuard` / `actionSessionGuard` still pass with the new actions.
- jsdom (`PlaylistSongRow` test): button calls the injected handler with the version id, then shows the level control; choosing a level calls the status-only handler; failure does not reveal the level control.
- `npm run lint` clean, `complexityBudget.test.ts` unchanged.

## Expected Results
- [ ] ER5 — Tapping the per-song button sets `last_practiced` on the presser's own `user_songs` row to the server's now.
- [ ] ER6 — Tapping the per-song button when the presser holds no row creates one with `status = unknown`.
- [ ] ER7 — On a band playlist, a tap by a band admin sets `last_practiced` to now on the band's existing `band_songs` row.
- [ ] ER8 — On a band playlist, a tap by a non-admin member leaves the `band_songs` row untouched and raises no error.
- [ ] ER9 — Choosing a level after the per-song tap changes `status` without changing `last_practiced`.
- [ ] ER16 — No practice write inserts a `band_songs` row.
- [ ] ER17 — No practice write changes another member's `user_songs` row.

## Out of Scope
Whole-playlist review list, edit-panel date field, practice session, propagation to members, `GREATEST`, showing `last_practiced` anywhere, offline snapshot.

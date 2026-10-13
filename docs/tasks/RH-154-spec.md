# RH-154 — Add admin catalog data layer: blast radius, merge versions, delete

## Scope
Data layer only (part 1 of RH-117): system-admin-gated `src/lib` functions plus thin Server Actions to (1) count what a version or song sustains, (2) merge version A into version B atomically, (3) delete a version only when nothing references it. No screen, no split, no song-level merge or delete, no `song_files` handling (keyed by song, not version, untouched).

## Approach
Behavior:
- Every new lib function calls `checkSystemAdmin(userId)` (`src/lib/moderation.ts`) as its first statement, before any read or write; a non-admin gets `Access denied: User is not a system admin` and nothing changes. Actions are thin (A2): resolve the session via `getRequiredUserId`, delegate, no SQL, names end in `Action`.
- Blast radius, for a version id or a song id (a song counts across all its versions): `{ repertoires, playlists }`. `repertoires` = distinct `user_songs` owners plus distinct `band_songs` owners; `playlists` = distinct `playlist_songs.playlist_id`. Counts are exact, no estimates.
- Merge A into B (both must exist; A != B; same `song_id` is not required, since a false-merge repair may cross songs, but both must exist). One `withTransaction`, in this order: repoint `user_songs`, `band_songs`, `playlist_songs` from A to B; repoint `catalog_suggestions.target_id` from A to B (uuids are globally unique and the column is polymorphic with no FK, so `WHERE target_id = A` is unambiguous); delete A. Afterwards no row references A.
- Collision rule (deterministic, B wins): where the same owner already holds B in `user_songs`/`band_songs`, or the same playlist already holds B in `playlist_songs`, B's row is kept untouched and A's row is deleted; A's data on that row is discarded. After `playlist_songs` removals the affected playlists' `position` values are renumbered contiguous from 1 in existing order (no gaps; `uq_playlist_song_position` must hold). Inserts into `playlist_songs` are not used; repoint is an UPDATE. Any unique violation must be prevented by the pre-delete of colliding rows, never by catching `23505` inside the transaction (see AGENTS.md "Transactions").
- Delete version: admin check, then refuse with an error when blast radius sums to > 0 or any `catalog_suggestions` row targets it; otherwise delete. The reference check and the delete happen in one transaction so a concurrent reference cannot slip in between (lock the version row `FOR UPDATE`).
- Errors follow L1 (log then throw `Failed to ...`), the admin-denied message is re-thrown verbatim (L1a).

Files touched:
- `src/lib/catalogAdmin.ts` (new): blast-radius, merge and delete functions.
- `src/app/actions/catalogAdmin.ts` (new): `getCatalogBlastRadiusAction`, `mergeSongVersionsAction`, `deleteSongVersionAction`.
- `src/lib/dbRows.ts`: row shape only if a projection needs one.
- `src/lib/__tests__/catalogAdmin.db.test.ts` (new): DB tests below.
- `src/app/actions/__tests__/catalogAdmin.test.ts` (new): non-admin rejection through the actions, delegation with the session user id.
- `AGENTS.md`: one line in the Directory Structure / Domain Concepts for the new module.

Test criteria (DB tests, seeded with `test-helpers`, unique ids per test, cleaned up):
- Non-admin: each function and action rejects; row counts of `user_songs`, `band_songs`, `playlist_songs`, `song_versions`, `catalog_suggestions` unchanged.
- Blast radius: seed a known mix (2 users, 1 band, 2 playlists, one owner holding the version in both tables is two repertoires) and assert exact numbers for a version and for its song.
- Merge happy path: all three tables repoint, no row left on A, A gone.
- Collision: owner holds both A and B, playlist holds both; assert B's row (by id and by its distinct status/position values) survives, A's is gone, playlist positions are contiguous.
- Suggestions: a `catalog_suggestions` row with `target_id = A` ends with `target_id = B`. (The 0021 CHECK only admits `target_table = 'songs'` today, so the seed uses that table with A's uuid as target_id.)
- Atomicity: a Postgres trigger scoped to one fixture row id raises mid-merge (pattern in `transactionAtomicity.db.test.ts`); afterwards every table equals its pre-merge snapshot.
- Delete: zero references succeeds; one reference (each of user_songs, band_songs, playlist_songs separately) is refused and the version still exists.

## Expected Results
- [ ] A non-system-admin calling any new lib function or action is rejected and no row in the affected tables changes.
- [ ] The blast-radius function returns exact distinct repertoire and playlist counts for a version and for a song, asserted with seeded rows.
- [ ] Merging A into B in one `withTransaction` leaves no `user_songs`, `band_songs` or `playlist_songs` row referencing A.
- [ ] When the owner or playlist already holds B, B's row survives and A's is deleted, asserted by a DB test, and playlist positions stay contiguous.
- [ ] Merging A into B repoints every `catalog_suggestions` row with `target_id = A` to B.
- [ ] A merge forced to fail midway leaves all affected tables identical to their pre-merge state.
- [ ] Deleting a version with zero references succeeds; deleting one with any reference is refused with an error and the row remains.
- [ ] The new DB tests pass under `RUN_DB_TESTS=1 npx vitest run`, and `npm run lint` and `npx tsc --noEmit` stay clean.

## Out of Scope
Admin screen (later RH-117 parts), splitting, song-level merge/delete, `song_files`, repointing `migrate_catalog_to_versions()`.

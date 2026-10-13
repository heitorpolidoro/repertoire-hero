# RH-155 — Add admin catalog data layer: split song and merge songs

## Scope
Data layer only (part 2 of RH-117, builds on RH-154 / commit 829bf5c): two system-admin-gated `src/lib` functions plus thin Server Actions to (1) split chosen versions off a song onto a new or an existing song and (2) merge song A into song B. No screen, no version delete, no song delete outside merge, no change to the RH-154 public signatures or behavior.

## Approach
Behavior:
- Every new lib function calls `checkSystemAdmin(userId)` first, before any read or write; a non-admin gets `Access denied: User is not a system admin` and nothing changes. Actions are thin (A2): `getRequiredUserId`, delegate, no SQL, names end in `Action`. Errors follow L1/L1a exactly as `catalogAdmin.ts` does (`CatalogAdminRefusal` re-thrown verbatim).
- Refactor, no behavior change: extract the body of `mergeSongVersions` into an internal `mergeVersionsInTransaction(client, fromId, intoId)` so song-level operations can merge duplicate versions inside their own transaction (nested `withTransaction` is not allowed). `mergeSongVersions` keeps its signature and tests.
- Split. Input: source song id, a non-empty list of version ids, and a target that is either `{ new: { artist, title } }` or `{ songId }`. All chosen versions must belong to the source song; the source must keep at least one version (moving all of them is a refusal that points to merge instead); target must differ from the source. One `withTransaction`: lock the source and target song rows `FOR UPDATE` and the versions, then:
  - New target: if a song with the same `lower(btrim(artist))`, `lower(btrim(title))` already exists, refuse with a clear message before inserting (never catch `23505`, see AGENTS.md "Transactions"); otherwise insert the song row (copying `standard_key`, `cover_url`, `duration_seconds` from the source, artist/title from the input).
  - `UPDATE song_versions SET song_id = target` for exactly the chosen ids. If a moved version would violate `UNIQUE NULLS NOT DISTINCT (song_id, album_id, label)` against a version already on an existing target, merge it into that version via `mergeVersionsInTransaction` (target's version wins) rather than updating it. The other versions stay on the source.
  - `song_links`: the source's links are copied to the target (`INSERT ... ON CONFLICT (song_id, url) DO NOTHING`, positions appended after the target's existing max); the source keeps its own.
  - `song_files`: a file row moves to the target when its `user_id` holds at least one moved version in `user_songs` and holds no remaining version of the source song in `user_songs`; otherwise it stays. (Files are keyed by user and song, not by version; this rule makes a musician's chart follow the version they actually play.)
  - `catalog_suggestions` targeting a moved version id need no change (version ids are stable); suggestions targeting the source song id stay on the source.
- Merge songs A into B (both must exist, A != B). One `withTransaction`, locking both song rows: move every version of A to B; where a moved version collides on `(song_id, album_id, label)` with one already on B, merge it into B's version via `mergeVersionsInTransaction` (B's wins), which repoints `user_songs`, `band_songs`, `playlist_songs` and `catalog_suggestions` per RH-154. Then `song_files` of A repoint to B; `song_links` of A repoint to B except rows whose `url` B already has (deleted, B's wins), appended after B's max position. `catalog_suggestions` rows with `target_table = 'songs'` and `target_id = A` move to `target_id = B`. `catalog_suggestions` rows with `target_table = 'song_links'` follow the link rule: if the target link is repointed, the suggestion is untouched (link ids are stable); if the target link is deleted because B already has that `url`, the suggestion is repointed to B's surviving link with the same `url` (per migration 0021's re-point requirement; no orphans are left, per 0023). This repoint happens before the duplicate link rows are deleted. Finally delete A. Afterwards no version, file, link or suggestion references A, and no `song_links` suggestion points at a deleted link.
- Triggers from migration 0019 mirror `song_links` into `songs.links`; the operations rely on them and do not write `songs.links` directly.

Files touched:
- `src/lib/catalogAdmin.ts`: extract `mergeVersionsInTransaction`; add `splitSongVersions` and `mergeSongs`.
- `src/app/actions/catalogAdmin.ts`: add `splitSongVersionsAction`, `mergeSongsAction`.
- `src/lib/__tests__/catalogAdmin.db.test.ts` (or a sibling `catalogAdminSongs.db.test.ts`): DB tests below.
- `src/app/actions/__tests__/catalogAdmin.test.ts`: non-admin rejection and delegation for the two new actions; `actionSessionGuard.test.ts` entries for them if that suite enumerates actions.
- `AGENTS.md`: one line extending the `catalogAdmin` module entry.

Test criteria (DB tests with `test-helpers`, unique ids, cleaned up):
- Non-admin: each function and action rejects; row counts of `songs`, `song_versions`, `song_files`, `song_links`, `catalog_suggestions` unchanged.
- Split to new song: chosen versions have the new `song_id`, the unchosen remain on the original; moving all versions is refused.
- Split to existing song: versions attach to it; a duplicate `(album_id, label)` on the target is merged, not errored; a new (artist, title) equal to an existing song (case/whitespace variants) is refused with a plain error and no row changes.
- Split carries `song_links` (copies, deduped by url) and `song_files` per the ownership rule, with a user who keeps a remaining version retaining their file.
- Merge songs: all versions of A end on B, none reference A, A is gone; files, links (url collision resolved for B) and `songs`-targeted suggestions land on B; a `song_links`-targeted suggestion on an A link whose url B already has ends targeting B's link with that url (no orphan), and one on a non-colliding link stays valid.
- Merge with duplicate versions: user_songs, band_songs, playlist_songs and a version-targeted suggestion end on the surviving version; playlist positions contiguous.
- Atomicity: a trigger scoped to one fixture row raises mid-operation (pattern in `transactionAtomicity.db.test.ts`) for split and for merge; every table equals its pre-operation snapshot.

## Expected Results
- [ ] A non-system-admin calling the split or merge-songs lib function or Server Action is rejected and no row changes.
- [ ] Splitting chosen versions onto a new songs row moves exactly those versions, and the remaining versions stay on the original song, asserted by a DB test.
- [ ] Splitting onto an existing song attaches the chosen versions, and an (artist, title) that would violate `uq_songs_artist_title` is refused with a plain error, no constraint error escaping, asserted by a DB test.
- [ ] A split carries the related `song_links` and `song_files` rows to the target song under the stated rules, asserted by a DB test.
- [ ] Merging song A into B moves all of A's versions to B and leaves no version, file, link or `songs` suggestion referencing A.
- [ ] Duplicate versions produced by a song merge are merged through the RH-154 version merge logic, and all references and `catalog_suggestions` targets end on the surviving version.
- [ ] Each operation runs in one `withTransaction`, and a forced mid-operation failure leaves all affected tables unchanged, asserted by a DB test.
- [ ] The new DB tests pass under `RUN_DB_TESTS=1 npx vitest run`, with `npm run lint` and `npx tsc --noEmit` clean.

## Out of Scope
Admin screen (later RH-117 parts), version delete changes, standalone song delete, editing song metadata beyond the split target's artist/title.

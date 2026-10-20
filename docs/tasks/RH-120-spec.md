# RH-120 — Store every album a recording appears on

## Scope
Today `song_versions.album_id` holds one album, and version identity is `UNIQUE NULLS NOT DISTINCT (song_id, album_id, label)` (RH-122, `docs/plans/repertoire-rework.md` § Rules). The same recording released on a studio album and a compilation therefore becomes two version rows, and a musician's hold, tags and practice date split across them.

This task makes a version *one recording* with *many releases*:
- a new join table `version_albums (version_id, album_id)` records every album a version appears on;
- version identity becomes `(song_id, label)` (still `NULLS NOT DISTINCT`); `album_id` leaves `song_versions`;
- the write paths attach an album to the matching version instead of minting a second version;
- reads that show one album per version keep showing exactly one, chosen by a fixed rule.

**Held task.** The justification says the operator unblocks it after using the reworked catalog; do not start before then.

Not covered: any new UI (no screen lists all of a version's albums; that is a follow-up once the data exists), changes to `albums` identity, `songs` identity, the `" - "` title/label split, Spotify scopes, or the moderation queue.

**Known trade-off, stated so the operator can veto it:** with `album_id` out of the identity, two *different* recordings sharing a label across albums (e.g. two distinct "Live" takes, both with label "Live") merge into one version. The RH-122 rationale warned that a wrong merge has no delete path; the admin catalog split (RH-155) is the path back, and the migration ledger below preserves what a merge dropped.

## Approach

**Behavior**
1. `version_albums` has primary key `(version_id, album_id)`, both cascading foreign keys, and `created_at`. A version may have zero albums (an unknown release is still a recording).
2. Ingest (`upsertAlbumAndVersion`, `ensureSongHasVersion`, and every path that calls them: manual add, Spotify import and sync, `createAndAddSong`) resolves the version by `(song_id, label)` alone, then inserts the `(version, album)` link with `ON CONFLICT DO NOTHING`. Ingesting the same track from a second album answers the **same version id**, leaves one `song_versions` row, and adds a second link. Idempotent on repeat. `duration_seconds`/`key` of an existing version are not overwritten by the second ingest.
3. **One album per version where a screen needs one.** Every existing projection of `albums` through `song_versions` (catalog search results, owner-row reads, the representative-version ordering) takes the version's *primary album*: `album_type = 'album'` first, then earliest `release_date`, then earliest link `created_at`, then `albums.id`, nulls last — the same ordering `representativeVersionOrder` uses for versions, spelled once and reused. A version with no link resolves to no album and is never dropped (`LEFT JOIN` / lateral that tolerates no row, per the existing guard in `ownerSongsGuards.test.ts`). Result shapes seen by components do not change.
4. `representativeVersionOrder` / `representativeVersionSubquery` order versions by their primary album's type and date, so the pick for a song with a single linked album is unchanged.
5. Admin version merge (`mergeVersionsInTransaction`) moves the merged version's album links onto the survivor (duplicates ignored). Song merge/split `moveVersions` collision test becomes `(song_id, label)`.
6. **Migration** `migrations/0029_version_albums.sql` (next free number; verify against `migrations/` at build time), one transaction:
   - create `version_albums`; backfill one link per existing `song_versions.album_id IS NOT NULL`;
   - find versions colliding on `(song_id, label)` (null-safe); keep the survivor chosen by the old representative ordering; re-point the only three foreign keys to `song_versions` (besides the new `version_albums`): `user_songs.version_id` and `band_songs.version_id` (migration 0016) and `playlist_songs.version_id` (migration 0017). `song_files` (keyed on `user_id, song_id`, no version column) and `catalog_suggestions` (targets `songs`/`song_links` only, never `song_versions`) reference no version and need nothing. Link all collided versions' albums to the survivor; delete the losers;
   - where re-pointing would violate `(owner, version_id)` or `(playlist_id, version_id)` uniqueness, the survivor's row wins and the displaced row is stored whole in the recovery ledger `merged_version_rows`, copying the shape of `orphaned_repertoire_rows` (migration 0016) plus the ids: `id uuid PK DEFAULT gen_random_uuid()`, `source_table text NOT NULL` (`user_songs`, `band_songs` or `playlist_songs`), `row_json jsonb NOT NULL` (the displaced row, whole), `loser_version_id uuid NOT NULL`, `survivor_version_id uuid NOT NULL` (plain uuids, no FK — the loser is deleted), `reason text NOT NULL`, `archived_at timestamptz NOT NULL DEFAULT now()`; nothing reads it;
   - replace `uq_song_versions_identity` with `UNIQUE NULLS NOT DISTINCT (song_id, label)`, then drop `song_versions.album_id`.
   The migration has no down path. `scripts/seed-catalog.sql` must still apply after it.
7. Docs updated in the same change: AGENTS.md Domain Concepts (*Song Version*, *Album*), `docs/plans/repertoire-rework.md` § Rules (supersede the version-identity paragraph), `docs/use-cases.md` where it states version identity.

**Files touched**
- `migrations/0029_version_albums.sql` — new: table, backfill, collision merge, ledger, identity swap, column drop.
- `src/lib/songVersions.ts` — identity lookup/insert on `(song_id, label)`, link insert, primary-album ordering helper, `ensureSongHasVersion` link projection.
- `src/lib/songs.ts`, `src/lib/ownerSongs.ts`, `src/lib/songSearchMerge.ts` — replace `JOIN albums ON album_id` with the primary-album lateral; comments updated.
- `src/lib/catalogAdmin.ts` — merge moves album links; `COLLIDING_VERSION` drops the album predicate.
- `src/types/database.ts`, `src/lib/dbRows.ts` — only if a type names `album_id` on the version.
- Tests listed below; AGENTS.md and the two docs above.

**Test criteria** (DB tests run with `RUN_DB_TESTS=1`)
- New `src/lib/__tests__/versionAlbums.db.test.ts`: same track ingested from two albums → one version, two links, same id returned; repeat ingest changes nothing; album-less ingest → version with zero links.
- New `versionAlbumsMigration.db.test.ts` (pattern of `catalogVersionsMigration.db.test.ts`): fixture with two versions of one song and label on two albums, each held by different owners and one owner holding both → one version, two links, the single hold survives, the displaced duplicate row is in `merged_version_rows`.
- Existing tests that insert or assert `album_id` (`ownerSongs`, `ownerVersionAdd`, `createAndAddSongVersion`, `catalogVersions`, `playlistVersionReads`, `spotifyPushUris`, `songVersions`, `ownerSongsGuards`, `catalogVersionsMigration`, `ownerSongsMigration`, `playlistSongsVersionMigration`) updated to the link model; the `ownerSongsGuards` LEFT JOIN guard extended to the new join.
- A search result and an owner row for a version on two albums each show exactly one album, the `album_type = 'album'` earliest-dated one.
- `npm run lint`, `npm run lint:dead`, `npm run lint:dup`, `npx tsc --noEmit` and `npm run test:coverage` pass; no `max-lines` override added (`songVersions.ts`, `ownerSongs.ts` sit near budget — extract the primary-album SQL into a small new module if needed).

## Behavior changes
none (no behavior registry)

## Expected Results
- [ ] After migration `song_versions` has no `album_id` column, `version_albums(version_id, album_id)` exists with a composite primary key, and one link exists for every pre-migration non-null `album_id`.
- [ ] `uq_song_versions_identity` is `UNIQUE NULLS NOT DISTINCT (song_id, label)`, so inserting a second version with the same song and label is refused with `23505`.
- [ ] Ingesting one track from two different albums leaves a single `song_versions` row linked to both albums, returns the same version id both times, and a repeat ingest adds no rows.
- [ ] Migrating a fixture with the same recording split across two versions yields one version holding both albums, keeps the owner's hold, and records any displaced duplicate row in `merged_version_rows`.
- [ ] Catalog search and owner-row reads return exactly one album per version for a two-album version (the `album_type = 'album'`, earliest-released one) and still return album-less versions.
- [ ] Admin version merge unions the album links onto the surviving version.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run lint:dead` and `npm run test:coverage` (with `RUN_DB_TESTS=1`) all pass.

## Out of Scope
- Any screen listing or editing a version's albums.
- Reversing the migration or un-merging versions automatically.
- Changing how `albums` rows are created or keyed.

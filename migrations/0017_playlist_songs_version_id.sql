-- Migration 0017 (RH-125): a playlist entry stops naming a song and names a
-- version.
--
-- `playlist_songs.song_id` becomes `playlist_songs.version_id`, referencing
-- `song_versions`, and `uq_playlist_song (playlist_id, song_id)` becomes
-- `uq_playlist_song_version (playlist_id, version_id)`.
--
-- WHY A VERSION AND NOT A REPERTOIRE ROW
--
-- The playlist already names its owner (`playlists.user_id` xor
-- `playlists.band_id`), so `(playlist owner, version_id)` *is* the unique key of
-- `user_songs` / `band_songs`: one index hit, and no second copy of the owner
-- that could disagree with the first. And the same version opened from a
-- personal playlist and from a band playlist must resolve to **two different
-- rows**, with different key, tuning, lyrics and map; a stored repertoire row id
-- could only ever name one of them.
--
-- THE ORDER OF THE STEPS IS LOAD-BEARING
--
-- `scripts/migrate.mjs` runs each file inside **one** transaction, and step 6
-- drops this migration's own source column. A step moved after that DROP reads a
-- column that is gone; a step moved before step 1 may find a `songs` row with no
-- version to point at.
--
--   1. call `migrate_catalog_to_versions()` — RH-122's idempotent backfill
--   2. ADD COLUMN version_id, nullable for the duration of the backfill only
--   3. create the `orphaned_playlist_entries` recovery ledger
--   4. archive, then delete, every entry whose song still has no version
--   5. backfill `version_id` by the representative-version ordering
--   6. SET NOT NULL, swap the unique, DROP COLUMN song_id, index the FK
--
-- WHY STEP 1 IS HERE AT ALL
--
-- Every carried entry needs a `version_id`, so "there is a target for each" has
-- to be a fact rather than an assumption. RH-122 backfilled one album and one
-- version per catalog row and **kept its backfill as a function** precisely so a
-- later migration could re-run it; a `songs` row written between that migration
-- and this one has no version until it is called. It is idempotent (`NOT EXISTS`
-- / `ON CONFLICT DO NOTHING` throughout), so calling it on a database that has
-- already run it costs one no-op. Same move as `migrations/0016` step 2.
--
-- WHY THE REPRESENTATIVE-VERSION JOIN ONTO `albums` IS A LEFT JOIN
--
-- `song_versions.album_id` is nullable on purpose (RH-122): a recording of an
-- unknown release is still a recording, and today's catalog holds such rows.
-- `album_type` and `release_date` live on `albums`, so an inner join would
-- silently drop every album-less version — and here that is not cosmetic: the
-- entry's song would be classed `no_version` and archived one step earlier, or
-- left with a null `version_id` that step 6 then refuses. A null `album_type`
-- therefore sorts after `'album'`, a null `release_date` sorts last, and the two
-- version-level tiebreakers (`created_at`, then `id`) keep the pick **total** for
-- a song whose every version is album-less, so two runs cannot disagree. The
-- ordering is `representativeVersionOrder()` in `src/lib/songVersions.ts`,
-- restated here because a migration cannot import TypeScript.
--
-- WHY THE NEW UNIQUE CANNOT BE VIOLATED BY THE BACKFILL
--
-- `uq_playlist_song` guarantees at most one source entry per `(playlist, song)`,
-- exactly one version is chosen per song, and a version belongs to exactly one
-- song — so two surviving entries of one playlist cannot land on the same
-- version. Conservation is asserted rather than assumed, in
-- `src/lib/__tests__/playlistSongsVersionMigration.db.test.ts`.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT NAME
--
-- The *other* unique on this table, the one over `(playlist_id, position)`.
-- RH-103 made it `DEFERRABLE INITIALLY IMMEDIATE` so a reorder can permute
-- positions in one statement, and nothing here touches it: `ADD COLUMN`,
-- `DROP COLUMN` and `ADD CONSTRAINT` do not re-declare an unrelated constraint,
-- and the backfill `UPDATE` writes only `version_id`, so it is not even
-- evaluated. **No `position` value is written anywhere in this file** — no
-- renumbering and no reordering.
--
-- `uq_playlist_song_version` is a plain, immediate unique: the default form, and
-- the same form `uq_playlist_song` had, so this is a swap of columns and not a
-- change of mode. Only a *reorder* permutes a column inside one statement, and
-- no path permutes a playlist's versions.
--
-- NOT IDEMPOTENT, AND NOT REQUIRED TO BE
--
-- It drops its own source column. The `_migrations` ledger is what stops a
-- second run.

-- ---------------------------------------------------------------------------
-- Step 1 — guarantee a version for every catalog row (RH-122's function).
-- ---------------------------------------------------------------------------
SELECT migrate_catalog_to_versions();

-- ---------------------------------------------------------------------------
-- Step 2 — the new column, nullable only until step 6.
--
-- `ON DELETE CASCADE` mirrors what `song_id` carried: a version deleted from
-- the catalog takes the playlist entries that named it with it, exactly as a
-- deleted song did.
-- ---------------------------------------------------------------------------
ALTER TABLE playlist_songs
    ADD COLUMN version_id uuid REFERENCES song_versions(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- Step 3 — the recovery ledger.
--
-- A playlist entry that silently vanishes is as bad as a repertoire row that
-- does, and `song_id` is dropped three steps later, so there is no second
-- chance to work out what an entry pointed at. Same reasoning as RH-123's
-- `abandoned_blobs` and RH-124's `orphaned_repertoire_rows`, and like both,
-- nothing reads this table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orphaned_playlist_entries (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    row_json    jsonb       NOT NULL,
    reason      text        NOT NULL,
    archived_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE orphaned_playlist_entries IS
    'Recovery ledger for RH-125: every `playlist_songs` row migration 0017 '
    'could not re-point at a `song_versions` row, stored whole as jsonb with '
    'the reason. Nothing reads it — it exists because the source column was '
    'dropped in the same migration, so an entry lost here is lost for good.';

-- ---------------------------------------------------------------------------
-- Step 4 — archive what cannot be carried, then delete it.
--
-- `no_version`: the entry's song still has no version after step 1. Unreachable
-- while step 1 runs, and kept as the same kind of guard `migrations/0016`
-- step 4 keeps — if the backfill function were ever dropped by hand, the entry
-- is recorded instead of lost to step 6's `SET NOT NULL`.
-- ---------------------------------------------------------------------------
INSERT INTO orphaned_playlist_entries (row_json, reason)
SELECT to_jsonb(ps), 'no_version'
  FROM playlist_songs ps
 WHERE NOT EXISTS (SELECT 1 FROM song_versions v WHERE v.song_id = ps.song_id);

DELETE FROM playlist_songs ps
 WHERE NOT EXISTS (SELECT 1 FROM song_versions v WHERE v.song_id = ps.song_id);

-- ---------------------------------------------------------------------------
-- Step 5 — the backfill, by the representative-version ordering.
--
-- Restated in full rather than referenced, because this is the one step whose
-- result can diverge from `src/lib/songVersions.ts`' ordering without any other
-- assertion noticing: prefer `albums.album_type = 'album'` over any other value
-- (`single`, `compilation`) and over a null, then the earliest
-- `albums.release_date` (nulls last), then the earliest
-- `song_versions.created_at`, then the lowest `song_versions.id`.
-- ---------------------------------------------------------------------------
UPDATE playlist_songs ps
   SET version_id = (
         SELECT v.id
           FROM song_versions v
           LEFT JOIN albums a ON a.id = v.album_id
          WHERE v.song_id = ps.song_id
          ORDER BY (a.album_type = 'album') DESC NULLS LAST,
                   a.release_date ASC NULLS LAST,
                   v.created_at ASC,
                   v.id ASC
          LIMIT 1);

-- ---------------------------------------------------------------------------
-- Step 6 — the column is required, the unique is swapped, the source is gone.
--
-- Postgres indexes the referenced side of a foreign key, never the referencing
-- one, and `version_id` is joined on every playlist read.
-- ---------------------------------------------------------------------------
ALTER TABLE playlist_songs ALTER COLUMN version_id SET NOT NULL;

ALTER TABLE playlist_songs DROP CONSTRAINT uq_playlist_song;
ALTER TABLE playlist_songs
    ADD CONSTRAINT uq_playlist_song_version UNIQUE (playlist_id, version_id);

ALTER TABLE playlist_songs DROP COLUMN song_id;

CREATE INDEX IF NOT EXISTS idx_playlist_songs_version_id ON playlist_songs (version_id);

COMMENT ON COLUMN playlist_songs.version_id IS
    'The recording this entry names (RH-125). Paired with the playlist''s own '
    'owner it is the unique key of user_songs / band_songs, so the owner''s '
    'hold is one index hit away and nothing stores a second copy of the owner.';

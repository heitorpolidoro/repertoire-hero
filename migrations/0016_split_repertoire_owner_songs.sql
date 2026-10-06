-- Migration 0016 (RH-124): one repertoire table becomes two, keyed by a version.
--
-- `repertoire (song_id, user_id | band_id, …)` becomes
-- `user_songs (user_id, version_id, …)` and `band_songs (band_id, version_id, …)`.
-- Two tables rather than one with a CHECK, and no `owners` supertype: decided in
-- `docs/plans/repertoire-rework.md` § "The model" and not reopened here.
--
-- THE ORDER OF THE STEPS IS LOAD-BEARING
--
-- `scripts/migrate.mjs` runs each file inside **one** transaction, and step 6
-- drops this migration's own source. A step moved after the DROP reads a table
-- that is gone; a step moved before step 2 may find a `songs` row with no
-- version to point at.
--
--   1. create `user_songs` and `band_songs`
--   2. call `migrate_catalog_to_versions()` — RH-122's idempotent backfill
--   3. create the `orphaned_repertoire_rows` recovery ledger
--   4. archive every row that cannot be carried, whole, as jsonb
--   5. carry the user-owned rows and the band-owned rows into their tables
--   6. DROP TABLE repertoire  — which takes any trigger still on it with it
--
-- WHY STEP 2 IS HERE AT ALL
--
-- Every carried row needs a `version_id`, so "there is a target for each" must
-- be a fact rather than an assumption. RH-122 backfilled one album and one
-- version per catalog row and **kept its backfill as a function** precisely so
-- a later migration could re-run it; a `songs` row written between the two
-- migrations has no version until it is called. It is idempotent (`NOT EXISTS`
-- / `ON CONFLICT DO NOTHING` throughout), so calling it on a fresh database
-- that has already run it costs one no-op.
--
-- WHY THE REPRESENTATIVE-VERSION JOIN ONTO `albums` IS A LEFT JOIN
--
-- `song_versions.album_id` is nullable on purpose (RH-122): a recording of an
-- unknown release is still a recording, and today's catalog holds rows with no
-- album. `album_type` and `release_date` live on `albums`, so an inner join
-- would silently drop every version whose album row is missing — and here that
-- is not cosmetic: the row's song would be classed `no_version` at best and
-- lost at worst, three steps before `repertoire` is dropped. A null
-- `album_type` therefore sorts after `'album'`, a null `release_date` sorts
-- last, and the two version-level tiebreakers (`created_at`, then `id`) keep
-- the pick total for a song whose every version is album-less. The migration
-- test's conservation assertion is what proves no version was dropped this way.
--
-- NOT IDEMPOTENT, AND NOT REQUIRED TO BE
--
-- It drops its own source. The `_migrations` ledger is what stops a second run.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT NAME
--
-- `sync_band_repertoire_on_member_update` and `trg_sync_band_repertoire`.
-- `migrations/0010_drop_band_status_trigger.sql` (RH-96) already dropped both,
-- and re-naming them here would reintroduce the identifiers. `DROP TABLE` would
-- take a surviving trigger with it in any case.

-- ---------------------------------------------------------------------------
-- Step 1 — the two owner tables.
--
-- `status song_status NOT NULL DEFAULT 'unknown'` reuses the existing enum: a
-- row exists => it has a status. *Absence* of a row is what "not in my
-- repertoire" means, and that is expressed by there being no row, never by a
-- null column.
--
-- `key`, `tuning`, `lyrics` and `map` are nullable with no default, because
-- null is what sends resolution up the chain — clearing an override is writing
-- null, there is no separate unset state (docs/use-cases.md, *Edit or clear an
-- override*).
--
-- `created_at` is kept though the plan's DDL line omits it: the dashboard
-- orders newest-first and used to do it with `ORDER BY r.id DESC`, which is
-- meaningless for a uuid. The new reads order `created_at DESC, id DESC`, which
-- for migrated rows — all stamped at migration time — degrades to exactly the
-- old order.
--
-- The uniques are plain, not the partial indexes the single table needed: both
-- key columns are `NOT NULL` here. They are what refuse a version already held.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_songs (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid        NOT NULL REFERENCES profiles(id)      ON DELETE CASCADE,
    version_id     uuid        NOT NULL REFERENCES song_versions(id) ON DELETE CASCADE,
    status         song_status NOT NULL DEFAULT 'unknown',
    key            text,
    tuning         text,
    lyrics         text,
    map            jsonb,
    tags           text[]      NOT NULL DEFAULT '{}',
    last_practiced timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_songs_user_version UNIQUE (user_id, version_id)
);

CREATE TABLE IF NOT EXISTS band_songs (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    band_id        uuid        NOT NULL REFERENCES bands(id)         ON DELETE CASCADE,
    version_id     uuid        NOT NULL REFERENCES song_versions(id) ON DELETE CASCADE,
    status         song_status NOT NULL DEFAULT 'unknown',
    key            text,
    tuning         text,
    lyrics         text,
    map            jsonb,
    tags           text[]      NOT NULL DEFAULT '{}',
    last_practiced timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_band_songs_band_version UNIQUE (band_id, version_id)
);

-- Postgres indexes the referenced side of a foreign key, never the referencing
-- one, and `version_id` is joined on every read.
CREATE INDEX IF NOT EXISTS idx_user_songs_version_id ON user_songs (version_id);
CREATE INDEX IF NOT EXISTS idx_band_songs_version_id ON band_songs (version_id);

COMMENT ON TABLE user_songs IS
    'One musician''s hold on one version of a song: status, tags, practice date '
    'and the key/tuning/lyrics/map overrides. Unique on (user_id, version_id) — '
    'that unique is what refuses a version already held. Absence of a row is '
    'what "not in my repertoire" means.';
COMMENT ON TABLE band_songs IS
    'One band''s hold on one version of a song. Same columns as user_songs and '
    'an independent cascade: a user''s hold and a band''s hold on the same '
    'version share nothing, and neither propagates to the other (RH-96).';
COMMENT ON COLUMN user_songs.key IS
    'The owner''s key override. Null sends resolution to song_versions.key and '
    'no further — key is a property of a recording and does not reach songs.';
COMMENT ON COLUMN user_songs.lyrics IS
    'The owner''s lyrics override. Null sends resolution to song_versions, then '
    'to songs: words belong to the composition and a live take overrides them.';
COMMENT ON COLUMN band_songs.key IS
    'The owner''s key override. Null sends resolution to song_versions.key and '
    'no further — key is a property of a recording and does not reach songs.';
COMMENT ON COLUMN band_songs.lyrics IS
    'The owner''s lyrics override. Null sends resolution to song_versions, then '
    'to songs: words belong to the composition and a live take overrides them.';

-- ---------------------------------------------------------------------------
-- Step 2 — guarantee a version for every catalog row (RH-122's function).
-- ---------------------------------------------------------------------------
SELECT migrate_catalog_to_versions();

-- ---------------------------------------------------------------------------
-- Step 3 — the recovery ledger.
--
-- The alternative to archiving is a row vanishing with a musician's status,
-- tags and practice date in it, and `repertoire` is dropped three steps later,
-- so there is no second chance. Same reasoning as RH-123's `abandoned_blobs`,
-- and like it, nothing reads this table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orphaned_repertoire_rows (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    row_json    jsonb       NOT NULL,
    reason      text        NOT NULL,
    archived_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE orphaned_repertoire_rows IS
    'Recovery ledger for RH-124: every `repertoire` row migration 0016 could '
    'not carry into user_songs or band_songs, stored whole as jsonb with the '
    'reason. Nothing reads it — it exists because the source table was dropped '
    'in the same migration, so a row lost here is lost for good.';

-- ---------------------------------------------------------------------------
-- Step 4 — archive what cannot be carried.
--
-- `two_owners` / `no_owner`: `check_repertoire_owner_exclusive` forbids both,
-- so this is defensive — and defensive is the point. If the constraint was ever
-- dropped by hand, the row is recorded instead of lost.
--
-- `no_version`: the row's song still has no version after step 2. Unreachable
-- while step 2 runs, kept as the same kind of guard.
-- ---------------------------------------------------------------------------
INSERT INTO orphaned_repertoire_rows (row_json, reason)
SELECT to_jsonb(r),
       CASE
           WHEN r.user_id IS NOT NULL AND r.band_id IS NOT NULL THEN 'two_owners'
           ELSE 'no_owner'
       END
  FROM repertoire r
 WHERE (r.user_id IS NOT NULL) = (r.band_id IS NOT NULL);

INSERT INTO orphaned_repertoire_rows (row_json, reason)
SELECT to_jsonb(r), 'no_version'
  FROM repertoire r
 WHERE (r.user_id IS NOT NULL) <> (r.band_id IS NOT NULL)
   AND NOT EXISTS (SELECT 1 FROM song_versions v WHERE v.song_id = r.song_id);

-- ---------------------------------------------------------------------------
-- Step 5 — carry the rows.
--
-- `status`, `tags`, `last_practiced` and `lyrics` go across verbatim;
-- `personal_key` becomes `key`. `tuning` and `map` stay null, having never
-- existed on `repertoire`.
--
-- The version is the representative one for `repertoire.song_id`, picked by the
-- ordering described in this file's header — spelled the same way as
-- `representativeVersionSubquery()` in `src/lib/songVersions.ts`, which is the
-- only other place it exists.
--
-- `uq_repertoire_user_song` / `uq_repertoire_band_song` guarantee at most one
-- source row per `(owner, song)`, and exactly one version is chosen per song,
-- so neither new unique can be violated by this backfill.
-- ---------------------------------------------------------------------------
INSERT INTO user_songs (user_id, version_id, status, key, lyrics, tags, last_practiced)
SELECT r.user_id,
       (SELECT v.id
          FROM song_versions v
          LEFT JOIN albums a ON a.id = v.album_id
         WHERE v.song_id = r.song_id
         ORDER BY (a.album_type = 'album') DESC NULLS LAST,
                  a.release_date ASC NULLS LAST,
                  v.created_at ASC,
                  v.id ASC
         LIMIT 1),
       r.status,
       r.personal_key,
       r.lyrics,
       r.tags,
       r.last_practiced
  FROM repertoire r
 WHERE r.user_id IS NOT NULL
   AND r.band_id IS NULL
   AND EXISTS (SELECT 1 FROM song_versions v WHERE v.song_id = r.song_id);

INSERT INTO band_songs (band_id, version_id, status, key, lyrics, tags, last_practiced)
SELECT r.band_id,
       (SELECT v.id
          FROM song_versions v
          LEFT JOIN albums a ON a.id = v.album_id
         WHERE v.song_id = r.song_id
         ORDER BY (a.album_type = 'album') DESC NULLS LAST,
                  a.release_date ASC NULLS LAST,
                  v.created_at ASC,
                  v.id ASC
         LIMIT 1),
       r.status,
       r.personal_key,
       r.lyrics,
       r.tags,
       r.last_practiced
  FROM repertoire r
 WHERE r.band_id IS NOT NULL
   AND r.user_id IS NULL
   AND EXISTS (SELECT 1 FROM song_versions v WHERE v.song_id = r.song_id);

-- ---------------------------------------------------------------------------
-- Step 6 — the source is gone.
--
-- Nothing references `repertoire` any more: RH-123 re-keyed `repertoire_tabs`
-- onto `song_files (user_id, song_id)`, so the last foreign key into this table
-- left with it.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS repertoire;

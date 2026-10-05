-- Migration 0015 (RH-123): a file belongs to a musician and a composition.
--
-- `repertoire_tabs (repertoire_id, …)` becomes `song_files (user_id, song_id, …)`.
-- The re-key is not cosmetic: it changes who owns a file, how many lists Fast
-- View shows, and whether a band holds files at all. It does not.
--
-- The five steps below must stay in this order. `scripts/migrate.mjs` runs each
-- migration file inside **one** transaction, so a SELECT placed after the DROP
-- fails the whole file.
--
--   1. create `song_files`
--   2. copy the user-owned `repertoire_tabs` rows into it
--   3. create the `abandoned_blobs` recovery ledger
--   4. record the band-owned rows' `file_url`s in that ledger
--   5. DROP TABLE repertoire_tabs  — which is also what destroys those rows
--
-- Band-owned rows record no uploader: `repertoire_tabs` has a `repertoire_id`
-- and nothing else. Under the new model there is no owner such a row could be
-- given — assigning it to one member would be a guess, and fanning it out to
-- every current member would manufacture rows for people who never uploaded
-- anything and duplicate the file across a membership that changes. So those
-- rows are dropped, and their annotations with them. The file objects survive
-- in Vercel Blob and their URLs land in `abandoned_blobs`, which makes the loss
-- recoverable by hand rather than absolute.
--
-- This is the one place in the repository that may name `repertoire_tabs` after
-- RH-123 (plus `src/lib/__tests__/songFilesMigration.db.test.ts`, which rebuilds
-- the legacy shape to replay this file).

-- 1. The new table. ---------------------------------------------------------
--
-- No `band_id` column, by product rule: files belong to the person, not to the
-- band. No unique constraint on `(user_id, song_id)` either — a musician may
-- attach several charts to one song.
CREATE TABLE IF NOT EXISTS song_files (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    song_id     uuid        NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    title       text        NOT NULL,
    file_url    text        NOT NULL,
    annotations jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Every read is by that pair: `listTabs(userId, songId)`.
CREATE INDEX IF NOT EXISTS idx_song_files_user_song ON song_files (user_id, song_id);

COMMENT ON COLUMN song_files.user_id IS
    'The musician the file belongs to. A file is personal by design and a band holds none: there is deliberately no band_id column, so a chart uploaded in band context lands on the uploader''s own row.';

-- Carried over from migrations/0005_add_tab_annotations.sql verbatim.
COMMENT ON COLUMN song_files.annotations IS
    'Freehand drawing-layer strokes, keyed by page number as a string, e.g. {"1": [ {stroke...}, ... ], "2": [...] }. Coordinates are normalized 0..1 relative to page width/height so they render correctly at any zoom/viewport.';

-- `created_at` is kept deliberately, though it is not in the plan's DDL line:
-- the file list sorts on it and the offline snapshot stores it verbatim, so
-- dropping it would silently reorder a musician's charts.

-- 2. Carry the user-owned rows across. --------------------------------------
--
-- `annotations` is copied as the jsonb value, not re-serialised through text,
-- so a migrated row's annotations compare equal to the pre-migration value.
-- `uq_repertoire_user_song` guarantees one repertoire row per (user_id, song_id),
-- so no two source rows can collide on anything the new table constrains.
INSERT INTO song_files (user_id, song_id, title, file_url, annotations, created_at)
SELECT r.user_id, r.song_id, t.title, t.file_url, t.annotations, t.created_at
  FROM repertoire_tabs t
  JOIN repertoire r ON r.id = t.repertoire_id
 WHERE r.user_id IS NOT NULL;

-- 3. The recovery ledger. ---------------------------------------------------
--
-- Nothing reads this table yet. It exists because the alternative is destroying
-- the only record of objects that stay in Vercel Blob forever and, because
-- uploads are `access: 'public'`, stay readable by URL — a silent,
-- unrecoverable leak.
CREATE TABLE IF NOT EXISTS abandoned_blobs (
    file_url     text        PRIMARY KEY,
    reason       text        NOT NULL,
    abandoned_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE abandoned_blobs IS
    'Recovery ledger of Vercel Blob objects the application no longer points at. Without it a dropped or deleted row destroys the only record of an object that stays in Blob storage forever and, because uploads are access: public, stays readable by URL — a silent, unrecoverable leak. Written by this migration (band-owned rows it drops) and by deleteTabAction when the object delete fails. Its future reader is the blob sweeper, which has no task yet; nothing in the application reads it today.';

-- 4. Record the band-owned rows before anything is dropped. -----------------
--
-- This is the last read of `repertoire_tabs`. `ON CONFLICT DO NOTHING` so two
-- band rows sharing a URL do not abort the migration.
INSERT INTO abandoned_blobs (file_url, reason)
SELECT t.file_url, 'band-owned repertoire_tabs row dropped by the song_files migration'
  FROM repertoire_tabs t
  JOIN repertoire r ON r.id = t.repertoire_id
 WHERE r.band_id IS NOT NULL
    ON CONFLICT (file_url) DO NOTHING;

-- 5. Last. ------------------------------------------------------------------
DROP TABLE repertoire_tabs;

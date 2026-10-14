-- Migration 0027 (RH-147): which of a musician's chart files for a song is the
-- primary one.
--
-- Rule: backfill = oldest; a new upload keeps the existing primary.
--
-- A primary file is a property of a (user_id, song_id) pair, like the file
-- itself: song_files has no band_id by product rule, so two band mates looking
-- at the same song may each have a different primary and neither can see or set
-- the other's.
--
-- WHICH FILE IS PRIMARY, AND WHEN
--
--   * Backfill: for every (user_id, song_id) group that already has chart
--     files, the OLDEST chart (created_at ASC, id ASC as the final tie-break)
--     becomes the primary.
--   * New upload: the first chart file for a pair becomes its primary; a later
--     upload KEEPS the existing primary and is stored non-primary
--     (createTab in src/lib/tabs.ts).
--   * Delete: removing the primary promotes the oldest remaining chart in the
--     same statement (deleteTab in src/lib/tabs.ts).
--
-- CHARTS ONLY. Audio rows (content_type 'audio/%', RH-162) share the table but
-- are never primary: the backfill skips them and the partial unique index below
-- covers chart rows only.
--
-- The invariant lives in the database: the partial unique index makes a second
-- primary for one pair impossible, even under concurrent writes.

ALTER TABLE song_files
    ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

UPDATE song_files f
SET is_primary = true
FROM (
    SELECT DISTINCT ON (user_id, song_id) id
    FROM song_files
    WHERE content_type NOT LIKE 'audio/%'
    ORDER BY user_id, song_id, created_at ASC, id ASC
) oldest
WHERE f.id = oldest.id
  -- Idempotent: a group that already has a primary keeps it.
  AND NOT EXISTS (
      SELECT 1 FROM song_files p
      WHERE p.user_id = f.user_id AND p.song_id = f.song_id AND p.is_primary
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_song_files_primary
    ON song_files (user_id, song_id)
    WHERE is_primary AND content_type NOT LIKE 'audio/%';

COMMENT ON COLUMN song_files.is_primary IS
    'True for the one chart file a musician has designated as primary for this song. At most one per (user_id, song_id), enforced by uq_song_files_primary. Personal like the file: never shared with band mates. Never true on an audio row. The first chart uploaded for a song is primary; later uploads keep the existing primary.';

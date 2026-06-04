-- Align remote schema with local migration design
--
-- Remote DB was bootstrapped manually and differed from the migration files in
-- several ways. This migration brings remote in sync. On a fresh local DB the
-- IF EXISTS / IF NOT EXISTS guards make all statements idempotent no-ops.

-- ──────────────────────────────────────────────
-- 1. Rename user_repertoire → repertoire
-- ──────────────────────────────────────────────
ALTER TABLE IF EXISTS user_repertoire RENAME TO repertoire;

-- ──────────────────────────────────────────────
-- 2. repertoire: add band_id + make user_id nullable
--    (remote table was personal-only; local design supports band repertoire)
-- ──────────────────────────────────────────────
ALTER TABLE IF EXISTS repertoire
  ADD COLUMN IF NOT EXISTS band_id uuid REFERENCES bands(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS repertoire
  ALTER COLUMN user_id DROP NOT NULL;

-- Drop old unique constraint (referenced by index of same name)
ALTER TABLE IF EXISTS repertoire
  DROP CONSTRAINT IF EXISTS uq_user_song;

CREATE UNIQUE INDEX IF NOT EXISTS uq_repertoire_user_song
  ON repertoire (user_id, song_id) WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_repertoire_band_song
  ON repertoire (band_id, song_id) WHERE band_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_repertoire_band_id ON repertoire (band_id);

ALTER TABLE IF EXISTS repertoire
  DROP CONSTRAINT IF EXISTS check_repertoire_owner_exclusive;

ALTER TABLE IF EXISTS repertoire
  ADD CONSTRAINT check_repertoire_owner_exclusive CHECK (
    (user_id IS NOT NULL AND band_id IS NULL) OR
    (user_id IS NULL     AND band_id IS NOT NULL)
  );

-- ──────────────────────────────────────────────
-- 3. playlists: make user_id nullable + re-FK → profiles
--    (remote had user_id NOT NULL FK → auth.users; band playlists have no owner)
-- ──────────────────────────────────────────────
ALTER TABLE IF EXISTS playlists
  DROP CONSTRAINT IF EXISTS playlists_user_id_fkey;

ALTER TABLE IF EXISTS playlists
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE IF EXISTS playlists
  ADD CONSTRAINT playlists_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- Clear user_id for any existing band playlists
UPDATE playlists SET user_id = NULL WHERE band_id IS NOT NULL AND user_id IS NOT NULL;

ALTER TABLE IF EXISTS playlists
  DROP CONSTRAINT IF EXISTS check_playlist_owner_exclusive;

ALTER TABLE IF EXISTS playlists
  ADD CONSTRAINT check_playlist_owner_exclusive CHECK (
    (user_id IS NOT NULL AND band_id IS NULL) OR
    (user_id IS NULL     AND band_id IS NOT NULL)
  );

-- =============================================================================
-- Migration: 20240114000000_make_playlist_owners_mutually_exclusive
-- Description: Makes user_id and band_id on playlists mutually exclusive.
--              A playlist belongs to either a user or a band, but never both.
-- =============================================================================

-- 1. Make user_id nullable on playlists table
ALTER TABLE playlists ALTER COLUMN user_id DROP NOT NULL;

-- 2. Add constraint to enforce mutual exclusivity (either user_id or band_id is set)
ALTER TABLE playlists ADD CONSTRAINT check_playlist_owner_exclusive
  CHECK (
    (user_id IS NOT NULL AND band_id IS NULL) OR
    (user_id IS NULL AND band_id IS NOT NULL)
  );

-- 3. Replace RLS policies for playlists to align with the new mutually exclusive ownership model
DROP POLICY IF EXISTS "playlists: users can select own rows" ON playlists;
CREATE POLICY "playlists: users can select own rows" ON playlists FOR SELECT
  USING (
    (user_id = auth.uid() AND band_id IS NULL) OR
    (band_id IS NOT NULL AND band_id IN (
      SELECT bm.band_id FROM band_members bm WHERE bm.user_id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS "playlists: users can insert own rows" ON playlists;
CREATE POLICY "playlists: users can insert own rows" ON playlists FOR INSERT
  WITH CHECK (
    (user_id = auth.uid() AND band_id IS NULL) OR
    (user_id IS NULL AND band_id IS NOT NULL AND band_id IN (
      SELECT bm.band_id FROM band_members bm WHERE bm.user_id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS "playlists: users can update own rows" ON playlists;
CREATE POLICY "playlists: users can update own rows" ON playlists FOR UPDATE
  USING (
    (user_id = auth.uid() AND band_id IS NULL) OR
    (band_id IS NOT NULL AND band_id IN (
      SELECT bm.band_id FROM band_members bm WHERE bm.user_id = auth.uid() AND bm.role = 'admin'
    ))
  );

DROP POLICY IF EXISTS "playlists: users can delete own rows" ON playlists;
CREATE POLICY "playlists: users can delete own rows" ON playlists FOR DELETE
  USING (
    (user_id = auth.uid() AND band_id IS NULL) OR
    (band_id IS NOT NULL AND band_id IN (
      SELECT bm.band_id FROM band_members bm WHERE bm.user_id = auth.uid() AND bm.role = 'admin'
    ))
  );

-- 4. Replace RLS policies for playlist_songs to align with the new mutually exclusive ownership model
DROP POLICY IF EXISTS "playlist_songs: users can select own rows" ON playlist_songs;
CREATE POLICY "playlist_songs: users can select own rows" ON playlist_songs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM playlists p
    WHERE p.id = playlist_id AND (
      (p.user_id = auth.uid() AND p.band_id IS NULL) OR
      (p.band_id IS NOT NULL AND p.band_id IN (
        SELECT bm.band_id FROM band_members bm WHERE bm.user_id = auth.uid()
      ))
    )
  ));

DROP POLICY IF EXISTS "playlist_songs: users can insert own rows" ON playlist_songs;
CREATE POLICY "playlist_songs: users can insert own rows" ON playlist_songs FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM playlists p
    WHERE p.id = playlist_id AND (
      (p.user_id = auth.uid() AND p.band_id IS NULL) OR
      (p.band_id IS NOT NULL AND p.band_id IN (
        SELECT bm.band_id FROM band_members bm WHERE bm.user_id = auth.uid()
      ))
    )
  ));

DROP POLICY IF EXISTS "playlist_songs: users can delete own rows" ON playlist_songs;
CREATE POLICY "playlist_songs: users can delete own rows" ON playlist_songs FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM playlists p
    WHERE p.id = playlist_id AND (
      (p.user_id = auth.uid() AND p.band_id IS NULL) OR
      (p.band_id IS NOT NULL AND p.band_id IN (
        SELECT bm.band_id FROM band_members bm WHERE bm.user_id = auth.uid()
      ))
    )
  ));

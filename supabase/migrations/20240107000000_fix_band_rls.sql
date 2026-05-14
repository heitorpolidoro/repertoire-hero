-- =============================================================================
-- Migration: 20240107000000_fix_band_rls
-- Description: Fix infinite recursion in band_members RLS by introducing a
--              SECURITY DEFINER helper that bypasses RLS for the self-join.
-- =============================================================================

-- Helper: returns the array of band_ids the calling user belongs to.
-- SECURITY DEFINER means this runs as the function owner (bypasses RLS),
-- which breaks the recursive loop in band_members policies.
CREATE OR REPLACE FUNCTION get_my_band_ids()
RETURNS uuid[]
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(band_id), '{}') FROM band_members WHERE user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION get_my_band_ids() TO authenticated;

-- ---------------------------------------------------------------------------
-- Fix band_members SELECT policy (was causing infinite recursion)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "band_members: members can select" ON band_members;
CREATE POLICY "band_members: members can select" ON band_members FOR SELECT
  USING (band_id = ANY(get_my_band_ids()));

-- ---------------------------------------------------------------------------
-- Fix bands SELECT policy (uses get_my_band_ids for consistency)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "bands: members can select" ON bands;
CREATE POLICY "bands: members can select" ON bands FOR SELECT
  USING (id = ANY(get_my_band_ids()));

DROP POLICY IF EXISTS "bands: admins can update" ON bands;
CREATE POLICY "bands: admins can update" ON bands FOR UPDATE
  USING (
    id IN (
      SELECT band_id FROM band_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- Fix playlists policies (replace band_members subqueries with helper)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "playlists: users can select own rows" ON playlists;
CREATE POLICY "playlists: users can select own rows" ON playlists FOR SELECT
  USING (
    user_id = auth.uid() OR
    (band_id IS NOT NULL AND band_id = ANY(get_my_band_ids()))
  );

DROP POLICY IF EXISTS "playlists: users can insert own rows" ON playlists;
CREATE POLICY "playlists: users can insert own rows" ON playlists FOR INSERT
  WITH CHECK (
    user_id = auth.uid() AND
    (band_id IS NULL OR band_id = ANY(get_my_band_ids()))
  );

DROP POLICY IF EXISTS "playlists: users can update own rows" ON playlists;
CREATE POLICY "playlists: users can update own rows" ON playlists FOR UPDATE
  USING (
    user_id = auth.uid() OR
    (band_id IS NOT NULL AND band_id IN (
      SELECT band_id FROM band_members WHERE user_id = auth.uid() AND role = 'admin'
    ))
  );

DROP POLICY IF EXISTS "playlists: users can delete own rows" ON playlists;
CREATE POLICY "playlists: users can delete own rows" ON playlists FOR DELETE
  USING (
    user_id = auth.uid() OR
    (band_id IS NOT NULL AND band_id IN (
      SELECT band_id FROM band_members WHERE user_id = auth.uid() AND role = 'admin'
    ))
  );

-- ---------------------------------------------------------------------------
-- Fix playlist_songs policies (same issue via playlists join)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "playlist_songs: users can select own rows" ON playlist_songs;
CREATE POLICY "playlist_songs: users can select own rows" ON playlist_songs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM playlists p
    WHERE p.id = playlist_id AND (
      p.user_id = auth.uid() OR
      (p.band_id IS NOT NULL AND p.band_id = ANY(get_my_band_ids()))
    )
  ));

DROP POLICY IF EXISTS "playlist_songs: users can insert own rows" ON playlist_songs;
CREATE POLICY "playlist_songs: users can insert own rows" ON playlist_songs FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM playlists p
    WHERE p.id = playlist_id AND (
      p.user_id = auth.uid() OR
      (p.band_id IS NOT NULL AND p.band_id = ANY(get_my_band_ids()))
    )
  ));

DROP POLICY IF EXISTS "playlist_songs: users can delete own rows" ON playlist_songs;
CREATE POLICY "playlist_songs: users can delete own rows" ON playlist_songs FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM playlists p
    WHERE p.id = playlist_id AND (
      p.user_id = auth.uid() OR
      (p.band_id IS NOT NULL AND p.band_id = ANY(get_my_band_ids()))
    )
  ));

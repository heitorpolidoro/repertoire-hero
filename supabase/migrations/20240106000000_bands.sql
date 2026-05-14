-- =============================================================================
-- Migration: 20240106000000_bands
-- Description: Band feature — bands, band_members, band_id on playlists,
--              SECURITY DEFINER RPCs for the invite flow.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Table: bands
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bands (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  description text,
  cover_url   text,
  created_by  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invite_code text        NOT NULL UNIQUE DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bands_invite_code ON bands (invite_code);
CREATE INDEX IF NOT EXISTS idx_bands_created_by  ON bands (created_by);

ALTER TABLE bands ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Table: band_members
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS band_members (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  band_id   uuid        NOT NULL REFERENCES bands(id)      ON DELETE CASCADE,
  user_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role      text        NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(band_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_band_members_band_id ON band_members (band_id);
CREATE INDEX IF NOT EXISTS idx_band_members_user_id ON band_members (user_id);

ALTER TABLE band_members ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- bands RLS
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "bands: members can select" ON bands;
CREATE POLICY "bands: members can select" ON bands FOR SELECT
  USING (
    id IN (SELECT bm.band_id FROM band_members bm WHERE bm.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "bands: authenticated can insert" ON bands;
CREATE POLICY "bands: authenticated can insert" ON bands FOR INSERT
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "bands: admins can update" ON bands;
CREATE POLICY "bands: admins can update" ON bands FOR UPDATE
  USING (
    id IN (SELECT bm.band_id FROM band_members bm WHERE bm.user_id = auth.uid() AND bm.role = 'admin')
  );

DROP POLICY IF EXISTS "bands: creator can delete" ON bands;
CREATE POLICY "bands: creator can delete" ON bands FOR DELETE
  USING (created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- band_members RLS
-- Members of a band can see all fellow members.
-- Inserts are driven by SECURITY DEFINER RPCs; direct inserts allowed for own user.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "band_members: members can select" ON band_members;
CREATE POLICY "band_members: members can select" ON band_members FOR SELECT
  USING (
    band_id IN (SELECT bm2.band_id FROM band_members bm2 WHERE bm2.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "band_members: can insert own" ON band_members;
CREATE POLICY "band_members: can insert own" ON band_members FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "band_members: admins or self can delete" ON band_members;
CREATE POLICY "band_members: admins or self can delete" ON band_members FOR DELETE
  USING (
    user_id = auth.uid() OR
    band_id IN (
      SELECT bm2.band_id FROM band_members bm2
      WHERE bm2.user_id = auth.uid() AND bm2.role = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- playlists: add band_id column and update RLS to allow band members access
-- ---------------------------------------------------------------------------
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS band_id uuid REFERENCES bands(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_playlists_band_id ON playlists (band_id);

-- Replace all four playlists policies to include band membership checks.
DROP POLICY IF EXISTS "playlists: users can select own rows" ON playlists;
CREATE POLICY "playlists: users can select own rows" ON playlists FOR SELECT
  USING (
    user_id = auth.uid() OR
    (band_id IS NOT NULL AND band_id IN (
      SELECT bm.band_id FROM band_members bm WHERE bm.user_id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS "playlists: users can insert own rows" ON playlists;
CREATE POLICY "playlists: users can insert own rows" ON playlists FOR INSERT
  WITH CHECK (
    user_id = auth.uid() AND
    (band_id IS NULL OR band_id IN (
      SELECT bm.band_id FROM band_members bm WHERE bm.user_id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS "playlists: users can update own rows" ON playlists;
CREATE POLICY "playlists: users can update own rows" ON playlists FOR UPDATE
  USING (
    user_id = auth.uid() OR
    (band_id IS NOT NULL AND band_id IN (
      SELECT bm.band_id FROM band_members bm WHERE bm.user_id = auth.uid() AND bm.role = 'admin'
    ))
  );

DROP POLICY IF EXISTS "playlists: users can delete own rows" ON playlists;
CREATE POLICY "playlists: users can delete own rows" ON playlists FOR DELETE
  USING (
    user_id = auth.uid() OR
    (band_id IS NOT NULL AND band_id IN (
      SELECT bm.band_id FROM band_members bm WHERE bm.user_id = auth.uid() AND bm.role = 'admin'
    ))
  );

-- Replace playlist_songs policies to allow access via band membership.
DROP POLICY IF EXISTS "playlist_songs: users can select own rows" ON playlist_songs;
CREATE POLICY "playlist_songs: users can select own rows" ON playlist_songs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM playlists p
    WHERE p.id = playlist_id AND (
      p.user_id = auth.uid() OR
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
      p.user_id = auth.uid() OR
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
      p.user_id = auth.uid() OR
      (p.band_id IS NOT NULL AND p.band_id IN (
        SELECT bm.band_id FROM band_members bm WHERE bm.user_id = auth.uid()
      ))
    )
  ));

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER RPCs — bypass RLS for invite flow
-- ---------------------------------------------------------------------------

-- get_band_by_invite_code: readable by anonymous users (for the join landing page).
CREATE OR REPLACE FUNCTION get_band_by_invite_code(p_invite_code text)
RETURNS TABLE(
  id           uuid,
  name         text,
  description  text,
  cover_url    text,
  member_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    b.id,
    b.name,
    b.description,
    b.cover_url,
    COUNT(bm.id) AS member_count
  FROM bands b
  LEFT JOIN band_members bm ON bm.band_id = b.id
  WHERE b.invite_code = p_invite_code
  GROUP BY b.id, b.name, b.description, b.cover_url;
END;
$$;

-- join_band_by_invite: joins the calling authenticated user to the band.
-- Returns the band_id on success, NULL if the code is invalid.
CREATE OR REPLACE FUNCTION join_band_by_invite(p_invite_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_band_id uuid;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id INTO v_band_id FROM bands WHERE invite_code = p_invite_code;
  IF v_band_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO band_members (band_id, user_id, role)
  VALUES (v_band_id, v_user_id, 'member')
  ON CONFLICT (band_id, user_id) DO NOTHING;

  RETURN v_band_id;
END;
$$;

-- create_band: creates a band and adds the caller as admin atomically.
CREATE OR REPLACE FUNCTION create_band(
  p_name        text,
  p_description text DEFAULT NULL,
  p_cover_url   text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_band_id uuid;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO bands (name, description, cover_url, created_by)
  VALUES (p_name, p_description, p_cover_url, v_user_id)
  RETURNING id INTO v_band_id;

  INSERT INTO band_members (band_id, user_id, role)
  VALUES (v_band_id, v_user_id, 'admin');

  RETURN v_band_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_band_by_invite_code(text)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION join_band_by_invite(text)              TO authenticated;
GRANT EXECUTE ON FUNCTION create_band(text, text, text)          TO authenticated;

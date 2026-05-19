-- ---------------------------------------------------------------------------
-- Rename owner_id → contributor_id in global_songs
--
-- "owner" implies exclusivity over a shared resource. Since global_songs is
-- a community catalogue, "contributor" better reflects that the column just
-- records who first added the song — not who controls it.
-- ---------------------------------------------------------------------------

ALTER TABLE global_songs
  RENAME COLUMN owner_id TO contributor_id;

COMMENT ON COLUMN global_songs.contributor_id IS
  'The authenticated user who first contributed this song to the catalogue. '
  'May update the song metadata; does not imply exclusive ownership.';

-- Re-create policies that reference the renamed column --------------------

DROP POLICY IF EXISTS "global_songs: authenticated users can insert own rows" ON global_songs;
CREATE POLICY "global_songs: authenticated users can insert own rows"
  ON global_songs FOR INSERT
  TO authenticated
  WITH CHECK (contributor_id = auth.uid() OR contributor_id IS NULL);

DROP POLICY IF EXISTS "global_songs: owner can update own rows" ON global_songs;
CREATE POLICY "global_songs: contributor can update own rows"
  ON global_songs FOR UPDATE
  TO authenticated
  USING  (contributor_id = auth.uid())
  WITH CHECK (contributor_id = auth.uid());

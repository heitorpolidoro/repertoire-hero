-- Migration 0028 (RH-143): drop the `songs.links` column and the forward bridge.
--
-- Every link lives in `song_links` (0019 backfilled it, and the forward trigger
-- kept mirroring any later `songs.links` write). RH-137 (0020) removed the
-- reverse trigger and every production reader, and RH-138 made corrections per
-- row, so the column and the trigger that fed it from hand-written SQL have no
-- remaining purpose. The dev seed and the test fixtures write `song_links`
-- directly now.
--
-- ORDER MATTERS. The trigger is `UPDATE OF links`, so the column cannot be
-- dropped while it stands; the function goes between the two.
--
-- NO DOWN PATH. The data is in `song_links` and is not touched here; the
-- retired jsonb copy is not rebuilt. Migration 0019 is not edited: its replay
-- test builds its own throwaway schema (`legacyCatalogReplayDdl`), which keeps
-- its own `links` column.
--
-- `IF EXISTS` throughout, so a replay is safe.

DROP TRIGGER IF EXISTS mirror_song_links_on_songs_write ON songs;

DROP FUNCTION IF EXISTS mirror_song_links_from_column();

ALTER TABLE songs DROP COLUMN IF EXISTS links;

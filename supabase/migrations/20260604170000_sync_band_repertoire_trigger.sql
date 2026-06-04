-- Trigger: when a member updates their personal song status,
-- automatically sync the band repertoire status to the weakest
-- level across all members who have that song personally.
--
-- MIN() on song_status enum works natively in PostgreSQL —
-- comparison order follows the CREATE TYPE declaration:
--   unknown < learning < practicing < polishing < mastered

CREATE OR REPLACE FUNCTION sync_band_repertoire_on_member_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Only react to personal repertoire rows (user_id IS NOT NULL)
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;

  -- Skip if status didn't actually change
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  -- For every band this user belongs to that has the same song in its
  -- band repertoire, update the band status to MIN across all members.
  UPDATE repertoire band_rep
  SET status = (
    SELECT MIN(member_rep.status)
    FROM   repertoire  member_rep
    JOIN   band_members bm ON bm.user_id = member_rep.user_id
    WHERE  bm.band_id         = band_rep.band_id
      AND  member_rep.song_id = band_rep.song_id
      AND  member_rep.user_id IS NOT NULL
  )
  WHERE band_rep.band_id IN (
    SELECT band_id FROM band_members WHERE user_id = NEW.user_id
  )
  AND band_rep.song_id   = NEW.song_id
  AND band_rep.band_id   IS NOT NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_band_repertoire
  AFTER UPDATE OF status ON repertoire
  FOR EACH ROW
  EXECUTE FUNCTION sync_band_repertoire_on_member_update();

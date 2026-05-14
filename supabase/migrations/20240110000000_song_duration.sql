-- Add duration_seconds to global_songs for playlist total-time display.
ALTER TABLE global_songs
  ADD COLUMN IF NOT EXISTS duration_seconds integer;

COMMENT ON COLUMN global_songs.duration_seconds IS 'Song duration in whole seconds (e.g. 214 for 3:34). NULL means unknown.';

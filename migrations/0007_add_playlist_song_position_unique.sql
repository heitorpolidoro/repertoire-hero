-- RH-36 (F18): playlist ordering is only meaningful if positions are unique
-- within a playlist. Existing rows can already hold duplicates: positions were
-- assigned as COUNT(*) + 1 while removals never renumbered, so a delete
-- followed by an add produced a collision. Renumber every playlist to a
-- contiguous 1..n in its current order first, then add the constraint.
WITH renumbered AS (
    SELECT id, row_number() OVER (PARTITION BY playlist_id ORDER BY position, id) AS rn
    FROM playlist_songs
)
UPDATE playlist_songs ps
SET    position = r.rn
FROM   renumbered r
WHERE  ps.id = r.id
AND    ps.position <> r.rn;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_playlist_song_position') THEN
        ALTER TABLE playlist_songs
            ADD CONSTRAINT uq_playlist_song_position UNIQUE (playlist_id, position);
    END IF;
END
$$;

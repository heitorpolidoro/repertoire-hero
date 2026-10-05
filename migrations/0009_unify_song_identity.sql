-- RH-95 — one song-identity rule for the shared catalog.
--
-- The catalog carried two disagreeing deduplication rules: `createAndAddSong`
-- resolved a `global_songs` row by (title, album) while `findOrCreateGlobalSong`
-- resolved it by (title, artist), and `uq_global_songs_title_album` — a partial
-- unique index on (lower(title), lower(album)) — backed only the first of the
-- two. The rule in docs/plans/repertoire-rework.md is
-- (primary artist, sanitized title), with album out of the key. This migration
-- makes the database hold that one rule:
--
--   1. every pre-existing duplicate identity group is merged into its oldest row
--      (links unioned by URL, empty keeper columns filled, every referencing
--      table repointed at the keeper);
--   2. the old artist-less index is dropped;
--   3. `uq_global_songs_artist_title` is created on
--      (lower(btrim(artist)), lower(btrim(title))), which is what makes the rule
--      hold under concurrency.
--
-- Set-based and re-runnable: after the first pass no identity group has more
-- than one member, so `map`/`dup` below are empty and every statement is a
-- no-op.
--
-- Collision rules. A merge collapses several `song_id` values into one, and two
-- of the referencing tables carry a unique constraint on `song_id`, so a plain
-- `UPDATE ... SET song_id = keeper` would abort the migration:
--
--   * `repertoire` (uq_repertoire_user_song / uq_repertoire_band_song): one row
--     survives per (owner, keeper) — the row already pointing at the keeper when
--     there is one, else the lowest id. The losers' `repertoire_tabs` are
--     repointed at the survivor *before* the losers are deleted, so an uploaded
--     chord chart is never lost.
--   * `playlist_songs` (uq_playlist_song): the group collapses to one row per
--     (playlist_id, keeper), the one with the lowest `position`, so the song
--     keeps the earliest place it held in that playlist. Every playlist that
--     held a member of a duplicate group is then renumbered to a contiguous
--     1..n ordered by (position, id), exactly as 0007 did, so the delete leaves
--     no gap behind and `uq_playlist_song_position` still holds. The renumber
--     runs in two passes — park every row at a negative position, then flip the
--     sign — because `uq_playlist_song_position` is not deferrable and a single
--     set-based UPDATE that closes a gap can collide with a row it has not
--     reached yet.
--   * `global_song_edits` has no unique constraint on `song_id`; its rows are
--     repointed unconditionally.
--
-- The repeated `grouped`/`map`/`dup` CTE prefix is deliberate: a temp table
-- would not survive a re-execution of this file inside one transaction, which is
-- how the migration is tested.

-- ---------------------------------------------------------------------------
-- 1. The album-based index goes first: step 3 below can fill a keeper's empty
--    `album` from a duplicate, which could collide under the old index.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS uq_global_songs_title_album;

-- ---------------------------------------------------------------------------
-- 2. Union the duplicates' links into the keeper, deduplicated by URL.
-- ---------------------------------------------------------------------------
WITH grouped AS (
    SELECT id,
           first_value(id) OVER grp AS keeper_id,
           count(*) OVER (PARTITION BY lower(btrim(artist)), lower(btrim(title))) AS group_size
    FROM   global_songs
    WINDOW grp AS (PARTITION BY lower(btrim(artist)), lower(btrim(title)) ORDER BY created_at, id)
),
map AS (
    SELECT id, keeper_id FROM grouped WHERE group_size > 1
),
dup AS (
    SELECT id, keeper_id FROM map WHERE id <> keeper_id
),
candidate AS (
    SELECT d.keeper_id,
           l.link,
           row_number() OVER (PARTITION BY d.keeper_id, l.link ->> 'url'
                              ORDER BY s.created_at, s.id, l.ord) AS rn
    FROM   dup d
    JOIN   global_songs s ON s.id = d.id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.links, '[]'::jsonb)) WITH ORDINALITY AS l(link, ord)
),
appended AS (
    SELECT c.keeper_id,
           jsonb_agg(c.link ORDER BY c.link ->> 'url') AS links
    FROM   candidate c
    JOIN   global_songs k ON k.id = c.keeper_id
    WHERE  c.rn = 1
      AND  NOT EXISTS (
               SELECT 1
               FROM   jsonb_array_elements(COALESCE(k.links, '[]'::jsonb)) AS kl(link)
               WHERE  kl.link ->> 'url' = c.link ->> 'url'
           )
    GROUP BY c.keeper_id
)
UPDATE global_songs g
SET    links = COALESCE(g.links, '[]'::jsonb) || a.links
FROM   appended a
WHERE  g.id = a.keeper_id;

-- ---------------------------------------------------------------------------
-- 3. Fill the keeper's empty columns from the oldest duplicate that has a
--    value. An already-set keeper column is never overwritten — the catalog is
--    shared, and clobbering good data for everyone is worse than no merge.
-- ---------------------------------------------------------------------------
WITH grouped AS (
    SELECT id,
           first_value(id) OVER grp AS keeper_id,
           count(*) OVER (PARTITION BY lower(btrim(artist)), lower(btrim(title))) AS group_size
    FROM   global_songs
    WINDOW grp AS (PARTITION BY lower(btrim(artist)), lower(btrim(title)) ORDER BY created_at, id)
),
map AS (
    SELECT id, keeper_id FROM grouped WHERE group_size > 1
),
dup AS (
    SELECT id, keeper_id FROM map WHERE id <> keeper_id
),
donor AS (
    SELECT d.keeper_id,
           (array_agg(s.album ORDER BY s.created_at, s.id)
                FILTER (WHERE s.album IS NOT NULL AND s.album <> ''))[1] AS album,
           (array_agg(s.standard_key ORDER BY s.created_at, s.id)
                FILTER (WHERE s.standard_key IS NOT NULL AND s.standard_key <> ''))[1] AS standard_key,
           (array_agg(s.cover_url ORDER BY s.created_at, s.id)
                FILTER (WHERE s.cover_url IS NOT NULL AND s.cover_url <> ''))[1] AS cover_url,
           (array_agg(s.duration_seconds ORDER BY s.created_at, s.id)
                FILTER (WHERE s.duration_seconds IS NOT NULL))[1] AS duration_seconds
    FROM   dup d
    JOIN   global_songs s ON s.id = d.id
    GROUP BY d.keeper_id
)
UPDATE global_songs g
SET    album            = CASE WHEN g.album IS NULL OR g.album = '' THEN d.album ELSE g.album END,
       standard_key     = CASE WHEN g.standard_key IS NULL OR g.standard_key = '' THEN d.standard_key ELSE g.standard_key END,
       cover_url        = CASE WHEN g.cover_url IS NULL OR g.cover_url = '' THEN d.cover_url ELSE g.cover_url END,
       duration_seconds = COALESCE(g.duration_seconds, d.duration_seconds)
FROM   donor d
WHERE  g.id = d.keeper_id;

-- ---------------------------------------------------------------------------
-- 4. Repoint the losing repertoire rows' tabs at the surviving row. Runs before
--    the delete in step 5, which would cascade them away.
-- ---------------------------------------------------------------------------
WITH grouped AS (
    SELECT id,
           first_value(id) OVER grp AS keeper_id,
           count(*) OVER (PARTITION BY lower(btrim(artist)), lower(btrim(title))) AS group_size
    FROM   global_songs
    WINDOW grp AS (PARTITION BY lower(btrim(artist)), lower(btrim(title)) ORDER BY created_at, id)
),
map AS (
    SELECT id, keeper_id FROM grouped WHERE group_size > 1
),
targeted AS (
    SELECT r.id,
           r.user_id,
           r.band_id,
           m.keeper_id,
           row_number() OVER (PARTITION BY m.keeper_id, r.user_id, r.band_id
                              ORDER BY (r.song_id = m.keeper_id) DESC, r.id) AS rn
    FROM   repertoire r
    JOIN   map m ON m.id = r.song_id
),
winner AS (
    SELECT keeper_id, user_id, band_id, id FROM targeted WHERE rn = 1
),
loser AS (
    SELECT t.id, w.id AS winner_id
    FROM   targeted t
    JOIN   winner w
      ON   w.keeper_id = t.keeper_id
     AND   w.user_id IS NOT DISTINCT FROM t.user_id
     AND   w.band_id IS NOT DISTINCT FROM t.band_id
    WHERE  t.rn > 1
)
UPDATE repertoire_tabs rt
SET    repertoire_id = l.winner_id
FROM   loser l
WHERE  rt.repertoire_id = l.id;

-- ---------------------------------------------------------------------------
-- 5. Drop the repertoire rows that would collide on (owner, keeper).
-- ---------------------------------------------------------------------------
WITH grouped AS (
    SELECT id,
           first_value(id) OVER grp AS keeper_id,
           count(*) OVER (PARTITION BY lower(btrim(artist)), lower(btrim(title))) AS group_size
    FROM   global_songs
    WINDOW grp AS (PARTITION BY lower(btrim(artist)), lower(btrim(title)) ORDER BY created_at, id)
),
map AS (
    SELECT id, keeper_id FROM grouped WHERE group_size > 1
),
targeted AS (
    SELECT r.id,
           r.user_id,
           r.band_id,
           m.keeper_id,
           row_number() OVER (PARTITION BY m.keeper_id, r.user_id, r.band_id
                              ORDER BY (r.song_id = m.keeper_id) DESC, r.id) AS rn
    FROM   repertoire r
    JOIN   map m ON m.id = r.song_id
)
DELETE FROM repertoire r
USING  targeted t
WHERE  r.id = t.id AND t.rn > 1;

-- ---------------------------------------------------------------------------
-- 6. Repoint every surviving repertoire row at its keeper.
-- ---------------------------------------------------------------------------
WITH grouped AS (
    SELECT id,
           first_value(id) OVER grp AS keeper_id,
           count(*) OVER (PARTITION BY lower(btrim(artist)), lower(btrim(title))) AS group_size
    FROM   global_songs
    WINDOW grp AS (PARTITION BY lower(btrim(artist)), lower(btrim(title)) ORDER BY created_at, id)
),
map AS (
    SELECT id, keeper_id FROM grouped WHERE group_size > 1
),
dup AS (
    SELECT id, keeper_id FROM map WHERE id <> keeper_id
)
UPDATE repertoire r
SET    song_id = d.keeper_id
FROM   dup d
WHERE  r.song_id = d.id;

-- ---------------------------------------------------------------------------
-- 7. Pending catalog edits: no unique constraint on song_id, so repoint all.
-- ---------------------------------------------------------------------------
WITH grouped AS (
    SELECT id,
           first_value(id) OVER grp AS keeper_id,
           count(*) OVER (PARTITION BY lower(btrim(artist)), lower(btrim(title))) AS group_size
    FROM   global_songs
    WINDOW grp AS (PARTITION BY lower(btrim(artist)), lower(btrim(title)) ORDER BY created_at, id)
),
map AS (
    SELECT id, keeper_id FROM grouped WHERE group_size > 1
),
dup AS (
    SELECT id, keeper_id FROM map WHERE id <> keeper_id
)
UPDATE global_song_edits e
SET    song_id = d.keeper_id
FROM   dup d
WHERE  e.song_id = d.id;

-- ---------------------------------------------------------------------------
-- 8. Collapse each playlist's copies of a duplicate group to one row — the one
--    sitting at the lowest position.
-- ---------------------------------------------------------------------------
WITH grouped AS (
    SELECT id,
           first_value(id) OVER grp AS keeper_id,
           count(*) OVER (PARTITION BY lower(btrim(artist)), lower(btrim(title))) AS group_size
    FROM   global_songs
    WINDOW grp AS (PARTITION BY lower(btrim(artist)), lower(btrim(title)) ORDER BY created_at, id)
),
map AS (
    SELECT id, keeper_id FROM grouped WHERE group_size > 1
),
targeted AS (
    SELECT ps.id,
           row_number() OVER (PARTITION BY ps.playlist_id, m.keeper_id
                              ORDER BY ps.position, ps.id) AS rn
    FROM   playlist_songs ps
    JOIN   map m ON m.id = ps.song_id
)
DELETE FROM playlist_songs ps
USING  targeted t
WHERE  ps.id = t.id AND t.rn > 1;

-- ---------------------------------------------------------------------------
-- 9. Repoint the surviving playlist rows. Positions are untouched here: the
--    survivor already holds the lowest of the collapsed positions.
-- ---------------------------------------------------------------------------
WITH grouped AS (
    SELECT id,
           first_value(id) OVER grp AS keeper_id,
           count(*) OVER (PARTITION BY lower(btrim(artist)), lower(btrim(title))) AS group_size
    FROM   global_songs
    WINDOW grp AS (PARTITION BY lower(btrim(artist)), lower(btrim(title)) ORDER BY created_at, id)
),
map AS (
    SELECT id, keeper_id FROM grouped WHERE group_size > 1
),
dup AS (
    SELECT id, keeper_id FROM map WHERE id <> keeper_id
)
UPDATE playlist_songs ps
SET    song_id = d.keeper_id
FROM   dup d
WHERE  ps.song_id = d.id;

-- ---------------------------------------------------------------------------
-- 10. Renumber pass 1 — park every row of an affected playlist at a negative
--     position. The targets are distinct negatives and no row holds a negative
--     position, so the statement cannot collide whatever order it processes in.
-- ---------------------------------------------------------------------------
WITH grouped AS (
    SELECT id,
           first_value(id) OVER grp AS keeper_id,
           count(*) OVER (PARTITION BY lower(btrim(artist)), lower(btrim(title))) AS group_size
    FROM   global_songs
    WINDOW grp AS (PARTITION BY lower(btrim(artist)), lower(btrim(title)) ORDER BY created_at, id)
),
map AS (
    SELECT id, keeper_id FROM grouped WHERE group_size > 1
),
affected AS (
    SELECT DISTINCT ps.playlist_id
    FROM   playlist_songs ps
    JOIN   map m ON m.id = ps.song_id
),
ordered AS (
    SELECT ps.id,
           row_number() OVER (PARTITION BY ps.playlist_id ORDER BY ps.position, ps.id) AS rn
    FROM   playlist_songs ps
    JOIN   affected a ON a.playlist_id = ps.playlist_id
)
UPDATE playlist_songs ps
SET    position = -o.rn
FROM   ordered o
WHERE  ps.id = o.id;

-- ---------------------------------------------------------------------------
-- 11. Renumber pass 2 — flip the parked rows back to a contiguous 1..n. Only
--     pass 1 ever writes a negative position, so this matches exactly those
--     rows and nothing else.
-- ---------------------------------------------------------------------------
UPDATE playlist_songs
SET    position = -position
WHERE  position < 0;

-- ---------------------------------------------------------------------------
-- 12. Nothing references the duplicates any more; drop them.
-- ---------------------------------------------------------------------------
WITH grouped AS (
    SELECT id,
           first_value(id) OVER grp AS keeper_id,
           count(*) OVER (PARTITION BY lower(btrim(artist)), lower(btrim(title))) AS group_size
    FROM   global_songs
    WINDOW grp AS (PARTITION BY lower(btrim(artist)), lower(btrim(title)) ORDER BY created_at, id)
),
map AS (
    SELECT id, keeper_id FROM grouped WHERE group_size > 1
),
dup AS (
    SELECT id, keeper_id FROM map WHERE id <> keeper_id
)
DELETE FROM global_songs g
USING  dup d
WHERE  g.id = d.id;

-- ---------------------------------------------------------------------------
-- 13. The rule, enforced.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_global_songs_artist_title
    ON global_songs (lower(btrim(artist)), lower(btrim(title)));

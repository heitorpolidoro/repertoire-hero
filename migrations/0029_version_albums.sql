-- ---------------------------------------------------------------------------
-- RH-120 — a version is one recording with many releases.
--
-- `song_versions.album_id` held one album and version identity was
-- `(song_id, album_id, label)`, so one recording released on a studio album and
-- a compilation became two version rows, and a musician's hold, tags and
-- practice date split across them. This migration:
--
--   1. creates `version_albums (version_id, album_id)` and backfills one link
--      per non-null `song_versions.album_id`;
--   2. creates the recovery ledger `merged_version_rows`;
--   3. collapses versions that now share `(song_id, label)`: the survivor is the
--      one the OLD representative ordering picked (`album_type = 'album'` first,
--      earliest `albums.release_date`, earliest `created_at`, lowest `id`);
--      album links, `user_songs`, `band_songs` and `playlist_songs` follow it;
--   4. swaps the identity to `UNIQUE NULLS NOT DISTINCT (song_id, label)` and
--      drops `song_versions.album_id`.
--
-- Where re-pointing would violate `(owner, version_id)` or `(playlist_id,
-- version_id)` uniqueness the survivor's row wins; when the owner holds only
-- losers, the earliest-created row wins. Every displaced row is stored whole in
-- `merged_version_rows`, because the loser version is deleted and there is no
-- second chance. Nothing reads that table.
--
-- No down path. `catalog_suggestions` and `song_files` reference no version.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS version_albums (
    version_id uuid        NOT NULL REFERENCES song_versions(id) ON DELETE CASCADE,
    album_id   uuid        NOT NULL REFERENCES albums(id)        ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_version_albums PRIMARY KEY (version_id, album_id)
);

CREATE INDEX IF NOT EXISTS idx_version_albums_album_id ON version_albums (album_id);

COMMENT ON TABLE version_albums IS
    'Every album a song version (one recording) appears on. A version may have '
    'none: an unknown release is still a recording.';

INSERT INTO version_albums (version_id, album_id, created_at)
SELECT id, album_id, created_at
  FROM song_versions
 WHERE album_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS merged_version_rows (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_table        text        NOT NULL,
    row_json            jsonb       NOT NULL,
    loser_version_id    uuid        NOT NULL,
    survivor_version_id uuid        NOT NULL,
    reason              text        NOT NULL,
    archived_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE merged_version_rows IS
    'Recovery ledger for RH-120: every user_songs, band_songs or playlist_songs '
    'row migration 0029 displaced while merging versions that shared '
    '(song_id, label), stored whole as jsonb. The version ids are plain uuids '
    'because the loser is deleted. Nothing reads it.';

-- ---------------------------------------------------------------------------
-- Collapse plan: one row per loser. NULL labels share a window partition, which
-- is the NULLS NOT DISTINCT semantics the new identity will have.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE version_collapse ON COMMIT DROP AS
SELECT id AS loser_id, survivor_id
  FROM (
        SELECT v.id,
               first_value(v.id) OVER w AS survivor_id,
               row_number()      OVER w AS rn
          FROM song_versions v
          LEFT JOIN albums a ON a.id = v.album_id
        WINDOW w AS (
            PARTITION BY v.song_id, v.label
            ORDER BY (a.album_type = 'album') DESC NULLS LAST,
                     a.release_date ASC NULLS LAST,
                     v.created_at ASC,
                     v.id ASC)
       ) ranked
 WHERE rn > 1;

INSERT INTO version_albums (version_id, album_id, created_at)
SELECT c.survivor_id, va.album_id, va.created_at
  FROM version_albums va
  JOIN version_collapse c ON c.loser_id = va.version_id
ON CONFLICT DO NOTHING;

DO $$
DECLARE
    spec record;
BEGIN
    FOR spec IN
        SELECT * FROM (VALUES
            ('user_songs',     'user_id',     'created_at'),
            ('band_songs',     'band_id',     'created_at'),
            ('playlist_songs', 'playlist_id', 'position')
        ) AS t(tbl, owner_col, order_col)
    LOOP
        CREATE TEMP TABLE displaced (row_id uuid) ON COMMIT DROP;

        -- Rows on a survivor or a loser, ranked per (owner, surviving version):
        -- the row already on the survivor first, then the oldest.
        EXECUTE format($q$
            WITH cand AS (
                SELECT t.id,
                       t.version_id AS from_version,
                       COALESCE(c.survivor_id, t.version_id) AS target,
                       to_jsonb(t) AS row_json,
                       row_number() OVER (
                           PARTITION BY t.%2$I, COALESCE(c.survivor_id, t.version_id)
                           ORDER BY (c.loser_id IS NULL) DESC, t.%3$I ASC, t.id ASC
                       ) AS rn
                  FROM %1$I t
                  LEFT JOIN version_collapse c ON c.loser_id = t.version_id
                 WHERE c.loser_id IS NOT NULL
                    OR t.version_id IN (SELECT survivor_id FROM version_collapse)
            ), lost AS (
                INSERT INTO merged_version_rows
                    (source_table, row_json, loser_version_id, survivor_version_id, reason)
                SELECT %1$L, row_json, from_version, target, 'duplicate_after_version_merge'
                  FROM cand WHERE rn > 1
                RETURNING (row_json->>'id')::uuid AS row_id
            )
            INSERT INTO displaced SELECT row_id FROM lost
        $q$, spec.tbl, spec.owner_col, spec.order_col);

        EXECUTE format('DELETE FROM %I WHERE id IN (SELECT row_id FROM displaced)', spec.tbl);
        EXECUTE format(
            'UPDATE %I t SET version_id = c.survivor_id
               FROM version_collapse c WHERE t.version_id = c.loser_id', spec.tbl);

        IF spec.tbl = 'playlist_songs' THEN
            -- Close the position gaps the displaced entries left.
            UPDATE playlist_songs p SET position = r.rn
              FROM (SELECT id, row_number() OVER (PARTITION BY playlist_id ORDER BY position, id)::int AS rn
                      FROM playlist_songs
                     WHERE playlist_id IN (
                           SELECT (row_json->>'playlist_id')::uuid
                             FROM merged_version_rows WHERE source_table = 'playlist_songs')) r
             WHERE p.id = r.id AND p.position <> r.rn;
        END IF;

        DROP TABLE displaced;
    END LOOP;
END
$$;

DELETE FROM song_versions WHERE id IN (SELECT loser_id FROM version_collapse);

-- ---------------------------------------------------------------------------
-- Identity swap, then the column goes (its index goes with it).
-- ---------------------------------------------------------------------------
ALTER TABLE song_versions DROP CONSTRAINT uq_song_versions_identity;
ALTER TABLE song_versions
    ADD CONSTRAINT uq_song_versions_identity UNIQUE NULLS NOT DISTINCT (song_id, label);
ALTER TABLE song_versions DROP COLUMN album_id;

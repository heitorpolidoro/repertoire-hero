-- RH-113: make catalog search index-servable.
--
-- `searchSongs` filters with `title ILIKE '%q%' OR artist ILIKE '%q%'`. A
-- leading wildcard cannot use a btree; a GIN trigram index can. The btree
-- indexes idx_songs_title / idx_songs_artist are kept: catalogRename.db.test.ts
-- pins them and uq_songs_artist_title is unaffected.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_songs_title_trgm
    ON songs USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_songs_artist_trgm
    ON songs USING gin (artist gin_trgm_ops);

-- =============================================================================
-- Migration: 20240103000000_add_album
-- Description: Add album column to global_songs and enforce case-insensitive
--              deduplication when both title and album are present.
-- =============================================================================

-- Add album column
ALTER TABLE global_songs ADD COLUMN IF NOT EXISTS album text;
COMMENT ON COLUMN global_songs.album IS 'Album or release name the song belongs to.';

-- Unique constraint: same title + same album = duplicate song.
-- NULLs are treated as distinct by default in PostgreSQL UNIQUE constraints,
-- so two songs with NULL album are NOT considered duplicates — use a partial
-- unique index on lower() to enforce case-insensitive dedup only when album is set.
CREATE UNIQUE INDEX IF NOT EXISTS uq_global_songs_title_album
    ON global_songs (lower(title), lower(album))
    WHERE album IS NOT NULL AND album <> '';

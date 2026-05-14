-- =============================================================================
-- Migration: 20240102000000_add_cover_url
-- Description: Add cover_url column to global_songs for album/song cover images.
-- =============================================================================

ALTER TABLE global_songs ADD COLUMN IF NOT EXISTS cover_url text;
COMMENT ON COLUMN global_songs.cover_url IS 'URL of the album/song cover image.';

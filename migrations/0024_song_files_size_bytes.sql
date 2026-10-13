-- Migration 0024 (RH-162): record how many bytes a stored file occupies.
--
-- Written for audio rows only, so the per-user audio quota can be summed in SQL
-- without a round trip to Vercel Blob per object. PDF/image rows leave it NULL.

ALTER TABLE song_files
    ADD COLUMN IF NOT EXISTS size_bytes bigint;

COMMENT ON COLUMN song_files.size_bytes IS
    'Size in bytes of the object stored in Vercel Blob. Written for audio rows (RH-162) and summed against the per-user audio quota; NULL for PDF/image rows, which are not counted.';

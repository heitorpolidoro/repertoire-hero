ALTER TABLE playlists ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN playlists.tags IS 'User-defined tags for organizing playlists.';

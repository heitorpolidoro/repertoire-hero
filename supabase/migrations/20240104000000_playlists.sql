-- =============================================================================
-- Migration: 20240104000000_playlists
-- Description: Playlists feature — spotify_tokens, playlists, and
--              playlist_songs tables with full RLS policies.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: spotify_tokens
-- Stores Spotify OAuth tokens per user. Access token is short-lived;
-- refresh token is used to obtain new access tokens server-side.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spotify_tokens (
    user_id         uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    access_token    text        NOT NULL,
    refresh_token   text        NOT NULL,
    expires_at      timestamptz NOT NULL,
    spotify_user_id text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  spotify_tokens                 IS 'Spotify OAuth tokens per user, managed server-side.';
COMMENT ON COLUMN spotify_tokens.access_token    IS 'Short-lived Spotify access token.';
COMMENT ON COLUMN spotify_tokens.refresh_token   IS 'Long-lived token used to obtain new access tokens.';
COMMENT ON COLUMN spotify_tokens.expires_at      IS 'UTC timestamp when the access token expires.';
COMMENT ON COLUMN spotify_tokens.spotify_user_id IS 'Spotify user ID obtained after OAuth, used for API calls.';

ALTER TABLE spotify_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "spotify_tokens: users can select own row" ON spotify_tokens;
CREATE POLICY "spotify_tokens: users can select own row"
    ON spotify_tokens FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "spotify_tokens: users can insert own row" ON spotify_tokens;
CREATE POLICY "spotify_tokens: users can insert own row"
    ON spotify_tokens FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "spotify_tokens: users can update own row" ON spotify_tokens;
CREATE POLICY "spotify_tokens: users can update own row"
    ON spotify_tokens FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "spotify_tokens: users can delete own row" ON spotify_tokens;
CREATE POLICY "spotify_tokens: users can delete own row"
    ON spotify_tokens FOR DELETE USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Table: playlists
-- A user-owned, optionally Spotify-synced, ordered collection of songs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS playlists (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name                text        NOT NULL,
    description         text,
    cover_url           text,
    spotify_playlist_id text,          -- null for local-only playlists
    sync_with_spotify   boolean     NOT NULL DEFAULT false,
    last_synced_at      timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  playlists                       IS 'User-owned playlists, optionally linked to a Spotify playlist.';
COMMENT ON COLUMN playlists.spotify_playlist_id   IS 'Spotify playlist ID. NULL for playlists that have no Spotify counterpart.';
COMMENT ON COLUMN playlists.sync_with_spotify     IS 'When true, changes to this playlist are pushed to Spotify on save.';
COMMENT ON COLUMN playlists.last_synced_at        IS 'Timestamp of the last successful two-way Spotify sync.';

CREATE INDEX IF NOT EXISTS idx_playlists_user_id ON playlists (user_id);

ALTER TABLE playlists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "playlists: users can select own rows" ON playlists;
CREATE POLICY "playlists: users can select own rows"
    ON playlists FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "playlists: users can insert own rows" ON playlists;
CREATE POLICY "playlists: users can insert own rows"
    ON playlists FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "playlists: users can update own rows" ON playlists;
CREATE POLICY "playlists: users can update own rows"
    ON playlists FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "playlists: users can delete own rows" ON playlists;
CREATE POLICY "playlists: users can delete own rows"
    ON playlists FOR DELETE USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Table: playlist_songs
-- Junction table linking playlists to global_songs with ordering support.
-- Access is governed by playlist ownership — no direct uid check needed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS playlist_songs (
    id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id uuid    NOT NULL REFERENCES playlists(id)     ON DELETE CASCADE,
    song_id     uuid    NOT NULL REFERENCES global_songs(id)  ON DELETE CASCADE,
    position    integer NOT NULL DEFAULT 0,
    CONSTRAINT uq_playlist_song UNIQUE (playlist_id, song_id)
);

COMMENT ON TABLE  playlist_songs              IS 'Ordered mapping of songs to playlists.';
COMMENT ON COLUMN playlist_songs.position     IS 'Zero-based display order within the playlist. Lower value = earlier position.';

CREATE INDEX IF NOT EXISTS idx_playlist_songs_playlist_id ON playlist_songs (playlist_id);

ALTER TABLE playlist_songs ENABLE ROW LEVEL SECURITY;

-- Access is derived from playlist ownership; the subquery is the authoritative check.
DROP POLICY IF EXISTS "playlist_songs: users can select own rows" ON playlist_songs;
CREATE POLICY "playlist_songs: users can select own rows"
    ON playlist_songs FOR SELECT
    USING (EXISTS (SELECT 1 FROM playlists p WHERE p.id = playlist_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS "playlist_songs: users can insert own rows" ON playlist_songs;
CREATE POLICY "playlist_songs: users can insert own rows"
    ON playlist_songs FOR INSERT
    WITH CHECK (EXISTS (SELECT 1 FROM playlists p WHERE p.id = playlist_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS "playlist_songs: users can delete own rows" ON playlist_songs;
CREATE POLICY "playlist_songs: users can delete own rows"
    ON playlist_songs FOR DELETE
    USING (EXISTS (SELECT 1 FROM playlists p WHERE p.id = playlist_id AND p.user_id = auth.uid()));

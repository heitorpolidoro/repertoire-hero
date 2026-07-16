-- =============================================================================
-- Migration: 0001_initial_schema
-- Description: Consolidated schema for Repertoire Hero.
--              No RLS or Supabase-specific dependencies.
--              Auth managed via Better Auth tables in public schema.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Enum: song_status
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'song_status') THEN
        CREATE TYPE song_status AS ENUM (
            'unknown', 'learning', 'practicing', 'polishing', 'mastered'
        );
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Better Auth tables
-- "user".id is uuid so it matches the uuid columns in the app tables.
-- session/account own IDs remain text (Better Auth internal).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "user" (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text        NOT NULL,
    email           text        NOT NULL UNIQUE,
    "emailVerified" boolean     NOT NULL DEFAULT false,
    image           text,
    "createdAt"     timestamptz NOT NULL DEFAULT now(),
    "updatedAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "session" (
    id           text        PRIMARY KEY,
    "expiresAt"  timestamptz NOT NULL,
    token        text        NOT NULL UNIQUE,
    "createdAt"  timestamptz NOT NULL DEFAULT now(),
    "updatedAt"  timestamptz NOT NULL DEFAULT now(),
    "ipAddress"  text,
    "userAgent"  text,
    "userId"     uuid        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "account" (
    id                      text        PRIMARY KEY,
    "accountId"             text        NOT NULL,
    "providerId"            text        NOT NULL,
    "userId"                uuid        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    "accessToken"           text,
    "refreshToken"          text,
    "idToken"               text,
    "accessTokenExpiresAt"  timestamptz,
    "refreshTokenExpiresAt" timestamptz,
    scope                   text,
    password                text,
    "createdAt"             timestamptz NOT NULL DEFAULT now(),
    "updatedAt"             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "verification" (
    id          text        PRIMARY KEY,
    identifier  text        NOT NULL,
    value       text        NOT NULL,
    "expiresAt" timestamptz NOT NULL,
    "createdAt" timestamptz,
    "updatedAt" timestamptz
);

-- ---------------------------------------------------------------------------
-- Table: profiles
-- Application-level user data. id mirrors "user".id (Better Auth).
-- Auto-created by auth.ts databaseHook on user signup.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
    id                  uuid    PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
    email               text    NOT NULL,
    full_name           text,
    avatar_url          text,
    instruments         text[]  NOT NULL DEFAULT '{}',
    primary_instrument  text
);

-- ---------------------------------------------------------------------------
-- Table: global_songs
-- Collaborative wiki catalog. contributor_id is informational.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS global_songs (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    contributor_id    uuid        REFERENCES profiles(id) ON DELETE SET NULL,
    title             text        NOT NULL,
    artist            text        NOT NULL,
    album             text,
    standard_key      text,
    cover_url         text,
    duration_seconds  integer,
    links             jsonb       NOT NULL DEFAULT '[]'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN global_songs.contributor_id IS 'User who contributed the song. Does not imply exclusive ownership.';
COMMENT ON COLUMN global_songs.links          IS 'Array of {label, url}. Chords, tabs, videos, etc.';

CREATE INDEX IF NOT EXISTS idx_global_songs_title  ON global_songs (title);
CREATE INDEX IF NOT EXISTS idx_global_songs_artist ON global_songs (artist);
CREATE UNIQUE INDEX IF NOT EXISTS uq_global_songs_title_album
    ON global_songs (lower(title), lower(album))
    WHERE album IS NOT NULL AND album <> '';

-- ---------------------------------------------------------------------------
-- Table: spotify_tokens
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spotify_tokens (
    user_id         uuid        PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    access_token    text        NOT NULL,
    refresh_token   text        NOT NULL,
    expires_at      timestamptz NOT NULL,
    spotify_user_id text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Table: bands
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bands (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL,
    description text,
    cover_url   text,
    invite_code text        NOT NULL UNIQUE DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bands_invite_code ON bands (invite_code);

-- ---------------------------------------------------------------------------
-- Table: band_members
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS band_members (
    id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    band_id   uuid        NOT NULL REFERENCES bands(id)    ON DELETE CASCADE,
    user_id   uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role      text        NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    joined_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (band_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_band_members_band_id ON band_members (band_id);
CREATE INDEX IF NOT EXISTS idx_band_members_user_id ON band_members (user_id);

-- ---------------------------------------------------------------------------
-- Stored Procedures for invite/creation flow
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_band_by_invite_code(p_invite_code text)
RETURNS TABLE(id uuid, name text, description text, cover_url text, member_count bigint)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT b.id, b.name, b.description, b.cover_url, COUNT(bm.id)
    FROM bands b LEFT JOIN band_members bm ON bm.band_id = b.id
    WHERE b.invite_code = p_invite_code
    GROUP BY b.id, b.name, b.description, b.cover_url;
END;
$$;

CREATE OR REPLACE FUNCTION create_band(
    p_name        text,
    p_description text DEFAULT NULL,
    p_cover_url   text DEFAULT NULL,
    p_user_id     uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_band_id uuid;
BEGIN
    IF p_user_id IS NULL THEN RAISE EXCEPTION 'p_user_id is required'; END IF;
    INSERT INTO bands (name, description, cover_url)
    VALUES (p_name, p_description, p_cover_url)
    RETURNING id INTO v_band_id;
    INSERT INTO band_members (band_id, user_id, role) VALUES (v_band_id, p_user_id, 'admin');
    RETURN v_band_id;
END;
$$;

CREATE OR REPLACE FUNCTION join_band_by_invite(
    p_invite_code text,
    p_user_id     uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_band_id uuid;
BEGIN
    IF p_user_id IS NULL THEN RAISE EXCEPTION 'p_user_id is required'; END IF;
    SELECT id INTO v_band_id FROM bands WHERE invite_code = p_invite_code;
    IF v_band_id IS NULL THEN RETURN NULL; END IF;
    INSERT INTO band_members (band_id, user_id, role)
    VALUES (v_band_id, p_user_id, 'member')
    ON CONFLICT (band_id, user_id) DO NOTHING;
    RETURN v_band_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Table: repertoire
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repertoire (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid        REFERENCES profiles(id) ON DELETE CASCADE,
    band_id        uuid        REFERENCES bands(id)    ON DELETE CASCADE,
    song_id        uuid        NOT NULL REFERENCES global_songs(id) ON DELETE CASCADE,
    personal_key   text,
    status         song_status NOT NULL DEFAULT 'unknown',
    tags           text[]      NOT NULL DEFAULT '{}',
    last_practiced timestamptz,
    CONSTRAINT check_repertoire_owner_exclusive CHECK (
        (user_id IS NOT NULL AND band_id IS NULL) OR
        (user_id IS NULL     AND band_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_repertoire_user_song ON repertoire (user_id, song_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_repertoire_band_song ON repertoire (band_id, song_id) WHERE band_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_repertoire_user_id ON repertoire (user_id);
CREATE INDEX IF NOT EXISTS idx_repertoire_band_id ON repertoire (band_id);
CREATE INDEX IF NOT EXISTS idx_repertoire_song_id ON repertoire (song_id);

-- ---------------------------------------------------------------------------
-- Table: playlists
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS playlists (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid        REFERENCES profiles(id) ON DELETE CASCADE,
    band_id             uuid        REFERENCES bands(id)    ON DELETE CASCADE,
    name                text        NOT NULL,
    description         text,
    cover_url           text,
    spotify_playlist_id text,
    sync_with_spotify   boolean     NOT NULL DEFAULT false,
    last_synced_at      timestamptz,
    tags                text[]      NOT NULL DEFAULT '{}',
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT check_playlist_owner_exclusive CHECK (
        (user_id IS NOT NULL AND band_id IS NULL) OR
        (user_id IS NULL     AND band_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_playlists_user_id ON playlists (user_id);
CREATE INDEX IF NOT EXISTS idx_playlists_band_id ON playlists (band_id);

-- ---------------------------------------------------------------------------
-- Table: playlist_songs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS playlist_songs (
    id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id uuid    NOT NULL REFERENCES playlists(id)    ON DELETE CASCADE,
    song_id     uuid    NOT NULL REFERENCES global_songs(id) ON DELETE CASCADE,
    position    integer NOT NULL DEFAULT 0,
    CONSTRAINT uq_playlist_song UNIQUE (playlist_id, song_id)
);

CREATE INDEX IF NOT EXISTS idx_playlist_songs_playlist_id ON playlist_songs (playlist_id);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_band_repertoire_on_member_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Only react to personal repertoire rows (user_id IS NOT NULL)
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;

  -- Skip if status didn't actually change
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  -- For every band this user belongs to that has the same song in its
  -- band repertoire, update the band status to MIN across all members.
  UPDATE repertoire band_rep
  SET status = (
    SELECT MIN(member_rep.status)
    FROM   repertoire  member_rep
    JOIN   band_members bm ON bm.user_id = member_rep.user_id
    WHERE  bm.band_id         = band_rep.band_id
      AND  member_rep.song_id = band_rep.song_id
      AND  member_rep.user_id IS NOT NULL
  )
  WHERE band_rep.band_id IN (
    SELECT band_id FROM band_members WHERE user_id = NEW.user_id
  )
  AND band_rep.song_id   = NEW.song_id
  AND band_rep.band_id   IS NOT NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_sync_band_repertoire
  AFTER UPDATE OF status ON repertoire
  FOR EACH ROW
  EXECUTE FUNCTION sync_band_repertoire_on_member_update();

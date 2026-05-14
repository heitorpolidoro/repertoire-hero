-- =============================================================================
-- Migration: 20240101000000_initial_schema
-- Description: Initial schema for Repertoire Hero — profiles, global_songs,
--              user_repertoire, RLS policies, and supporting indexes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Enum: song_status
-- Represents the 5-level mastery scale for a song in a user's repertoire.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'song_status') THEN
        CREATE TYPE song_status AS ENUM (
            'unknown',    -- Don't know it yet
            'learning',   -- Just started
            'practicing', -- Developing fluency
            'polishing',  -- Almost ready / fine-tuning
            'mastered'    -- Fully mastered
        );
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Table: profiles
-- One row per authenticated user. Mirrors auth.users for application-level
-- data access without leaking the auth schema to the client.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
    id        uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email     text        NOT NULL,
    full_name text
);

COMMENT ON TABLE  profiles           IS 'Application-level user profiles mirroring auth.users.';
COMMENT ON COLUMN profiles.id        IS 'Foreign key to auth.users. Matches the JWT sub claim.';
COMMENT ON COLUMN profiles.email     IS 'User email address, copied from auth.users at signup.';
COMMENT ON COLUMN profiles.full_name IS 'Display name, optional at signup.';

-- ---------------------------------------------------------------------------
-- Function + Trigger: auto-create profile on new auth user
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name)
    VALUES (
        NEW.id,
        NEW.email,
        NEW.raw_user_meta_data ->> 'full_name'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

-- Drop the trigger first so this migration is safely re-runnable.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ---------------------------------------------------------------------------
-- Table: global_songs
-- Shared, curated catalogue of songs. Any authenticated user can read.
-- The user who first created a song (owner_id) may update it. Deletes are
-- restricted to service-role / admin operations to prevent catalogue pollution.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS global_songs (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    title        text        NOT NULL,
    artist       text        NOT NULL,
    standard_key text,
    links        jsonb       NOT NULL DEFAULT '[]'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  global_songs              IS 'Shared song catalogue visible to all authenticated users.';
COMMENT ON COLUMN global_songs.owner_id     IS 'The authenticated user who created this song. May update but not delete via client.';
COMMENT ON COLUMN global_songs.standard_key IS 'The canonical key of the song (e.g., "Am", "G", "Bb").';
COMMENT ON COLUMN global_songs.links        IS 'Array of URL objects: [{label, url}]. Stores chord sheets, tabs, videos, etc.';

-- ---------------------------------------------------------------------------
-- Table: user_repertoire
-- Each user's personal collection, linking them to global_songs with
-- per-user overrides (personal key, status, tags, last practice date).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_repertoire (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid        NOT NULL REFERENCES profiles(id)     ON DELETE CASCADE,
    song_id        uuid        NOT NULL REFERENCES global_songs(id) ON DELETE CASCADE,
    personal_key   text,
    status         song_status NOT NULL DEFAULT 'unknown',
    tags           text[]      NOT NULL DEFAULT '{}',
    last_practiced timestamptz,
    CONSTRAINT uq_user_song UNIQUE (user_id, song_id)
);

COMMENT ON TABLE  user_repertoire                 IS 'Per-user song collection with individual progress tracking.';
COMMENT ON COLUMN user_repertoire.personal_key    IS 'User-preferred key, overrides standard_key when set.';
COMMENT ON COLUMN user_repertoire.status          IS 'Mastery level for this user. Drives progress visualization.';
COMMENT ON COLUMN user_repertoire.tags            IS 'Flexible tags, e.g., ["jazz", "setlist-2025"].';
COMMENT ON COLUMN user_repertoire.last_practiced  IS 'Timestamp of the most recent practice session.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_user_repertoire_user_id
    ON user_repertoire (user_id);

CREATE INDEX IF NOT EXISTS idx_user_repertoire_song_id
    ON user_repertoire (song_id);

CREATE INDEX IF NOT EXISTS idx_global_songs_title
    ON global_songs (title);

CREATE INDEX IF NOT EXISTS idx_global_songs_artist
    ON global_songs (artist);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

-- profiles ---------------------------------------------------------------
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile.
DROP POLICY IF EXISTS "profiles: users can select own row" ON profiles;
CREATE POLICY "profiles: users can select own row"
    ON profiles FOR SELECT
    USING (id = auth.uid());

-- Users can update their own profile (but cannot change id or email directly).
DROP POLICY IF EXISTS "profiles: users can update own row" ON profiles;
CREATE POLICY "profiles: users can update own row"
    ON profiles FOR UPDATE
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- The handle_new_user trigger runs as SECURITY DEFINER and bypasses RLS for
-- the initial INSERT, so no INSERT policy is needed on profiles for normal flow.

-- global_songs -----------------------------------------------------------
ALTER TABLE global_songs ENABLE ROW LEVEL SECURITY;

-- All authenticated users can browse the song catalogue.
DROP POLICY IF EXISTS "global_songs: authenticated users can select" ON global_songs;
CREATE POLICY "global_songs: authenticated users can select"
    ON global_songs FOR SELECT
    TO authenticated
    USING (true);

-- Any authenticated user may contribute a new song, but owner_id must be
-- set to their own uid. This prevents a user from inserting a row that
-- claims a different owner.
DROP POLICY IF EXISTS "global_songs: authenticated users can insert own rows" ON global_songs;
CREATE POLICY "global_songs: authenticated users can insert own rows"
    ON global_songs FOR INSERT
    TO authenticated
    WITH CHECK (owner_id = auth.uid());

-- Only the original creator may edit a song's metadata.
-- Service-role operations (migrations, admin) bypass RLS entirely.
DROP POLICY IF EXISTS "global_songs: owner can update own rows" ON global_songs;
CREATE POLICY "global_songs: owner can update own rows"
    ON global_songs FOR UPDATE
    TO authenticated
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- DELETE is intentionally not exposed to regular users to prevent catalogue
-- pollution / accidental loss of shared data. Use the Supabase service key
-- for admin deletions.

-- user_repertoire --------------------------------------------------------
ALTER TABLE user_repertoire ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_repertoire: users can select own rows" ON user_repertoire;
CREATE POLICY "user_repertoire: users can select own rows"
    ON user_repertoire FOR SELECT
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_repertoire: users can insert own rows" ON user_repertoire;
CREATE POLICY "user_repertoire: users can insert own rows"
    ON user_repertoire FOR INSERT
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_repertoire: users can update own rows" ON user_repertoire;
CREATE POLICY "user_repertoire: users can update own rows"
    ON user_repertoire FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_repertoire: users can delete own rows" ON user_repertoire;
CREATE POLICY "user_repertoire: users can delete own rows"
    ON user_repertoire FOR DELETE
    USING (user_id = auth.uid());

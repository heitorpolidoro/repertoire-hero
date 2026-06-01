-- =============================================================================
-- Migration: 20260601000000_initial_schema
-- Description: Schema consolidado do Repertoire Hero — estado final limpo.
--              Incorpora todas as migrações anteriores + generalização do
--              repertório (user_id | band_id mutuamente exclusivos).
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
            'unknown',
            'learning',
            'practicing',
            'polishing',
            'mastered'
        );
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Table: profiles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
    id                  uuid  PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email               text  NOT NULL,
    full_name           text,
    avatar_url          text,
    instruments         text[]  NOT NULL DEFAULT '{}',
    primary_instrument  text
);

COMMENT ON TABLE  profiles IS 'Application-level user profiles mirroring auth.users.';

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, instruments, primary_instrument)
    VALUES (
        NEW.id,
        NEW.email,
        NEW.raw_user_meta_data ->> 'full_name',
        COALESCE(
            ARRAY(SELECT jsonb_array_elements_text(NEW.raw_user_meta_data -> 'instruments')),
            '{}'
        ),
        NEW.raw_user_meta_data ->> 'primary_instrument'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles: users can select own row" ON profiles;
CREATE POLICY "profiles: users can select own row"
    ON profiles FOR SELECT
    USING (id = auth.uid());

DROP POLICY IF EXISTS "profiles: users can update own row" ON profiles;
CREATE POLICY "profiles: users can update own row"
    ON profiles FOR UPDATE
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- ---------------------------------------------------------------------------
-- Table: global_songs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS global_songs (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    contributor_id    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    title             text        NOT NULL,
    artist            text        NOT NULL,
    album             text,
    standard_key      text,
    cover_url         text,
    duration_seconds  integer,
    links             jsonb       NOT NULL DEFAULT '[]'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN global_songs.contributor_id IS 'Usuário que contribuiu a música ao catálogo. Pode atualizar, não implica posse exclusiva.';
COMMENT ON COLUMN global_songs.links          IS 'Array de {label, url}. Cifras, tabs, vídeos, etc.';

CREATE INDEX IF NOT EXISTS idx_global_songs_title  ON global_songs (title);
CREATE INDEX IF NOT EXISTS idx_global_songs_artist ON global_songs (artist);

CREATE UNIQUE INDEX IF NOT EXISTS uq_global_songs_title_album
    ON global_songs (lower(title), lower(album))
    WHERE album IS NOT NULL AND album <> '';

ALTER TABLE global_songs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "global_songs: authenticated users can select" ON global_songs;
CREATE POLICY "global_songs: authenticated users can select"
    ON global_songs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "global_songs: authenticated users can insert own rows" ON global_songs;
CREATE POLICY "global_songs: authenticated users can insert own rows"
    ON global_songs FOR INSERT TO authenticated
    WITH CHECK (contributor_id = auth.uid() OR contributor_id IS NULL);

DROP POLICY IF EXISTS "global_songs: contributor can update own rows" ON global_songs;
CREATE POLICY "global_songs: contributor can update own rows"
    ON global_songs FOR UPDATE TO authenticated
    USING (contributor_id = auth.uid())
    WITH CHECK (contributor_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Table: spotify_tokens
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
-- Table: bands
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bands (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL,
    description text,
    cover_url   text,
    created_by  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    invite_code text        NOT NULL UNIQUE DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bands_invite_code ON bands (invite_code);
CREATE INDEX IF NOT EXISTS idx_bands_created_by  ON bands (created_by);

ALTER TABLE bands ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Table: band_members
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS band_members (
    id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    band_id   uuid        NOT NULL REFERENCES bands(id)           ON DELETE CASCADE,
    user_id   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role      text        NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    joined_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(band_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_band_members_band_id ON band_members (band_id);
CREATE INDEX IF NOT EXISTS idx_band_members_user_id ON band_members (user_id);

ALTER TABLE band_members ENABLE ROW LEVEL SECURITY;

-- Helper anti-recursão para RLS de band_members
CREATE OR REPLACE FUNCTION get_my_band_ids()
RETURNS uuid[]
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(band_id), '{}') FROM band_members WHERE user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION get_my_band_ids() TO authenticated;

-- profiles: co-membros podem ler perfis um do outro
DROP POLICY IF EXISTS "profiles: band members can read co-member profiles" ON profiles;
CREATE POLICY "profiles: band members can read co-member profiles"
    ON profiles FOR SELECT
    USING (
      id = ANY(
        SELECT user_id FROM band_members
        WHERE band_id = ANY(get_my_band_ids())
      )
    );

-- bands RLS
DROP POLICY IF EXISTS "bands: members can select" ON bands;
CREATE POLICY "bands: members can select" ON bands FOR SELECT
    USING (id = ANY(get_my_band_ids()));

DROP POLICY IF EXISTS "bands: authenticated can insert" ON bands;
CREATE POLICY "bands: authenticated can insert" ON bands FOR INSERT
    WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "bands: admins can update" ON bands;
CREATE POLICY "bands: admins can update" ON bands FOR UPDATE
    USING (id IN (SELECT band_id FROM band_members WHERE user_id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "bands: creator can delete" ON bands;
CREATE POLICY "bands: creator can delete" ON bands FOR DELETE
    USING (created_by = auth.uid());

-- band_members RLS
DROP POLICY IF EXISTS "band_members: members can select" ON band_members;
CREATE POLICY "band_members: members can select" ON band_members FOR SELECT
    USING (band_id = ANY(get_my_band_ids()));

DROP POLICY IF EXISTS "band_members: can insert own" ON band_members;
CREATE POLICY "band_members: can insert own" ON band_members FOR INSERT
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "band_members: admins or self can delete" ON band_members;
CREATE POLICY "band_members: admins or self can delete" ON band_members FOR DELETE
    USING (
        user_id = auth.uid() OR
        band_id IN (SELECT band_id FROM band_members WHERE user_id = auth.uid() AND role = 'admin')
    );

-- RPCs SECURITY DEFINER para o fluxo de convite
CREATE OR REPLACE FUNCTION get_band_by_invite_code(p_invite_code text)
RETURNS TABLE(id uuid, name text, description text, cover_url text, member_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT b.id, b.name, b.description, b.cover_url, COUNT(bm.id)
  FROM bands b
  LEFT JOIN band_members bm ON bm.band_id = b.id
  WHERE b.invite_code = p_invite_code
  GROUP BY b.id, b.name, b.description, b.cover_url;
END;
$$;

CREATE OR REPLACE FUNCTION join_band_by_invite(p_invite_code text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_band_id uuid; v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id INTO v_band_id FROM bands WHERE invite_code = p_invite_code;
  IF v_band_id IS NULL THEN RETURN NULL; END IF;
  INSERT INTO band_members (band_id, user_id, role)
  VALUES (v_band_id, v_user_id, 'member')
  ON CONFLICT (band_id, user_id) DO NOTHING;
  RETURN v_band_id;
END;
$$;

CREATE OR REPLACE FUNCTION create_band(p_name text, p_description text DEFAULT NULL, p_cover_url text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_band_id uuid; v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  INSERT INTO bands (name, description, cover_url, created_by)
  VALUES (p_name, p_description, p_cover_url, v_user_id)
  RETURNING id INTO v_band_id;
  INSERT INTO band_members (band_id, user_id, role) VALUES (v_band_id, v_user_id, 'admin');
  RETURN v_band_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_band_by_invite_code(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION join_band_by_invite(text)      TO authenticated;
GRANT EXECUTE ON FUNCTION create_band(text, text, text)  TO authenticated;

-- ---------------------------------------------------------------------------
-- Table: repertoire
-- Coleção pessoal (user_id) ou de banda (band_id) de músicas com tracking
-- de domínio individual. user_id e band_id são mutuamente exclusivos.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repertoire (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid        REFERENCES profiles(id)      ON DELETE CASCADE,
    band_id        uuid        REFERENCES bands(id)         ON DELETE CASCADE,
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

COMMENT ON TABLE  repertoire               IS 'Repertório pessoal ou de banda — uma entrada por música por dono.';
COMMENT ON COLUMN repertoire.user_id       IS 'Dono pessoal. Mutuamente exclusivo com band_id.';
COMMENT ON COLUMN repertoire.band_id       IS 'Dono banda. Mutuamente exclusivo com user_id.';
COMMENT ON COLUMN repertoire.personal_key  IS 'Tom preferido, sobrepõe standard_key quando definido.';
COMMENT ON COLUMN repertoire.status        IS 'Nível de domínio da música.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_repertoire_user_song
    ON repertoire (user_id, song_id) WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_repertoire_band_song
    ON repertoire (band_id, song_id) WHERE band_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_repertoire_user_id ON repertoire (user_id);
CREATE INDEX IF NOT EXISTS idx_repertoire_band_id ON repertoire (band_id);
CREATE INDEX IF NOT EXISTS idx_repertoire_song_id ON repertoire (song_id);

ALTER TABLE repertoire ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "repertoire: users can select own rows" ON repertoire;
CREATE POLICY "repertoire: users can select own rows" ON repertoire FOR SELECT
    USING (
        (user_id = auth.uid() AND band_id IS NULL) OR
        (band_id IS NOT NULL AND band_id = ANY(get_my_band_ids()))
    );

DROP POLICY IF EXISTS "repertoire: users can insert own rows" ON repertoire;
CREATE POLICY "repertoire: users can insert own rows" ON repertoire FOR INSERT
    WITH CHECK (
        (user_id = auth.uid() AND band_id IS NULL) OR
        (user_id IS NULL AND band_id IS NOT NULL AND band_id = ANY(get_my_band_ids()))
    );

DROP POLICY IF EXISTS "repertoire: users can update own rows" ON repertoire;
CREATE POLICY "repertoire: users can update own rows" ON repertoire FOR UPDATE
    USING (
        (user_id = auth.uid() AND band_id IS NULL) OR
        (band_id IS NOT NULL AND band_id IN (
            SELECT band_id FROM band_members WHERE user_id = auth.uid() AND role = 'admin'
        ))
    );

DROP POLICY IF EXISTS "repertoire: users can delete own rows" ON repertoire;
CREATE POLICY "repertoire: users can delete own rows" ON repertoire FOR DELETE
    USING (
        (user_id = auth.uid() AND band_id IS NULL) OR
        (band_id IS NOT NULL AND band_id IN (
            SELECT band_id FROM band_members WHERE user_id = auth.uid() AND role = 'admin'
        ))
    );

-- ---------------------------------------------------------------------------
-- Table: playlists
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS playlists (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
    band_id             uuid        REFERENCES bands(id)      ON DELETE CASCADE,
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

ALTER TABLE playlists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "playlists: users can select own rows" ON playlists;
CREATE POLICY "playlists: users can select own rows" ON playlists FOR SELECT
    USING (
        (user_id = auth.uid() AND band_id IS NULL) OR
        (band_id IS NOT NULL AND band_id IN (
            SELECT bm.band_id FROM band_members bm WHERE bm.user_id = auth.uid()
        ))
    );

DROP POLICY IF EXISTS "playlists: users can insert own rows" ON playlists;
CREATE POLICY "playlists: users can insert own rows" ON playlists FOR INSERT
    WITH CHECK (
        (user_id = auth.uid() AND band_id IS NULL) OR
        (user_id IS NULL AND band_id IS NOT NULL AND band_id IN (
            SELECT bm.band_id FROM band_members bm WHERE bm.user_id = auth.uid()
        ))
    );

DROP POLICY IF EXISTS "playlists: users can update own rows" ON playlists;
CREATE POLICY "playlists: users can update own rows" ON playlists FOR UPDATE
    USING (
        (user_id = auth.uid() AND band_id IS NULL) OR
        (band_id IS NOT NULL AND band_id IN (
            SELECT band_id FROM band_members WHERE user_id = auth.uid() AND role = 'admin'
        ))
    );

DROP POLICY IF EXISTS "playlists: users can delete own rows" ON playlists;
CREATE POLICY "playlists: users can delete own rows" ON playlists FOR DELETE
    USING (
        (user_id = auth.uid() AND band_id IS NULL) OR
        (band_id IS NOT NULL AND band_id IN (
            SELECT band_id FROM band_members WHERE user_id = auth.uid() AND role = 'admin'
        ))
    );

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

ALTER TABLE playlist_songs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "playlist_songs: users can select own rows" ON playlist_songs;
CREATE POLICY "playlist_songs: users can select own rows" ON playlist_songs FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM playlists p WHERE p.id = playlist_id AND (
            (p.user_id = auth.uid() AND p.band_id IS NULL) OR
            (p.band_id IS NOT NULL AND p.band_id IN (
                SELECT bm.band_id FROM band_members bm WHERE bm.user_id = auth.uid()
            ))
        )
    ));

DROP POLICY IF EXISTS "playlist_songs: users can insert own rows" ON playlist_songs;
CREATE POLICY "playlist_songs: users can insert own rows" ON playlist_songs FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM playlists p WHERE p.id = playlist_id AND (
            (p.user_id = auth.uid() AND p.band_id IS NULL) OR
            (p.band_id IS NOT NULL AND p.band_id IN (
                SELECT bm.band_id FROM band_members bm WHERE bm.user_id = auth.uid()
            ))
        )
    ));

DROP POLICY IF EXISTS "playlist_songs: users can delete own rows" ON playlist_songs;
CREATE POLICY "playlist_songs: users can delete own rows" ON playlist_songs FOR DELETE
    USING (EXISTS (
        SELECT 1 FROM playlists p WHERE p.id = playlist_id AND (
            (p.user_id = auth.uid() AND p.band_id IS NULL) OR
            (p.band_id IS NOT NULL AND p.band_id IN (
                SELECT bm.band_id FROM band_members bm WHERE bm.user_id = auth.uid()
            ))
        )
    ));

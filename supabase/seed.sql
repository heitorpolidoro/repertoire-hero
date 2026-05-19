-- =============================================================================
-- Seed: supabase/seed.sql
-- Description: Populates global_songs with a diverse catalogue of songs
--              spanning rock, bossa nova, samba, pop, and jazz genres.
--
-- Usage:
--   supabase db seed
--
-- Notes:
--   - This file only populates global_songs. Auth users must be created via
--     the GoTrue admin API — run: npm run dev:seed-users
--   - Running this file multiple times is safe: the ON CONFLICT clause
--     skips rows whose (title, artist) pair already exists.
--   - The `links` column stores a JSON array of {label, url} objects.
-- =============================================================================

-- =============================================================================
-- Catalogue songs
-- =============================================================================

INSERT INTO global_songs (title, artist, standard_key, links)
VALUES

    -- Rock -------------------------------------------------------------------
    (
        'Hotel California',
        'Eagles',
        'Bm',
        '[
            {"label": "Cifra Club", "url": "https://www.cifraclub.com.br/eagles/hotel-california/"},
            {"label": "YouTube (Original)", "url": "https://www.youtube.com/watch?v=BciS5grGs7Y"}
        ]'::jsonb
    ),
    (
        'Wish You Were Here',
        'Pink Floyd',
        'G',
        '[
            {"label": "Cifra Club", "url": "https://www.cifraclub.com.br/pink-floyd/wish-you-were-here/"},
            {"label": "YouTube (Original)", "url": "https://www.youtube.com/watch?v=IXdNnw99-Ic"}
        ]'::jsonb
    ),
    (
        'Come As You Are',
        'Nirvana',
        'F#m',
        '[
            {"label": "Ultimate Guitar", "url": "https://tabs.ultimate-guitar.com/tab/nirvana/come-as-you-are-tabs-17455"},
            {"label": "YouTube (Original)", "url": "https://www.youtube.com/watch?v=vabnZ9-ex7o"}
        ]'::jsonb
    ),

    -- Bossa Nova -------------------------------------------------------------
    (
        'Garota de Ipanema',
        'Tom Jobim & Vinícius de Moraes',
        'F',
        '[
            {"label": "Cifra Club", "url": "https://www.cifraclub.com.br/joao-gilberto/garota-de-ipanema/"},
            {"label": "YouTube (Original)", "url": "https://www.youtube.com/watch?v=FPkqHpBaDlI"}
        ]'::jsonb
    ),
    (
        'Corcovado',
        'Tom Jobim',
        'Dm',
        '[
            {"label": "Cifra Club", "url": "https://www.cifraclub.com.br/tom-jobim/corcovado/"},
            {"label": "YouTube (Original)", "url": "https://www.youtube.com/watch?v=8lJBFarVGiA"}
        ]'::jsonb
    ),
    (
        'Wave',
        'Tom Jobim',
        'D',
        '[
            {"label": "Cifra Club", "url": "https://www.cifraclub.com.br/tom-jobim/wave/"},
            {"label": "YouTube (Original)", "url": "https://www.youtube.com/watch?v=Pz2bfqHKH2U"}
        ]'::jsonb
    ),

    -- Samba ------------------------------------------------------------------
    (
        'Aquarela do Brasil',
        'Ary Barroso',
        'Gm',
        '[
            {"label": "Cifra Club", "url": "https://www.cifraclub.com.br/ary-barroso/aquarela-do-brasil/"},
            {"label": "YouTube (Original)", "url": "https://www.youtube.com/watch?v=BIH4Pm_5S1A"}
        ]'::jsonb
    ),
    (
        'Mas Que Nada',
        'Jorge Ben Jor',
        'Am',
        '[
            {"label": "Cifra Club", "url": "https://www.cifraclub.com.br/sergio-mendes/mas-que-nada/"},
            {"label": "YouTube (Sérgio Mendes cover)", "url": "https://www.youtube.com/watch?v=Q_0MX6VHCX4"}
        ]'::jsonb
    ),

    -- Pop --------------------------------------------------------------------
    (
        'Let It Be',
        'The Beatles',
        'C',
        '[
            {"label": "Cifra Club", "url": "https://www.cifraclub.com.br/the-beatles/let-it-be/"},
            {"label": "YouTube (Original)", "url": "https://www.youtube.com/watch?v=QDYfEBY9NM4"}
        ]'::jsonb
    ),
    (
        'Blackbird',
        'The Beatles',
        'G',
        '[
            {"label": "Ultimate Guitar", "url": "https://tabs.ultimate-guitar.com/tab/the-beatles/blackbird-tabs-65534"},
            {"label": "YouTube (Original)", "url": "https://www.youtube.com/watch?v=man9t6y4OzY"}
        ]'::jsonb
    ),

    -- Jazz -------------------------------------------------------------------
    (
        'Autumn Leaves',
        'Joseph Kosma',
        'Gm',
        '[
            {"label": "iReal Pro", "url": "https://www.irealb.com/forums/showthread.php?270-Autumn-Leaves"},
            {"label": "YouTube (Bill Evans)", "url": "https://www.youtube.com/watch?v=r-Z8KuwI7Gc"}
        ]'::jsonb
    ),
    (
        'All The Things You Are',
        'Jerome Kern',
        'Ab',
        '[
            {"label": "iReal Pro", "url": "https://www.irealb.com/forums/showthread.php?29-All-The-Things-You-Are"},
            {"label": "YouTube (Chet Baker)", "url": "https://www.youtube.com/watch?v=yZnwfKFzM8c"}
        ]'::jsonb
    )

ON CONFLICT DO NOTHING;

-- =============================================================================
-- Example user_repertoire rows (commented out — requires a real user_id)
--
-- Replace '<your-user-uuid>' with the UUID from auth.users for the target user.
-- Typical usage in local dev: run `supabase status` to get the local API URL,
-- sign up with heitor.polidoro@gmail.com, then find the UUID in auth.users.
--
-- INSERT INTO user_repertoire (user_id, song_id, status, personal_key, tags)
-- SELECT
--     '<your-user-uuid>',
--     id,
--     status_value::song_status,
--     NULL,
--     tags_array
-- FROM (VALUES
--     ('Hotel California',          'mastered',   ARRAY['rock', 'setlist']),
--     ('Garota de Ipanema',         'polishing',  ARRAY['bossa nova']),
--     ('Autumn Leaves',             'practicing', ARRAY['jazz']),
--     ('Come As You Are',           'learning',   ARRAY['rock']),
--     ('All The Things You Are',    'unknown',    ARRAY['jazz'])
-- ) AS t(song_title, status_value, tags_array)
-- JOIN global_songs gs ON gs.title = t.song_title;
-- =============================================================================

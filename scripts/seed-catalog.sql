-- =============================================================================
-- Seed catalogue: scripts/seed-catalog.sql
-- Description: Populates the `songs` catalogue and its links, spanning rock,
--              bossa nova, samba, pop, and jazz genres.
--
-- Usage:
--   Applied automatically on the first boot of the bundled compose Postgres,
--   by docker/init-migrations.sh (mounted at /seed/catalog.sql).
--   On the host it is applied by `npm run seed` (scripts/dev-seed), after that
--   script's own users/profiles/band inserts.
--
-- Notes:
--   - This file populates `songs` and their `song_links` rows. Auth users are
--     created by scripts/dev-seed — run: npm run seed
--   - Running this file multiple times is safe: the ON CONFLICT clauses skip
--     rows whose (title, artist) pair, or whose (song_id, url) pair, already
--     exists.
--   - Links are `song_links` rows (url, label, position); `position` is the
--     1-based order listed below. The `songs.links` column was dropped by
--     migration 0028 (RH-143).
-- =============================================================================

INSERT INTO songs (title, artist, standard_key)
VALUES

    -- Rock -------------------------------------------------------------------
    ('Hotel California', 'Eagles', 'Bm'),
    ('Wish You Were Here', 'Pink Floyd', 'G'),
    ('Come As You Are', 'Nirvana', 'F#m'),

    -- Bossa Nova -------------------------------------------------------------
    ('Garota de Ipanema', 'Tom Jobim & Vinícius de Moraes', 'F'),
    ('Corcovado', 'Tom Jobim', 'Dm'),
    ('Wave', 'Tom Jobim', 'D'),

    -- Samba ------------------------------------------------------------------
    ('Aquarela do Brasil', 'Ary Barroso', 'Gm'),
    ('Mas Que Nada', 'Jorge Ben Jor', 'Am'),

    -- Pop --------------------------------------------------------------------
    ('Let It Be', 'The Beatles', 'C'),
    ('Blackbird', 'The Beatles', 'G'),

    -- Jazz -------------------------------------------------------------------
    ('Autumn Leaves', 'Joseph Kosma', 'Gm'),
    ('All The Things You Are', 'Jerome Kern', 'Ab')

ON CONFLICT DO NOTHING;

-- Links, keyed by (title, artist) against the rows above. `provider` is a
-- generated column and is never named here.
INSERT INTO song_links (song_id, url, label, position)
SELECT s.id, l.url, l.label, l.position
  FROM (VALUES
    ('Hotel California', 'Eagles', 'https://www.cifraclub.com.br/eagles/hotel-california/', 'Cifra Club', 1),
    ('Hotel California', 'Eagles', 'https://www.youtube.com/watch?v=BciS5grGs7Y', 'YouTube (Original)', 2),
    ('Wish You Were Here', 'Pink Floyd', 'https://www.cifraclub.com.br/pink-floyd/wish-you-were-here/', 'Cifra Club', 1),
    ('Wish You Were Here', 'Pink Floyd', 'https://www.youtube.com/watch?v=IXdNnw99-Ic', 'YouTube (Original)', 2),
    ('Come As You Are', 'Nirvana', 'https://tabs.ultimate-guitar.com/tab/nirvana/come-as-you-are-tabs-17455', 'Ultimate Guitar', 1),
    ('Come As You Are', 'Nirvana', 'https://www.youtube.com/watch?v=vabnZ9-ex7o', 'YouTube (Original)', 2),
    ('Garota de Ipanema', 'Tom Jobim & Vinícius de Moraes', 'https://www.cifraclub.com.br/joao-gilberto/garota-de-ipanema/', 'Cifra Club', 1),
    ('Garota de Ipanema', 'Tom Jobim & Vinícius de Moraes', 'https://www.youtube.com/watch?v=FPkqHpBaDlI', 'YouTube (Original)', 2),
    ('Corcovado', 'Tom Jobim', 'https://www.cifraclub.com.br/tom-jobim/corcovado/', 'Cifra Club', 1),
    ('Corcovado', 'Tom Jobim', 'https://www.youtube.com/watch?v=8lJBFarVGiA', 'YouTube (Original)', 2),
    ('Wave', 'Tom Jobim', 'https://www.cifraclub.com.br/tom-jobim/wave/', 'Cifra Club', 1),
    ('Wave', 'Tom Jobim', 'https://www.youtube.com/watch?v=Pz2bfqHKH2U', 'YouTube (Original)', 2),
    ('Aquarela do Brasil', 'Ary Barroso', 'https://www.cifraclub.com.br/ary-barroso/aquarela-do-brasil/', 'Cifra Club', 1),
    ('Aquarela do Brasil', 'Ary Barroso', 'https://www.youtube.com/watch?v=BIH4Pm_5S1A', 'YouTube (Original)', 2),
    ('Mas Que Nada', 'Jorge Ben Jor', 'https://www.cifraclub.com.br/sergio-mendes/mas-que-nada/', 'Cifra Club', 1),
    ('Mas Que Nada', 'Jorge Ben Jor', 'https://www.youtube.com/watch?v=Q_0MX6VHCX4', 'YouTube (Sérgio Mendes cover)', 2),
    ('Let It Be', 'The Beatles', 'https://www.cifraclub.com.br/the-beatles/let-it-be/', 'Cifra Club', 1),
    ('Let It Be', 'The Beatles', 'https://www.youtube.com/watch?v=QDYfEBY9NM4', 'YouTube (Original)', 2),
    ('Blackbird', 'The Beatles', 'https://tabs.ultimate-guitar.com/tab/the-beatles/blackbird-tabs-65534', 'Ultimate Guitar', 1),
    ('Blackbird', 'The Beatles', 'https://www.youtube.com/watch?v=man9t6y4OzY', 'YouTube (Original)', 2),
    ('Autumn Leaves', 'Joseph Kosma', 'https://www.irealb.com/forums/showthread.php?270-Autumn-Leaves', 'iReal Pro', 1),
    ('Autumn Leaves', 'Joseph Kosma', 'https://www.youtube.com/watch?v=r-Z8KuwI7Gc', 'YouTube (Bill Evans)', 2),
    ('All The Things You Are', 'Jerome Kern', 'https://www.irealb.com/forums/showthread.php?29-All-The-Things-You-Are', 'iReal Pro', 1),
    ('All The Things You Are', 'Jerome Kern', 'https://www.youtube.com/watch?v=yZnwfKFzM8c', 'YouTube (Chet Baker)', 2)
  ) AS l(title, artist, url, label, position)
  JOIN songs s ON s.title = l.title AND s.artist = l.artist
ON CONFLICT (song_id, url) DO NOTHING;

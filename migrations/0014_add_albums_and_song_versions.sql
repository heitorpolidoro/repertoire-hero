-- ---------------------------------------------------------------------------
-- RH-122 — `albums` and `song_versions`, and the title splits instead of being
-- stripped.
--
-- THE PRODUCT DECISION
--
-- `"Bad - Remaster 2012"` must not be *stripped* down to `"Bad"` with the
-- remaster simply lost: a musician wants to choose between *Bad*, *Bad /
-- Remaster 2012* and *Bad / Remaster 2025*. So the title **splits** at its
-- first `" - "`. The left half is the song's identity, under the artist+title
-- unique index RH-95 installed; the right half becomes `song_versions.label`, a
-- field of its own rather than a suffix hidden inside a title. The TypeScript
-- half of that rule is `src/lib/songTitle.ts`; `song_title_head` and
-- `song_title_label` below are the SQL half, and
-- `src/lib/__tests__/catalogVersions.db.test.ts` replays the TypeScript module's
-- pinned cases against them so the two cannot drift.
--
-- THE ORDER OF THE STEPS IS LOAD-BEARING
--
-- `uq_songs_artist_title` is live when this migration starts. Rewriting two
-- rows of one artist down to the same title — `"Song X"` and
-- `"Song X - 2011 Remaster"` both becoming `"Song X"` — violates it, so the
-- `UPDATE` inside the backfill would abort. The index is therefore dropped
-- *before* `migrate_catalog_to_versions()` runs and recreated *after* it, and
-- the collapse inside that function is what makes it creatable again. No other
-- sequence works. The migration ends with `songs` carrying exactly the key
-- RH-95 installed, under the same name: this task does not change the key, it
-- changes what the titles under it look like.
--
-- WHY THE BACKFILL IS A FUNCTION, AND WHY IT IS KEPT
--
-- CI migrates a fresh, empty database, so a straight sequence of backfill and
-- collapse statements inside this file would ship untested — there would be no
-- row for them to touch. Packaging them as one idempotent function lets
-- `catalogVersions.db.test.ts` insert legacy-shaped rows and call it again,
-- asserting one album and one version per row, the collapse, the re-pointed
-- foreign keys, and that a second call changes nothing. The three functions are
-- therefore **retained on purpose after this migration runs** — they are not
-- left behind by accident, and that test is the reason they exist.
--
-- WHAT THE COLLAPSE THROWS AWAY, STATED PLAINLY
--
-- Where re-pointing a child row at the survivor would duplicate a key —
-- `(user_id, song_id)`, `(band_id, song_id)`, `(playlist_id, song_id)` or
-- `(song_id, album_id, label)` — the **loser's row is deleted and the
-- survivor's is kept untouched**. Nothing is merged: not a per-column
-- coalesce, not a max-status, not a tag union. A deleted `repertoire` row's
-- `status`, `tags`, `personal_key`, `lyrics` and `last_practiced` are
-- discarded, and the owner re-enters them.
--
-- `docs/plans/repertoire-rework.md` states that migration cost is explicitly
-- not a constraint and that re-registering data is acceptable, and a merge rule
-- would have to invent an answer for `status` (whose "higher" is not obviously
-- right) and for `personal_key` (where two values are simply a conflict).
-- Scalar `songs` fields and `links` are likewise not merged: the survivor keeps
-- its own album, key, cover and links.
--
-- The **one** exception is `repertoire_tabs`. Its foreign key is
-- `ON DELETE CASCADE`, so deleting a `repertoire` row would silently destroy an
-- uploaded PDF chart — a file somebody scanned and annotated, not re-enterable
-- data. Those rows are re-pointed at the surviving `repertoire` row *before*
-- the loser is deleted.
--
-- `repertoire` is otherwise untouched by this migration: it keeps its name, its
-- columns and its foreign key to `songs`, and there is deliberately no
-- `ALTER TABLE repertoire` anywhere below. Splitting it into `user_songs` and
-- `band_songs`, and moving reads off `songs.album`/`standard_key`/
-- `duration_seconds` onto the version, are later parts of the same plan.
--
-- Every statement is idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`,
-- `NOT EXISTS` guards), because `docker/init-migrations.sh` and
-- `scripts/migrate.mjs` may both apply this file and because a migration here
-- is expected to be re-appliable by hand.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Step 1 — `songs` gains `lyrics` and `map`.
--
-- Both nullable with no default: null is what makes the resolution cascade in
-- `docs/use-cases.md` § *Resolving a value* walk up. Words and structure belong
-- to the composition, so they start here on `songs`; a live take overrides them
-- on its `song_versions` row because it has ad-libs and a longer solo.
-- ---------------------------------------------------------------------------
ALTER TABLE songs ADD COLUMN IF NOT EXISTS lyrics text;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS map jsonb;

COMMENT ON COLUMN songs.lyrics IS
    'The composition''s words. The bottom of the lyrics cascade: a version and '
    'then an owner override it, and null here means nobody has entered any.';
COMMENT ON COLUMN songs.map IS
    'The composition''s structure (sections, bars). Bottom of the same cascade '
    'as `lyrics`.';

-- ---------------------------------------------------------------------------
-- Step 2 — `albums`.
--
-- `artist` is in the identity key, and that is the whole point of the key:
-- keying on the name alone merges Queen's *Greatest Hits* with Michael
-- Jackson's into one row with one cover and one release date, and the catalog
-- has no delete path to undo it.
--
-- `album_type` is constrained to the three values Spotify reports so the
-- representative-version sort in the plan ("`album` first, then earliest
-- `release_date`") has a closed domain to order on. `release_date` is nullable
-- and starts null everywhere: the catalog has never stored one, and enriching
-- it from the Spotify API is not this task.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS albums (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    artist       text NOT NULL,
    name         text NOT NULL,
    album_type   text NOT NULL DEFAULT 'album'
                 CONSTRAINT albums_album_type_check
                 CHECK (album_type IN ('album', 'single', 'compilation')),
    cover_url    text,
    release_date date,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_albums_artist_name
    ON albums (lower(artist), lower(name));

COMMENT ON TABLE albums IS
    'A release. Identity is (lower(artist), lower(name)) — the artist is in the '
    'key because two artists have a Greatest Hits and merging them would give '
    'one row one cover and one date, irreversibly.';

-- ---------------------------------------------------------------------------
-- Step 3 — `song_versions`.
--
-- `album_id` is **nullable**: today's catalog holds rows with no album at all,
-- and a recording of an unknown release is still a recording.
--
-- The identity is declared `UNIQUE NULLS NOT DISTINCT`, not as a plain unique.
-- A null `label` is the common case and Postgres otherwise treats nulls as
-- distinct, so two unlabelled versions of one album would both insert. That
-- same clause is what makes two album-less, label-less versions of one song
-- collapse into one, which the backfill below relies on.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS song_versions (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    song_id          uuid NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    album_id         uuid REFERENCES albums(id) ON DELETE SET NULL,
    label            text,
    duration_seconds integer,
    key              text,
    tuning           text,
    lyrics           text,
    map              jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_song_versions_identity
        UNIQUE NULLS NOT DISTINCT (song_id, album_id, label)
);

-- The two foreign keys get their own indexes: Postgres indexes the referenced
-- side, never the referencing one, and both are joined on every version read.
CREATE INDEX IF NOT EXISTS idx_song_versions_song_id  ON song_versions (song_id);
CREATE INDEX IF NOT EXISTS idx_song_versions_album_id ON song_versions (album_id);

COMMENT ON TABLE song_versions IS
    'One recording of a song on one release. Identity is '
    '(song_id, album_id, label) with NULLS NOT DISTINCT, because a null label '
    'is the common case and plain-unique nulls would never collide.';
COMMENT ON COLUMN song_versions.label IS
    'The right half of the title split — "2018 Remaster", "Live at Wembley". A '
    'visible field of its own, never a suffix hidden inside songs.title.';

-- ---------------------------------------------------------------------------
-- Step 4a — the SQL half of the title split.
--
-- Four outcomes, matching `src/lib/songTitle.ts` exactly:
--   'Still Of The Night - 2018 Remaster' -> head 'Still Of The Night',
--                                           label '2018 Remaster'
--   'Hotel California'                   -> head unchanged, label null
--   'Song - '                            -> head 'Song', label null
--   ' - Live'                            -> head '- Live', label null
--
-- `position(' - ' in ...) > 1` is the "left half is non-empty" test: the input
-- is `btrim`med first, so its first character is never whitespace, and a
-- separator at position 1 therefore means there is nothing to its left. Both
-- functions are `IMMUTABLE` so the `UPDATE` below can be planned over them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION song_title_head(raw text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN position(' - ' in btrim(raw)) > 1
         AND btrim(substring(btrim(raw) from position(' - ' in btrim(raw)) + 3)) <> ''
        THEN btrim(substring(btrim(raw) from 1 for position(' - ' in btrim(raw)) - 1))
        -- No usable split: drop a dangling separator so 'Song - ' is stored as
        -- 'Song' and not as 'Song -', and never return an empty title.
        ELSE coalesce(nullif(regexp_replace(btrim(raw), '\s+-\s*$', ''), ''), btrim(raw))
    END
$$;

CREATE OR REPLACE FUNCTION song_title_label(raw text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT nullif(
        CASE
            WHEN position(' - ' in btrim(raw)) > 1
            THEN btrim(substring(btrim(raw) from position(' - ' in btrim(raw)) + 3))
            ELSE ''
        END, '')
$$;

COMMENT ON FUNCTION song_title_head(text) IS
    'Left half of the " - " title split. Retained after RH-122: '
    'src/lib/__tests__/catalogVersions.db.test.ts pins it against '
    'src/lib/songTitle.ts so the SQL and TypeScript halves cannot drift.';
COMMENT ON FUNCTION song_title_label(text) IS
    'Right half of the " - " title split, null when there is none. Retained '
    'for the same reason as song_title_head(text).';

-- ---------------------------------------------------------------------------
-- Step 4b — backfill and collapse, as one idempotent function.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION migrate_catalog_to_versions() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    v_group  record;
    v_keep   uuid;
    v_loser  uuid;
BEGIN
    -- ---- one `albums` row per distinct case-insensitive (artist, album) ----
    --
    -- The key uses `songs.artist` **exactly as stored**: this migration does
    -- not re-derive a primary artist from it. RH-95 extracts `artists[0]` at
    -- both ingestion points, so new rows are already primary-artist-shaped, but
    -- a legacy row may still hold a joined string such as
    -- 'Michael Jackson, Akon' — and such a row gets its own `albums` row under
    -- that exact artist text. Splitting stored artist strings on ', ' in SQL is
    -- rejected: it would also cut names that legitimately contain a comma
    -- ("Earth, Wind & Fire"), and `albums` has no delete path to undo the wrong
    -- merge that would produce. One extra `albums` row is the cheap error.
    --
    -- `DISTINCT ON` picks the source row for the artist/album text and the
    -- cover deterministically — oldest first, id as tiebreak.
    INSERT INTO albums (artist, name, cover_url)
    SELECT DISTINCT ON (lower(s.artist), lower(s.album))
           s.artist, s.album, s.cover_url
      FROM songs s
     WHERE s.album IS NOT NULL AND btrim(s.album) <> ''
     ORDER BY lower(s.artist), lower(s.album), s.created_at, s.id
    ON CONFLICT DO NOTHING;

    -- ---- one `song_versions` row per catalog row that has none ----
    --
    -- `label` is the right half of the title split (null when there is none),
    -- `key` comes from `songs.standard_key`, and `tuning`, `lyrics` and `map`
    -- start null so the cascade walks up. The `NOT EXISTS` guard is what makes
    -- a second call a no-op rather than a second version per song.
    INSERT INTO song_versions (song_id, album_id, label, duration_seconds, key)
    SELECT s.id,
           a.id,
           song_title_label(s.title),
           s.duration_seconds,
           s.standard_key
      FROM songs s
      LEFT JOIN albums a
        ON s.album IS NOT NULL
       AND btrim(s.album) <> ''
       AND lower(a.artist) = lower(s.artist)
       AND lower(a.name)   = lower(s.album)
     WHERE NOT EXISTS (SELECT 1 FROM song_versions v WHERE v.song_id = s.id)
    ON CONFLICT DO NOTHING;

    -- ---- rewrite every title to the left half ----
    --
    -- `updated_at` moves with it: the row's title genuinely changed, and the
    -- offline snapshot compares against that column to decide whether a cached
    -- row is stale. The predicate makes this a no-op on a second call, because
    -- `song_title_head` is idempotent.
    UPDATE songs
       SET title = song_title_head(title), updated_at = now()
     WHERE title <> song_title_head(title);

    -- ---- collapse the rows the rewrite just made duplicates ----
    --
    -- The survivor is the earliest `created_at` (id as tiebreak). Only groups
    -- with more than one row are visited, so a second call finds none.
    --
    -- The grouping expression mirrors `uq_songs_artist_title` exactly —
    -- `lower(btrim(...))` on both columns, not bare `lower(...)`. Any drift
    -- would leave a pair the index forbids in two different groups, and the
    -- `CREATE UNIQUE INDEX` at the end of this migration would then be the
    -- statement that fails, after the rewrite had already happened.
    FOR v_group IN
        SELECT array_agg(id ORDER BY created_at, id) AS ids
          FROM songs
         GROUP BY lower(btrim(artist)), lower(btrim(title))
        HAVING count(*) > 1
    LOOP
        v_keep := v_group.ids[1];

        FOREACH v_loser IN ARRAY v_group.ids[2:] LOOP
            -- `repertoire_tabs` first, and before anything is deleted: the FK
            -- is ON DELETE CASCADE, so an uploaded chart would otherwise go
            -- with the row. This is the one thing the collapse rescues.
            UPDATE repertoire_tabs t
               SET repertoire_id = keeper.id
              FROM repertoire loser
              JOIN repertoire keeper
                ON keeper.song_id = v_keep
               AND ((keeper.user_id IS NOT NULL AND keeper.user_id = loser.user_id)
                 OR (keeper.band_id IS NOT NULL AND keeper.band_id = loser.band_id))
             WHERE loser.song_id = v_loser
               AND t.repertoire_id = loser.id;

            -- An owner holding both rows keeps the survivor's row untouched;
            -- the loser's practice state is discarded (see the header).
            DELETE FROM repertoire AS loser
             WHERE loser.song_id = v_loser
               AND EXISTS (
                   SELECT 1 FROM repertoire keeper
                    WHERE keeper.song_id = v_keep
                      AND ((keeper.user_id IS NOT NULL AND keeper.user_id = loser.user_id)
                        OR (keeper.band_id IS NOT NULL AND keeper.band_id = loser.band_id)));

            UPDATE repertoire SET song_id = v_keep WHERE song_id = v_loser;

            -- `uq_playlist_song` is (playlist_id, song_id): a playlist holding
            -- both rows keeps the survivor's entry, at its own position.
            DELETE FROM playlist_songs AS loser
             WHERE loser.song_id = v_loser
               AND EXISTS (
                   SELECT 1 FROM playlist_songs keeper
                    WHERE keeper.song_id = v_keep
                      AND keeper.playlist_id = loser.playlist_id);

            UPDATE playlist_songs SET song_id = v_keep WHERE song_id = v_loser;

            -- `uq_song_versions_identity` is NULLS NOT DISTINCT, so the
            -- duplicate test has to be `IS NOT DISTINCT FROM` on both nullable
            -- columns — plain `=` would read two null labels as different and
            -- the re-point below would then raise 23505.
            DELETE FROM song_versions AS loser
             WHERE loser.song_id = v_loser
               AND EXISTS (
                   SELECT 1 FROM song_versions keeper
                    WHERE keeper.song_id = v_keep
                      AND keeper.album_id IS NOT DISTINCT FROM loser.album_id
                      AND keeper.label    IS NOT DISTINCT FROM loser.label);

            UPDATE song_versions SET song_id = v_keep WHERE song_id = v_loser;

            -- The moderation queue carries no unique on `song_id`, so every
            -- pending correction simply follows the survivor. `global_song_edits`
            -- keeps its name until it becomes `catalog_suggestions`.
            UPDATE global_song_edits SET song_id = v_keep WHERE song_id = v_loser;

            DELETE FROM songs WHERE id = v_loser;
        END LOOP;
    END LOOP;
END
$$;

COMMENT ON FUNCTION migrate_catalog_to_versions() IS
    'RH-122 backfill and collapse. Retained after the migration on purpose: '
    'src/lib/__tests__/catalogVersions.db.test.ts calls it on legacy-shaped '
    'rows, which is the only way the backfill and the collapse get tested at '
    'all — CI migrates an empty database. Idempotent.';

-- ---------------------------------------------------------------------------
-- Step 5 — drop RH-95's artist+title unique, run the backfill, put it back.
--
-- The drop has to precede the call and the create has to follow it; see the
-- header. `uq_songs_artist_title` is the name RH-121's `0013` renamed RH-95's
-- index to, and it is recreated under exactly that name on exactly the same
-- expressions.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS uq_songs_artist_title;

SELECT migrate_catalog_to_versions();

CREATE UNIQUE INDEX IF NOT EXISTS uq_songs_artist_title
    ON songs (lower(btrim(artist)), lower(btrim(title)));

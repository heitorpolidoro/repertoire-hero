-- Migration 0019 (RH-136): a song's links become rows, with a derived provider.
--
-- `songs.links` was a jsonb array nobody validated. There is no stable identity
-- for one link, so nothing can target one (RH-107 needs a per-row target), and
-- the array is rewritten wholesale by every writer. `song_links` makes each link
-- a row with an `id`, a `UNIQUE (song_id, url)` key every writer upserts on, and
-- a `provider` the *schema* derives from the url so no TypeScript writer can
-- disagree with this backfill.
--
-- `songs.links` is deliberately NOT dropped here. Three readers of the column
-- live in files RH-136 may not edit (the Spotify push route, the Spotify import,
-- and `searchSongs`' `SELECT s.*`), and every one of those breaks is invisible
-- to `tsc`. The drop belongs to the part that removes the last reader, and that
-- part drops the bridge trigger below with it.

CREATE TABLE IF NOT EXISTS song_links (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    song_id    uuid        NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    url        text        NOT NULL,
    -- Never null: the UI renders `link.label || link.url`, so an empty label
    -- already means "show the url" (src/components/fastview/LinksSection.tsx).
    label      text        NOT NULL DEFAULT '',
    -- Generated, never written by the application, so a wrong provider is not a
    -- state this table can hold. The host is normalised in exactly three steps:
    --
    --   1. `substring(lower(url) from '^https?://([^/?#\\]*)')` — the WHOLE url
    --      is lowercased *before* the match, because the pattern is
    --      case-sensitive and `HTTPS://OPEN.SPOTIFY.COM/track/2` would otherwise
    --      extract nothing. The backslash is in the excluded class on purpose:
    --      the WHATWG URL parser treats `\` as `/` for a special scheme, so a
    --      browser's host for `https://evil.com\@spotify.com/x` is `evil.com`.
    --      With `[^/?#]*` that url normalises to `spotify.com` and would be
    --      labelled `spotify` — a spoofing hole, since the Spotify push is keyed
    --      off `provider`.
    --   2. `regexp_replace(…, '^.*@', '')` — drop any `userinfo@` prefix by
    --      keeping the text after the LAST `@`. Before the port strip, not
    --      after: stripping the port first reduces
    --      `https://user:pw@spotify.com/x` to the host `user`.
    --   3. `split_part(…, ':', 1)` — drop any `:port` suffix.
    --
    -- A url with no `http(s)://` prefix extracts the empty host and falls
    -- through to `other`.
    --
    -- The match is dot-anchored, never a bare suffix: `LIKE '%spotify.com'`
    -- would label `https://notspotify.com/x` as `spotify`.
    --
    -- Three values today; a fourth is a later migration, which is the point of
    -- generating it rather than storing it.
    provider   text        GENERATED ALWAYS AS (
                   CASE
                     WHEN split_part(regexp_replace(substring(lower(url) from '^https?://([^/?#\\]*)'), '^.*@', ''), ':', 1) = 'spotify.com'
                       OR split_part(regexp_replace(substring(lower(url) from '^https?://([^/?#\\]*)'), '^.*@', ''), ':', 1) LIKE '%.spotify.com'
                       THEN 'spotify'
                     WHEN split_part(regexp_replace(substring(lower(url) from '^https?://([^/?#\\]*)'), '^.*@', ''), ':', 1) IN ('youtube.com', 'youtu.be')
                       OR split_part(regexp_replace(substring(lower(url) from '^https?://([^/?#\\]*)'), '^.*@', ''), ':', 1) LIKE '%.youtube.com'
                       OR split_part(regexp_replace(substring(lower(url) from '^https?://([^/?#\\]*)'), '^.*@', ''), ':', 1) LIKE '%.youtu.be'
                       THEN 'youtube'
                     ELSE 'other'
                   END
               ) STORED,
    -- The displayed order of a song's links is visible to a musician, and
    -- `(created_at, id)` alone scrambles any two rows written by the same
    -- statement: they share one `now()` and break the tie on a random uuid.
    -- Deliberately NOT unique, so a delete leaves a gap rather than forcing a
    -- renumber of every surviving row.
    position   integer     NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- The key every writer upserts on.
    CONSTRAINT uq_song_links_song_url UNIQUE (song_id, url)
);

-- Supports the canonical read order, `ORDER BY position, created_at, id`.
CREATE INDEX IF NOT EXISTS idx_song_links_song_position ON song_links (song_id, position);

COMMENT ON TABLE song_links IS
    'One accepted catalog link per row. Holds no status and no pending flag: a proposed link stays in the moderation queue until catalog_suggestions replaces it (RH-107). The canonical read order is ORDER BY position, created_at, id.';

-- The backfill, from the array the column still holds.
--
-- `jsonb_typeof(links) = 'array'` comes FIRST and is not decoration: the column
-- is unvalidated (the additive branch of `applySongLinkUpdate` ran a bare
-- `UPDATE songs SET links = $1` with no shape check), and
-- `jsonb_array_elements` on a scalar raises and would abort this whole file.
--
-- An element that is not an object, or an object with no `url`, contributes
-- nothing: there is no url, so nothing could ever have been clicked.
-- `-> 'url'` reading null covers both.
--
-- A non-http(s) url IS kept, with its label, at `provider = 'other'`.
--
-- A duplicate `(song_id, url)` collapses to the LOWEST-ordinality element,
-- keeping that element's label — the same rule `dedupeLinksByUrl` applies in
-- TypeScript, so the two can never disagree. `DISTINCT ON` rather than
-- `ON CONFLICT`, so the migration cannot fail on data `0009` left behind:
-- that step deduplicated only the links it *appended* from merged duplicates
-- and never the keeper's own pre-existing array.
--
-- `position` is the element's 1-based array ordinality after the collapse, so
-- the order a musician sees today is the order they see afterwards.
INSERT INTO song_links (song_id, url, label, position)
SELECT song_id, url, label, row_number() OVER (PARTITION BY song_id ORDER BY ordinality) AS position
  FROM (
    SELECT DISTINCT ON (s.id, e.element ->> 'url')
           s.id                                      AS song_id,
           e.element ->> 'url'                        AS url,
           COALESCE(e.element ->> 'label', '')        AS label,
           e.ordinality                               AS ordinality
      FROM songs s
      CROSS JOIN LATERAL jsonb_array_elements(s.links) WITH ORDINALITY AS e(element, ordinality)
     WHERE jsonb_typeof(s.links) = 'array'
       AND jsonb_typeof(e.element) = 'object'
       AND e.element -> 'url' IS NOT NULL
       AND jsonb_typeof(e.element -> 'url') = 'string'
     ORDER BY s.id, e.element ->> 'url', e.ordinality
  ) deduped;

-- The bridge trigger.
--
-- It exists for ONE writer RH-136 may not edit: `findOrCreateSong`'s
-- `UPDATE songs SET links = $1` (src/lib/spotifyPlaylistSync.ts), which appends
-- the Spotify link when importing a track whose catalog row already exists.
-- Without this, that link would be written to a column nothing reads any more
-- and the song page would stop showing it. The precedent is
-- `sync_profile_email_on_user_update` (migrations/0008): a trigger kept because
-- the write it mirrors happens in code this part does not own. It is a BRIDGE —
-- the part that drops `songs.links` drops it too.
--
-- The four `songs.links` writes RH-136 does own all stop writing the column, so
-- this never fires for them and there is no dual write.
--
-- THE CHANGED-VALUE TEST IS IN THE BODY, NEVER IN A `WHEN` CLAUSE. A `WHEN`
-- referencing `OLD` on a trigger that also fires `AFTER INSERT` is rejected at
-- creation time with `42P17: INSERT trigger's WHEN condition cannot reference
-- OLD values`, which would abort this file and leave `song_links` nonexistent.
-- One trigger, one function; the two-trigger split is not the repair.
--
-- Insert-only: it never updates a label and never deletes a row, so it cannot
-- lose data and cannot disturb an existing `song_links.id`. An empty array
-- inserts nothing, which is what makes a `songs.links = '[]'::jsonb` fixture
-- constructible at all — a song can hold `song_links` rows while its column
-- stays empty, because no firing of this trigger will ever contradict it.
--
-- THE `position` EXPRESSION MUST BE COALESCE'd. `max(position)` over zero rows
-- is NULL, `NULL + ordinality` is NULL, and `position` is NOT NULL — so the
-- bare form raises `23502` on EVERY firing for a song that has no `song_links`
-- row yet. Both reachable paths hit that: `scripts/seed-catalog.sql`'s
-- `INSERT INTO songs (title, artist, standard_key, links)` (a fresh
-- `docker compose` database would come up with no catalog) and the Spotify
-- import's append to a catalog song that currently holds zero links, which is
-- the ordinary case rather than an edge one.
--
-- Everything inside is UNQUALIFIED and the body does not `SET search_path`, so
-- a replay resolves `song_links` and `songs` in whatever schema is first on the
-- path rather than writing into `public`.
CREATE OR REPLACE FUNCTION mirror_song_links_from_column() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.links IS NOT DISTINCT FROM NEW.links THEN
        RETURN NULL;
    END IF;

    IF jsonb_typeof(NEW.links) <> 'array' THEN
        RETURN NULL;
    END IF;

    INSERT INTO song_links (song_id, url, label, position)
    SELECT NEW.id,
           deduped.url,
           deduped.label,
           COALESCE((SELECT max(position) FROM song_links WHERE song_id = NEW.id), 0) + deduped.ordinality
      FROM (
        SELECT DISTINCT ON (e.element ->> 'url')
               e.element ->> 'url'                 AS url,
               COALESCE(e.element ->> 'label', '') AS label,
               e.ordinality                        AS ordinality
          FROM jsonb_array_elements(NEW.links) WITH ORDINALITY AS e(element, ordinality)
         WHERE jsonb_typeof(e.element) = 'object'
           AND jsonb_typeof(e.element -> 'url') = 'string'
         ORDER BY e.element ->> 'url', e.ordinality
      ) deduped
    ON CONFLICT (song_id, url) DO NOTHING;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS mirror_song_links_on_songs_write ON songs;

CREATE TRIGGER mirror_song_links_on_songs_write
    AFTER INSERT OR UPDATE OF links ON songs
    FOR EACH ROW
    EXECUTE FUNCTION mirror_song_links_from_column();

-- The REVERSE bridge trigger: `song_links` rows back into `songs.links`.
--
-- DROPPED BY `0020_drop_song_links_reverse_bridge.sql` (RH-137), which
-- re-keyed the Spotify push off `song_links.provider` and so removed this
-- trigger's only reader. The block below is left as written because the file
-- is already applied everywhere and migrations are never edited in place; read
-- it as history. The FORWARD trigger above survives 0020 and is dropped by
-- RH-143 together with the column.
--
-- Added in review round 1 of RH-136, against a measured regression. The spec's
-- premise that deferring the DROP "costs a musician nothing today" was written
-- before RH-135 (`5d602f7`) re-keyed the Spotify push off the link's **url**
-- instead of its label. Since RH-135 the push really works, and it reads the
-- retained column:
-- `src/app/api/spotify/playlists/[id]/sync/route.ts` selects `s.links` and
-- `spotifyTrackUriFromLinks` picks the Spotify host out of it. With the four
-- owned writers moved off the column and only the forward bridge above, every
-- song whose links were written after this migration lands would have an empty
-- column, so the push would build an empty `uris` list and answer HTTP 200 with
-- `{added: 0}` — success, having pushed nothing. That is precisely the defect
-- class RH-135 existed to remove, and it would be reintroduced one commit
-- later. The repo commits to master and Vercel deploys from master, so nothing
-- holds this part until the part that moves the route lands.
--
-- Why a trigger and not four TypeScript dual writes: all four owned writers,
-- plus any future one, are covered by this one statement, and the writers stay
-- single-source — `song_links` is the truth, the column is a derived shadow of
-- it. The three affected user-facing paths are the Spotify pull
-- (`resolveOrCreateSongIdentity`), the Fast View add-link
-- (`applySongLinkUpdate`) and the song-form save (`applyCatalogFill`); a change
-- in `songIdentity.ts`'s `INSERT_SQL` alone would have covered only the first.
-- It is a BRIDGE, exactly like the forward one: the part that drops
-- `songs.links` drops both.
--
-- IT IS CREATED AFTER THE BACKFILL ABOVE, NOT BEFORE. The backfill is an
-- `INSERT INTO song_links` over every song, so with this trigger already in
-- place it would rewrite `songs.links` for every row — collapsing duplicates,
-- dropping malformed elements and defaulting absent labels — and the migration
-- could no longer claim it leaves the column it migrated from untouched.
--
-- Recursion terminates, measured on the dev database rather than argued: an
-- `INSERT INTO song_links` fires this function, whose `UPDATE songs` fires the
-- forward trigger, whose insert is `ON CONFLICT (song_id, url) DO NOTHING` and
-- therefore inserts no row — and a row-level `AFTER INSERT` trigger does not
-- fire for a row `DO NOTHING` suppressed. So the cycle closes after one turn.
--
-- `UPDATE songs SET links = '[]'::jsonb` on a song that holds rows still leaves
-- them alone and leaves the column empty: the forward trigger is insert-only
-- and inserts nothing from an empty array, so **no `song_links` row changes and
-- this function never runs**. That is what keeps the deliberately-empty-column
-- fixtures constructible — insert the rows first, then blank the column.
--
-- It recomputes from the rows rather than patching the array, so a DELETE
-- (`reviewSongEdit`'s replace-set) and a reordering upsert are both expressed
-- by the same body, and the column always holds the canonical read order
-- `ORDER BY position, created_at, id`. `{label, url}` only, matching the shape
-- every pre-existing reader of the column already expects; `provider` is a
-- `song_links` concept and the readers that want it read the rows.
--
-- `COALESCE(NEW.song_id, OLD.song_id)`, because `NEW` is null on DELETE and
-- `OLD` is null on INSERT. Unqualified names and no `SET search_path`, for the
-- same reason as the forward trigger: a replay must resolve both tables in its
-- own schema and never write into `public`.
CREATE OR REPLACE FUNCTION mirror_column_from_song_links() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    target uuid := COALESCE(NEW.song_id, OLD.song_id);
BEGIN
    UPDATE songs
       SET links = COALESCE((
             SELECT jsonb_agg(jsonb_build_object('label', sl.label, 'url', sl.url)
                      ORDER BY sl.position, sl.created_at, sl.id)
               FROM song_links sl
              WHERE sl.song_id = target
           ), '[]'::jsonb)
     WHERE id = target;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS mirror_column_on_song_links_write ON song_links;

CREATE TRIGGER mirror_column_on_song_links_write
    AFTER INSERT OR UPDATE OR DELETE ON song_links
    FOR EACH ROW
    EXECUTE FUNCTION mirror_column_from_song_links();

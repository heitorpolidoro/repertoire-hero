-- ---------------------------------------------------------------------------
-- RH-121 — `global_songs` becomes `songs`, and loses `contributor_id`.
--
-- The table has been the shared catalogue since `0001_initial_schema.sql`, and
-- the `global_` prefix was only ever there to distinguish it from a
-- per-user song that never existed: `repertoire` has always been the per-owner
-- side. The prefix now costs every reader an extra concept, and the
-- restructuring work that follows (albums, song versions, the `repertoire`
-- split) names the catalogue in a dozen more places. Renaming it first is what
-- keeps those from inheriting the prefix.
--
-- `contributor_id` goes with it. It was declared "informational only and does
-- not imply ownership" from the start, nothing authorizes against it, no screen
-- reads it, and on a wiki-style row that many users edit it records only who
-- happened to be first — a fact the moderation queue (`global_song_edits`)
-- records properly and per edit.
--
-- WHAT IS RENAMED, AND THE ONE DEVIATION FROM THE SPEC'S LIST
--
-- The table, its primary key constraint and its three indexes:
--
--     global_songs                 -> songs
--     global_songs_pkey            -> songs_pkey
--     idx_global_songs_title       -> idx_songs_title
--     idx_global_songs_artist      -> idx_songs_artist
--     uq_global_songs_artist_title -> uq_songs_artist_title
--
-- The spec (RH-121 ER1) names the third unique index as
-- `uq_global_songs_title_album`, the partial unique index on
-- `(lower(title), lower(album))` that `0001_initial_schema.sql` created. That
-- index no longer exists: RH-95's `0009_unify_song_identity.sql` dropped it
-- (`DROP INDEX IF EXISTS uq_global_songs_title_album`) after deduplicating the
-- catalogue, and created `uq_global_songs_artist_title` on
-- `(lower(btrim(artist)), lower(btrim(title)))` as the single identity rule in
-- its place. So the third index carried across here is the artist/title one —
-- same count, same role, and still the index
-- `resolveOrCreateSongIdentity`'s bare `ON CONFLICT DO NOTHING` arbitrates
-- against. No statement for the dropped partial index is written, because
-- `0009` removes it unconditionally and it can never be present at this point
-- in the ledger.
--
-- Renaming rather than dropping and recreating is deliberate: an index rename
-- is a catalogue-only operation, so the identity predicate survives
-- byte-identical and no window exists in which the catalogue has no uniqueness
-- rule.
--
-- WHAT IS NOT TOUCHED
--
-- `global_song_edits` keeps its name this round — it is superseded wholesale by
-- a differently shaped `catalog_suggestions` table in a later part, so renaming
-- it now would be churn that part deletes. Its
-- `global_song_edits_song_id_fkey` re-points by itself: Postgres records the
-- referenced relation by OID, not by name, so the rename carries the
-- constraint across with no `DROP CONSTRAINT`/`ADD CONSTRAINT` pair. The same
-- is true of `repertoire.song_id` and `playlist_songs.song_id`. Writing a
-- drop/add pair would be worse than redundant: it would re-validate three
-- foreign keys against the whole table for no gain.
--
-- `COMMENT ON COLUMN global_songs.links` needs no restatement — a comment is
-- attached to the column, which the rename does not disturb. The
-- `contributor_id` comment goes away with its column.
--
-- Re-applying this file is a no-op: every statement is predicated on the old
-- name still being there (`ALTER TABLE IF EXISTS`, `ALTER INDEX IF EXISTS`,
-- `DROP COLUMN IF EXISTS`), so a second run finds `songs` already renamed and
-- changes nothing.
-- ---------------------------------------------------------------------------

ALTER TABLE IF EXISTS global_songs RENAME TO songs;

ALTER INDEX IF EXISTS global_songs_pkey            RENAME TO songs_pkey;
ALTER INDEX IF EXISTS idx_global_songs_title       RENAME TO idx_songs_title;
ALTER INDEX IF EXISTS idx_global_songs_artist      RENAME TO idx_songs_artist;
ALTER INDEX IF EXISTS uq_global_songs_artist_title RENAME TO uq_songs_artist_title;

ALTER TABLE songs DROP COLUMN IF EXISTS contributor_id;

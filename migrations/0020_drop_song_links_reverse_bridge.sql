-- Migration 0020 (RH-137): drop the REVERSE bridge trigger, and nothing else.
--
-- `mirror_column_on_song_links_write` / `mirror_column_from_song_links()` were
-- added by 0019 to recompute `songs.links` after every `song_links` write,
-- purely so the Spotify push — which still selected `s.links` and matched a
-- track by the url's host (RH-135) — kept finding a url to send. RH-137 re-keys
-- that query off `song_links.provider` and resolves its uris through
-- `spotifyPushUris`, so the column has no production reader left and the reverse
-- mirror has nothing to serve. A dual write nobody reads is a state the two
-- copies can disagree in, which is the reason to remove it rather than leave it
-- standing.
--
-- THE FORWARD BRIDGE IS DELIBERATELY KEPT. The trigger that mirrors a
-- `songs.links` write into `song_links` rows stays, together with its function
-- and the column itself: after this migration the column is written by exactly
-- one class of writer, hand-written SQL that seeds it (the dev seed script and
-- the test fixtures), and the forward trigger is what translates that one-way
-- into the rows every production reader already uses. Dropping it here would
-- mean rewriting nine fixture files plus the seed in the same change as the
-- route and the import.
--
-- RH-143 owns the rest as one deliverable: dropping the `links` column,
-- the forward trigger and its function, the fixture and seed conversion, and
-- `searchSongs` / `CatalogSearchResult`, whose projected field would otherwise
-- be undefined at runtime with nothing for tsc to see.
--
-- `IF EXISTS` on both, so a replay and a database built before 0019 landed are
-- equally safe. `scripts/migrate.mjs` tracks migrations by name only.

DROP TRIGGER IF EXISTS mirror_column_on_song_links_write ON song_links;

DROP FUNCTION IF EXISTS mirror_column_from_song_links();

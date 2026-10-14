# RH-143 — Drop songs.links and the forward bridge trigger

> **Renamed 2026-10-13** to match its task id; a spec is always `docs/tasks/<task id>-spec.md`.
> **Re-derived 2026-10-14** against the current tree. Two earlier claims were stale: migration number 0027 is
> taken (RH-147 landed `0027_song_file_primary.sql`), and most fixture files already stopped touching the column.
> No UI is built or changed, so there is no mock.

## Scope

RH-136 moved links into `song_links` and kept `songs.links` plus a two-way bridge. RH-137 (landed,
`migrations/0020_drop_song_links_reverse_bridge.sql`) removed the reverse trigger and every production reader;
RH-138 (landed) made corrections per row. What is left is the column, the forward trigger and function, and the
two places that still depend on them (the dev seed and the `CatalogSearchResult` type). One deliverable:

1. **Migration** `migrations/0028_drop_songs_links.sql` (highest tracked is `0027_song_file_primary.sql`, so 0028
   is the next free number and keeps the numbering contiguous for the guard in `migrationsSingleSource.test.ts`;
   re-check with `ls migrations` before writing). In order: `DROP TRIGGER IF EXISTS
   mirror_song_links_on_songs_write ON songs`, `DROP FUNCTION IF EXISTS mirror_song_links_from_column()`, then
   `ALTER TABLE songs DROP COLUMN IF EXISTS links`. The trigger goes first: it is `UPDATE OF links`, so the column
   cannot be dropped while it stands. The header says the data already lives in `song_links` (0019 backfilled it,
   the forward trigger kept mirroring), that the drop has **no down path**, and that 0019 is not edited (its replay
   test builds its own throwaway schema via `legacyCatalogReplayDdl`, which keeps its own `links` column).
2. **`CatalogSearchResult`** (`src/types/database.ts:325`, `searchSongs` in `src/lib/songs.ts:84`). Nothing reads
   `.links` off a search result. Decision: the field is **removed from the type**, not re-projected:
   `CatalogSearchResult` extends `Omit<Song, 'links'>` so `SELECT s.*` is correct once the column is gone and the
   type does not lie (`tsc` cannot see a column vanishing). Fix whatever `tsc` then flags (candidates: test helpers
   `catalogSong` in `manualEntryPanel.test.tsx` and `repertoireDashboardSearch.test.tsx`, `result_` in
   `useSongPicker.test.tsx`, `CatalogFlowPanel.tsx`). `Song` keeps `links`: entry, owner and playlist rows still
   project it through `songLinksJson`. The docblock on the type is updated.
3. **Seed** `scripts/seed-catalog.sql`: the `songs` insert loses the `links` column and its JSON literals; the same
   links are inserted into `song_links` (url, label, position = array order), keyed by `(title, artist)` against the
   just-seeded `songs` rows, with `ON CONFLICT (song_id, url) DO NOTHING` so the file stays re-runnable. The header
   note about the `links` column (line 17) is rewritten.
4. **Fixtures.** Already clean, verified by grep: `authzFixtures.ts`, `songLinksTable.db.test.ts`,
   `songLinksBridge.db.test.ts`, `spotify.test.ts` (seeds `song_links` at 506 and 612), `catalogRename`,
   `catalogTimestamp`, `songCatalogRefusal`. `songIdentity.db.test.ts` and `songLinksMigration.db.test.ts` write
   `songs.links` only inside throwaway replay schemas and need no change. The developer re-greps (below) and fixes
   any straggler.
5. **Docs and comments.** `AGENTS.md` (*Song Links* paragraph at ~262): delete the "One bridge trigger is left",
   "No production source writes `songs.links`" and "still projected" sentences and state `songs.links` was dropped
   by `0028`. Comments saying the column is "retained" or naming it: `src/lib/dbRows.ts` (28-31, 89),
   `src/lib/songs.ts` (~144), `src/app/api/spotify/playlists/[id]/sync/route.ts` (~133),
   `src/app/actions/repertoire.ts:281`, and the test comments in `authzRepertoire.db.test.ts:91`,
   `songCatalogRefusal.db.test.ts:78`, `spotifyPlaylistSync.test.ts:141,235`, `songIdentity.test.ts:176`,
   `spotifyPushUris.db.test.ts`.
6. **Lint pin.** `eslint.config.mjs:169` pins `src/lib/__tests__/spotify.test.ts` at 670, which equals its current
   line count (670). This task no longer touches that file, so the pin is unchanged and must still equal the file's
   line count (`complexityBudget.test.ts` enforces equality). The ratchet entry count is unchanged.

Not in this task: any change to `song_links`, `songLinksJson`, `Song.links` readers, migrations 0019/0020, e2e
(`e2e/offline-mode.spec.ts` holds an in-browser literal, not SQL), corrections or UI.

## Approach (behavior, files, tests)

Behavior once done: a database migrated through 0028 has no `songs.links`, no `mirror_song_links_on_songs_write`,
no `mirror_song_links_from_column()`; `searchSongs` rows carry no `links` key and the type says so; every
`song_links` row that existed before still exists; a fresh compose boot seeds the catalog and each seeded song has
its `song_links` rows in the listed order.

Files: `migrations/0028_drop_songs_links.sql` (new), `scripts/seed-catalog.sql`, `src/types/database.ts`,
whatever `tsc` flags after the type change, `AGENTS.md`, and the comment-only files in item 5.

Test criteria: a new DB test (`RUN_DB_TESTS=1`, e.g. `src/lib/__tests__/songsLinksDrop.db.test.ts`) asserts
`information_schema.columns` has no `songs.links`, `pg_trigger` has no `mirror_song_links_on_songs_write`, `pg_proc`
no `mirror_song_links_from_column`, that inserting a `songs` row without links still works, that `song_links` rows
present before the 0028 file runs are unchanged after it (replay in a throwaway schema, as `songLinksMigration`
does), and that `searchSongs` returns a row with no `links` key. A seed test applies `scripts/seed-catalog.sql` twice
to a migrated database and asserts the `song_links` urls for "Hotel California" equal its two seeded links, in order,
both times. Gates: `npx tsc --noEmit`, `npm run lint`, `npm run lint:dead`, `npm run lint:dup`,
`RUN_DB_TESTS=1 npm run test:coverage` (check `$?` of each).

`grep -rnE "(INSERT INTO|UPDATE) songs[^;]*links|links FROM songs" src scripts e2e` returns only the
throwaway-schema replay tests named in item 4 (`songIdentity.db.test.ts`, `songLinksMigration.db.test.ts`).

## Expected Results

- [ ] ER1: After migrations run to 0028, `songs` has no `links` column.
- [ ] ER2: After 0028, neither trigger `mirror_song_links_on_songs_write` nor function `mirror_song_links_from_column` exists.
- [ ] ER3: A database holding `song_links` rows keeps every one of them, unchanged, across 0028.
- [ ] ER4: `searchSongs` returns rows with no `links` key and `CatalogSearchResult` does not declare `links`.
- [ ] ER5: `scripts/seed-catalog.sql` applies to a migrated database, twice, and leaves each seeded song with its `song_links` rows in array order.
- [ ] ER6: Outside the throwaway replay-schema tests, no file under `src`, `scripts` or `e2e` writes or selects `songs.links`, and `npx tsc --noEmit`, `npm run lint` and `RUN_DB_TESTS=1 npm run test:coverage` all exit 0.
- [ ] ER7: `eslint.config.mjs` still pins `src/lib/__tests__/spotify.test.ts` at its exact line count, which has not grown past 670.

## Out of Scope

Dropping or altering `song_links`; editing migrations 0019/0020; `Song.links` readers; link-correction behaviour; UI.

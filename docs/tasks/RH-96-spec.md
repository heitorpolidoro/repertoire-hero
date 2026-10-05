# RH-95 — Unify the two song deduplication rules

Spec file name follows the repository convention (board id + 1):
`docs/tasks/RH-96-spec.md` for board task **RH-95**.

Sources: `docs/plans/repertoire-rework.md` (§The model → Rules, §Work items →
*Unify the two song deduplication rules*), `docs/use-cases.md` (*Add a song to the
repertoire*, *Search for a song*), `docs/reviews/feature-review.md` (F1.1 and the
Queen empirical check).

## Scope

One shared song-identity rule for the catalog, on the **current** `global_songs`
schema, and an atomic create path.

In scope:

- A single identity rule — `(lower(trim(primary artist)), lower(trim(sanitized title)))`,
  album **not** in the key — used by every code path that resolves or creates a
  `global_songs` row: `createAndAddSong` (`src/lib/songs.ts`) and
  `findOrCreateGlobalSong` (`src/lib/spotifyPlaylistSync.ts`).
- The database constraint that makes the rule hold under concurrency: the old
  artist-less unique index goes, a new one on the identity pair arrives, and the
  pre-existing duplicate groups are merged in the same migration so it can be
  created.
- `createAndAddSong` becomes one transaction (`withTransaction`), the way
  `updateSong` and `reviewGlobalSongEdit` already are.
- Primary-artist extraction at the two Spotify ingestion points, per the plan's
  *Song identity* rule (`artists[0]`, not the joined list).

Not in scope — see **Out of Scope** for why each is excluded: the
`songs`/`albums`/`song_versions` restructure (RH-105), title **splitting**, ISRC,
a catalog delete or split path, F1.2/F1.3 (`updateSong` discarding edits), F1.5
(search index/ranking), `global_songs.updated_at`.

## Approach

### Behavior

1. **One identity rule, one implementation.** Resolving a catalog row means:
   sanitize the title (`sanitizeSongTitle`), sanitize the album
   (`sanitizeAlbumName`), reduce the artist to its primary name, trim; then look
   up `global_songs` by the identity pair; create the row when absent. Both UI
   paths call the same function, so they can no longer disagree. The lookup no
   longer mentions `album` at all, and no longer matches a row whose artist
   differs.
2. **Album stops deciding identity.** Two rows that share artist and title but
   differ in album become one row; two rows that share a title but have different
   artists stay two rows, with or without an album. This is the plan's rule and
   reverses the current index.
3. **Atomic create.** `createAndAddSong` runs catalog resolution, the
   already-in-repertoire check and both inserts inside one `withTransaction`
   callback. Expected duplicates are absorbed with `ON CONFLICT DO NOTHING`
   (bare form) plus a follow-up `SELECT`, never by catching `23505` — per
   AGENTS.md §Transactions. Two musicians creating the same new song
   concurrently end with one catalog row; a second attempt by the *same* owner
   still fails with the unchanged user-facing message
   `Song already in your repertoire`. A failure anywhere in the callback leaves
   no catalog row behind.
4. **Catalog data is still never clobbered.** Resolving to an existing row keeps
   that row's artist, album, key, cover and duration as they are; the Spotify
   path keeps its existing behaviour of appending a Spotify link that is not
   already present (deduplicated by exact URL). No new write to an already-set
   field.
5. **Existing duplicates are merged, not left to block the index.** The migration
   merges each duplicate identity group into its oldest row: links unioned by
   URL, null/empty keeper columns (`album`, `standard_key`, `cover_url`,
   `duration_seconds`) filled from the duplicates, `repertoire`,
   `playlist_songs`, `global_song_edits` repointed at the keeper, then the
   duplicate catalog rows are deleted. Set-based SQL, idempotent, re-runnable.
   Because a merge collapses several `song_id` values into one, every table with
   a unique constraint on `song_id` needs a stated collision rule — a plain
   `UPDATE` would abort the migration:
   - `repertoire` (`uq_repertoire_user_song` / `uq_repertoire_band_song`): rows
     that would collide with an existing one are dropped after their
     `repertoire_tabs` are repointed at the surviving repertoire row.
   - `playlist_songs` (`uq_playlist_song UNIQUE (playlist_id, song_id)`, the
     ordinary case, since a playlist usually holds both duplicates): the group
     collapses to **one** row per `(playlist_id, keeper)`, which takes the
     **lowest `position`** among the collapsing rows — so the song keeps the
     earliest place it occupied in that playlist — and the other rows are
     deleted. The migration then renumbers every affected playlist to a
     contiguous `1..n` ordered by `(position, id)`, exactly as `0007` did, so no
     `position` gap is left behind and `uq_playlist_song_position` holds.
   - `global_song_edits` has no unique constraint on `song_id`; its rows are
     repointed unconditionally.
6. **Error-handling and guards unchanged.** L1 log-then-wrap stays; the
   `already in` passthrough in `createAndAddSong`'s catch stays.

### Files touched

- `migrations/<NNNN>_unify_song_identity.sql` — new. `<NNNN>` is **the next
  number after the highest prefix present in `migrations/` at implementation
  time** (expected `0009`, since `0008_sync_profile_email.sql` is the highest on
  disk today). Do not treat `0009` as fixed: RH-95, RH-96 and RH-121 were all
  specced against the same `0008` high-water mark, so whichever of them lands
  second or third must renumber its own file to keep the prefixes unique and
  contiguous from `0001` — the invariant
  `src/lib/__tests__/migrationsSingleSource.test.ts` enforces. The `_unify_song_identity`
  suffix is the stable part of the name and is what other artifacts should match
  on. Contents: merge duplicate identity groups,
  `DROP INDEX IF EXISTS uq_global_songs_title_album`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_global_songs_artist_title ON global_songs (lower(btrim(artist)), lower(btrim(title)))`.
  Written to be safely re-runnable.
- `src/lib/songIdentity.ts` — new server-only module (imports `@/lib/db`): the
  identity normalisation (`sanitizeSongTitle` + primary artist + trim), the
  exported primary-artist helper used by the two ingestion points, and the single
  transaction-aware resolve-or-create function taking a `Queryable` client.
- `src/lib/songs.ts` — `createAndAddSong` rewritten onto `withTransaction` and
  the new module; its own lookup/insert SQL deleted. **The file is pinned at
  `max-lines: 505` — its exact current length — by the complexity-budget ratchet;
  if the rewrite shortens it, lower that override to the new count in
  `eslint.config.mjs` (the ratchet may only shrink, and the list may not grow).**
- `src/lib/spotifyPlaylistSync.ts` — `findOrCreateGlobalSong` delegates lookup
  and insert to the new module, keeping its link-append behaviour and its plain
  (non-L1) thrown messages; `fetchAllSpotifyTracks` takes the primary artist.
- `src/app/api/spotify/search/route.ts` — takes the primary artist through the
  same helper.
- `src/lib/dbRows.ts` — only if a new distinct projection is needed.
- `package.json` — version bump per AGENTS.md.
- Tests: `src/lib/__tests__/songIdentity.test.ts`,
  `src/lib/__tests__/songIdentity.db.test.ts`, plus updates to
  `src/lib/__tests__/songs.test.ts` (the `reuses existing global song if matching
  title and album` case now asserts the artist rule),
  `src/lib/__tests__/spotifyPlaylistSync.test.ts`,
  `src/lib/__tests__/errors.test.ts` and `src/lib/__tests__/edge_cases.test.ts`
  (their `query` mock counts change once the path is transactional).

### Test criteria

Unit (mocked `pg`): normalisation — sanitized title, primary artist from
`"Michael Jackson, Akon"`, trimming, case folding; the SQL issued carries no
`album` predicate and does carry the artist predicate.

DB-backed (`*.db.test.ts`, `RUN_DB_TESTS=1`): same title + different artists +
no album → two rows; same artist + title + different albums → one row with the
first row's fields intact; cross-path convergence in both orders (manual then
Spotify, Spotify then manual); two concurrent `createAndAddSong` calls → one
catalog row (same owner: one repertoire row and the loser rejecting with the
unchanged message; different owners: two repertoire rows); a forced failure after
the catalog insert leaves no catalog row; the new index exists and the old one
does not; no duplicate identity group exists in the database.

Migration: a DB test seeds duplicate rows with the unique index dropped inside a
transaction, then executes the migration file read from disk. **The test must
resolve that filename at runtime, never hardcode it**: read `migrations/`, take
the single entry whose name ends with `_unify_song_identity.sql`, and fail the
test if there is not exactly one such entry. (This is the simpler of the two
options — matching the suffix rather than recomputing the highest prefix — and it
keeps the test green through a renumber.) It asserts one surviving row with the unioned links and the repointed repertoire /
playlist / pending-edit rows, re-executes the file to prove idempotence, and rolls
back. The seed must include a playlist holding **both** duplicates and a
repertoire owner holding both, so the two collision rules are exercised: the
playlist ends with one row at the lower of the two positions and contiguous
`1..n` positions, and the surviving repertoire row carries the dropped row's
`repertoire_tabs`.

Suite-level: `npm run test:coverage` meets its thresholds,
`src/lib/__tests__/transactionGuard.test.ts`,
`errorHandlingStyle.test.ts`, `namingConventions.test.ts` and
`complexityBudget.test.ts` stay green, `npm run lint:dead` and
`npm run lint:dup` stay green.

## Expected Results

- [ ] ER1 — Exactly one file in `migrations/` has a name ending
      `_unify_song_identity.sql`, and its four-digit prefix is the next number
      after the highest prefix otherwise present in `migrations/` (expected
      `0009`, but a higher number is correct if another migration landed first);
      `src/lib/__tests__/migrationsSingleSource.test.ts` passes, so the prefixes
      stay unique and contiguous from `0001`. After `npm run db:migrate`,
      `uq_global_songs_artist_title` exists as a UNIQUE index on
      `(lower(btrim(artist)), lower(btrim(title)))` and
      `uq_global_songs_title_album` no longer exists.
- [ ] ER2 — A DB test resolves that migration file by its
      `_unify_song_identity.sql` suffix (not a hardcoded prefix), executes it
      against seeded duplicate rows
      (index dropped, transaction rolled back) and asserts: the oldest row
      survives, links are unioned by URL, empty keeper columns are filled, and
      `repertoire`, `playlist_songs`, `global_song_edits` and `repertoire_tabs`
      point at surviving rows; re-executing the file changes nothing.
- [ ] ER3 — The migration survives a playlist that holds **both** rows of a
      duplicate group: that playlist ends with exactly one `playlist_songs` row
      for the keeper, whose `position` is the lowest of the two collapsed rows,
      and the playlist's positions are a contiguous `1..n` with no gap (DB test;
      a plain `UPDATE` violating `uq_playlist_song` would fail this).
- [ ] ER4 — `src/lib/songIdentity.ts` exists and is the only place under `src`
      that resolves or inserts a `global_songs` identity row by title/artist;
      both `createAndAddSong` and `findOrCreateGlobalSong` call it, and no query
      in either file selects or inserts `global_songs` by title/artist. The
      by-id and search queries in `src/lib/songs.ts`
      (`SELECT * FROM global_songs WHERE title ILIKE ... OR artist ILIKE ...` in
      `searchGlobalSongs`, and `SELECT links FROM global_songs WHERE id = $1`)
      are out of scope and must remain.
- [ ] ER5 — Adding two different songs that share a title, have different artists
      and no album produces **two** `global_songs` rows (DB test).
- [ ] ER6 — Adding the same artist+title with a different album produces **one**
      `global_songs` row, and the second caller's album, key, cover, duration and
      links do not overwrite the first row's values (DB test).
- [ ] ER7 — Cross-path convergence in both orders: a song created through
      `createAndAddSong` is found by `findOrCreateGlobalSong` for the same
      artist+title, and vice versa, with no second catalog row in either
      direction (DB test).
- [ ] ER8 — `createAndAddSong` performs all of its statements inside one
      `withTransaction` callback; a forced failure at the repertoire insert leaves
      no `global_songs` row behind (DB test), and `transactionGuard.test.ts`
      stays green.
- [ ] ER9 — Two concurrent `createAndAddSong` calls for the same new song yield
      exactly one `global_songs` row; for the same owner exactly one `repertoire`
      row with the losing call rejecting with the unchanged message
      `Song already in your repertoire`; for two different owners two
      `repertoire` rows (DB test).
- [ ] ER10 — No new `catch` inspects Postgres code `23505`: expected duplicates
      are absorbed by `ON CONFLICT DO NOTHING`, and
      `errorHandlingStyle.test.ts` stays green.
- [ ] ER11 — A Spotify track whose `artists` are `["Michael Jackson", "Akon"]` is
      ingested with artist `Michael Jackson` through the shared primary-artist
      helper, by both `src/lib/spotifyPlaylistSync.ts` and
      `src/app/api/spotify/search/route.ts`, and matches an existing
      `Michael Jackson` catalog row (unit test asserting both call sites).
- [ ] ER12 — Both paths store the sanitized title: creating
      `"Song X - 2011 Remaster"` through the manual form resolves to an existing
      `"Song X"` row by the same artist and creates no new row (DB test).
- [ ] ER13 — `npm run test:coverage` passes with its configured thresholds,
      `npm run lint:dead` and `npm run lint:dup` pass, and
      `complexityBudget.test.ts` passes with the `src/lib/songs.ts` `max-lines`
      override equal to that file's actual line count and the override list no
      longer than 17 entries. The ratchet in `complexityBudget.test.ts` is
      `MAX_OVERRIDES = 17` and `eslint.config.mjs` already carries exactly 17
      overrides, so the list may only shrink: adding an eighteenth fails the
      test this same ER requires to pass.
- [ ] ER14 — `package.json` version is bumped per AGENTS.md (patch + local
      `YYYYMMDDHHmm` suffix, strictly above every version in `git log`).
- [ ] ER15 — No landing-page copy changes: this is a correctness fix, not a
      selling point (AGENTS.md Landing Page Rule decision recorded here).

## Out of Scope

- **Title splitting.** `docs/plans/repertoire-rework.md` §Rules replaces
  `sanitizeSongTitle` with a `" - "` split whose right half becomes
  `song_versions.label`. On the current schema there is no column to hold that
  half, so splitting would merge the live, acoustic and remix takes into one row —
  an unrecoverable over-merge, the exact failure mode the plan ranks worst. This
  task therefore keeps `sanitizeSongTitle` (Rule B, which `docs/use-cases.md`
  *Add a song to the repertoire* step 1 also states as "sanitized title"), and the
  split lands with `song_versions` in RH-105.
- **ISRC.** `docs/reviews/feature-review.md` concludes ISRC is the more reliable
  signal; `docs/plans/repertoire-rework.md` §The model, reconciled later, rejects
  an `isrc` column outright. The plan is the later decision and governs: no ISRC
  here. Flagged as the one place where the two documents disagree.
- **The restructure** (`songs`/`albums`/`song_versions`/`catalog_suggestions`),
  RH-105. A consequence accepted meanwhile: because album leaves the key but
  versions do not yet exist, the first-entered album, cover and duration represent
  the song for everyone.
- **Catalog delete / split path**, and repairing false merges that already
  happened — there is still no way to undo one.
- **F1.2, F1.3** (`updateSong` silently discarding edits, `links` all-or-nothing),
  **F1.5** (trigram index and search ranking), **F1.6** (`/songs/search` stub),
  **F1.7** (`global_songs.updated_at`), and the band status trigger.
- **`scripts/deduplicate-songs.mjs`** stays as-is: the migration merges by stored
  values only, while that script also sanitizes titles and re-fetches link labels
  through the network — not something a migration should do.
- **No UI mockup**: this task changes no screen, and no open question here is a
  visual one.

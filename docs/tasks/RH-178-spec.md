# RH-178 — Fill a blank duration when a Spotify import meets an existing song

## Scope

"Enter Sandman" shows no duration. Its `songs` row (and its `song_versions` row)
were first created with `duration_seconds` NULL; a later Spotify import carried a
duration, but `resolveOrCreateSongIdentity` (`src/lib/songIdentity.ts`) returns a
found row untouched and `upsertAlbumAndVersion` (`src/lib/songVersions.ts`)
no-ops its `INSERT` on an existing version. Reads use
`COALESCE(v.duration_seconds, s.duration_seconds)`, so both stay blank forever.

This task makes the two shared catalog helpers **fill a blank duration** when
the incoming input carries one, and never overwrite a set value.

Covered:
- `songs.duration_seconds` and `song_versions.duration_seconds`, filled only
  where currently NULL, only from a non-null incoming duration.
- Both production write paths, because both go through the same two helpers:
  the Spotify import (`findOrCreateSong`) and the manual add
  (`createAndAddSong` -> `resolveCatalogSongForAdd`).

Not covered:
- Any other column (album, cover, key, links). Only duration is filled here.
- Overwriting or "correcting" a set duration — a different value stays as it
  is; corrections keep going through moderation (RH-97).
- Backfilling rows that are already NULL in production. That is an operator
  action (re-import the playlist, or a one-off SQL run by the operator; see the
  report), not code in this task.
- Any UI change.

## Approach

**Where the fill lives: in the shared helpers, not only on the Spotify path.**
The RH-97 catalog rule (`src/lib/catalogFields.ts`) is "a single owner may *fill
a blank* directly; a conflicting value goes to moderation". A manual add that
meets an existing song with a blank duration is exactly a fill, so it gets the
same treatment as a Spotify import; putting it in the helpers also keeps the two
paths from diverging again (the reason RH-95 created one resolver). A
conflicting value is simply not written; this path never offered a refusal
notice for create-time data and does not start now.

Behavior:
1. `resolveOrCreateSongIdentity`, on a **found** row (both the first lookup and
   the post-race re-lookup), when `input.duration_seconds` is a non-null
   number, runs one conditional update on that row: set `duration_seconds` to
   the input value and `updated_at = now()`, guarded by
   `duration_seconds IS NULL`. A row with a set duration is not touched at all
   (its `updated_at` does not move). The returned value is unchanged in shape.
2. `upsertAlbumAndVersion`, when the version `INSERT` was a no-op and the
   existing version was read back, runs the analogous conditional update on
   that `song_versions` row (no `updated_at` column exists there). A freshly
   inserted version is unaffected.
3. Both statements run on the caller's `db`/client, i.e. inside the existing
   `withTransaction` of `findOrCreateSong` and `createAndAddSong`. The
   `IS NULL` guard makes them idempotent and race-safe: two concurrent fills
   leave the first committed value.
4. The doc comments that promise "Found rows are returned untouched" /
   "never writes to a row it merely found" (`songIdentity.ts`) and "An existing
   version's `duration_seconds` and `key` are never overwritten"
   (`songVersions.ts`) are rewritten to state the new rule: a found row may have
   a blank duration filled, a set field is never overwritten.

Files touched:
- `src/lib/songIdentity.ts` — conditional duration fill on a found `songs` row; module and function comments updated.
- `src/lib/songVersions.ts` — conditional duration fill on a found `song_versions` row; comments updated.
- `src/lib/__tests__/catalogTimestampGuard.test.ts` — `EXPECTED_CATALOG_WRITERS` goes from 4 to 5 and its doc comment names the new `UPDATE songs` in `songIdentity.ts` (the new statement must carry `updated_at = now()`, which this guard enforces).
- `src/lib/__tests__/durationFill.db.test.ts` — new db test file (gated on `RUN_DB_TESTS` like its siblings) covering the cases below.
- `src/lib/__tests__/songIdentity.test.ts` / `songVersions.test.ts` — adjust mocked query sequences only if the extra statement breaks them.
- `docs/behavior.md` — add the registry line below under `## Spotify integration` (the helper only reads; edit that section directly).

Both source files are ~250 lines, well under the 400-line budget; no
complexity override may be added.

Test criteria (`durationFill.db.test.ts`, against the local Postgres):
- Spotify import fills a blank: seed a song + version with NULL duration via
  `createAndAddSong` with no duration, then `findOrCreateSong` the same
  title/artist with `durationSeconds: 331` -> both `songs.duration_seconds` and
  the returned version's `duration_seconds` are 331, and the
  `COALESCE(v.duration_seconds, s.duration_seconds)` read gives 331.
- No overwrite: seed with duration 300, import with 331 -> both stay 300, and
  `songs.updated_at` is unchanged.
- Null input fills nothing: seed NULL, import with `durationSeconds: null` -> both stay NULL.
- Manual add fills too: seed NULL via import with null duration, then
  `createAndAddSong` (another owner) with `duration_seconds: 240` -> both are 240.
- Atomicity: a failure later in the same transaction rolls the fill back
  (e.g. `createAndAddSong` for an owner who already holds the version throws
  "already in your repertoire" -> duration stays NULL).

## Behavior changes

- added: Spotify integration — An import or manual add that meets an existing song or version with a blank duration fills it from the incoming track, and never overwrites a set duration. (src/lib/songIdentity.ts, src/lib/songVersions.ts, src/lib/__tests__/durationFill.db.test.ts) (RH-178)

## Expected Results

- [ ] `durationFill.db.test.ts`: a Spotify import with a duration fills an existing song's and version's NULL `duration_seconds`.
- [ ] `durationFill.db.test.ts`: an import never changes a set `duration_seconds` on `songs` or `song_versions`, and leaves `songs.updated_at` unchanged.
- [ ] `durationFill.db.test.ts`: a manual add (`createAndAddSong`) with a duration fills an existing song's and version's NULL duration.
- [ ] `durationFill.db.test.ts`: when the add's transaction fails afterwards, the duration stays NULL.
- [ ] `catalogTimestampGuard.test.ts` passes with `EXPECTED_CATALOG_WRITERS` = 5, and `npm run lint`, `npm run lint:dup`, and the full unit and db test suites pass.
- [ ] `node scripts/behavior.js area "Spotify integration"` lists the new duration-fill line tagged RH-178.
- [ ] [operator] Re-import the playlist containing "Enter Sandman" (or run the backfill noted in the report) and confirm the song shows a duration.

# RH-179 — Fill every blank catalog field when a Spotify import meets an existing song

## Scope

The operator asked that a Spotify playlist import or sync "always update missing
information". RH-178 did this for one column: a found `songs` row and a found
`song_versions` row get a blank `duration_seconds` filled from the incoming
track. Every other field the track carries is still dropped on a found row:
`resolveOrCreateSongIdentity` (`src/lib/songIdentity.ts`) writes `album` and
`cover_url` only on insert, and `upsertAlbum` (`src/lib/songVersions.ts`) writes
`albums.cover_url` only on insert. A song first entered by hand without an album
or cover keeps showing none, because the repertoire and playlist reads use
`songs.album` / `songs.cover_url` directly (`src/lib/ownerSongRows.ts`,
`src/lib/playlistSql.ts`).

What a `SpotifyRawTrack` (`src/lib/spotifyPlaylistSync.ts`) carries, and what
happens to each field on a found row once this task is done:

| Track field | Catalog target | On a found row |
|---|---|---|
| `title`, `artist` | `songs.title`, `songs.artist` | Identity key; a found row always has them. Unchanged. |
| `durationSeconds` | `songs.duration_seconds`, `song_versions.duration_seconds` | Blank filled (RH-178). Unchanged. |
| `album` | `songs.album` | **New:** blank filled. |
| `album` | `albums` row + `version_albums` link | Already handled: a found version is linked to the incoming album today. Unchanged. |
| `albumArt` | `songs.cover_url` | **New:** blank filled. |
| `albumArt` | `albums.cover_url` (album found by `(artist, name)`) | **New:** blank filled. |
| `spotifyUrl` | `song_links` row | Already appended when missing. Unchanged. |

Covered:
- Filling `songs.album`, `songs.cover_url` and `albums.cover_url` on a found row
  when the stored value is blank and the incoming one is not.
- Both production write paths, because both go through the same two helpers:
  the Spotify import/sync (`findOrCreateSong`) and the manual add
  (`createAndAddSong` -> `resolveCatalogSongForAdd`).

Not covered:
- Overwriting or "correcting" any set value. A different incoming album or cover
  is not written; corrections keep going through moderation (RH-97).
- `standard_key` / `song_versions.key`. Spotify does not carry a key, and the
  key a musician types on a manual add is the owner row's own `key`
  (`catalogFields.ts`); this task does not start filling it on a found row.
- `albums.album_type` and `albums.release_date`. The Spotify playlist-tracks
  response has them, but `SpotifyRawTrack` does not map them and no app code
  writes them today; mapping new fields from the API is a separate task.
- Backfilling rows that are already blank in production. A re-import of the
  playlist fills them through this code; no migration or script is part of the
  task.
- Any UI change.

## Approach

**Where the fill lives: RH-178's mechanism, widened.** The fill stays in the
two shared helpers, on the caller's transaction client, guarded per column by
"the stored value is blank". RH-178's `fillBlankDuration` is generalised into
one blank-fill for the found `songs` row rather than joined by a parallel
helper per column.

**Manual add fills too — decided.** `createAndAddSong` passes `album` and
`cover_url` into the same helpers, and a manual add that meets a song with a
blank album or cover is exactly the RH-97 "fill a blank directly" case, the
same reasoning RH-178 applied to duration. Excluding it would need a flag on a
shared helper whose point is that the two paths cannot diverge (RH-95).

Behavior:
1. **Blank means** what `isCatalogFieldEmpty` (`src/lib/catalogFields.ts`) says:
   `NULL` or `''` for `album` and `cover_url`, `NULL` for `duration_seconds`.
   An incoming value is usable when it is non-null and, for text, non-empty
   after trimming. The album is written trimmed (as the insert path does).
2. **Found `songs` row** (first lookup and post-race re-lookup alike): each of
   `album`, `cover_url`, `duration_seconds` that is blank receives the usable
   incoming value; every other column is left as it is. This is done in **one**
   conditional `UPDATE songs` that replaces RH-178's duration-only statement,
   carries `updated_at = now()`, and matches the row only when at least one
   column is actually filled. A row where nothing is filled is not touched at
   all (its `updated_at` does not move). The production `UPDATE songs` count
   therefore stays 5.
3. **Found `albums` row** (the `ON CONFLICT DO NOTHING` insert was a no-op and
   the album was read back): a blank `albums.cover_url` receives the usable
   incoming cover. A freshly inserted album is unaffected. `albums` has no
   `updated_at` column.
4. **Found `song_versions` row**: unchanged from RH-178 (blank duration fill).
5. All statements run on the caller's `db`/client, inside the existing
   `withTransaction` of `findOrCreateSong` and `createAndAddSong`, so a later
   failure rolls every fill back. Per-column blank guards make the fill
   idempotent and race-safe: two concurrent fills leave the first committed
   value.
6. Doc comments that describe the found-row rule are rewritten to name all
   filled columns: `songIdentity.ts` module comment ("The first-entered album
   and cover represent the song ...") and `resolveOrCreateSongIdentity`'s
   comment, `songVersions.ts` around `upsertAlbum`, and the
   `findOrCreateSong` comment in `spotifyPlaylistSync.ts` ("A found row's own
   fields are never rewritten", which RH-178 left stale).

Files touched:
- `src/lib/songIdentity.ts` — the found-row fill covers `album`, `cover_url`, `duration_seconds` in one statement; comments updated.
- `src/lib/songVersions.ts` — blank `albums.cover_url` fill on a found album; comments updated.
- `src/lib/spotifyPlaylistSync.ts` — comment only.
- `src/lib/__tests__/catalogTimestampGuard.test.ts` — `EXPECTED_CATALOG_WRITERS` stays 5; its doc comment describes the `songIdentity.ts` statement as the blank-field fill, not the duration fill.
- `src/lib/__tests__/catalogBlankFill.db.test.ts` — new db test file, gated on `RUN_DB_TESTS` like its siblings, covering the cases below.
- `src/lib/__tests__/durationFill.db.test.ts` — unchanged; must keep passing.
- `src/lib/__tests__/songIdentity.test.ts`, `songVersions.test.ts`, `spotifyPlaylistSync.test.ts` — adjust mocked query sequences only where the new or changed statement breaks them.
- `docs/behavior.md` — replace the RH-178 duration-fill line under `## Spotify integration` with the line below (edit that section directly; the helper only reads).

The three source files are under 300 lines each, well inside the 400-line
budget; no complexity override may be added.

Test criteria (`catalogBlankFill.db.test.ts`, against the local Postgres):
- Import fills blanks: seed a song via `createAndAddSong` with no album and no
  cover, then `findOrCreateSong` the same title/artist with `album` and
  `albumArt` set -> `songs.album` and `songs.cover_url` hold the incoming values.
- Empty string is blank: a song whose `cover_url` is `''` gets the incoming
  cover.
- Album cover fills: an `albums` row that exists with a NULL `cover_url` (seed
  via an import with that album name and `albumArt: null`) gets the incoming
  cover when a later track on that album carries one.
- No overwrite: seed album "A" and cover "X", import with album "B" and cover
  "Y" (re-importing the same track URL so no link is appended) -> `songs.album`,
  `songs.cover_url` and `albums.cover_url` keep their values and
  `songs.updated_at` is unchanged.
- Blank incoming fills nothing: an import with `album: null`, `albumArt: null`
  leaves blank columns blank.
- Manual add fills too: seed via an import with no album/cover, then
  `createAndAddSong` by another owner with `album` and `cover_url` -> both filled.
- Atomicity: `createAndAddSong` for an owner who already holds the version
  throws "already in your repertoire" -> album and cover stay blank.

## Behavior changes

- changed: Spotify integration — An import or manual add that meets an existing song, version or album fills each blank album, cover or duration from the incoming track, and never overwrites a set value. (src/lib/songIdentity.ts, src/lib/songVersions.ts, src/lib/__tests__/catalogBlankFill.db.test.ts) (RH-179)

This replaces the RH-178 line "An import or manual add that meets an existing
song or version with a blank duration fills it from the incoming track, and
never overwrites a set duration."

## Expected Results

- [ ] `catalogBlankFill.db.test.ts`: a Spotify import with an album and cover fills an existing song's blank (`NULL` or `''`) `songs.album` and `songs.cover_url`.
- [ ] `catalogBlankFill.db.test.ts`: an import carrying a cover fills an existing album row's `NULL` `albums.cover_url`.
- [ ] `catalogBlankFill.db.test.ts`: an import never changes a set `songs.album`, `songs.cover_url` or `albums.cover_url`, and leaves `songs.updated_at` unchanged when nothing is filled.
- [ ] `catalogBlankFill.db.test.ts`: a manual add (`createAndAddSong`) with an album and cover fills an existing song's blank album and cover.
- [ ] `catalogBlankFill.db.test.ts`: when the add's transaction fails afterwards, album and cover stay blank.
- [ ] `catalogTimestampGuard.test.ts` passes with `EXPECTED_CATALOG_WRITERS` still 5, `durationFill.db.test.ts` passes unchanged, and `npm run lint`, `npm run lint:dup` and the full unit and db suites pass.
- [ ] `node scripts/behavior.js area "Spotify integration"` lists the album/cover/duration fill line tagged RH-179 and no longer the duration-only RH-178 line.
- [ ] [operator] Re-import a playlist containing a song that shows no cover or album today and confirm it now shows them.

## Out of Scope

Key fill, `albums.album_type` / `release_date`, mapping new Spotify API fields,
a production backfill script, moderation of conflicting values, UI.

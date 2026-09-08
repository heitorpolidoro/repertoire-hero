# RH-58 - query tipado parte 5/5: tipar o caminho de dados do Spotify e seus route handlers

Part 5 of 5 of RH-40 (RH-25 F16). Parent: RH-40. Depends on RH-54 (`f92c0f3`, the `DbRow`
foundation and `src/lib/dbRows.ts`) and RH-57 (`9e37072`), both `done`.

Baseline for every number in this spec is HEAD = `9e37072`. The numbers in the task's own draft
`expected_results` (17 call sites, 2 casts, `src/lib/spotify.ts` and `src/lib/auth.ts` among the
files) predate RH-55/RH-56/RH-57 and are stale: `src/lib/spotify.ts` holds no `query` call site at
all, `src/lib/auth.ts` holds exactly one - `src/lib/auth.ts:84` is `await pool.query(`, untyped on
`pg`'s own `Pool.query` (whose default type argument is `any`), invisible to this spec's greps only
because the receiver is named `pool`, and it is deliberately excluded from this task (see
"## Out of Scope" for the reason) - and three sites left over from RH-55 sit in
`src/lib/moderation.ts`. Every count below was re-measured at `9e37072`.

This is the last slice of F16. RH-40's own close-out is docs-only, so the tree has to end this
task with zero untyped row-reading call sites anywhere outside the transaction control in
`src/lib/db.ts` - that is what ER1 pins.

## Scope

Name the row shape at every remaining untyped `query` / `client.query` / `db.query` call site in
the Spotify data path (`src/lib/spotifyAuth.ts`, `src/lib/spotifyPlaylistSync.ts` and the four
route handlers under `src/app/api/**`) and in `src/lib/moderation.ts`, and delete every cast on a
query result in those files. Nothing else changes: every SQL string, every parameter array, every
thrown message, every logged tag and every returned value stay byte-identical.

Concretely, this task covers exactly:

1. The 14 untyped `query(` / `client.query(` sites: 1 in `src/lib/spotifyAuth.ts` (line 81), 3 in
   `src/lib/spotifyPlaylistSync.ts` (96, 104, 117), 4 in
   `src/app/api/spotify/playlists/[id]/sync/route.ts` (49, 103, 107, 178), 1 in
   `src/app/api/spotify/playlists/[id]/import/route.ts` (112), 1 in
   `src/app/api/auth/spotify/callback/route.ts` (132), 1 in
   `src/app/api/auth/spotify/disconnect/route.ts` (19) and 3 in `src/lib/moderation.ts`
   (32, 142, 150).
2. The 3 untyped `db.query(` sites in `src/lib/spotifyPlaylistSync.ts` (149, 153, 158) - the
   `Queryable` spelling of the same helper, in a file this task is already editing (see Approach
   section 5 for why they are in).
3. The 5 casts on query results: `src/lib/spotifyPlaylistSync.ts` lines 99, 100 and 125,
   `src/app/api/spotify/playlists/[id]/sync/route.ts` line 62, and `src/lib/moderation.ts`
   line 151.
4. One new interface in `src/lib/dbRows.ts` (`GlobalSongLinksRow`), taking that file from 9
   exported interfaces to 10.

It does not cover the HTTP-response casts in the same files (`src/lib/spotify.ts:30` and friends -
see the Audit), and it adds no feature, no migration and no UI change. No `eslint.config.mjs`
change is expected (see Approach section 6).

## Audit at 9e37072

The inventory command is the one RH-57 left behind:
`grep -rnE 'await (client\.)?query\(' src --include='*.ts' | grep -v __tests__`. At `9e37072` it
returns 17 lines: the 14 listed below plus `src/lib/db.ts:57`, `:59` and `:63`. That regex matches
only the `query` / `client.query` receivers; two other receivers exist in the tree and are handled
explicitly: `db.query(` (three sites in `src/lib/spotifyPlaylistSync.ts`, in scope - see Approach
section 5) and `pool.query(` (one site, `src/lib/auth.ts:84`, out of scope - see "## Out of Scope").

### `src/lib/db.ts` - the three lines that are deliberately left alone

`await client.query('BEGIN')`, `await client.query('COMMIT')` and `await client.query('ROLLBACK')`
inside `withTransaction` (`src/lib/db.ts:57`, `:59`, `:63`) are transaction control, not row
reads: they take no parameters, their `QueryResult` is discarded, and no column is ever read off
them. Typing them would document nothing. They stay exactly as they are, and every final-state
grep in this spec filters `src/lib/db.ts` out for that reason.

### `src/lib/spotifyAuth.ts` - untyped call sites (1)

| Line | Function | Statement (unchanged) | Rows read? | Row type to name |
|---|---|---|---|---|
| 81 | `getSpotifyAccessToken` | `UPDATE spotify_tokens SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = now() WHERE user_id = $4` (no `RETURNING`) | result discarded | `never` |

Already typed and untouched: line 14 (`query<SpotifyTokenRow>`). One typed call site today, 2
after this task. The file already imports from `@/lib/dbRows`, so no import line changes. The
`(await refreshResponse.json()) as { access_token: string; ... }` cast on line 65 is an HTTP
response body, not a DB row - out of scope (see "The casts" below).

### `src/lib/spotifyPlaylistSync.ts` - untyped call sites (6)

| Line | Function | Statement (unchanged) | Rows read? | Row type to name |
|---|---|---|---|---|
| 96 | `findOrCreateGlobalSong` | `SELECT id, links FROM global_songs WHERE LOWER(title) = LOWER($1) AND LOWER(artist) = LOWER($2) LIMIT 1` | `rows.length`, `rows[0].id`, `rows[0].links` | `GlobalSongLinksRow` (new) |
| 104 | `findOrCreateGlobalSong` | `UPDATE global_songs SET links = $1 WHERE id = $2` (no `RETURNING`) | result discarded | `never` |
| 117 | `findOrCreateGlobalSong` | `INSERT INTO global_songs (title, artist, album, cover_url, duration_seconds, links) VALUES ($1 .. $6) RETURNING id` | `rows[0].id` | inline `{ id: string }` |
| 149 | `ensureInRepertoire` | `INSERT INTO repertoire (band_id, song_id, status) VALUES ($1, $2, 'unknown') ON CONFLICT DO NOTHING` | result discarded | `never` |
| 153 | `ensureInRepertoire` | `INSERT INTO repertoire (user_id, song_id, status) SELECT bm.user_id, $1, 'unknown' FROM band_members bm WHERE bm.band_id = $2 ON CONFLICT DO NOTHING` | result discarded | `never` |
| 158 | `ensureInRepertoire` | `INSERT INTO repertoire (user_id, song_id, status) VALUES ($1, $2, 'unknown') ON CONFLICT DO NOTHING` | result discarded | `never` |

Lines 149, 153 and 158 are `db.query(` on the injected `Queryable` (the pool by default, a
transaction client when a caller passes one), which the inventory regex above does not match -
they are counted here because this task edits the file anyway. Zero typed call sites today, 6
after this task. The `(await response.json()) as SpotifyTracksPage` cast on line 59 is an HTTP
response body - out of scope.

### `src/app/api/spotify/playlists/[id]/sync/route.ts` - untyped call sites (4)

| Line | Statement (unchanged) | Rows read? | Row type to name |
|---|---|---|---|
| 49 | `SELECT spotify_playlist_id FROM playlists WHERE id = $1` | `rows[0].spotify_playlist_id` on lines 55 and 62 | inline `{ spotify_playlist_id: string \| null }` |
| 103 | `DELETE FROM playlist_songs WHERE playlist_id = $1` (inside `withTransaction`) | result discarded | `never` |
| 107 | the bulk `INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES ...` built by `buildPlaylistSongsInsert` (inside `withTransaction`) | result discarded | `never` |
| 178 | `UPDATE playlists SET last_synced_at = now(), updated_at = now() WHERE id = $1` | result discarded | `never` |

Already typed and untouched: lines 52 (`query<PlaylistSongIdRow>`) and 112
(`query<PlaylistSongLinksRow>`). Two typed call sites today, 6 after this task. The file already
imports from `@/lib/dbRows`, and the two new type arguments are inline, so no import line changes.
`playlists.spotify_playlist_id` is `text` with no `NOT NULL`
(`migrations/0001_initial_schema.sql:247`), hence the nullable column in the inline type; the
existing `if (!linkRes.rows[0].spotify_playlist_id) return ...` guard on line 55 is what narrows
it to `string` for line 62.

### `src/app/api/spotify/playlists/[id]/import/route.ts` - untyped call sites (1)

| Line | Statement (unchanged) | Rows read? | Row type to name |
|---|---|---|---|
| 112 | the bulk `INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES ...` built by `buildPlaylistSongsInsert` | result discarded | `never` |

Already typed and untouched: line 97 (`query<Playlist>`). One typed call site today, 2 after this
task. No import change: `never` needs none.

### `src/app/api/auth/spotify/callback/route.ts` - untyped call sites (1)

| Line | Statement (unchanged) | Rows read? | Row type to name |
|---|---|---|---|
| 132 | `INSERT INTO spotify_tokens (user_id, access_token, refresh_token, expires_at, spotify_user_id, created_at, updated_at) VALUES ($1 .. $7) ON CONFLICT (user_id) DO UPDATE SET ...` (no `RETURNING`) | result discarded | `never` |

Zero typed call sites today, 1 after. The two `(await ....json()) as {...}` casts on lines 90 and
103 are HTTP response bodies - out of scope.

### `src/app/api/auth/spotify/disconnect/route.ts` - untyped call sites (1)

| Line | Statement (unchanged) | Rows read? | Row type to name |
|---|---|---|---|
| 19 | `DELETE FROM spotify_tokens WHERE user_id = $1` | result discarded | `never` |

Zero typed call sites today, 1 after.

### `src/lib/moderation.ts` - untyped call sites (3)

| Line | Function | Statement (unchanged) | Rows read? | Row type to name |
|---|---|---|---|---|
| 32 | `checkSystemAdmin` | `SELECT is_system_admin FROM profiles WHERE id = $1` | `res.rowCount`, `res.rows[0]?.is_system_admin` | inline `{ is_system_admin: boolean }` |
| 142 | `reviewGlobalSongEdit` | `UPDATE global_songs SET <dynamic> WHERE id = $n` (no `RETURNING`, inside `withTransaction`) | result discarded | `never` |
| 150 | `reviewGlobalSongEdit` | `UPDATE global_song_edits SET status = 'approved', reviewed_by = $1, updated_at = now() WHERE id = $2 RETURNING *` (inside `withTransaction`) | `res.rows[0]`, returned as `GlobalSongEdit` | `GlobalSongEdit` (existing domain type) |

Already typed and untouched: lines 21, 72, 93 and 115 (`query<GlobalSongEdit>`). Four typed call
sites today, 7 after this task. `profiles.is_system_admin` is `boolean NOT NULL DEFAULT false`
(`migrations/0006_add_system_admin_and_moderation.sql:4`), so the inline column is non-nullable;
the existing `?.` on line 33 guards the absent-row case, not a null column, and stays.
`moderation.ts` needs no `@/lib/dbRows` import: two of its three sites are `never` / inline and
the third names the domain type the file already imports from `@/types/database`.

### The casts

`grep -rnE 'rows\[0\].* as |\brow\.[a-z_]+ as ' src --include='*.ts' | grep -v __tests__` returns
exactly 5 lines at `9e37072`, and all 5 are deleted by this task:

- `src/app/api/spotify/playlists/[id]/sync/route.ts:62` - `const spotifyPlaylistId = linkRes.rows[0].spotify_playlist_id as string`
- `src/lib/moderation.ts:151` - `return res.rows[0] as GlobalSongEdit`
- `src/lib/spotifyPlaylistSync.ts:99` - `const existingSongId = rows[0].id as string`
- `src/lib/spotifyPlaylistSync.ts:100` - `const existingLinks = (rows[0].links as Array<{ label: string; url: string }>) ?? []`
- `src/lib/spotifyPlaylistSync.ts:125` - `return insertRes.rows[0].id as string`

RH-57's wider inventory,
`grep -rn 'as [A-Z][A-Za-z]*\[\]\|rows\[0\] as \|\.rows as ' src --include='*.ts' | grep -v __tests__`,
returns two lines today: `src/lib/moderation.ts:151` (deleted here) and `src/lib/spotify.ts:30`.

**Decision on `src/lib/spotify.ts:30`** (`const data = await response.json() as SpotifyTrack[]`):
it stays, and this spec is where that is recorded. It is not a database row - `searchSpotify` is a
browser-side helper that `fetch`es `/api/spotify/search` and parses an HTTP body. F16 is about
`query()` results whose shape the compiler was never shown; `response.json()` is declared
`Promise<any>` by `lib.dom`, so the only ways to remove the `as` are (a) to move it to an
annotation (`const data: SpotifyTrack[] = await response.json()`), which launders the same
unchecked assumption into a different token and is exactly what RH-57's ER2 forbids, or (b) to add
a real runtime validator and filter non-conforming elements, which changes what the function
returns for a malformed body and would rewrite the 12 tests in `src/lib/__tests__/spotify.test.ts`.
Neither belongs in the last slice of a typing refactor; validating HTTP boundaries is its own
finding. The same reasoning covers the four sibling `(await ....json()) as {...}` casts in
`spotifyAuth.ts:65`, `spotifyPlaylistSync.ts:59`, `callback/route.ts:90` and `:103`, and the
`(await request.json()) as {...}` reads in the two Spotify route handlers. ER3 pins
`src/lib/spotify.ts:30` as the exact and only remaining line in the wider inventory, so the
decision is visible and reversible rather than silent. The task's draft ER asking for it to be
removed is therefore deliberately not honoured; the report filed with this spec flags that for the
orchestrator.

The `(error as { code?: string }).code` pattern from AGENTS.md convention `E1` appears nowhere in
these seven files, so nothing of that kind is at risk here.

### Existing types that already fit, and the one that does not

`SpotifyTokenRow`, `PlaylistSongIdRow` and `PlaylistSongLinksRow` (from `dbRows.ts`), `Playlist`
and `GlobalSongEdit` (from `src/types/database.ts`) already sit at the six call sites that are
typed today and stay untouched. Of the remaining projections, only `SELECT id, links FROM
global_songs` needs a name: `GlobalSong` (from `src/types/database.ts`) carries nine columns
against the two this projection selects, so naming it would assert seven columns the SELECT list
never returns; `PlaylistSongLinksRow` is a different projection (`song_id`, `position`, `links`).
The other five row-reading shapes are single-column or two-column projections evident at the call
site, which AGENTS.md ("Database Row Types") allows to be written inline.

## Approach

### 1. Statements that return no rows: `never`

Twelve statements return no rows at all - `spotifyAuth.ts:81`, `spotifyPlaylistSync.ts` 104, 149,
153 and 158, `sync/route.ts` 103, 107 and 178, `import/route.ts:112`, `callback/route.ts:132`,
`disconnect/route.ts:19` and `moderation.ts:142`: all are `UPDATE` / `INSERT` / `DELETE` without
`RETURNING`, and none of the twelve results is read at all. They are written `query<never>(...)`, `client.query<never>(...)` and
`db.query<never>(...)`, exactly as RH-56 and RH-57 did in `songs.ts`, `playlists.ts` and
`profile.ts`.

`never` satisfies the `T extends QueryResultRow` constraint on `query`, `Queryable.query` and
`PoolClient.query` - re-verified at `9e37072` with a throwaway probe module compiled by
`./node_modules/.bin/tsc --noEmit`, which exited 0 for all three spellings and was deleted
afterwards. It leaves `res.rowCount` readable and turns any later attempt to read a column off
such a result into a compile error. Leaving these sites untyped is not an option: the default
`DbRow` still parses as an untyped call site under ER1's grep and wrongly suggests the statement
yields readable rows.

### 2. Projections written inline

Three sites get an inline type argument, spelled exactly as follows (single spaces inside the
braces, because ER2 pins them as fixed strings):

```
await query<{ id: string }>(
await query<{ spotify_playlist_id: string | null }>(
await query<{ is_system_admin: boolean }>(
```

- `spotifyPlaylistSync.ts:117` -> `{ id: string }` (the `RETURNING id` of the `global_songs`
  insert).
- `sync/route.ts:49` -> `{ spotify_playlist_id: string | null }`.
- `moderation.ts:32` -> `{ is_system_admin: boolean }`.

### 3. The one new interface in `src/lib/dbRows.ts`

Added in the file's existing alphabetical-by-name order (between `BandMemberRoleRow` and
`JoinBandByInviteRow`) and in its doc-comment style, taking the file from 9 to 10 exported
interfaces:

```ts
/** `SELECT id, links FROM global_songs WHERE LOWER(title) = LOWER($1) AND LOWER(artist) = LOWER($2)` */
export interface GlobalSongLinksRow {
  id: string
  links: SongLink[]
}
```

`SongLink` is already imported by `dbRows.ts` (line 1), so the import clause does not change.
`links` is non-nullable because `global_songs.links` is `jsonb NOT NULL DEFAULT '[]'::jsonb`
(`migrations/0001_initial_schema.sql:105`); the `?? []` on line 100 is kept anyway, byte-identical
minus the cast, because deleting it would be a behaviour change on rows written before that
default existed, and no lint rule in `eslint.config.mjs` objects to a `??` on a non-nullable
operand (there is no type-aware `no-unnecessary-condition` in the config).

It earns a name rather than an inline literal because it is a two-column projection whose `links`
element type is a domain type, and because `dbRows.ts` is where AGENTS.md puts exactly this. It
duplicates no domain type: `GlobalSong` has nine fields against these two.

### 4. Per-site edits

`src/lib/spotifyAuth.ts`:

- Line 81 -> `await query<never>(updateSql, [`. No import change (line 2 already pulls
  `SpotifyTokenRow` from `@/lib/dbRows`), no cast to delete, no line-count change.

`src/lib/spotifyPlaylistSync.ts`:

- Add `import type { GlobalSongLinksRow } from '@/lib/dbRows'` after the `@/lib/db` import on
  line 12 (+1 line, file goes 185 -> 186).
- Line 96 -> `const { rows } = await query<GlobalSongLinksRow>(lookupSql, [cleanTitle, track.artist.trim()])`.
- Line 99 -> `const existingSongId = rows[0].id` (cast deleted).
- Line 100 -> `const existingLinks = rows[0].links ?? []` (cast and its parentheses deleted).
- Line 104 -> `await query<never>(`.
- Line 117 -> `const insertRes = await query<{ id: string }>(insertSql, [`.
- Line 125 -> `return insertRes.rows[0].id` (cast deleted).
- Lines 149, 153, 158 -> `await db.query<never>(`.

`src/app/api/spotify/playlists/[id]/sync/route.ts`:

- Line 49 -> `const linkRes = await query<{ spotify_playlist_id: string | null }>('SELECT spotify_playlist_id FROM playlists WHERE id = $1', [localPlaylistId])`.
  The line grows to ~147 characters; there is no `max-len` rule in `eslint.config.mjs`, and the
  neighbouring lines 52 and 178 are already of that order.
- Line 62 -> `const spotifyPlaylistId = linkRes.rows[0].spotify_playlist_id` (cast deleted). The
  `if (!linkRes.rows[0].spotify_playlist_id) return ...` on line 55 narrows the element access to
  `string`, so the cast is not merely deleted, it is replaced by a check the compiler performs -
  verified with the probe described in section 1, which compiled this exact shape at `9e37072`.
- Lines 103 and 107 -> `await client.query<never>(`.
- Line 178 -> `await query<never>(`.
- No import change: both new type arguments are inline, and the file already imports
  `PlaylistSongIdRow` / `PlaylistSongLinksRow` from `@/lib/dbRows`.

`src/app/api/spotify/playlists/[id]/import/route.ts`:

- Line 112 -> `await query<never>(sql, values)`. No import change, no line-count change.

`src/app/api/auth/spotify/callback/route.ts`:

- Line 132 -> `await query<never>(upsertSql, [`. No import change, no line-count change.

`src/app/api/auth/spotify/disconnect/route.ts`:

- Line 19 -> `await query<never>('DELETE FROM spotify_tokens WHERE user_id = $1', [userId])`. No
  import change, no line-count change.

`src/lib/moderation.ts`:

- Line 32 -> `const res = await query<{ is_system_admin: boolean }>(sql, [userId])`.
- Line 142 -> `await client.query<never>(updateSongSql, values)`.
- Line 150 -> `const res = await client.query<GlobalSongEdit>(updateEditSql, [adminUserId, editId])`.
- Line 151 -> `return res.rows[0]` (cast deleted). `GlobalSongEdit` stays imported on line 4 - it
  is still the function's declared return type and the type argument at four other call sites.
- No import change, no line-count change.

Route handlers live under `src/app`, so the F21/RH-47 import-direction rule (which forbids
`src/lib`, `src/components` and `src/hooks` from importing `@/app/*`) does not constrain them;
`sync/route.ts` already imports `@/lib/dbRows` today.

### 5. Why the three `db.query` sites are in scope

`ensureInRepertoire(songId, owner, db: Queryable = pool)` runs three statements through the
injected `Queryable`, whose `query<T extends QueryResultRow = DbRow>` signature is the same helper
signature `query()` has. They are not matched by the inventory regex only because the receiver is
named `db` rather than `client`. Typing them is three tokens in a file this task already edits;
leaving exactly three untyped sites behind in the middle of `spotifyPlaylistSync.ts` while the
three above them get named would read as an oversight and would leave F16's close-out inaccurate.
ER1 therefore pins both greps: the mandated one (`query(` / `client.query(`) and a wider one that
also covers `db.query(`.

### 6. Line counts and complexity budgets

None of the seven edited files has a `max-lines` override; the largest after the edit is
`sync/route.ts` at 192 lines and `spotifyPlaylistSync.ts` at 186, both far under the base
`max-lines: 400`. `sync/route.ts` carries
`{ files: ["src/app/api/spotify/playlists/\\[id\\]/sync/route.ts"], rules: { complexity: ["error", 26], "max-depth": ["error", 5] } }`
(`eslint.config.mjs:71`) and `import/route.ts` carries `complexity: ["error", 21]`
(`eslint.config.mjs:70`). No branch, loop or `&&` is added or removed by any edit in this task -
deleting an `as` cast changes no decision point, and the `if` on line 55 that does the narrowing
already exists - so neither route's measured complexity moves and neither override can be
tightened on the strength of this change. `eslint.config.mjs` is therefore expected to be
**unchanged** and the override list stays at 23 entries (ER6 pins both). The `POST` handlers stay
at 168 and 98 lines against `max-lines-per-function: 200`.

### 7. Test plan

No new test file and no change to any existing test. `tsconfig.json` excludes `**/__tests__/**`,
so the `@/lib/db` mocks that hand back plain object literals are never type-checked and naming a
row type cannot invalidate one. The behaviour proof is the suites that already exercise these
files, all green at `9e37072`:

| Suite | Tests | What it pins |
|---|---|---|
| `src/lib/__tests__/spotify.test.ts` | 12 | `searchSpotify` (the file whose cast this task leaves alone) |
| `src/lib/__tests__/spotifyPlaylistSync.test.ts` | 10 | `findOrCreateGlobalSong`, `ensureInRepertoire`, `buildPlaylistSongsInsert` |
| `src/lib/__tests__/spotifyRouteAuth.test.ts` | 12 | the guards the two playlist routes run before any query |
| `src/lib/__tests__/spotifyPlaylistRouteAuthz.db.test.ts` | 11 | sync/import authorization against real Postgres |
| `src/lib/__tests__/spotifySyncAtomicity.db.test.ts` | 2 | the delete+reinsert transaction in `sync/route.ts` |
| `src/lib/__tests__/moderation.test.ts` | 12 | `checkSystemAdmin`, `getPendingGlobalSongEdits`, `reviewGlobalSongEdit` |
| `src/lib/__tests__/moderationPayload.db.test.ts` | 2 | approve/reject against real Postgres |
| `src/app/actions/__tests__/authzRepertoire.db.test.ts` | 20 | the repertoire rows `ensureInRepertoire` seeds |
| `src/lib/__tests__/devProfiles.test.ts` | 7 | the `profiles` reads around `is_system_admin` |
| `src/lib/__tests__/dbRowTypes.test.ts` | 3 | the RH-54 guard, incl. "every `dbRows.ts` export is imported" |
| `src/lib/__tests__/complexityBudget.test.ts` | 6 | the RH-39 ratchet |

Sum: 97 tests across 11 files (measured at `9e37072`).

Type safety itself is proven by `./node_modules/.bin/tsc --noEmit` exiting 0 with the five casts
gone: with `DbRow = Record<string, unknown>` as the default, an unnamed row cannot be read at all,
so a compiling read is a proof the shape was declared.

## Expected Results

ER1 - F16's final state: no untyped row-reading query call site is left in the tree. From the repo
root, `sh -c "grep -rnE 'await (client\.)?query\(' src --include='*.ts' | grep -v __tests__ | grep -v '^src/lib/db.ts:'"`
prints nothing and exits non-zero (at `9e37072` it prints exactly 14 lines: `spotifyAuth.ts:81`;
`spotifyPlaylistSync.ts` 96, 104, 117; `sync/route.ts` 49, 103, 107, 178; `import/route.ts:112`;
`callback/route.ts:132`; `disconnect/route.ts:19`; `moderation.ts` 32, 142, 150). The wider form
that also catches the `Queryable` receiver,
`sh -c "grep -rnE 'await (client|db)?\.?query\(' src --include='*.ts' | grep -v __tests__ | grep -v '^src/lib/db.ts:'"`,
likewise prints nothing and exits non-zero (at `9e37072`: 17 lines, the 14 above plus
`spotifyPlaylistSync.ts` 149, 153, 158). The three transaction-control lines survive untouched:
`grep -cE "await client\.query\('(BEGIN|COMMIT|ROLLBACK)'\)" src/lib/db.ts` prints `3` and
`git diff 9e37072 -- src/lib/db.ts` prints nothing. Per file,
`grep -cE 'await (client\.)?query<' src/lib/spotifyAuth.ts src/lib/spotifyPlaylistSync.ts src/lib/moderation.ts 'src/app/api/spotify/playlists/[id]/sync/route.ts' 'src/app/api/spotify/playlists/[id]/import/route.ts' src/app/api/auth/spotify/callback/route.ts src/app/api/auth/spotify/disconnect/route.ts`
prints `2`, `3`, `7`, `6`, `2`, `1` and `1` respectively (baseline `1`, `0`, `4`, `2`, `1`, `0`,
`0`). The one deliberately excluded call site is still there and still untouched:
`grep -c 'await pool.query(' src/lib/auth.ts` prints `1`, unchanged from baseline, and
`git diff 9e37072 -- src/lib/auth.ts` prints nothing.

ER2 - each row type is exactly the one this spec names, pinned as a fixed string with its own file
operand. From the repo root: `grep -cF 'await query<never>(' src/lib/spotifyAuth.ts` prints `1`;
`grep -cF 'await query<GlobalSongLinksRow>(' src/lib/spotifyPlaylistSync.ts` prints `1`;
`grep -cF 'await query<never>(' src/lib/spotifyPlaylistSync.ts` prints `1`;
`grep -cF 'await query<{ id: string }>(' src/lib/spotifyPlaylistSync.ts` prints `1`;
`grep -cF 'await db.query<never>(' src/lib/spotifyPlaylistSync.ts` prints `3`;
`grep -cF 'await query<{ spotify_playlist_id: string | null }>(' 'src/app/api/spotify/playlists/[id]/sync/route.ts'` prints `1`;
`grep -cF 'await client.query<never>(' 'src/app/api/spotify/playlists/[id]/sync/route.ts'` prints `2`;
`grep -cF 'await query<never>(' 'src/app/api/spotify/playlists/[id]/sync/route.ts'` prints `1`;
`grep -cF 'await query<never>(sql, values)' 'src/app/api/spotify/playlists/[id]/import/route.ts'` prints `1`;
`grep -cF 'await query<never>(upsertSql, [' src/app/api/auth/spotify/callback/route.ts` prints `1`;
`grep -cF 'await query<never>(' src/app/api/auth/spotify/disconnect/route.ts` prints `1`;
`grep -cF 'await query<{ is_system_admin: boolean }>(' src/lib/moderation.ts` prints `1`;
`grep -cF 'await client.query<never>(' src/lib/moderation.ts` prints `1`; and
`grep -cF 'await client.query<GlobalSongEdit>(' src/lib/moderation.ts` prints `1`. No `any`
sneaked in as a substitute: `grep -rn ': any\|<any>\|as any' src/lib/spotifyAuth.ts src/lib/spotifyPlaylistSync.ts src/lib/moderation.ts src/lib/dbRows.ts 'src/app/api/spotify/playlists/[id]/sync/route.ts' 'src/app/api/spotify/playlists/[id]/import/route.ts' src/app/api/auth/spotify/callback/route.ts src/app/api/auth/spotify/disconnect/route.ts`
prints nothing and exits non-zero.

ER3 - the five query-result casts are gone and none was laundered. From the repo root,
`sh -c "grep -rnE 'rows\[0\].* as |\brow\.[a-z_]+ as ' src --include='*.ts' | grep -v __tests__"`
prints nothing and exits non-zero (at `9e37072` it prints exactly 5 lines: `sync/route.ts:62`,
`moderation.ts:151`, `spotifyPlaylistSync.ts` 99, 100 and 125). The wider RH-57 inventory,
`sh -c "grep -rn 'as [A-Z][A-Za-z]*\[\]\|rows\[0\] as \|\.rows as ' src --include='*.ts' | grep -v __tests__"`,
prints exactly one line, `src/lib/spotify.ts:30`, and nothing else (baseline: that line plus
`src/lib/moderation.ts:151`) - `src/lib/spotify.ts` is an HTTP-body cast deliberately kept, and
`git diff 9e37072 -- src/lib/spotify.ts` prints nothing. Laundering is excluded:
`grep -rn 'as unknown as' src --include='*.ts' --include='*.tsx' | grep -v __tests__ | wc -l`
prints `2`, unchanged from baseline;
`grep -rc '@ts-ignore\|@ts-expect-error\|@ts-nocheck' src --include='*.ts' --include='*.tsx' | grep -v ':0$' | wc -l`
prints `0`; and `grep -cE ': (SpotifyTrack|GlobalSongEdit|SongLink)\[\] = await' src --include='*.ts' -r | grep -v ':0$' | wc -l`
prints `0`, so no cast was rewritten as a type annotation on an `any`-valued await.

ER4 - the one new row interface lives in `src/lib/dbRows.ts` and is consumed.
`grep -c '^export interface ' src/lib/dbRows.ts` prints `10` (baseline `9`) and
`grep -cF 'export interface GlobalSongLinksRow {' src/lib/dbRows.ts` prints `1`. Its fields are
declared there: `sed -n '/^export interface GlobalSongLinksRow {$/,/^}$/p' src/lib/dbRows.ts | grep -cE '^  (id: string|links: SongLink\[\])$'`
prints `2`. No row interface was added to the edited modules:
`grep -c '^export interface .*Row' src/lib/spotifyAuth.ts src/lib/spotifyPlaylistSync.ts src/lib/moderation.ts 'src/app/api/spotify/playlists/[id]/sync/route.ts' 'src/app/api/spotify/playlists/[id]/import/route.ts' src/app/api/auth/spotify/callback/route.ts src/app/api/auth/spotify/disconnect/route.ts`
prints `0` for all seven files. `grep -rl "from '@/lib/dbRows'" src --include='*.ts' | grep -v __tests__ | sort`
lists exactly seven paths - `src/app/api/spotify/playlists/[id]/sync/route.ts`,
`src/lib/bands.server.ts`, `src/lib/bands.ts`, `src/lib/playlists.ts`, `src/lib/songs.ts`,
`src/lib/spotifyAuth.ts` and `src/lib/spotifyPlaylistSync.ts` (baseline: the same six without
`spotifyPlaylistSync.ts`). `npm run lint:dead` prints no file or symbol list and exits 0, and
`rtk proxy npx vitest run src/lib/__tests__/dbRowTypes.test.ts` reports `Test Files 1 passed (1)`
and `Tests 3 passed (3)`.

ER5 - every SQL statement, parameter list, thrown message and logged tag is byte-identical. In
bash or zsh, from the repo root, for each of the seven edited files that carry a query call site - `src/lib/spotifyAuth.ts`,
`src/lib/spotifyPlaylistSync.ts`, `src/lib/moderation.ts`,
`src/app/api/spotify/playlists/[id]/sync/route.ts`,
`src/app/api/spotify/playlists/[id]/import/route.ts`, `src/app/api/auth/spotify/callback/route.ts`
and `src/app/api/auth/spotify/disconnect/route.ts` - the command
`diff <(git show 9e37072:FILE | sed -E 's/query<[^>]*>\(/query(/g') <(sed -E 's/query<[^>]*>\(/query(/g' FILE) | grep -cE 'SELECT|INSERT|UPDATE|DELETE|RETURNING|VALUES|ON CONFLICT|\$[0-9]|throw new |logger\.|NextResponse'`
prints `0` with `FILE` substituted: once the added type arguments are normalized away, not one
differing line carries SQL text, a bind placeholder, a thrown message, a log call or a response.
For the four files whose only change is a type argument - `src/lib/spotifyAuth.ts`,
`src/app/api/spotify/playlists/[id]/import/route.ts`, `src/app/api/auth/spotify/callback/route.ts`
and `src/app/api/auth/spotify/disconnect/route.ts` - the stronger form holds:
`diff <(git show 9e37072:FILE | sed -E 's/query<[^>]*>\(/query(/g') <(sed -E 's/query<[^>]*>\(/query(/g' FILE)`
prints nothing at all.

ER6 - nothing outside the eight edited files moved, and the complexity budgets were neither loosened nor
disturbed. `git diff 9e37072 -- src/components src/hooks src/store src/types src/i18n migrations eslint.config.mjs`
prints nothing, and `git diff 9e37072 -- src/lib/db.ts src/lib/spotify.ts src/lib/spotifyRouteAuth.ts src/lib/songs.ts src/lib/bands.ts src/lib/bands.server.ts src/lib/playlists.ts src/lib/profile.ts`
prints nothing. `git diff --name-only 9e37072 -- src/app | sort` lists exactly
`src/app/api/auth/spotify/callback/route.ts`, `src/app/api/auth/spotify/disconnect/route.ts`,
`src/app/api/spotify/playlists/[id]/import/route.ts` and
`src/app/api/spotify/playlists/[id]/sync/route.ts`, and
`git diff --name-only 9e37072 -- src | grep -c 'test\.tsx\?$'` prints `0` (no existing test file
needed changing). `grep -c 'complexity-budget/override' eslint.config.mjs` prints `23`, unchanged,
and `grep -cF 'complexity: ["error", 26]' eslint.config.mjs` prints `1` (the sync route's ceiling
is still 26, neither raised nor - since no branch was removed - lowered).
`wc -l src/lib/spotifyAuth.ts src/lib/spotifyPlaylistSync.ts src/lib/moderation.ts src/lib/dbRows.ts 'src/app/api/spotify/playlists/[id]/sync/route.ts' 'src/app/api/spotify/playlists/[id]/import/route.ts' src/app/api/auth/spotify/callback/route.ts src/app/api/auth/spotify/disconnect/route.ts`
prints eight numbers each `<= 400`, and
`rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts` reports
`Test Files 1 passed (1)` and `Tests 6 passed (6)`.

ER7 - the suites that exercise these files stay green with unchanged counts. With Postgres live at
`postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied and a non-empty
`SUPABASE_SERVICE_ROLE_KEY` in `.env.local`,
`rtk proxy npx vitest run src/lib/__tests__/spotify.test.ts src/lib/__tests__/spotifyPlaylistSync.test.ts src/lib/__tests__/spotifyRouteAuth.test.ts src/lib/__tests__/spotifyPlaylistRouteAuthz.db.test.ts src/lib/__tests__/spotifySyncAtomicity.db.test.ts src/lib/__tests__/moderation.test.ts src/lib/__tests__/moderationPayload.db.test.ts src/app/actions/__tests__/authzRepertoire.db.test.ts src/lib/__tests__/devProfiles.test.ts src/lib/__tests__/dbRowTypes.test.ts src/lib/__tests__/complexityBudget.test.ts`
reports `Test Files 11 passed (11)` and `Tests 97 passed (97)`, with `0 failed` and no skipped test
(identical to the `9e37072` baseline: 12 + 10 + 12 + 11 + 2 + 12 + 2 + 20 + 7 + 3 + 6).

ER8 - the static gates hold exactly where they did. `./node_modules/.bin/tsc --noEmit` writes
nothing to stdout or stderr and exits 0. `rtk proxy npx eslint .` ends with the summary line
`22 problems (8 errors, 14 warnings)` - unchanged from `9e37072` - and
`rtk proxy npx eslint . 2>&1 | grep -cE '/src/(lib/(spotifyAuth|spotifyPlaylistSync|moderation|dbRows)\.ts|app/api/(spotify/playlists/\[id\]/(sync|import)|auth/spotify/(callback|disconnect))/route\.ts)$'`
prints `0` (it prints `0` at baseline too: none of the eight touched files is listed by eslint
today, and none may become listed). `npm run lint:dup` prints `Found 19 clones.` or fewer, with a
total of `242 (0.71%)` duplicated lines or fewer. `npm run audit` prints
`found 0 vulnerabilities`.

ER9 - the whole suite and the coverage gate stay green, modulo one named pre-existing flake. With
the same DB precondition as ER7 (Postgres live at
`postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied and a non-empty
`SUPABASE_SERVICE_ROLE_KEY` in `.env.local`), `rtk proxy npx vitest run` reports at least 92 test
files and at least 1064 tests, with `0 skipped`. The only tolerated failure is the single test
`src/lib/__tests__/complexityBudget.test.ts > complexity budget (F20) > sets the base budget for src at complexity 15, max-depth 4, max-lines-per-function 200, max-params 4 and max-lines 400`
failing with `Error: Test timed out in 5000ms.` at `complexityBudget.test.ts:82` on
`await loadConfig()`: that is a pre-existing flake under full-suite parallel load, reproducible at
the `9e37072` baseline in 3 of 5 runs, unrelated to RH-58 and owned by follow-up task RH-59, and
RH-58 must not touch that test. If that one failure appears (i.e. the run reports
`Test Files 1 failed | 91 passed (92)` / `Tests 1 failed | 1063 passed (1064)` and the failing test
is exactly the one named above), QA re-runs
`rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts` in isolation and it must
report `Tests 6 passed (6)` for ER9 to count as passed; any other failing test, any skipped test,
fewer than 92 files or fewer than 1064 tests fails ER9. If the run is green, nothing extra is
needed. The same rule applies to `npm run test:coverage`, which runs the same full suite: its exit
code may be non-zero only because of that one named timeout (attributed the same way, with the same
isolated re-run), and regardless of exit code its `All files` row must show statements >= 80,
branches >= 65, functions >= 78 and lines >= 80, with no
`ERROR: Coverage for ... does not meet global threshold` line anywhere in the output.

ER10 - the app still builds and renders server-side, the version went up, the landing page did not
move, and the diff stays inside the whitelist. `npx next build` exits 0 and its output contains no
line matching `^Error|^Failed|Failed to compile` (do not grep for `Compiled successfully`: this
Next version does not print that phrase on success), and
`npx playwright test e2e/ssr-smoke.spec.ts` reports `4 passed`.
`node -p "require('./package.json').version"` prints a string matching `^0\.1\.87-[0-9]{12}$`,
which sorts strictly after the baseline `0.1.86-202609080234`. This task ships no selling point (it
is an internal type-safety refactor, invisible to musicians), so
`git diff 9e37072 -- src/components/landing/LandingPage.tsx src/i18n/dictionaries/en.json src/i18n/dictionaries/pt-BR.json`
prints nothing. `git diff --name-only 9e37072 | sort` lists only paths drawn from this closed set:
`AGENTS.md`, `docs/suggestions-log.md`, `docs/tasks/RH-58-spec.md`, `package.json`,
`src/app/api/auth/spotify/callback/route.ts`, `src/app/api/auth/spotify/disconnect/route.ts`,
`src/app/api/spotify/playlists/[id]/import/route.ts`,
`src/app/api/spotify/playlists/[id]/sync/route.ts`, `src/lib/dbRows.ts`, `src/lib/moderation.ts`,
`src/lib/spotifyAuth.ts`, `src/lib/spotifyPlaylistSync.ts` - any other path fails this result.

## Out of Scope

- Every HTTP-body cast in the touched path: `src/lib/spotify.ts:30`, `src/lib/spotifyAuth.ts:65`,
  `src/lib/spotifyPlaylistSync.ts:59`, `src/app/api/auth/spotify/callback/route.ts:90` and `:103`,
  and the `(await request.json()) as {...}` reads in the two playlist routes. They parse network
  payloads, not `QueryResult` rows; validating HTTP boundaries is a separate finding (see the
  Audit for the full argument). ER3 pins `src/lib/spotify.ts:30` in place.
- The three `client.query('BEGIN'|'COMMIT'|'ROLLBACK')` lines in `src/lib/db.ts` - transaction
  control, no rows, no parameters. ER1 pins them unchanged.
- `src/lib/auth.ts:84`, the one `await pool.query(` in the tree (untyped, straight on `pg`'s
  `Pool.query`, whose default type argument is `any`). It is an
  `INSERT INTO profiles (id, email, full_name) VALUES ($1::uuid, $2, $3) ON CONFLICT (id) DO NOTHING`
  inside the Better Auth `user.create.after` hook: the `QueryResult` is discarded, so no column is
  ever read off it and no cast hides there, and `auth.ts` is outside the Spotify data path this task
  owns. Typing it would document nothing here and would widen the diff past this task's whitelist,
  so the implementer must not touch it - ER1 pins it as unchanged and ER10's whitelist deliberately
  omits `src/lib/auth.ts`. The post-merge guard note below carries the `pool.query(` receiver
  forward so a repo-wide ratchet can decide about it on its own terms.
- Any change to SQL text, parameter order, return values, thrown messages or logging (ER5).
- Any change to `src/types/database.ts`, `src/lib/spotifyRouteAuth.ts`, the RH-54 guard test, or
  any other module already cleared by RH-55/RH-56/RH-57.
- Any `eslint.config.mjs` edit, including retightening an override: no branch count moves here
  (ER6).
- A repo-wide lint rule or guard test forbidding untyped `query(` call sites. The tree only
  becomes clean at the end of this task; adding the ratchet is a follow-up worth its own task, and
  it needs an exemption for `src/lib/db.ts`.
- Runtime validation of Spotify API payloads, new tests, new features, migrations, UI and
  landing-page copy.
- The RH-40 close-out itself (marking F16/F17 in `docs/plans/code-quality-review.md`) - it is
  docs-only and post-merge.

## Post-merge checks (orchestrator)

- RH-40's close-out is now unblocked on the code side: F16 in `docs/plans/code-quality-review.md`
  (line 365, and row 16 of the summary table at line 483) can be marked resolved, together with
  F17 (line 373 / row 17) which RH-55 already delivered. The "Covers: F16, F17" plan entry near
  line 545 can be closed with it.
- Carry forward the one remaining cast in the inventory, `src/lib/spotify.ts:30`, and the decision
  recorded in this spec's Audit: it is an HTTP-body cast, not a DB row. If the HTTP boundary is
  worth validating, capture it as a new finding rather than reopening F16.
- Consider a follow-up guard (a `no-restricted-syntax` rule or a source-scan test in the style of
  `dbRowTypes.test.ts`) that fails on `await query(` / `await client.query(` / `await db.query(` /
  `await pool.query(` without a type argument outside `src/lib/db.ts`, now that the tree is at zero
  for the first three receivers. The fourth receiver has exactly one site, `src/lib/auth.ts:84`
  (result discarded; left untouched by RH-58 on purpose - see "## Out of Scope"), so such a guard
  either types that site first or exempts it explicitly.
- RH-59 owns the `complexityBudget.test.ts` full-suite timeout flake that ER9 tolerates by name. Its
  fix is independent of RH-58 and must not be folded into this task's diff.

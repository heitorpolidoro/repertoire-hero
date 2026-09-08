# RH-57 - query tipado parte 4/5: tipar a camada de dados de bands, playlists e profile

Part 4 of 5 of RH-40 (RH-25 F16). Parent: RH-40. Depends on RH-54 (`f92c0f3`, the `DbRow`
foundation and `src/lib/dbRows.ts`) and RH-56 (`b293e82`), both `done`.

Baseline for every number in this spec is HEAD = `b293e82`. The numbers in the task's own
draft `expected_results` (21 call sites, 9 casts) predate RH-55/RH-56 and are stale; every
count below was re-measured at `b293e82`.

## Scope

Name the row shape at every remaining untyped `query` / `client.query` call site in
`src/lib/bands.ts`, `src/lib/bands.server.ts`, `src/lib/playlists.ts` and `src/lib/profile.ts`,
and delete every `as` cast on a query result in those four files (plus the one redundant
`as BandMember[]` on `getBandMembers`, which the repo-wide cast inventory counts). Nothing else
changes: every SQL string, every parameter array, every thrown message and every return value
stay byte-identical.

Concretely, this task covers exactly:

1. The 27 untyped call sites: 12 in `src/lib/bands.ts` (lines 41, 115, 123, 162, 179, 194, 210,
   223, 278, 292, 308, 326), 1 in `src/lib/bands.server.ts` (line 42), 11 in
   `src/lib/playlists.ts` (lines 10, 81, 124, 138, 159, 163, 168, 179, 197, 289, 292) and 3 in
   `src/lib/profile.ts` (lines 59, 76, 77).
2. The 14 casts on query results / domain rows in those files: `bands.ts` lines 54, 121, 218,
   279, 294, 335 and 348; `bands.server.ts` line 45; `playlists.ts` lines 89, 290, 294, 295,
   296 and 297.
3. Four new interfaces in `src/lib/dbRows.ts` (`BandMemberRoleRow`, `JoinBandByInviteRow`,
   `PlaylistAccessRow`, `PlaylistEntryRow`).

It does not cover any other module's call sites or casts, and it adds no feature, no migration
and no UI change. No `eslint.config.mjs` change is expected (see Approach section 5).

## Audit at b293e82

### `src/lib/bands.ts` - untyped call sites (12)

| Line | Function | Statement (unchanged) | Rows read? | Row type to name |
|---|---|---|---|---|
| 41 | `assertBandMember` | `SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2` | `res.rowCount`, `res.rows[0].role` | `BandMemberRoleRow` (new) |
| 115 | `createBand` | `SELECT create_band($1, $2, $3, $4) as band_id` | `res.rows[0].band_id` | inline `{ band_id: string }` |
| 123 | `createBand` | `UPDATE bands SET color = $1 WHERE id = $2` (no `RETURNING`) | result discarded | `never` |
| 162 | `updateBand` | `UPDATE bands SET <dynamic> WHERE id = $n` (no `RETURNING`) | `res.rowCount` only | `never` |
| 179 | `deleteBand` | `DELETE FROM bands WHERE id = $1` | `res.rowCount` only | `never` |
| 194 | `leaveBand` | `DELETE FROM band_members WHERE band_id = $1 AND user_id = $2` | result discarded | `never` |
| 210 | `removeBandMember` | `SELECT band_id FROM band_members WHERE id = $1` | `res.rowCount`, `res.rows[0].band_id` | inline `{ band_id: string }` |
| 223 | `removeBandMember` | `DELETE FROM band_members WHERE id = $1 AND band_id = $2` | result discarded | `never` |
| 278 | `createBandPlaylist` | `INSERT INTO playlists ... RETURNING id` | `res.rows[0].id` | inline `{ id: string }` |
| 292 | `joinBandByInviteClient` | `SELECT * FROM join_band_by_invite($1, $2)` | `res.rows[0].band_id` | `JoinBandByInviteRow` (new) |
| 308 | `regenerateBandInviteCode` | `SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2` | `res.rowCount`, `res.rows[0].role` | `BandMemberRoleRow` (new) |
| 326 | `regenerateBandInviteCode` | `UPDATE bands SET invite_code = ... RETURNING invite_code` | `res.rowCount`, `res.rows[0].invite_code` | inline `{ invite_code: string }` |

Already typed and untouched: lines 21 and 97 (`query<Band>`), 255 (`query<Playlist>`). Three
typed call sites today, 15 after this task.

### `src/lib/bands.server.ts` - untyped call sites (1)

| Line | Function | Statement (unchanged) | Rows read? | Row type to name |
|---|---|---|---|---|
| 42 | `joinBandByInviteServer` | `SELECT * FROM join_band_by_invite($1, $2)` | `res.rows[0].band_id`, `.already_member` | `JoinBandByInviteRow` (new) |

Already typed and untouched: line 13 (`query<BandByInviteCodeRow>`). One typed call site today,
2 after this task. The file already imports from `@/lib/dbRows`, so the new name joins the
existing import clause and the file's line count does not change.

### `src/lib/playlists.ts` - untyped call sites (11)

| Line | Function | Statement (unchanged) | Rows read? | Row type to name |
|---|---|---|---|---|
| 10 | `getUserPlaylists` | `SELECT band_id FROM band_members WHERE user_id = $1` | `res.rows.map(m => m.band_id)` | inline `{ band_id: string }` |
| 81 | `assertPlaylistAccess` | `SELECT id, user_id, band_id FROM playlists WHERE ...` | `res.rowCount`, `res.rows[0]` (returned to callers) | `PlaylistAccessRow` (new) |
| 124 | `updatePlaylist` | `UPDATE playlists SET <dynamic> WHERE id = $n` (no `RETURNING`) | `res.rowCount` only | `never` |
| 138 | `deletePlaylist` | `DELETE FROM playlists WHERE id = $1` | `res.rowCount` only | `never` |
| 159 | `addSongToPlaylist` | `INSERT INTO repertoire (band_id, ...) ... ON CONFLICT DO NOTHING` | result discarded | `never` |
| 163 | `addSongToPlaylist` | `INSERT INTO repertoire (user_id, ...) ... ON CONFLICT DO NOTHING` | result discarded | `never` |
| 168 | `addSongToPlaylist` | `INSERT INTO repertoire (user_id, ...) ... ON CONFLICT DO NOTHING` | result discarded | `never` |
| 179 | `addSongToPlaylist` | `INSERT INTO playlist_songs ... SELECT $1, $2, COALESCE(MAX(position), 0) + 1 ...` | result discarded | `never` |
| 197 | `removeSongFromPlaylist` | `DELETE FROM playlist_songs WHERE playlist_id = $1 AND song_id = $2` | result discarded | `never` |
| 289 | `getPlaylistDetailsWithEntries` | `SELECT name FROM playlists WHERE id = $1` | `res.rows[0]?.name` | inline `{ name: string }` |
| 292 | `getPlaylistDetailsWithEntries` | `SELECT ps.position, r.id AS repertoire_id, ps.song_id, s.title, s.artist FROM playlist_songs ps JOIN ...` | `res.rows.map(...)` | `PlaylistEntryRow` (new) |

Lines 159, 163, 168 and 179 are `client.query(` calls inside `withTransaction`. Already typed
and untouched: lines 33, 55 and 238 (`query<Playlist>`). Three typed call sites today, 14 after
this task.

### `src/lib/profile.ts` - untyped call sites (3)

| Line | Function | Statement (unchanged) | Rows read? | Row type to name |
|---|---|---|---|---|
| 59 | `updateProfile` | `UPDATE profiles SET <dynamic> WHERE id = $n` (no `RETURNING`) | `res.rowCount` only | `never` |
| 76 | `updateEmail` | `UPDATE "user" SET email = $1, "updatedAt" = now() WHERE id = $2::uuid` | result discarded | `never` |
| 77 | `updateEmail` | `UPDATE profiles SET email = $1 WHERE id = $2::uuid` | result discarded | `never` |

Lines 76 and 77 are `client.query(` calls inside `withTransaction`. Already typed and untouched:
line 8 (`query<Profile>`). One typed call site today, 4 after this task. `profile.ts` needs no
new import and no new interface.

### The 14 casts to delete

`grep -nE 'rows\[0\].* as |\brow\.[a-z_]+ as '` over the four files returns 13 lines today:

- `src/lib/bands.ts:54` - `return res.rows[0].role as 'admin' | 'member'`
- `src/lib/bands.ts:121` - `const bandId = res.rows[0].band_id as string`
- `src/lib/bands.ts:218` - `const bandId = memberRes.rows[0].band_id as string`
- `src/lib/bands.ts:279` - `return res.rows[0].id as string`
- `src/lib/bands.ts:294` - `return row ? (row.band_id as string | null) : null`
- `src/lib/bands.ts:335` - `return res.rows[0].invite_code as string`
- `src/lib/bands.server.ts:45` - `return { bandId: row.band_id as string, alreadyMember: Boolean(row.already_member) }`
- `src/lib/playlists.ts:89` - `return res.rows[0] as { id: string; user_id: string | null; band_id: string | null }`
- `src/lib/playlists.ts:290` - `const name = (playlistRes.rows[0]?.name as string) ?? 'Playlist'`
- `src/lib/playlists.ts:294` to `297` - `row.repertoire_id as string`, `row.song_id as string`,
  `row.title as string`, `row.artist as string | null`

The 14th is `src/lib/bands.ts:348` - `return (band.members ?? []) as BandMember[]` in
`getBandMembers`. It is not a query result cast, but it is redundant on its own terms
(`Band.members` is already declared `BandMember[] | undefined` in `src/types/database.ts`, so
`band.members ?? []` is already `BandMember[]`), and it is one of the four lines the repo-wide
inventory reports. Deleting it is what takes that inventory down to the two lines ER2 pins:
`grep -rn 'as [A-Z][A-Za-z]*\[\]\|rows\[0\] as \|\.rows as ' src --include='*.ts' | grep -v __tests__`
returns exactly `src/lib/spotify.ts:30`, `src/lib/bands.ts:348`, `src/lib/moderation.ts:151` and
`src/lib/playlists.ts:89` today; `spotify.ts:30` belongs to RH-58 and `moderation.ts:151` to the
RH-40 close-out, so both stay.

The `(error as { code?: string }).code === '23505'` read at `src/lib/bands.ts:338` is the
sanctioned `E1` pattern from AGENTS.md and is **not** touched.

### Function return shapes from `migrations/`

- `create_band(p_name text, p_description text, p_cover_url text, p_user_id uuid)`
  (`migrations/0001_initial_schema.sql:176-193`) `RETURNS uuid`, non-null on every path that
  returns at all (it raises when `p_user_id IS NULL`). The call site projects it as
  `SELECT create_band(...) as band_id`, so the row is a single non-null column:
  `{ band_id: string }`.
- `join_band_by_invite(p_invite_code text, p_user_id uuid)` was redefined by
  `migrations/0004_join_band_by_invite_already_member.sql` as
  `RETURNS TABLE(band_id uuid, already_member boolean)`, and it returns
  `SELECT NULL::uuid, NULL::boolean` when the invite code matches no band. Both columns are
  therefore nullable: `{ band_id: string | null; already_member: boolean | null }`. Both call
  sites (`bands.ts:292`, `bands.server.ts:42`) already branch on exactly that null, so the
  interface documents behaviour the code already has.

### Existing types that already fit, and the ones that do not

`Band`, `Playlist` and `Profile` from `src/types/database.ts` are already named at the six
`SELECT *`-style sites and stay as they are. None of the 27 remaining sites projects a full
domain row: they are single-column projections, set-returning function results, a
three-column authorization projection, a five-column join projection, or statements that return
no rows at all. In particular `BandMember` and `PlaylistSong` match no remaining projection -
the member and song arrays in `bands.ts` and `playlists.ts` are `json_agg` sub-selects inside
rows already typed as `Band` / `Playlist`. `dbRows.ts` today holds `BandByInviteCodeRow`,
`PlaylistSongIdRow`, `PlaylistSongLinksRow`, `RepertoireAccessRow` and `SpotifyTokenRow`; none
of them matches any projection in this task.

## Approach

### 1. Statements that return no rows: `never`

Fifteen statements return no rows at all - five in `bands.ts` (123, 162, 179, 194, 223), seven
in `playlists.ts` (124, 138, 159, 163, 168, 179, 197) and three in `profile.ts` (59, 76, 77):
all are `UPDATE`/`DELETE`/`INSERT` without `RETURNING`, read at most for `res.rowCount`. They are written `query<never>(...)` and
`client.query<never>(...)`, exactly as RH-56 did in `songs.ts`.

`never` satisfies the `T extends QueryResultRow` constraint (verified at `b293e82` with a
throwaway probe module against `./node_modules/.bin/tsc --noEmit`, which exited 0), it leaves
`res.rowCount` readable, and it makes any later attempt to read a column off such a result a
compile error instead of a silent `unknown`. Leaving these sites untyped is not an option: the
default `DbRow` would still parse as an untyped call site under the ER1 grep and would wrongly
suggest the statement yields readable rows.

### 2. Single-column projections: inline type arguments

AGENTS.md ("Database Row Types") allows `query<{ id: string }>('... RETURNING id')` for a
single-column projection whose shape is evident at the call site. Five sites are that:

- `bands.ts:115` -> `{ band_id: string }` (the `create_band(...) as band_id` alias)
- `bands.ts:210` -> `{ band_id: string }`
- `bands.ts:278` -> `{ id: string }`
- `bands.ts:326` -> `{ invite_code: string }`
- `playlists.ts:10` -> `{ band_id: string }`
- `playlists.ts:289` -> `{ name: string }`

Written with exactly these spellings (single space inside the braces), because ER1 pins them as
fixed strings:

```
await query<{ band_id: string }>(
await query<{ id: string }>(
await query<{ invite_code: string }>(
await query<{ name: string }>(
await query<never>(
await client.query<never>(
```

`playlists.ts:10` typed as `{ band_id: string }` makes `bandIds` a `string[]` instead of
`unknown[]`; `query`'s `params?: unknown[]` accepts it unchanged.

### 3. The four new interfaces in `src/lib/dbRows.ts`

Added in the file's existing alphabetical-by-name order and doc-comment style, taking the file
from 5 to 9 exported interfaces:

```ts
/** `SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2` */
export interface BandMemberRoleRow {
  role: 'admin' | 'member'
}

/** `SELECT * FROM join_band_by_invite($1, $2)` - both columns are NULL when the code matches no band (migration 0004). */
export interface JoinBandByInviteRow {
  band_id: string | null
  already_member: boolean | null
}

/** `SELECT id, user_id, band_id FROM playlists WHERE id = $1 AND (...)` */
export interface PlaylistAccessRow {
  id: string
  user_id: string | null
  band_id: string | null
}

/** `SELECT ps.position, r.id AS repertoire_id, ps.song_id, s.title, s.artist FROM playlist_songs ps JOIN ...` */
export interface PlaylistEntryRow {
  position: number
  repertoire_id: string
  song_id: string
  title: string
  artist: string
}
```

Why each earns a name rather than an inline literal:

- `BandMemberRoleRow` is the same projection at two call sites (`bands.ts:41` and `bands.ts:308`)
  and carries a literal union the function's own return type depends on.
- `JoinBandByInviteRow` is a two-column set-returning function result shared by two modules, and
  it is the direct sibling of the existing `BandByInviteCodeRow`.
- `PlaylistAccessRow` is a three-column projection that `assertPlaylistAccess` hands back to
  callers; it is the `playlists.ts` analogue of RH-56's `RepertoireAccessRow`.
- `PlaylistEntryRow` is a five-column join projection.

None duplicates a domain type: `BandMember` carries five fields, `Playlist` eleven and
`PlaylistSong` five, against one, three and five columns here respectively, and
`join_band_by_invite`'s result has no domain type at all. `artist` is typed non-null because
`global_songs.artist` is `text NOT NULL` (`migrations/0001_initial_schema.sql:100`); the public
`PlaylistEntrySummary.artist` stays `string | null` and `string` assigns to it cleanly.
`PlaylistEntrySummary` itself stays in `src/lib/playlists.ts` - it is the mapped DTO the fast
view consumes, not a row shape.

### 4. Per-site edits

`src/lib/bands.ts`:

- Add `import type { BandMemberRoleRow, JoinBandByInviteRow } from '@/lib/dbRows'` after the
  `@/lib/db` import (+1 line, file goes 349 -> 350).
- Line 41 -> `query<BandMemberRoleRow>`; line 54 -> `return res.rows[0].role` (cast deleted).
- Line 115 -> `query<{ band_id: string }>`; line 121 -> `const bandId = res.rows[0].band_id`.
- Lines 123, 162, 179, 194, 223 -> `query<never>`.
- Line 210 -> `query<{ band_id: string }>`; line 218 -> `const bandId = memberRes.rows[0].band_id`.
- Line 278 -> `query<{ id: string }>`; line 279 -> `return res.rows[0].id`.
- Line 292 -> `query<JoinBandByInviteRow>`; line 294 -> `return row ? row.band_id : null`.
- Line 308 -> `query<BandMemberRoleRow>` (line 319's `memberRes.rows[0].role !== 'admin'` needs
  no edit).
- Line 326 -> `query<{ invite_code: string }>`; line 335 -> `return res.rows[0].invite_code`.
- Line 348 -> `return band.members ?? []` (cast deleted). `BandMember` stays imported: it is
  still the function's declared return type on line 347.

`src/lib/bands.server.ts`:

- Extend the existing line 2 import to
  `import type { BandByInviteCodeRow, JoinBandByInviteRow } from '@/lib/dbRows'` (0 line delta).
- Line 42 -> `query<JoinBandByInviteRow>`; line 45 -> `return { bandId: row.band_id, alreadyMember: Boolean(row.already_member) }`.
  The `if (!row || row.band_id === null) return null` guard on line 44 narrows `row.band_id` to
  `string` for line 45, so the cast is not merely deleted, it is replaced by a check the
  compiler performs (verified with the probe described in section 1).

`src/lib/playlists.ts`:

- Add `import type { PlaylistAccessRow, PlaylistEntryRow } from '@/lib/dbRows'` after the
  `@/lib/db` import (+1 line, file goes 306 -> 307).
- Line 10 -> `query<{ band_id: string }>`.
- Line 72 -> `): Promise<PlaylistAccessRow> {`; line 81 -> `query<PlaylistAccessRow>`; line 89 ->
  `return res.rows[0]` (cast deleted). `PlaylistAccessRow` is structurally identical to the
  inline literal it replaces, so `src/lib/spotifyRouteAuth.ts` (whose `PlaylistRouteAccess`
  spells the same three columns inline) needs no change and must not get one.
- Lines 124, 138, 197 -> `query<never>`; lines 159, 163, 168, 179 -> `client.query<never>`.
- Line 289 -> `query<{ name: string }>`; line 290 ->
  `const name = playlistRes.rows[0]?.name ?? 'Playlist'` (cast deleted, the `?.` kept because
  `rows[0]` really can be absent at runtime).
- Line 292 -> `query<PlaylistEntryRow>`; lines 294-297 drop their four casts
  (`repertoireId: row.repertoire_id,` and so on).

`src/lib/profile.ts`:

- Line 59 -> `query<never>`; lines 76 and 77 -> `client.query<never>`. No import change, no cast
  to delete, no line-count change. The pre-existing `// eslint-disable-next-line
  @typescript-eslint/no-explicit-any` on line 29 belongs to the `values: any[]` accumulator, not
  to a query result, and stays.

### 5. Line counts and complexity budgets

`src/lib/bands.ts` has a single pinned override, `{ files: ["src/lib/bands.ts"], rules: { "max-params": ["error", 5] } }`
(`eslint.config.mjs:84`), driven by `createBand`'s five parameters - untouched here, so the
ceiling stays exactly right. None of the four files has a `max-lines` or `complexity` override,
and after the two +1 import lines they sit at 350, 51, 307 and 84 lines against the base
`max-lines: 400`. No branch is added or removed anywhere, so no `complexity` number moves.
`eslint.config.mjs` is therefore expected to be **unchanged** by this task and the override list
stays at 23 entries (ER5 pins both).

### 6. Test plan

No new test file and no change to any existing test. The `@/lib/db` mocks in
`errors.test.ts` / `edge_cases.test.ts` hand back plain object literals and are never
type-checked (`tsconfig.json` excludes `**/__tests__/**`), so naming a row type cannot make a
mock invalid. The behaviour proof is the suites that already exercise these functions, all green
at `b293e82`:

| Suite | Tests | What it pins |
|---|---|---|
| `src/lib/__tests__/bands.test.ts` | 14 | band CRUD, invite join, `getBandMembers` |
| `src/lib/__tests__/bands.server.test.ts` | 3 | `joinBandByInviteServer` incl. the null-code path |
| `src/lib/__tests__/joinBandByInvite.test.ts` | 5 | `join_band_by_invite` idempotence against real Postgres |
| `src/lib/__tests__/playlists.test.ts` | 11 | playlist CRUD, add/remove song, details+entries |
| `src/lib/__tests__/profile.test.ts` | 10 | `getProfile`, `updateProfile`, `updateEmail` |
| `src/lib/__tests__/edge_cases.test.ts` | 10 | empty/absent-row paths |
| `src/lib/__tests__/errors.test.ts` | 49 | the L1 log-then-throw wrapper messages |
| `src/lib/__tests__/transactionAtomicity.db.test.ts` | 6 | `addSongToPlaylist` / `updateEmail` atomicity |
| `src/lib/__tests__/spotifyPlaylistRouteAuthz.db.test.ts` | 11 | `assertPlaylistAccess` through the route guard |
| `src/lib/__tests__/dbRowTypes.test.ts` | 3 | RH-54 guard, incl. "every `dbRows.ts` export is imported" |
| `src/app/actions/__tests__/authzBands.db.test.ts` | 14 | `assertBandMember` / `assertBandAdmin` matrix |
| `src/app/actions/__tests__/authzPlaylists.db.test.ts` | 12 | playlist authorization matrix |

Sum: 148 tests across 12 files. `complexityBudget.test.ts` (6 tests) covers the budget side.

Type safety itself is proven by `./node_modules/.bin/tsc --noEmit` exiting 0 with the casts
gone: with `DbRow = Record<string, unknown>` as the default, an unnamed row cannot be read at
all, so a compiling read is a proof the shape was declared.

## Expected Results

ER1 - every query call site in the four data modules names its row type. From the repo root,
`grep -cE 'await (client\.)?query\(' src/lib/bands.ts src/lib/bands.server.ts src/lib/playlists.ts src/lib/profile.ts`
prints `0` for all four files (baseline at `b293e82`: `12`, `1`, `11`, `3`), and
`grep -cE 'await (client\.)?query<' src/lib/bands.ts src/lib/bands.server.ts src/lib/playlists.ts src/lib/profile.ts`
prints `src/lib/bands.ts:15`, `src/lib/bands.server.ts:2`, `src/lib/playlists.ts:14` and
`src/lib/profile.ts:4` (baseline `3`, `1`, `3`, `1`). The individual type arguments are pinned as
fixed strings, each command carrying its own file operand:
`grep -cF 'await query<BandMemberRoleRow>(' src/lib/bands.ts` prints `2`,
`grep -cF 'await query<{ band_id: string }>(' src/lib/bands.ts` prints `2`,
`grep -cF 'await query<{ id: string }>(' src/lib/bands.ts` prints `1`,
`grep -cF 'await query<JoinBandByInviteRow>(' src/lib/bands.ts` prints `1`,
`grep -cF 'await query<{ invite_code: string }>(' src/lib/bands.ts` prints `1`,
`grep -cF 'await query<never>(' src/lib/bands.ts` prints `5`,
`grep -cF 'await query<JoinBandByInviteRow>(' src/lib/bands.server.ts` prints `1`,
`grep -cF 'await query<{ band_id: string }>(' src/lib/playlists.ts` prints `1`,
`grep -cF 'await query<PlaylistAccessRow>(' src/lib/playlists.ts` prints `1`,
`grep -cF 'await query<{ name: string }>(' src/lib/playlists.ts` prints `1`,
`grep -cF 'await query<PlaylistEntryRow>(' src/lib/playlists.ts` prints `1`,
`grep -cF 'await query<never>(' src/lib/playlists.ts` prints `3`,
`grep -cF 'await client.query<never>(' src/lib/playlists.ts` prints `4`,
`grep -cF 'await query<never>(' src/lib/profile.ts` prints `1` and
`grep -cF 'await client.query<never>(' src/lib/profile.ts` prints `2`.

ER2 - the casts in these four files are gone and no cast was laundered anywhere.
`grep -nE 'rows\[0\].* as |\brow\.[a-z_]+ as ' src/lib/bands.ts src/lib/bands.server.ts src/lib/playlists.ts src/lib/profile.ts`
prints nothing and exits non-zero (the baseline at `b293e82` prints exactly 13 lines:
`bands.ts` 54, 121, 218, 279, 294, 335; `bands.server.ts` 45; `playlists.ts` 89, 290, 294, 295,
296, 297). `grep -n 'as BandMember\[\]' src/lib/bands.ts` prints nothing (baseline: line 348).
Repo-wide,
`sh -c "grep -rn 'as [A-Z][A-Za-z]*\[\]\|rows\[0\] as \|\.rows as ' src --include='*.ts' | grep -v __tests__"`
lists exactly two lines, one in `src/lib/spotify.ts` and one in `src/lib/moderation.ts`, and no
line from `src/lib/bands.ts` or `src/lib/playlists.ts` appears (baseline: four lines, the two
extra ones being `src/lib/bands.ts:348` and `src/lib/playlists.ts:89`). The `E1` Postgres-code
read survives: `grep -c "(error as { code?: string })" src/lib/bands.ts` prints `1`. Finally
`grep -rc '@ts-ignore\|@ts-expect-error\|@ts-nocheck' src --include='*.ts' --include='*.tsx' | grep -v ':0$' | wc -l`
prints `0`, and
`grep -rn 'as unknown as' src --include='*.ts' --include='*.tsx' | grep -v __tests__ | wc -l`
prints `2`, unchanged from baseline.

ER3 - the four new row interfaces live in `src/lib/dbRows.ts` and are all consumed.
`grep -c '^export interface ' src/lib/dbRows.ts` prints `9` (baseline `5`) and
`grep -cE '^export interface (BandMemberRoleRow|JoinBandByInviteRow|PlaylistAccessRow|PlaylistEntryRow) \{$' src/lib/dbRows.ts`
prints `4`. Their fields are declared there:
`sed -n '/^export interface BandMemberRoleRow {$/,/^}$/p' src/lib/dbRows.ts | grep -cF "role: 'admin' | 'member'"`
prints `1`;
`sed -n '/^export interface JoinBandByInviteRow {$/,/^}$/p' src/lib/dbRows.ts | grep -cE 'band_id: string \| null|already_member: boolean \| null'`
prints `2`;
`sed -n '/^export interface PlaylistAccessRow {$/,/^}$/p' src/lib/dbRows.ts | grep -c ': string'`
prints `3`; and
`sed -n '/^export interface PlaylistEntryRow {$/,/^}$/p' src/lib/dbRows.ts | grep -cE 'position: number|repertoire_id: string|song_id: string|title: string|artist: string'`
prints `5`. No row interface was added to the data modules:
`grep -c '^export interface .*Row' src/lib/bands.ts src/lib/bands.server.ts src/lib/playlists.ts src/lib/profile.ts`
prints `0` for all four files. `grep -rl "from '@/lib/dbRows'" src --include='*.ts' | grep -v __tests__ | sort`
lists exactly `src/app/api/spotify/playlists/[id]/sync/route.ts`, `src/lib/bands.server.ts`,
`src/lib/bands.ts`, `src/lib/playlists.ts`, `src/lib/songs.ts` and `src/lib/spotifyAuth.ts` (six
paths; baseline four, without `bands.ts` and `playlists.ts`). `npm run lint:dead` prints no file
or symbol list and exits 0, and `rtk proxy npx vitest run src/lib/__tests__/dbRowTypes.test.ts`
reports `Test Files 1 passed (1)` and `Tests 3 passed (3)`.

ER4 - every SQL statement and parameter list is byte-identical. In bash or zsh, from the repo
root, for each of the four files - `src/lib/bands.ts`, `src/lib/bands.server.ts`,
`src/lib/playlists.ts`, `src/lib/profile.ts` - the command
`diff <(git show b293e82:FILE | sed -E 's/query<[^>]*>\(/query(/g') <(sed -E 's/query<[^>]*>\(/query(/g' FILE) | grep -cE 'SELECT|INSERT|UPDATE|DELETE|RETURNING|VALUES|ON CONFLICT|\$[0-9]'`
prints `0` with `FILE` substituted: once the added type arguments are normalized away, not one
differing line carries SQL text or a bind placeholder. For `src/lib/profile.ts` the stronger form
holds as well - `diff <(git show b293e82:src/lib/profile.ts | sed -E 's/query<[^>]*>\(/query(/g') <(sed -E 's/query<[^>]*>\(/query(/g' src/lib/profile.ts)`
prints nothing at all, because that file's only change is three type arguments.

ER5 - nothing outside the data layer moved, and the complexity budgets were neither loosened nor
disturbed. `git diff b293e82 -- src/app src/components src/hooks src/store src/types src/i18n migrations eslint.config.mjs`
prints nothing, and `git diff b293e82 -- src/lib/spotifyRouteAuth.ts src/lib/db.ts src/lib/songs.ts src/lib/moderation.ts src/lib/spotify.ts src/lib/spotifyAuth.ts`
prints nothing. `git diff --name-only b293e82 -- src | grep -c 'test\.tsx\?$'` prints `0` (no
existing test file needed changing). `grep -c 'complexity-budget/override' eslint.config.mjs`
prints `23`, unchanged. `wc -l src/lib/bands.ts src/lib/bands.server.ts src/lib/playlists.ts src/lib/profile.ts` prints
four numbers each `<= 400`, and `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts`
reports `Test Files 1 passed (1)` and `Tests 6 passed (6)`.

ER6 - the suites that exercise these four modules stay green with unchanged counts. With
Postgres live at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations
applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`,
`rtk proxy npx vitest run src/lib/__tests__/bands.test.ts src/lib/__tests__/bands.server.test.ts src/lib/__tests__/joinBandByInvite.test.ts src/lib/__tests__/playlists.test.ts src/lib/__tests__/profile.test.ts src/lib/__tests__/edge_cases.test.ts src/lib/__tests__/errors.test.ts src/lib/__tests__/transactionAtomicity.db.test.ts src/lib/__tests__/spotifyPlaylistRouteAuthz.db.test.ts src/lib/__tests__/dbRowTypes.test.ts src/app/actions/__tests__/authzBands.db.test.ts src/app/actions/__tests__/authzPlaylists.db.test.ts`
reports `Test Files 12 passed (12)` and `Tests 148 passed (148)`, with `0 failed` and no skipped
test (identical to the `b293e82` baseline: 14 + 3 + 5 + 11 + 10 + 10 + 49 + 6 + 11 + 3 + 14 + 12).

ER7 - the static gates hold exactly where they did. `./node_modules/.bin/tsc --noEmit` writes
nothing to stdout or stderr and exits 0. `rtk proxy npx eslint .` ends with the summary line
`22 problems (8 errors, 14 warnings)` - unchanged from `b293e82` - and
`rtk proxy npx eslint . 2>&1 | grep -cE '/src/lib/(bands|bands\.server|playlists|profile|dbRows)\.ts$'`
prints `0` (it prints `0` at baseline too: none of the touched files is listed by eslint today,
and none may become listed). `npm run lint:dup` prints `Found 19 clones.` or fewer, with a total
of `242 (0.71%)` duplicated lines or fewer. `npm run audit` prints `found 0 vulnerabilities`.

ER8 - the whole suite and the coverage gate stay green. With the same DB precondition as ER6
(Postgres live at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations
applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`),
`rtk proxy npx vitest run` reports at least `Test Files 92 passed (92)` and at least
`Tests 1064 passed (1064)`, with `0 failed` and `0 skipped` (the `b293e82` baseline is exactly
92 files / 1064 tests / 0 skipped). `npm run test:coverage` exits 0 and its `All files` row shows
statements >= 80, branches >= 65, functions >= 78 and lines >= 80, with no
`ERROR: Coverage for ... does not meet global threshold` line anywhere in the output.

ER9 - the app still builds and renders server-side. `npx next build` exits 0 and its output
contains no line matching `^Error|^Failed|Failed to compile` (do not grep for
`Compiled successfully`: this Next version does not print that phrase on success).
`npx playwright test e2e/ssr-smoke.spec.ts` reports `4 passed`.

ER10 - version bumped, landing untouched, diff inside the whitelist.
`node -p "require('./package.json').version"` prints a string matching `^0\.1\.86-[0-9]{12}$`,
which sorts strictly after the baseline `0.1.85-202609080152`. This task ships no selling point
(it is an internal type-safety refactor, invisible to musicians), so
`git diff b293e82 -- src/components/landing/LandingPage.tsx src/i18n/dictionaries/en.json src/i18n/dictionaries/pt-BR.json`
prints nothing. `git diff --name-only b293e82 | sort` lists only paths drawn from this closed
set: `AGENTS.md`, `docs/suggestions-log.md`, `docs/tasks/RH-57-spec.md`, `package.json`,
`src/lib/bands.server.ts`, `src/lib/bands.ts`, `src/lib/dbRows.ts`, `src/lib/playlists.ts`,
`src/lib/profile.ts` - any other path fails this result.

## Out of Scope

- Part 5 of RH-40: `src/lib/spotify.ts`, `src/lib/spotifyAuth.ts` and the
  `src/app/api/**/route.ts` handlers, including the `as SpotifyTrack[]` cast at
  `src/lib/spotify.ts:30` (RH-58).
- The `res.rows[0] as GlobalSongEdit` cast at `src/lib/moderation.ts:151` and that module's call
  sites - they belong to the RH-40 close-out. ER2 pins both remaining casts in place.
- Any change to SQL text, parameter order, return values, thrown messages or logging.
- Any change to `src/lib/db.ts`, `src/types/database.ts`, `src/lib/spotifyRouteAuth.ts` or the
  RH-54 guard test.
- Any `eslint.config.mjs` edit, including retightening an override: none is needed here (ER5).
- A repo-wide lint rule or guard test forbidding untyped `query(` call sites. That only makes
  sense once part 5 has cleared the remaining modules; it belongs to the last part of RH-40.
- New tests, new features, migrations, UI and landing-page copy.

## Post-merge checks (orchestrator)

- Carry the remaining cast inventory into the RH-58 and RH-40 close-out specs as their starting
  baseline: after this task it is exactly two lines, `src/lib/spotify.ts:30` and
  `src/lib/moderation.ts:151`.
- The untyped-call-site inventory after this task is `src/lib/moderation.ts`,
  `src/lib/spotify*.ts` and `src/app/api/**/route.ts` only; re-measure it with
  `grep -rcE 'await (client\.)?query\(' src --include='*.ts' | grep -v ':0$'` when scoping part 5.

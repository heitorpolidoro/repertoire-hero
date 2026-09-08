# RH-54 - query tipado parte 1/5: fundacao DbRow e casa dos row types

Parent: RH-40 (part 1 of 5). Baseline: `246313f`. `blockedBy`: empty.

## Scope

This task lays the foundation the other four parts of the RH-40 split stand on, and nothing else.

It covers exactly five things:

1. Give `query` and the `Queryable` interface in `src/lib/db.ts` a non-`any` default row type: `export type DbRow = Record<string, unknown>`, `params?: unknown[]`, explicit `Promise<QueryResult<T>>` return.
2. Remove both `eslint-disable-next-line @typescript-eslint/no-explicit-any` comments from `src/lib/db.ts` (they exist only to shield the two `any`s that this task deletes).
3. Create `src/lib/dbRows.ts` as the single home for row interfaces that are not already a domain type in `src/types/database.ts`, and document that convention in `AGENTS.md`.
4. Type the shared db helper `src/lib/__tests__/test-helpers.ts` (the `SupabaseMockChain` that builds and executes real SQL through `query`) so it holds no `any` and no `eslint-disable` comment.
5. Fix exactly the sites the compiler flags once step 1 lands - 29 errors across 10 files, enumerated below - by naming the row type as a type argument at the call site, never by adding a cast.

It does not cover the remaining ~52 untyped `query()` call sites, the 6 casts the compiler does not flag, or any change to `src/lib/moderation.ts` semantics. Those belong to RH-55 (moderation validator, F17), RH-56 (songs/tabs), RH-57 (bands/playlists/profile) and RH-58 (Spotify + route handlers).

## Audit at 246313f

`git log --oneline -1` prints `246313f chore(RH-39): enforce complexity, depth and size budgets in eslint.config.mjs`. Version in `package.json` is `0.1.82-202609072252`. The audit below was reproduced in this working tree by copying `src/lib/db.ts` aside, applying the new signature, running `./node_modules/.bin/tsc --noEmit`, then restoring the file byte-for-byte; `git status --short` printed nothing afterwards.

### Current signatures (`src/lib/db.ts:22-35`)

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function query<T extends QueryResultRow = any>(text: string, params?: any[]) {
  return pool.query<T>(text, params)
}

export interface Queryable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>>
}
```

Two facts about this shape, both verified empirically and both load-bearing for the spec:

- Simply **dropping** the default (`<T extends QueryResultRow>`) achieves nothing. `@types/pg` declares `QueryResultRow` as `{ [column: string]: any }`, so an omitted type argument falls back to the constraint and rows stay `any`-valued. Measured: that variant produces exactly 1 compiler error in the whole repo. The non-`any` default is the only variant with teeth.
- `Record<string, unknown>` satisfies the `QueryResultRow` constraint, and so do the existing domain **interfaces** (`Repertoire`, `Band`, `Playlist`, `Profile`, `GlobalSong`, `GlobalSongEdit`, `RepertoireTab`) - `query<Repertoire>(sql, params)` compiles today. Verified with a throwaway probe file.

`rtk proxy npx eslint src/lib/db.ts` currently prints nothing: a disable comment is not itself reported, so `db.ts` contributes 0 of the repo's 24 eslint problems. Removing the two disables plus the two `any`s therefore leaves the eslint total unchanged at 24 - the only eslint movement in this task comes from step 4.

### Compiler worklist (29 errors, 10 files)

Applying `export type DbRow = Record<string, unknown>` plus `query<T extends QueryResultRow = DbRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>` (and the identical change on `Queryable.query`) yields exactly these errors. By code: 20x TS2352, 6x TS2322, 1x TS2345, 1x TS2339, 1x TS2739.

| file | errors | lines | row type to name |
|---|---|---|---|
| `src/lib/songs.ts` | 8 | 61, 97, 191, 223, 341, 360, 400, 525 | `Repertoire` (61, 97, 223, 400, 525), `GlobalSong` (191), `{ id: string }` inline (341, 360) |
| `src/lib/moderation.ts` | 4 | 18, 69, 98, 112 | `GlobalSongEdit` |
| `src/lib/bands.server.ts` | 4 | 18, 19, 20, 21 | `BandByInviteCodeRow` (new) |
| `src/lib/playlists.ts` | 3 | 34, 56, 240 | `Playlist` |
| `src/lib/bands.ts` | 3 | 22, 99, 256 | `Band` (22, 99), `Playlist` (256) |
| `src/lib/tabs.ts` | 2 | 55, 156 | `RepertoireTab` (via a generic `runTabQuery`) |
| `src/app/api/spotify/playlists/[id]/sync/route.ts` | 2 | 90, 124 | `PlaylistSongIdRow` (new), `PlaylistSongLinksRow` (new) |
| `src/lib/spotifyAuth.ts` | 1 | 19 | `SpotifyTokenRow` (new) |
| `src/lib/profile.ts` | 1 | 10 | `Profile` |
| `src/app/api/spotify/playlists/[id]/import/route.ts` | 1 | 107 | `Playlist` |

Verbatim samples (full list reproducible with the probe described above):

```
src/lib/songs.ts(61,12): error TS2352: Conversion of type 'DbRow[]' to type 'Repertoire[]' may be a mistake ...
src/lib/songs.ts(341,7): error TS2322: Type 'unknown' is not assignable to type 'string'.
src/lib/bands.server.ts(18,7): error TS2322: Type 'unknown' is not assignable to type 'string'.
src/app/api/spotify/playlists/[id]/sync/route.ts(90,35): error TS2345: Argument of type 'unknown' is not assignable to parameter of type 'string'.
src/app/api/spotify/playlists/[id]/sync/route.ts(124,36): error TS2339: Property 'find' does not exist on type '{}'.
src/lib/spotifyAuth.ts(19,5): error TS2739: Type 'DbRow' is missing the following properties from type '{ access_token: string; refresh_token: string; expires_at: string; }': access_token, refresh_token, expires_at
```

Six of the ten files already import the domain type they need (`Repertoire`/`GlobalSong` in `songs.ts:5`, `GlobalSongEdit` in `moderation.ts:4`, `Playlist` in `playlists.ts:5` and in the import route, `Band`/`Playlist` in `bands.ts:4`, `Profile` in `profile.ts:3`, `RepertoireTab` in `tabs.ts:4`), so those fixes need no new import line.

### The `songs.ts` line ceiling

`src/lib/songs.ts` is **exactly 531 lines** and `eslint.config.mjs` pins it to `"max-lines": ["error", 531]`. The RH-39 ratchet may only shrink, and `src/lib/__tests__/complexityBudget.test.ts` fails on an override that is not exactly the file's current worst number. So `songs.ts` cannot take a single new line - not even an import. Its eight fixes are all line-neutral: six reuse types already imported on line 5, and the two `SELECT id` / `RETURNING id` sites use an inline `query<{ id: string }>(...)` type argument. Verified: after the reference implementation `wc -l src/lib/songs.ts` still prints 531 and the budget guard still passes 6/6.

### Cast baseline

```
grep -rn "as [A-Z][A-Za-z]*\[\]\|rows\[0\] as \|\.rows as " src --include='*.ts' | grep -v __tests__ | wc -l
```

prints **26** at `246313f`, spread over 8 files: `songs.ts` 8, `moderation.ts` 5, `bands.ts` 4, `playlists.ts` 4, `tabs.ts` 2, `profile.ts` 1, `spotify.ts` 1, `api/spotify/playlists/[id]/import/route.ts` 1. Exactly 20 of those 26 are the TS2352 sites above, so the reference implementation leaves **6** (`songs.ts` 2, `moderation.ts` 1, `bands.ts` 1, `playlists.ts` 1, `spotify.ts` 1) for RH-56/57/58. `grep -rn "as unknown as" src --include='*.ts' --include='*.tsx' | grep -v __tests__ | wc -l` prints **2** (`src/lib/db.ts:9` and `src/app/bands/[id]/page.tsx:376`); both must survive untouched, which is what stops a "fix" from laundering a cast through `as unknown as`.

### Test files affected

`tsconfig.json` **excludes** `**/__tests__/**` and `**/*.test.ts`, so `tsc --noEmit` never type-checks a test file, and vitest strips types without checking them. Consequence: typing the shared helper cannot break the build, and a `@ts-expect-error`-style type test placed in a `__tests__` file would be inert. The only compile-time proof of the new signature is a throwaway probe under `src/lib/` (ER3).

`grep -rln "@/lib/db" src --include='*.test.ts*'` lists 21 test files; `createAdminTestClient` (whose declared return type changes from `any`) is consumed by 14 files. None of them needs to change: they are not type-checked, and the runtime behaviour of the helper is unchanged. **Whitelist: no existing test file is modified.** The only test artefacts in this task are the edit to `src/lib/__tests__/test-helpers.ts` and the new `src/lib/__tests__/dbRowTypes.test.ts`.

### Verified baselines at 246313f

- `./node_modules/.bin/tsc --noEmit` prints nothing, exit 0.
- `rtk proxy npx eslint .` -> `24 problems (10 errors, 14 warnings)`; the 10 errors are 7x `react-hooks/set-state-in-effect`, 1x `@next/next/no-html-link-for-pages`, and 2x `@typescript-eslint/no-explicit-any` at `src/lib/__tests__/test-helpers.ts:96` and `:120`.
- `rtk proxy npx vitest run` -> `Test Files 89 passed (89)`, `Tests 1040 passed (1040)`, 0 skipped (with Postgres live).
- `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts` -> 6 passed.
- `npm run test:coverage` -> `All files | 97.14 | 84.45 | 99.4 | 97.66` against thresholds 80/65/78/80.
- `npm run lint:dup` -> `Found 18 clones`, `230 (0.69%)` duplicated lines.
- `npm run lint:dead` -> no output, exit 0. `npm run audit` -> `found 0 vulnerabilities`.

## Approach

### 1. `src/lib/db.ts`

Replace lines 22-35 with exactly this (the `QueryResult` and `QueryResultRow` types are already imported on line 1):

```ts
/**
 * The default row shape: a bare record whose values are `unknown`, not `any`.
 * A caller that names no type argument therefore has to prove what it reads,
 * instead of silently getting `any` back from `@types/pg`'s `QueryResultRow`
 * index signature (RH-54 / RH-25 F16).
 */
export type DbRow = Record<string, unknown>

export async function query<T extends QueryResultRow = DbRow>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
  return pool.query<T>(text, params)
}

/**
 * Anything that can run a parameterized statement: the pool itself, or one
 * client checked out of it inside `withTransaction`. A helper that takes a
 * `Queryable` works both standalone and as part of a caller's transaction.
 */
export interface Queryable {
  query<T extends QueryResultRow = DbRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>
}
```

Both `eslint-disable-next-line @typescript-eslint/no-explicit-any` comments disappear with the `any`s they shielded. `const globalForDb = global as unknown as { pool?: Pool }` on line 9, the module-load `console.warn`, and `withTransaction` are untouched.

### 2. `src/lib/dbRows.ts` (new)

One exported interface per distinct SELECT list that is not already a domain type, named `<Subject>Row`, mirroring the projection column for column. Exactly four are needed by this task's worklist:

```ts
import type { SongLink } from '@/types/database'

/** `SELECT * FROM get_band_by_invite_code($1)` - `member_count` is a bigint, so pg hands it back as text. */
export interface BandByInviteCodeRow {
  id: string
  name: string
  description: string | null
  cover_url: string | null
  member_count: string
}

/** `SELECT song_id FROM playlist_songs WHERE playlist_id = $1` */
export interface PlaylistSongIdRow {
  song_id: string
}

/** `SELECT ps.song_id, ps.position, s.links FROM playlist_songs ps JOIN global_songs s ...` */
export interface PlaylistSongLinksRow {
  song_id: string
  position: number
  links: SongLink[] | null
}

/** `SELECT access_token, refresh_token, expires_at FROM spotify_tokens WHERE user_id = $1` */
export interface SpotifyTokenRow {
  access_token: string
  refresh_token: string
  expires_at: string
}
```

`links` is typed nullable so the existing `links?.find(...)` optional chain in the sync route keeps its exact current semantics.

Do **not** re-declare a domain type here. `Repertoire`, `Band`, `Playlist`, `Profile`, `GlobalSong`, `GlobalSongEdit` and `RepertoireTab` stay in `src/types/database.ts` and are named directly as type arguments. `knip` fails on an unused export, so no speculative row types.

### 3. `AGENTS.md`

Add this section immediately after the existing `# Transactions` section, verbatim:

```markdown
# Database Row Types

`query()` and `Queryable.query()` in `src/lib/db.ts` default their row parameter to
`DbRow = Record<string, unknown>`, never `any`: a call that names no type argument hands
back `unknown`-valued columns, so the compiler forces every read to declare the shape it
expects. Dropping the default instead of replacing it does nothing - `@types/pg` declares
`QueryResultRow` as `{ [column: string]: any }`, so an omitted argument falls back to that
constraint and rows stay `any`. Declare the shape as a type argument
(`query<Repertoire>(sql, params)`), never as a cast on `res.rows`: a cast asserts a shape
the checker never verified against the SELECT list, which is exactly what RH-25 F16 set out
to remove.

Row shapes that are not already a domain type from `src/types/database.ts` live in
`src/lib/dbRows.ts` - one exported interface per distinct SELECT list, named `<Subject>Row`
and mirroring the projection column for column (`SpotifyTokenRow`, `PlaylistSongIdRow`).
They live there rather than beside their SQL because `src/lib/songs.ts` is pinned at
`max-lines: 531` by the RH-39 ratchet and cannot grow by even one import line. Keep
`src/types/database.ts` as the app's public vocabulary and `dbRows.ts` as an implementation
detail of the data layer: never duplicate a domain type there, name it at the call site
instead. `knip` (`npm run lint:dead`) fails on a row interface nobody imports, so do not add
speculative ones. A single-column projection whose shape is evident at the call site
(`query<{ id: string }>('... RETURNING id')`) may be written inline.
```

### 4. Per-file fixes

Every fix is "add a type argument, delete the cast the type argument makes unnecessary". No behaviour changes, no new runtime code.

- **`src/lib/songs.ts`** (line-neutral, stays at 531 lines): `query<Repertoire>` at the five sites that returned `res.rows as Repertoire[]` / `res.rows[0] as Repertoire` (lines 61, 97, 223, 400, 525) with the cast deleted; `query<GlobalSong>` at line 191 with `as GlobalSong[]` deleted; `query<{ id: string }>(lookupSql, lookupParams)` and `query<{ id: string }>(insertSongSql, [...])` for the two `id` projections feeding `songId` (lines 341, 360).
- **`src/lib/moderation.ts`**: `query<GlobalSongEdit>` on the four statements at lines 17, 62-68, 89 and 111; the three `as GlobalSongEdit` / `as GlobalSongEdit[]` casts and the `const edit = editRes.rows[0] as GlobalSongEdit` cast are deleted. **No other change to this file** - the `if (edit.status !== 'pending')` guards, the approval `UPDATE`, the `proposed_data as Record<string, unknown>` cast and every message string stay exactly as they are; validating the payload is RH-55's job.
- **`src/lib/bands.server.ts`**: add `import type { BandByInviteCodeRow } from '@/lib/dbRows'`, use `query<BandByInviteCodeRow>(...)`. The `Number(row.member_count)` conversion stays.
- **`src/lib/bands.ts`**: `query<Band>` at lines 22 and 99, `query<Playlist>` at line 256, casts deleted.
- **`src/lib/playlists.ts`**: `query<Playlist>` at lines 34, 56, 240, casts deleted.
- **`src/lib/profile.ts`**: `query<Profile>` at line 10, cast deleted.
- **`src/lib/tabs.ts`**: make the shared wrapper generic - `async function runTabQuery<T extends QueryResultRow = DbRow>(...)` returning `query<T>(sql, params)` - which also retires the `params as never` cast now that `query` takes `unknown[]`. Call it as `runTabQuery<RepertoireTab>(...)` in `createTab` and `listTabs`; both `as RepertoireTab` casts are deleted. Needs `import type { QueryResultRow } from 'pg'` and `import { query, type DbRow } from '@/lib/db'`. The other four `runTabQuery` calls keep the default and are unchanged.
- **`src/lib/spotifyAuth.ts`**: add `import type { SpotifyTokenRow } from '@/lib/dbRows'`, replace the inline `let tokenRow: { ... } | null = null` block with `let tokenRow: SpotifyTokenRow | null = null`, and use `query<SpotifyTokenRow>(...)`.
- **`src/app/api/spotify/playlists/[id]/sync/route.ts`**: add `import type { PlaylistSongIdRow, PlaylistSongLinksRow } from '@/lib/dbRows'`; `query<PlaylistSongIdRow>` for the `SELECT song_id FROM playlist_songs` read, which also lets `localEntries.map((e) => e.song_id as string)` drop its cast; `query<PlaylistSongLinksRow>` for the push-direction read, which lets `links?.find((l: { label: string; url: string }) => ...)` drop its inline parameter annotation. The `spotify_playlist_id as string` cast on the separate `linkRes` read is **not** touched (RH-58 owns it).
- **`src/app/api/spotify/playlists/[id]/import/route.ts`**: `query<Playlist>(insertPlaylistSql, [...])` at line 97, `as Playlist` at line 107 deleted.

### 5. `src/lib/__tests__/test-helpers.ts`

Type the `SupabaseMockChain` so the file holds no `any` and no `eslint-disable` comment. ESLint 9 flat config reports unused disable directives as warnings, so the directives must go with the `any`s they shielded. Suggested shape (the module already only ever handles plain row records):

- a module-local `type MockRow = Record<string, unknown>`;
- `private actionData: MockRow | MockRow[] | null = null`;
- `private conditions: { type: 'eq' | 'in' | 'ilike'; col: string; val: unknown }[] = []`;
- `insert(data: MockRow | MockRow[])`, `update(data: MockRow)`, `upsert(data: MockRow | MockRow[])`, `eq/in/ilike(col: string, val: unknown)`;
- `const params: unknown[] = []`, `rows.map((row: MockRow) => ...)` at both former `any` sites (lines 96 and 120), `let data: unknown = res.rows`;
- `then(onfulfilled?: (value: { data: unknown; error: { message?: string; code?: string } | null }) => unknown, onrejected?: (reason: unknown) => unknown)`;
- `createAdminTestClient(): SupabaseMockClient` and `admin: SupabaseMockClient` on the four `createTestUser` / `deleteTestUser` / `...WithGoTrue` helpers.

The SQL built, the parameters pushed, and every returned value must be byte-identical to today - this is a type-only edit. The 14 suites that call `createAdminTestClient()` are not modified.

### 6. Test plan

A permanent type-level test is impossible in a `__tests__` file (tsc excludes them, vitest strips types). Instead, add a source-scanning guard in the style of `errorHandlingStyle.test.ts`, reusing `fs`/`path` directly:

`src/lib/__tests__/dbRowTypes.test.ts`, `describe('db row typing (RH-54)')`, exactly three tests:

1. `'src/lib/db.ts uses DbRow as the default row type for query and Queryable'` - asserts the file contains `export type DbRow = Record<string, unknown>` once and `= DbRow>` twice.
2. `'src/lib/db.ts carries no any and no eslint-disable comment'` - asserts no `eslint-disable` occurrence and no `: any` / `= any` / `any[]` occurrence in the file.
3. `'every type exported by src/lib/dbRows.ts is imported somewhere under src'` - parses the `export interface X` / `export type X` names out of `dbRows.ts` and asserts each appears in an import from `@/lib/dbRows` in at least one other file under `src/`.

The guard test may build its `@/lib/dbRows` marker string however it likes - a plain string literal is fine, no concatenation or escaping trick is required. ER2's consumer grep filters `__tests__` out precisely so that this test file is never counted as a consumer, whichever form the marker takes.

The compile-time proof of the signature itself is the throwaway probe in ER3, run by the developer and by QA and deleted afterwards.

### 7. Version and landing page

Bump `package.json` to `0.1.83-YYYYMMDDHHmm` (local time, strictly greater than `0.1.82-202609072252`). Per the Landing Page Rule this task is internal type hygiene with no user-visible behaviour, so it is **not** a selling point: `src/components/landing/LandingPage.tsx`, `src/i18n/dictionaries/en.json` and `src/i18n/dictionaries/pt-BR.json` must not change.

## Expected Results

ER1 - `src/lib/db.ts` carries the new signature and no `any`. From the repo root, `grep -c "^export type DbRow = Record<string, unknown>$" src/lib/db.ts` prints `1`; `grep -c "= DbRow>" src/lib/db.ts` prints `2` (the `query` function and the `Queryable.query` member); `grep -c "params?: unknown\[\]" src/lib/db.ts` prints `2`; `grep -c "Promise<QueryResult<T>>" src/lib/db.ts` prints `2`; `grep -c "eslint-disable" src/lib/db.ts` prints `0`; and `grep -c ": any\|= any\|any\[\]" src/lib/db.ts` prints `0`. The line `const globalForDb = global as unknown as { pool?: Pool }` is still present (`grep -c "global as unknown as { pool?: Pool }" src/lib/db.ts` prints `1`).

ER2 - `src/lib/dbRows.ts` exists, holds exactly the four new row types, and every one of them is consumed. `test -f src/lib/dbRows.ts` succeeds; `grep -c "^export interface " src/lib/dbRows.ts` prints `4`; `grep -c "^export interface BandByInviteCodeRow\|^export interface PlaylistSongIdRow\|^export interface PlaylistSongLinksRow\|^export interface SpotifyTokenRow" src/lib/dbRows.ts` prints `4`; `grep -rl "from '@/lib/dbRows'" src --include='*.ts' | grep -v __tests__ | sort` lists exactly `src/app/api/spotify/playlists/[id]/sync/route.ts`, `src/lib/bands.server.ts` and `src/lib/spotifyAuth.ts`; and `npm run lint:dead` prints no file or symbol list and exits 0 (knip flags any unused export, so this proves no speculative row type was added). `grep -c "^# Database Row Types$" AGENTS.md` prints `1` and `grep -c "src/lib/dbRows.ts" AGENTS.md` prints at least `1`.

ER3 - the compiler now rejects reading an untyped row and accepts a typed one. First run `./node_modules/.bin/tsc --noEmit`: it prints nothing and exits 0. Then create a probe with `printf 'import { query } from "./db"\nexport async function probe() {\n  const r = (await query("SELECT 1 AS n")).rows[0]\n  const x: number = r.n\n  return x\n}\n' > src/lib/probeRow.ts` and run `./node_modules/.bin/tsc --noEmit` again: it prints a line containing `src/lib/probeRow.ts(4,9): error TS2322: Type 'unknown' is not assignable to type 'number'.` and exits non-zero. Then replace the probe's first `query(` call with `query<{ n: number }>(` (same file, otherwise identical) and re-run `./node_modules/.bin/tsc --noEmit`: it prints nothing and exits 0. Finally `rm src/lib/probeRow.ts` and confirm `git status --short` shows no entry for `src/lib/probeRow.ts`.

ER4 - the 20 compiler-flagged casts are gone and no cast was added or laundered anywhere. `grep -rn "as [A-Z][A-Za-z]*\[\]\|rows\[0\] as \|\.rows as " src --include='*.ts' | grep -v __tests__ | wc -l` prints `6` (down from the `246313f` baseline of `26`), and `grep -rn "as [A-Z][A-Za-z]*\[\]\|rows\[0\] as \|\.rows as " src --include='*.ts' | grep -v __tests__ | sed 's/:.*//' | sort | uniq -c` shows exactly `1 src/lib/bands.ts`, `1 src/lib/moderation.ts`, `1 src/lib/playlists.ts`, `2 src/lib/songs.ts`, `1 src/lib/spotify.ts` and nothing else. `grep -rn "as unknown as" src --include='*.ts' --include='*.tsx' | grep -v __tests__ | wc -l` prints `2`, unchanged from baseline. `grep -rc "@ts-ignore\|@ts-expect-error\|@ts-nocheck" src --include='*.ts' --include='*.tsx' | grep -v ":0$" | wc -l` prints `0`.

ER5 - the shared db helper is typed and its consumers are untouched. `grep -c "eslint-disable" src/lib/__tests__/test-helpers.ts` prints `0` and `grep -c ": any\|= any\|any\[\]\|(admin: any" src/lib/__tests__/test-helpers.ts` prints `0`. `git diff --name-only 246313f -- src --diff-filter=M | grep "test.ts" | wc -l` prints `0` (no existing test file was modified). With Postgres live at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`, `rtk proxy npx vitest run src/lib/__tests__/bands.test.ts src/lib/__tests__/playlists.test.ts src/lib/__tests__/profile.test.ts src/lib/__tests__/songs.test.ts src/lib/__tests__/spotify.test.ts src/lib/__tests__/joinBandByInvite.test.ts` reports `Test Files 6 passed (6)` and `0 failed`.

ER6 - the new guard test exists and passes. `rtk proxy npx vitest run src/lib/__tests__/dbRowTypes.test.ts` reports `Test Files 1 passed (1)` and `Tests 3 passed (3)`, and its output contains the three test names `src/lib/db.ts uses DbRow as the default row type for query and Queryable`, `src/lib/db.ts carries no any and no eslint-disable comment` and `every type exported by src/lib/dbRows.ts is imported somewhere under src` (visible with `rtk proxy npx vitest run src/lib/__tests__/dbRowTypes.test.ts --reporter=verbose`).

ER7 - the static gates hold and no budget override was loosened. `rtk proxy npx eslint .` ends with a summary line matching `problems (8 errors,` - the two `@typescript-eslint/no-explicit-any` errors are gone and no new error appeared - and `rtk proxy npx eslint . 2>&1 | grep -c "no-explicit-any"` prints `0`; `rtk proxy npx eslint . 2>&1 | grep -c "src/lib/db.ts\|src/lib/dbRows.ts"` prints `0`. `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts` reports `Tests 6 passed (6)`. `git diff 246313f -- eslint.config.mjs` prints nothing, or prints only hunks that lower a number inside the `complexity-budget-overrides` block - no number may rise and no entry may be added. `wc -l src/lib/songs.ts` prints `531`. `npm run lint:dup` prints `Found 18 clones` with `230 (0.69%)` duplicated lines or fewer, and `npm run audit` prints `found 0 vulnerabilities`.

ER8 - behaviour is provably unchanged outside the data layer. `git diff 246313f -- src/app/actions src/components src/hooks src/store src/types src/i18n migrations` prints nothing. With the DB precondition of ER5 satisfied, `rtk proxy npx vitest run src/lib/__tests__/transactionAtomicity.db.test.ts src/lib/__tests__/spotifySyncAtomicity.db.test.ts src/lib/__tests__/spotifyPlaylistRouteAuthz.db.test.ts src/app/actions/__tests__/authzRepertoire.db.test.ts src/app/actions/__tests__/authzBands.db.test.ts src/app/actions/__tests__/authzPlaylists.db.test.ts src/app/actions/__tests__/authzTabs.db.test.ts src/lib/__tests__/moderation.test.ts src/lib/__tests__/tabs.test.ts src/lib/__tests__/bands.server.test.ts` reports `Test Files 10 passed (10)` and `Tests 114 passed (114)`.

ER9 - the whole suite and the coverage gate stay green. With Postgres live at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`, `rtk proxy npx vitest run` reports at least `Test Files 90 passed (90)` and at least `Tests 1043 passed (1043)`, with `0 failed` and `0 skipped` (the baseline at `246313f` is 89 files / 1040 tests, plus the three tests of ER6). `npm run test:coverage` exits 0 and its `All files` row shows statements >= 80, branches >= 65, functions >= 78 and lines >= 80 (baseline 97.14 / 84.45 / 99.4 / 97.66), with no `ERROR: Coverage for ... does not meet threshold` line in the output.

ER10 - the app still builds and renders server-side. `npx next build` exits 0 and prints `Compiled successfully`. `npx playwright test e2e/ssr-smoke.spec.ts` reports `4 passed`.

ER11 - version bumped, landing untouched, and the diff stays inside the whitelist. `node -p "require('./package.json').version"` prints a string matching `^0\.1\.83-[0-9]{12}$` that sorts strictly after `0.1.82-202609072252`. `git diff 246313f -- src/components/landing/LandingPage.tsx src/i18n/dictionaries/en.json src/i18n/dictionaries/pt-BR.json` prints nothing (this task ships no selling point). `git diff --name-only 246313f | sort` lists only paths drawn from this closed set: `AGENTS.md`, `docs/suggestions-log.md`, `docs/tasks/RH-54-spec.md`, `eslint.config.mjs`, `package.json`, `package-lock.json`, `src/app/api/spotify/playlists/[id]/import/route.ts`, `src/app/api/spotify/playlists/[id]/sync/route.ts`, `src/lib/__tests__/dbRowTypes.test.ts`, `src/lib/__tests__/test-helpers.ts`, `src/lib/bands.server.ts`, `src/lib/bands.ts`, `src/lib/db.ts`, `src/lib/dbRows.ts`, `src/lib/moderation.ts`, `src/lib/playlists.ts`, `src/lib/profile.ts`, `src/lib/songs.ts`, `src/lib/spotifyAuth.ts`, `src/lib/tabs.ts` - any other path fails this result.

## Out of Scope

- The ~52 `query()` call sites the compiler does not flag, and the 6 remaining casts. RH-56 (`songs.ts`, `tabs.ts`), RH-57 (`bands.ts`, `bands.server.ts`, `playlists.ts`, `profile.ts`) and RH-58 (`spotifyAuth.ts`, `spotifyPlaylistSync.ts`, `spotify.ts`, `auth.ts`, the four route handlers) own them. This task deliberately leaves those files partially typed.
- Any change to `src/lib/moderation.ts` behaviour: no payload validation, no restructuring of `reviewGlobalSongEdit`, no touching its pinned `complexity: 19` override. That is RH-55 (F17).
- Schema changes. `migrations/` is not touched.
- Server Actions, components, hooks, stores, i18n dictionaries and `src/types/database.ts`: none of them changes.
- Landing page copy: this is internal type hygiene, not a selling point.
- Retiring `kysely`, changing the pool configuration, or introducing an ORM.

## Post-merge checks (orchestrator)

- RH-56 must re-measure `src/lib/songs.ts`: after this task the six `Repertoire`/`GlobalSong` sites are already typed, so its "19 call sites / 10 casts" figure drops to 11 call sites and 2 casts, and the same applies to `tabs.ts` (both casts already gone). Re-spec RH-56 against the post-merge tree rather than against `246313f`.
- RH-57 and RH-58 likewise inherit `bands.server.ts`, `profile.ts`, `spotifyAuth.ts` and the two Spotify route handler sites already done here.
- RH-55 inherits `moderation.ts` with four typed reads; the `proposed_data as Record<string, unknown>` cast it will delete is the one this task deliberately left in place.

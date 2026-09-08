# RH-56 - query tipado parte 3/5: tipar a camada de dados de songs e tabs

Part 3 of 5 of RH-40 (RH-25 F16). Parent: RH-40. Depends on RH-54 (`f92c0f3`, the `DbRow`
foundation and `src/lib/dbRows.ts`) and RH-55 (`b024a87`), both `done`.

Baseline for every number in this spec is HEAD = `b024a87`.

## Scope

Name the row shape at every remaining untyped query call site in `src/lib/songs.ts` and
`src/lib/tabs.ts`, and delete the four `as` casts on query results that live in those two
files. Nothing else changes: every SQL string, every parameter array, every function
signature's observable behaviour and every return value stay byte-identical.

Concretely, this task covers exactly:

1. The 11 untyped `query(` / `client.query(` call sites in `src/lib/songs.ts`
   (lines 26, 115, 134, 153, 171, 282, 293, 369, 428, 452, 482).
2. The 4 untyped `runTabQuery(` call sites in `src/lib/tabs.ts` (lines 70, 84, 99, 135).
   `runTabQuery` is this module's only query call site wrapper: it forwards its row type
   argument straight to `query<T>`, so naming the type there is the same operation.
3. The 4 casts on query results in those two files: `src/lib/songs.ts:34`,
   `src/lib/songs.ts:472`, `src/lib/tabs.ts:78`, `src/lib/tabs.ts:107`.
4. One new interface in `src/lib/dbRows.ts` (`RepertoireAccessRow`), plus the
   `eslint.config.mjs` `max-lines` override for `src/lib/songs.ts` retightened to the
   file's new line count.

It does not cover any other module's call sites or casts, and it adds no feature, no
migration and no UI change.

## Audit at b024a87

### `src/lib/songs.ts` - untyped call sites (11)

| Line | Function | Statement (unchanged) | Rows read? | Row type to name |
|---|---|---|---|---|
| 26 | `assertRepertoireAccess` | `SELECT id, song_id, user_id, band_id FROM repertoire WHERE ...` | `res.rowCount`, `res.rows[0]` | `RepertoireAccessRow` (new, `dbRows.ts`) |
| 115 | `updateSongStatus` | `UPDATE repertoire SET status = $1 ... RETURNING id` | `res.rowCount` only | inline `{ id: string }` |
| 134 | `updateSongTags` | `UPDATE repertoire SET tags = $1 ... RETURNING id` | `res.rowCount` only | inline `{ id: string }` |
| 153 | `updatePersonalKey` | `UPDATE repertoire SET personal_key = $1 ... RETURNING id` | `res.rowCount` only | inline `{ id: string }` |
| 171 | `removeSongFromRepertoire` | `DELETE FROM repertoire WHERE ... RETURNING id` | `res.rowCount` only | inline `{ id: string }` |
| 282 | `updateSong` (inside `withTransaction`) | `UPDATE global_songs SET ... WHERE id = $8` (no `RETURNING`) | result discarded | `never` |
| 293 | `updateSong` (inside `withTransaction`) | `UPDATE repertoire SET ... WHERE id = $4 AND ...` (no `RETURNING`) | result discarded | `never` |
| 369 | `createAndAddSong` | `SELECT id FROM repertoire WHERE song_id = $1 AND ... LIMIT 1` | `res.rowCount` only | inline `{ id: string }` |
| 428 | `updateLyrics` | `UPDATE repertoire SET lyrics = $1 WHERE ...` (no `RETURNING`) | result discarded | `never` |
| 452 | `applySongLinkUpdate` | `SELECT links FROM global_songs WHERE id = $1` | `res.rowCount`, `res.rows[0].links` | inline `{ links: SongLink[] \| null }` |
| 482 | `applySongLinkUpdate` | `UPDATE global_songs SET links = $1 WHERE id = $2` (no `RETURNING`) | result discarded | `never` |

Already typed and untouched in `songs.ts`: lines 60, 96, 221, 399, 523 (`query<Repertoire>`),
190 (`query<GlobalSong>`), 338 and 350 (`query<{ id: string }>`). Eight typed call sites
today, 19 after this task.

### `src/lib/tabs.ts` - untyped call sites (4)

| Line | Function | Statement (unchanged) | Rows read? | Row type to name |
|---|---|---|---|---|
| 70 | `getTabFileUrl` | `SELECT file_url FROM repertoire_tabs WHERE id = $1 AND repertoire_id = $2` | `res.rows[0].file_url` | inline `{ file_url: string }` |
| 84 | `deleteTab` | `DELETE FROM repertoire_tabs WHERE id = $1 AND repertoire_id = $2` | result discarded | `never` |
| 99 | `getTabAnnotations` | `SELECT annotations FROM repertoire_tabs WHERE id = $1 AND repertoire_id = $2` | `res.rows[0].annotations` | inline `{ annotations: TabAnnotations }` |
| 135 | `saveTabAnnotations` | `UPDATE repertoire_tabs SET annotations = jsonb_set(...) ... RETURNING id` | `res.rows.length` only | inline `{ id: string }` |

Already typed and untouched in `tabs.ts`: line 35 (`query<T>` inside `runTabQuery`), 51 and
151 (`runTabQuery<RepertoireTab>`). Three typed call sites today, 7 after this task.

`src/lib/tabs.ts` has zero direct `query(` call sites: every statement goes through the
`runTabQuery` helper, which already carries the generic parameter
`<T extends QueryResultRow = DbRow>`.

### The four casts to delete

- `src/lib/songs.ts:34` - `return res.rows[0] as { id: string; song_id: string; user_id: string | null; band_id: string | null }`
- `src/lib/songs.ts:472` - `const currentLinks = (songRes.rows[0].links ?? []) as SongLink[]`
- `src/lib/tabs.ts:78` - `return res.rows[0].file_url as string`
- `src/lib/tabs.ts:107` - `return res.rows[0].annotations as TabAnnotations`

The repo-wide cast inventory at `b024a87` is six lines
(`grep -rn 'as [A-Z][A-Za-z]*\[\]\|rows\[0\] as \|\.rows as ' src --include='*.ts' | grep -v __tests__`
returns `src/lib/spotify.ts:30`, `src/lib/bands.ts:348`, `src/lib/songs.ts:34`,
`src/lib/songs.ts:472`, `src/lib/moderation.ts:151`, `src/lib/playlists.ts:89`). That pattern
does not catch the two `tabs.ts` column casts, so `grep -n 'rows.* as ' src/lib/songs.ts
src/lib/tabs.ts` (4 lines today) is the second inventory this task drives to zero.

### Existing types that already fit

- `Repertoire`, `GlobalSong`, `SongLink`, `TabAnnotations`, `RepertoireTab` from
  `src/types/database.ts` - already named where they fit; `SongLink` and `TabAnnotations` are
  reused inside the two inline shapes below and are already imported by their files.
- `dbRows.ts` today holds `BandByInviteCodeRow`, `PlaylistSongIdRow`, `PlaylistSongLinksRow`,
  `SpotifyTokenRow`. None of them matches any projection in this task
  (`PlaylistSongLinksRow` is a three-column playlist projection, not
  `SELECT links FROM global_songs`).

## Approach

### 1. Statements that return no rows: `never`

Five statements return no rows at all (`songs.ts:282`, `songs.ts:293`, `songs.ts:428`,
`songs.ts:482`, `tabs.ts:84` - all `UPDATE`/`DELETE` without `RETURNING`, all with their
result discarded). They are written `query<never>(...)`, `client.query<never>(...)` and
`runTabQuery<never>(...)`.

`never` satisfies the `T extends QueryResultRow` constraint, so this compiles today
(verified with a throwaway probe against `./node_modules/.bin/tsc --noEmit`), and it states
the fact precisely: `QueryResult<never>.rows` is `never[]`, so any later attempt to read a
column off such a result is a compile error rather than a silent `unknown`. Leaving these
sites untyped is not an option: the default `DbRow` would still parse as an untyped call site
under the ER1 grep, and it would wrongly suggest the statement yields readable rows.

### 2. Single-column projections: inline type arguments

AGENTS.md ("Database Row Types") explicitly allows `query<{ id: string }>('... RETURNING id')`
for a single-column projection whose shape is evident at the call site. All of these are that:

- `songs.ts:115, 134, 153, 171, 369` and `tabs.ts:135` -> `{ id: string }` (five `RETURNING id`
  statements plus one `SELECT id ... LIMIT 1`, all read only for the affected-row count).
- `songs.ts:452` -> `{ links: SongLink[] | null }`. `SongLink` is already imported by
  `songs.ts` and stays imported (it is still used by `SongUpdateInput`, `createAndAddSong` and
  `applySongLinkUpdate`).
- `tabs.ts:70` -> `{ file_url: string }`; `tabs.ts:99` -> `{ annotations: TabAnnotations }`.
  `TabAnnotations` is already imported by `tabs.ts`.

Written with exactly these spellings (single space inside the braces), because ER1 pins them
as fixed strings:

```
await query<{ id: string }>(
await query<{ links: SongLink[] | null }>(
await runTabQuery<{ file_url: string }>(
await runTabQuery<{ annotations: TabAnnotations }>(
await runTabQuery<{ id: string }>(
await runTabQuery<never>(
```

### 3. The one new interface: `RepertoireAccessRow`

`songs.ts:26` projects four columns and its row is returned to callers
(`src/app/actions/repertoire.ts:141` destructures `song_id` from it), so it earns a named
interface. Add to `src/lib/dbRows.ts`, keeping the file's existing doc-comment style and
alphabetical-by-subject placement:

```ts
/** `SELECT id, song_id, user_id, band_id FROM repertoire WHERE id = $1 AND (...)` */
export interface RepertoireAccessRow {
  id: string
  song_id: string
  user_id: string | null
  band_id: string | null
}
```

It is not a duplicate of a domain type: `Repertoire` in `src/types/database.ts` carries nine
more columns than this projection selects.

### 4. Per-site edits

`src/lib/songs.ts`:

- Add `import type { RepertoireAccessRow } from '@/lib/dbRows'` as a new line after the
  `@/lib/moderation` import (+1 line).
- Collapse the four-line signature of `assertRepertoireAccess` (lines 14-17) into one line,
  using the new interface as the return type (-3 lines):

  ```ts
  export async function assertRepertoireAccess(repertoireId: string, userId: string): Promise<RepertoireAccessRow> {
  ```

  The type is structurally identical to the inline object literal it replaces, so no caller
  changes. `max-params` is 4 for `src/lib` and this function takes 2; there is no `max-len`
  rule in `eslint.config.mjs`.
- Line 26 becomes `res = await query<RepertoireAccessRow>(sql, [repertoireId, userId])`; line
  34 becomes `return res.rows[0]` (cast deleted).
- Lines 115, 134, 153, 171, 369: `query(` becomes `query<{ id: string }>(`.
- Lines 282, 293: `client.query(` becomes `client.query<never>(`.
- Lines 428, 482: `query(` becomes `query<never>(`.
- Line 452: `query(` becomes `query<{ links: SongLink[] | null }>(`; line 472 becomes
  `const currentLinks = songRes.rows[0].links ?? []` (cast deleted).

`src/lib/tabs.ts`:

- Lines 70, 84, 99, 135: name the row type on the `runTabQuery` call as listed in the audit.
- Line 78 becomes `return res.rows[0].file_url`; line 107 becomes
  `return res.rows[0].annotations` (both casts deleted).
- Update the stale sentence in the `runTabQuery` doc comment (line 26, "the callers that only
  read one column keep the `DbRow` default") to say that every caller now names its row shape.
- Keep the `= DbRow` default on `runTabQuery` and keep `type DbRow` in the `@/lib/db` import.
  `src/lib/tabs.ts` is the only non-test importer of `DbRow`; dropping it would make `DbRow` an
  unused export and fail `npm run lint:dead`.

### 5. Line-count strategy for `src/lib/songs.ts`

`src/lib/songs.ts` is 531 lines and `eslint.config.mjs` pins
`{ files: ["src/lib/songs.ts"], rules: { complexity: ["error", 21], "max-lines": ["error", 531] } }`.
Naming a type argument adds characters, not lines, and both cast deletions are in-place edits,
so the only line-count movement is the +1 import and the -3 signature collapse: the file lands
at **529** lines.

`src/lib/__tests__/complexityBudget.test.ts` fails on an override ceiling that is not exactly
the file's current worst number, so the override must be retightened in the same commit:

```
{ name: "complexity-budget/override", files: ["src/lib/songs.ts"], rules: { complexity: ["error", 21], "max-lines": ["error", 529] } },
```

`complexity: 21` is unchanged (no branch is added or removed). The override list stays at 23
entries; no entry is added and none is loosened. `src/lib/tabs.ts` keeps its `max-params: 5`
override and has no `max-lines` override (base budget 400, file is 162 lines and stays well
under it).

### 6. Test plan

No new test file and no change to any existing test. The behaviour proof is the suites that
already exercise these functions end to end, all green at `b024a87`:

| Suite | Tests | What it pins |
|---|---|---|
| `src/lib/__tests__/songs.test.ts` | 27 | repertoire CRUD, `createAndAddSong` lookup/insert, link updates |
| `src/lib/__tests__/tabs.test.ts` | 25 | all six `tabs.ts` functions incl. the annotation read/write paths |
| `src/lib/__tests__/edge_cases.test.ts` | 10 | empty/absent-row paths |
| `src/lib/__tests__/errors.test.ts` | 49 | the L1 log-then-throw wrapper messages |
| `src/lib/__tests__/dbRowTypes.test.ts` | 3 | RH-54 guard, incl. "every `dbRows.ts` export is imported" |
| `src/lib/__tests__/transactionAtomicity.db.test.ts` | 6 | `updateSong`'s two-statement transaction against real Postgres |
| `src/app/actions/__tests__/authzRepertoire.db.test.ts` | 20 | `assertRepertoireAccess` denial/allow matrix |
| `src/app/actions/__tests__/authzTabs.db.test.ts` | 11 | tab authorization through the same predicate |

Sum: 151 tests across 8 files. `complexityBudget.test.ts` (6 tests) covers the budget side.

Type safety itself is proven by `./node_modules/.bin/tsc --noEmit` exiting 0 with the casts
gone: with `DbRow = Record<string, unknown>` as the default, an unnamed row cannot be read at
all, so a compiling read is a proof the shape was declared. A hand-written type-level test
would add nothing here - `tsconfig.json` excludes `**/__tests__/**`, so a type assertion
parked in a test file is never checked (this is exactly why the RH-54 guard is a source scan).

## Expected Results

ER1 - every query call site in the two data modules names its row type. From the repo root,
`grep -cE 'await (client\.)?query\(|await runTabQuery\(' src/lib/songs.ts src/lib/tabs.ts`
prints `src/lib/songs.ts:0` and `src/lib/tabs.ts:0` (in either order; the baseline at
`b024a87` is `11` and `4`), and
`grep -cE 'await (client\.)?query<|await runTabQuery<' src/lib/songs.ts src/lib/tabs.ts`
prints `src/lib/songs.ts:19` and `src/lib/tabs.ts:7` (baseline `8` and `3`). The individual
type arguments are pinned as fixed strings: `grep -cF 'await query<{ id: string }>' src/lib/songs.ts`
prints `7`, `grep -cF 'await query<RepertoireAccessRow>' src/lib/songs.ts` prints `1`,
`grep -cF 'await query<{ links: SongLink[] | null }>' src/lib/songs.ts` prints `1`,
`grep -cF 'query<never>' src/lib/songs.ts` prints `4`,
`grep -cF 'await runTabQuery<{ file_url: string }>' src/lib/tabs.ts` prints `1`,
`grep -cF 'await runTabQuery<{ annotations: TabAnnotations }>' src/lib/tabs.ts` prints `1`,
`grep -cF 'await runTabQuery<{ id: string }>' src/lib/tabs.ts` prints `1` and
`grep -cF 'await runTabQuery<never>' src/lib/tabs.ts` prints `1`. Finally
`grep -c 'type DbRow' src/lib/tabs.ts` prints `1` and `grep -c '= DbRow>' src/lib/tabs.ts`
prints `1` (the `= DbRow` default on `runTabQuery` and its import are deliberately kept,
because `src/lib/tabs.ts` is the only non-test importer of that export).

ER2 - the four casts in these two files are gone and no cast was laundered anywhere.
`grep -n 'rows.* as ' src/lib/songs.ts src/lib/tabs.ts` prints nothing and exits non-zero
(the baseline at `b024a87` prints exactly four lines: `src/lib/songs.ts:34`,
`src/lib/songs.ts:472`, `src/lib/tabs.ts:78`, `src/lib/tabs.ts:107`). Repo-wide,
`sh -c "grep -rn 'as [A-Z][A-Za-z]*\[\]\|rows\[0\] as \|\.rows as ' src --include='*.ts' | grep -v __tests__"`
lists exactly four lines and they are in `src/lib/spotify.ts`, `src/lib/bands.ts`,
`src/lib/moderation.ts` and `src/lib/playlists.ts` only - no `src/lib/songs.ts` and no
`src/lib/tabs.ts` line appears (baseline: six lines, the two extra ones being the `songs.ts`
casts). `grep -rc '@ts-ignore\|@ts-expect-error\|@ts-nocheck' src --include='*.ts' --include='*.tsx' | grep -v ':0$' | wc -l`
prints `0`, and
`grep -rn 'as unknown as' src --include='*.ts' --include='*.tsx' | grep -v __tests__ | wc -l`
prints `2`, unchanged from baseline.

ER3 - the new row interface lives in `src/lib/dbRows.ts` and is consumed.
`grep -c '^export interface ' src/lib/dbRows.ts` prints `5` (baseline `4`);
`grep -c '^export interface RepertoireAccessRow {$' src/lib/dbRows.ts` prints `1`; and the
four fields are declared there, so
`sed -n '/^export interface RepertoireAccessRow {$/,/^}$/p' src/lib/dbRows.ts | grep -c 'id: string'`
prints `4` (the lines `id: string`, `song_id: string`, `user_id: string | null` and
`band_id: string | null`). `grep -c 'RepertoireAccessRow' src/lib/songs.ts` prints `3` (the import,
the return type and the `query<RepertoireAccessRow>` call), and
`grep -rl "from '@/lib/dbRows'" src --include='*.ts' | grep -v __tests__ | sort` lists exactly
`src/app/api/spotify/playlists/[id]/sync/route.ts`, `src/lib/bands.server.ts`,
`src/lib/songs.ts` and `src/lib/spotifyAuth.ts`. No row interface was added to `src/lib/songs.ts`
or `src/lib/tabs.ts`: `grep -c '^export interface .*Row' src/lib/songs.ts src/lib/tabs.ts`
prints `src/lib/songs.ts:0` and `src/lib/tabs.ts:0`. `npm run lint:dead` prints no file or
symbol list and exits 0, and `rtk proxy npx vitest run src/lib/__tests__/dbRowTypes.test.ts`
reports `Test Files 1 passed (1)` and `Tests 3 passed (3)`.

ER4 - `src/lib/songs.ts` did not grow and its budget override was retightened, not loosened.
`wc -l src/lib/songs.ts` prints a number N with N <= 531 (the approach in this spec yields
`529`). The line in `eslint.config.mjs` whose `files` entry is `["src/lib/songs.ts"]` has
`"max-lines": ["error", N]` for exactly that same N and still has `complexity: ["error", 21]`
(read it with `grep -n 'src/lib/songs.ts' eslint.config.mjs`, which prints one line).
`grep -c 'complexity-budget/override' eslint.config.mjs` prints `23`, unchanged, and
`git diff b024a87 -- eslint.config.mjs` prints either nothing or a single one-line hunk that
only lowers that `max-lines` number - no other override line may change, no number may rise
and no entry may be added. `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts`
reports `Test Files 1 passed (1)` and `Tests 6 passed (6)`.

ER5 - every SQL statement and parameter list is byte-identical, and nothing outside the data
layer moved. In bash or zsh, from the repo root,
`diff <(git show b024a87:src/lib/songs.ts | sed -E 's/query<[^>]*>\(/query(/g') <(sed -E 's/query<[^>]*>\(/query(/g' src/lib/songs.ts) | grep -cE 'SELECT|INSERT|UPDATE|DELETE|RETURNING|VALUES|\$[0-9]'`
prints `0` - that is, once the added type arguments are normalized away, not one differing
line carries SQL or a bind placeholder. Likewise
`git diff b024a87 -- src/lib/tabs.ts | grep '^[-+]' | grep -v '^[-+][-+]' | grep -cE 'SELECT|INSERT|UPDATE|DELETE|RETURNING|VALUES|\$[0-9]'`
prints `0`. `git diff b024a87 -- src/app src/components src/hooks src/store src/types src/i18n migrations`
prints nothing, and `git diff --name-only b024a87 -- src --diff-filter=M | grep -c 'test\.tsx\?$'`
prints `0` (no existing test file needed changing).

ER6 - the suites that exercise these two modules stay green with unchanged counts. With
Postgres live at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations
applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`,
`rtk proxy npx vitest run src/lib/__tests__/songs.test.ts src/lib/__tests__/tabs.test.ts src/lib/__tests__/edge_cases.test.ts src/lib/__tests__/errors.test.ts src/lib/__tests__/dbRowTypes.test.ts src/lib/__tests__/transactionAtomicity.db.test.ts src/app/actions/__tests__/authzRepertoire.db.test.ts src/app/actions/__tests__/authzTabs.db.test.ts`
reports `Test Files 8 passed (8)` and `Tests 151 passed (151)`, with `0 failed` and no skipped
test (identical to the `b024a87` baseline: 27 + 25 + 10 + 49 + 3 + 6 + 20 + 11).

ER7 - the static gates hold exactly where they did. `./node_modules/.bin/tsc --noEmit` writes
nothing to stdout or stderr and exits 0. `rtk proxy npx eslint .` ends with the summary line
`22 problems (8 errors, 14 warnings)` - unchanged from `b024a87` - and
`rtk proxy npx eslint . 2>&1 | grep -c 'src/lib/songs.ts\|src/lib/tabs.ts\|src/lib/dbRows.ts'`
prints `0`. `npm run lint:dup` prints `Found 19 clones.` or fewer, with a total of
`242 (0.71%)` duplicated lines or fewer. `npm run audit` prints `found 0 vulnerabilities`.

ER8 - the whole suite and the coverage gate stay green. With the same DB precondition as ER6
(Postgres live at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations
applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`),
`rtk proxy npx vitest run` reports at least `Test Files 92 passed (92)` and at least
`Tests 1064 passed (1064)`, with `0 failed` and `0 skipped` (the `b024a87` baseline is exactly
92 files / 1064 tests / 0 skipped). `npm run test:coverage` exits 0 and its `All files` row
shows statements >= 80, branches >= 65, functions >= 78 and lines >= 80, with no
`ERROR: Coverage for ... does not meet global threshold` line anywhere in the output.

ER9 - the app still builds and renders server-side. `npx next build` exits 0 and prints
`Compiled successfully`. `npx playwright test e2e/ssr-smoke.spec.ts` reports `4 passed`.

ER10 - version bumped, landing untouched, diff inside the whitelist.
`node -p "require('./package.json').version"` prints a string matching `^0\.1\.85-[0-9]{12}$`
that sorts strictly after `0.1.84-202609080104`. This task ships no selling point (it is an
internal type-safety refactor), so
`git diff b024a87 -- src/components/landing/LandingPage.tsx src/i18n/dictionaries/en.json src/i18n/dictionaries/pt-BR.json`
prints nothing. `git diff --name-only b024a87 | sort` lists only paths drawn from this closed
set: `AGENTS.md`, `docs/suggestions-log.md`, `docs/tasks/RH-56-spec.md`, `eslint.config.mjs`,
`package.json`, `src/lib/dbRows.ts`, `src/lib/songs.ts`, `src/lib/tabs.ts` - any other path
fails this result.

## Out of Scope

- Parts 4 and 5 of RH-40: the call sites and casts in `src/lib/bands.ts`,
  `src/lib/bands.server.ts`, `src/lib/playlists.ts`, `src/lib/profile.ts`,
  `src/lib/moderation.ts`, `src/lib/spotify.ts`, `src/lib/spotifyAuth.ts` and the
  `src/app/api/**/route.ts` handlers. Their four remaining casts stay exactly where they are
  (ER2 pins that).
- Any change to SQL text, parameter order, return values, thrown messages or logging.
- Any change to `src/lib/db.ts`, `src/types/database.ts` or the RH-54 guard test.
- A repo-wide lint rule or guard test forbidding untyped `query(` call sites. That only makes
  sense once parts 4 and 5 have cleared the remaining modules; it belongs to the last part of
  RH-40.
- New tests, new features, migrations, UI and landing-page copy.

## Post-merge checks (orchestrator)

- After merge, re-run `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts` on
  `master` to confirm the retightened `max-lines: 529` still matches the merged file.
- Carry the remaining cast inventory (four lines, ER2) into the RH-40 part 4 and part 5 specs
  as their starting baseline.

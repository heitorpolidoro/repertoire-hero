# RH-40 - Tipar o helper query e validar o payload de moderacao (integration and close-out)

RH-40 was split once, into RH-54, RH-55, RH-56, RH-57 and RH-58. All five are
`done` and merged (`f92c0f3`, `b024a87`, `b293e82`, `9e37072`, `55656fe`). A task
is split at most once, so this is not a second split: it is the reduced-scope
spec for what is left after the five parts, which is integration verification
plus the documentation close-out.

Baseline: `ca91de2`, version `0.1.88-202609090956`, clean tree
(`git status --porcelain` prints nothing). The baseline moved past RH-58's
`55656fe` because RH-60 (`ca91de2`) landed in between: it pinned `next` from
16.0.0 to 16.3.4 and picked up the transitive `sharp`, `js-yaml` and
`@vitest/mocker` fixes, clearing five npm audit advisories that had made ER6's
`npm run audit` clause unsatisfiable. RH-60 touched `package.json`,
`package-lock.json` and its own docs only - no file under `src/`, `migrations/`,
`e2e/`, `eslint.config.mjs` or `vitest.config.ts` - so every count below was
re-measured at `ca91de2` and every one of them is unchanged from `55656fe`.

## Scope

This task covers exactly two things.

1. **Integration verification.** Prove that the five parts compose at `ca91de2`:
   findings F16 and F17 of `docs/plans/code-quality-review.md` are satisfied
   simultaneously over the *whole* data-access layer, not just per module; the
   `query()` contract is provably enforced by the compiler rather than by
   convention; no cast, `as unknown as` launder, `@ts-expect-error` or `any`
   was substituted for a named row type anywhere; the row-type home holds
   exactly the interfaces that are actually consumed; the moderation validator
   is wired on both paths; and the guard suites the five parts introduced or
   must not have broken pass together in one run, alongside every static gate,
   the whole suite, coverage, the production build and the SSR smoke spec at the
   same commit. Nothing here changes behaviour; the verification is the
   deliverable and its evidence is the Expected Results below.
2. **Documentation close-out.** Mark F16, F17 and task T7 (section 5) as
   resolved in `docs/plans/code-quality-review.md`, with the commit ids, and
   record with a dated additive note that F16's remediation as written does not
   type anything, so a later reader does not "fix" the delivered signature back
   into the broken one.

**This task changes no code.** The work was delivered by RH-54 (the `DbRow`
default, `src/lib/dbRows.ts`, the typed shared db mock and the 29
compiler-flagged sites), RH-55 (the `parseGlobalSongEditPayload` validator and
both moderation wiring points, F17), RH-56 (`songs.ts`, `tabs.ts`), RH-57
(`bands.ts`, `bands.server.ts`, `playlists.ts`, `profile.ts`) and RH-58 (the
Spotify data path, `moderation.ts`'s remaining reads and the four route
handlers). Not one line under `src/`, `migrations/`, `e2e/`, `eslint.config.mjs`
or `vitest.config.ts` moves here; ER9 states that as a checkable result.

## State at ca91de2

Every claim below was re-measured from the repository root at `ca91de2` while
writing this spec, on a clean tree.

**The helper contract.** `src/lib/db.ts` now reads
`export type DbRow = Record<string, unknown>` (L28),
`export async function query<T extends QueryResultRow = DbRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>`
(L30) and the identical member on `Queryable` (L40). No `any`, no `any[]`, no
`eslint-disable` comment survives in the file. The three
`await client.query('BEGIN' | 'COMMIT' | 'ROLLBACK')` lines are transaction
control, read no rows, and are deliberately untouched.

**Progress commit by commit.** Each row is the untyped row-reading call-site
count (`sh -c "grep -rnE 'await (client|db)?\.?query\(' src --include='*.ts' | grep -v __tests__ | grep -v '^src/lib/db.ts:'" | wc -l`),
the DB-row cast inventory
(`sh -c "grep -rn 'as [A-Z][A-Za-z]*\[\]\|rows\[0\] as \|\.rows as ' src --include='*.ts' | grep -v __tests__" | wc -l`),
the number of interfaces in `src/lib/dbRows.ts`, and the number of complexity
budget overrides in `eslint.config.mjs`.

| Commit | Task | Untyped sites | Casts | `dbRows.ts` interfaces | Overrides |
|---|---|---|---|---|---|
| `246313f` | pre-split HEAD | 80 | 26 | (file absent) | 24 |
| `f92c0f3` | RH-54 | 55 | 6 | 4 | 24 |
| `b024a87` | RH-55 | 55 | 6 | 4 | 23 |
| `b293e82` | RH-56 | 44 | 4 | 5 | 23 |
| `9e37072` | RH-57 | 17 | 2 | 9 | 23 |
| `55656fe` | RH-58 | 0 | 1 | 10 | 23 |
| `ca91de2` | RH-60 (dependencies only) | 0 | 1 | 10 | 23 |

The `80` at `246313f` is the mandated regex, which does not match the `pool`
receiver; counting `src/lib/auth.ts:84` as well gives the 81 sites the split
analysis reported. The single remaining cast is `src/lib/spotify.ts:30`,
`const data = await response.json() as SpotifyTrack[]` - a cast on an HTTP JSON
body, not on a `QueryResult` row, and therefore outside F16 (RH-58 recorded that
decision and pinned the line in place).

**What each child delivered.**

- **RH-54 (`f92c0f3`)** - the `DbRow` default and `unknown[]` params on both
  `query` and `Queryable.query`, both `eslint-disable` comments deleted,
  `src/lib/dbRows.ts` created with its first four interfaces, the
  `# Database Row Types` section added to AGENTS.md, the shared db mock
  `src/lib/__tests__/test-helpers.ts` typed (which retired the last two
  `@typescript-eslint/no-explicit-any` errors and took the eslint baseline from
  24 problems to 22), the 29 compiler-flagged sites fixed by naming a type
  argument, 20 casts deleted, and the guard `src/lib/__tests__/dbRowTypes.test.ts`.
- **RH-55 (`b024a87`)** - F17: `src/lib/globalSongEditPayload.ts` with exactly
  two exports (`GlobalSongEditPayload` and `parseGlobalSongEditPayload`), seven
  optional fields, one per mutable `global_songs` column; both wiring points in
  `src/lib/moderation.ts`; the ad-hoc `typeof` / `!== undefined` block deleted;
  `moderation.ts` dropping under the base complexity budget and losing its
  per-file override (24 entries down to 23); 17 table tests plus 2
  real-database tests.
- **RH-56 (`b293e82`)** - every remaining site in `src/lib/songs.ts` and
  `src/lib/tabs.ts`, `RepertoireAccessRow` added, the last two `songs.ts` casts
  deleted; `songs.ts` shrank 531 -> 529 lines and its `max-lines` override
  tightened to match.
- **RH-57 (`9e37072`)** - `bands.ts`, `bands.server.ts`, `playlists.ts`,
  `profile.ts`; `BandMemberRoleRow`, `JoinBandByInviteRow`, `PlaylistAccessRow`
  and `PlaylistEntryRow` added; fourteen casts deleted.
- **RH-58 (`55656fe`)** - `spotifyAuth.ts`, `spotifyPlaylistSync.ts`, the three
  remaining `moderation.ts` reads and the four Spotify route handlers;
  `GlobalSongLinksRow` added; the last five casts deleted. This is the commit at
  which the untyped count reaches zero.

**The contract is enforced by the compiler, not by convention.** I proved it on
this tree. A probe `src/lib/rh40Probe.ts` doing
`const r = (await query("SELECT 1 AS n")).rows[0]; const x: number = r.n` makes
`./node_modules/.bin/tsc --noEmit` print
`src/lib/rh40Probe.ts(4,9): error TS2322: Type 'unknown' is not assignable to type 'number'.`
and exit 2; changing only the call to `query<{ n: number }>(...)` makes the same
command print nothing and exit 0. The probe was deleted and
`git status --porcelain` prints nothing afterwards. This is the mechanically
checkable form of F16's intent, and ER2 carries it.

**The ten row interfaces are all consumed.** `grep -c "^export interface " src/lib/dbRows.ts`
prints `10`: `BandByInviteCodeRow`, `BandMemberRoleRow`, `GlobalSongLinksRow`,
`JoinBandByInviteRow`, `PlaylistAccessRow`, `PlaylistEntryRow`,
`PlaylistSongIdRow`, `PlaylistSongLinksRow`, `RepertoireAccessRow`,
`SpotifyTokenRow`. `grep -rl "from '@/lib/dbRows'" src --include='*.ts' | grep -v __tests__ | sort`
lists exactly seven consumers:
`src/app/api/spotify/playlists/[id]/sync/route.ts`, `src/lib/bands.server.ts`,
`src/lib/bands.ts`, `src/lib/playlists.ts`, `src/lib/songs.ts`,
`src/lib/spotifyAuth.ts`, `src/lib/spotifyPlaylistSync.ts`. `npm run lint:dead`
(knip) is clean, which is what proves no speculative interface was added, and
`src/lib/__tests__/dbRowTypes.test.ts` reports 3 passed, its third test asserting
that every export of `dbRows.ts` is imported somewhere under `src` outside
`__tests__`.

**F17 is wired on both paths.** `grep -c "parseGlobalSongEditPayload(" src/lib/moderation.ts`
prints `2`, `grep -c "from '@/lib/globalSongEditPayload'" src/lib/moderation.ts`
prints `1`, `grep -c "!== undefined" src/lib/moderation.ts` and
`grep -c "typeof proposed" src/lib/moderation.ts` each print `0`, and
`grep -c "src/lib/moderation.ts" eslint.config.mjs` prints `0` (the override was
deleted, not re-pinned). `src/lib/globalSongEditPayload.ts` has exactly two
`^export ` lines and seven optional-field declarations.

**The twelve guard and integration suites pass together.** One run over
`src/lib/__tests__/dbRowTypes.test.ts`,
`src/lib/__tests__/globalSongEditPayload.test.ts`,
`src/lib/__tests__/moderation.test.ts`,
`src/lib/__tests__/moderationPayload.db.test.ts`,
`src/lib/__tests__/complexityBudget.test.ts`,
`src/app/actions/__tests__/authzRepertoire.db.test.ts`,
`src/app/actions/__tests__/authzBands.db.test.ts`,
`src/app/actions/__tests__/authzPlaylists.db.test.ts`,
`src/app/actions/__tests__/authzTabs.db.test.ts`,
`src/lib/__tests__/transactionAtomicity.db.test.ts`,
`src/lib/__tests__/spotifySyncAtomicity.db.test.ts` and
`src/lib/__tests__/spotifyPlaylistRouteAuthz.db.test.ts` reports
`Test Files 12 passed (12)` and `Tests 116 passed (116)`, no failed and no
skipped. Every one of those files was confirmed to exist. The seven real-database
suites are the part that matters most here: they are the only thing proving that
a re-typed row still carries the columns the SQL actually returns, because a row
interface is a hand-written assertion the compiler cannot check against a SQL
string.

**Gate baselines, all measured at `ca91de2`.**

- `rtk proxy npx vitest run`: `Test Files 92 passed (92)`,
  `Tests 1064 passed (1064)`, 0 skipped. Needs Postgres at
  `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations
  applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`; without
  them six DB-backed files skip 51 tests.
- `npm run test:coverage`: exit 0, `All files` row reads
  `97.38 | 85.43 | 99.41 | 97.95` against thresholds 80 / 65 / 78 / 80, no
  `does not meet threshold` line.
- `rtk proxy npx eslint .`: final summary line `22 problems (8 errors, 14 warnings)`.
  The 8 errors are 7x `react-hooks/set-state-in-effect` plus 1x
  `@next/next/no-html-link-for-pages`; none is in the data layer and none is a
  typing rule.
- `./node_modules/.bin/tsc --noEmit`: exits 0, prints nothing.
- `npm run lint:dead` (knip): clean.
- `npm run lint:dup` (jscpd): `Found 19 clones.`, Total row `242 (0.71%)`,
  against the 2 % threshold.
- `npm run audit`: `found 0 vulnerabilities`. This is clean again only because
  RH-60 (`ca91de2`) pinned `next` to 16.3.4 and pulled the transitive `sharp`,
  `js-yaml` and `@vitest/mocker` fixes; five advisories had opened after RH-58
  and would have made ER6 unsatisfiable at `55656fe`.
- `npx next build`: exits 0, no `^Error` / `^Failed` / `Failed to compile` line.
- `PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" npx playwright test e2e/ssr-smoke.spec.ts`:
  `4 passed`.
- `grep -rn "as unknown as" src --include='*.ts' --include='*.tsx' | grep -v __tests__ | wc -l`
  prints `2`; `grep -rc "@ts-ignore\|@ts-expect-error\|@ts-nocheck" src --include='*.ts' --include='*.tsx' | grep -v ":0$" | wc -l`
  prints `0`.

**Known flake.** `src/lib/__tests__/complexityBudget.test.ts > complexity budget (F20) > sets the base budget for src at complexity 15, max-depth 4, max-lines-per-function 200, max-params 4 and max-lines 400`
times out at 5000ms on `await loadConfig()` under full-suite parallel load in
some runs. It is pre-existing, unrelated to this work, owned by RH-59, and did
not reproduce in the full-suite and coverage runs measured above. Every ER below
that runs the whole suite carries the same disposal rule RH-58's ER9 used:
tolerate exactly that one named failure, re-run the file in isolation, require
`Tests 6 passed (6)`.

**Tooling note.** A shell hook in this environment rewrites the output of
`npx eslint`, `npx tsc` and `npx vitest`. Every ESLint and vitest result below
must be produced with `rtk proxy npx ...`, and TypeScript with the exact binary
path `./node_modules/.bin/tsc --noEmit`.

**F16's remediation, re-measured against the review's own baseline.**
`docs/plans/code-quality-review.md` is pinned to `13da8b2` (its third line says
so). Its `**Remediation:**` for F16 prescribes
`query<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>`
**with no default**. That does not type anything, and the split analysis verified
it empirically before RH-54 started: `node_modules/@types/pg/index.d.ts:96`
declares `export interface QueryResultRow { [column: string]: any }`, and when a
type argument is omitted and cannot be inferred from the value arguments,
TypeScript falls back to the parameter's *constraint*. So `res.rows[0].whatever`
would still be `any` at every call site and no caller would be forced to name
`T`; that variant produced exactly **one** compiler error repo-wide, against 29
errors across 10 files for the `DbRow` default that was actually delivered. The
second half of the remediation ("declare row interfaces next to each SQL string
in `src/lib`") was also inverted in practice, and for a mechanical reason:
`src/lib/songs.ts` sits at its RH-39 `max-lines` ceiling and cannot take even one
import line, so the interfaces live in one `src/lib/dbRows.ts`.

As with RH-37's and RH-38's corrections, the honest fix is a dated additive
line, not a rewrite of the remediation: section 2 is an explicitly dated
measurement of `13da8b2` and section 3 is its analysis, so editing either
destroys the audit trail. I deliberately do **not** correct F16's "~44 such
casts overall": the figure is prefixed with a tilde and I could not reproduce
the counting method (at `13da8b2` the DB-row cast inventory regex gives 32,
`rows.* as ` gives 29, and every `as X` under `src/lib` gives 64), so calling it
wrong would be an unverified claim.

## Approach

### 1. `docs/plans/code-quality-review.md` - four added lines, nothing removed

The edit is **purely additive**: four new lines, no line deleted, no line
reworded. ER8 checks that with `git diff --numstat`. Each new line is a single
physical line in the file, appended at the end of the block it belongs to, so
every closed finding ends with a `**Status:**` line, exactly as RH-37 and RH-38
left F8, F21, F22, F6, F26, T4 and T5 (lines 289, 307, 413, 422, 456, 526 and
533 at `ca91de2`).

**After F16's `**Remediation:**` line (L371 at `ca91de2`), append these two
lines, in this order:**

```
**Correction (RH-40):** The remediation above does not do what it says. `query<T extends QueryResultRow>` with no default types nothing: `@types/pg` declares `QueryResultRow` as `{ [column: string]: any }`, and when a type argument is omitted and cannot be inferred TypeScript falls back to the parameter's constraint, so rows stay `any`-valued and no caller is under any pressure to name `T`. Measured before the remediation started: that signature produces exactly one compiler error in the whole repository, against 29 errors across 10 files for the signature actually delivered, `export type DbRow = Record<string, unknown>` plus `query<T extends QueryResultRow = DbRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>`. Replacing the default is what has teeth; dropping it is cosmetic. The second half of the remediation was inverted too: `src/lib/songs.ts` sits at its RH-39 `max-lines` ceiling and cannot take even one import line, so the row interfaces live in one `src/lib/dbRows.ts` rather than next to each SQL string.
**Status:** Resolved by RH-54 (`f92c0f3`), RH-56 (`b293e82`), RH-57 (`9e37072`) and RH-58 (`55656fe`). `query()` and `Queryable.query()` default to `DbRow = Record<string, unknown>` with `params?: unknown[]` and an explicit `Promise<QueryResult<T>>`, and both `eslint-disable` comments are gone; every row-reading call site names its shape as a type argument (`query<never>` where no row is read), and the ten interfaces that are not already domain types live in `src/lib/dbRows.ts`. At `ca91de2` the untyped row-reading call sites are down from 80 at `246313f`, the commit this split branched from, to 0, and the DB-row cast inventory from 26 at `246313f` to 1; the survivor, `src/lib/spotify.ts:30`, is a cast on an HTTP JSON body rather than on a `QueryResult` row and is outside this finding. The one query call the finding does not cover is `src/lib/auth.ts:84`, an `INSERT ... ON CONFLICT DO NOTHING` issued on `pg`'s own `Pool.query` inside the Better Auth create hook, whose result is discarded so no column is ever read off it. Guarded by `src/lib/__tests__/dbRowTypes.test.ts`, and the convention is recorded in the `# Database Row Types` section of AGENTS.md.
```

**After F17's `**Remediation:**` line (L379 at `ca91de2`), append this line:**

```
**Status:** Resolved by RH-55 (`b024a87`). `src/lib/globalSongEditPayload.ts` exports `GlobalSongEditPayload` and one `parseGlobalSongEditPayload(data: unknown)` that validates all seven mutable `global_songs` columns with per-field messages and sanitises title and album through `songSanitizer`; `submitGlobalSongEdit` calls it before the INSERT so bad input never reaches the queue, and `reviewGlobalSongEdit` calls it again on `proposed_data` before the approval UPDATE, building its SET clause from the parsed payload, so a hand-crafted historical row is refused with the catalog row left untouched. The ad-hoc `typeof` block, the `!== undefined` pushes, the `any[]` and the `eslint-disable` are gone, and `moderation.ts` fell under the base complexity budget and lost its per-file override (24 entries down to 23). Covered by `src/lib/__tests__/globalSongEditPayload.test.ts` (17 table tests) and `src/lib/__tests__/moderationPayload.db.test.ts` (2 real-database tests).
```

**After T7's `**Covers:** F16, F17` line (L545 at `ca91de2`), append this line:**

```
**Status:** Delivered by RH-54 (`f92c0f3`), RH-55 (`b024a87`), RH-56 (`b293e82`), RH-57 (`9e37072`) and RH-58 (`55656fe`); integrated and verified by RH-40. Both findings it covers are closed.
```

As in RH-37 and RH-38, the T7 marker uses `Delivered` rather than `Resolved`, so
that `grep -c "^\*\*Status:\*\* Resolved"` counts findings only (5 today, 7 after
this edit) and `grep -c "^\*\*Status:\*\* Delivered"` counts tasks only (2 today,
3 after). Measured today at `ca91de2`: `Resolved` 5, `Delivered` 2,
`Correction (RH-37)` 2, `Correction (RH-38)` 1, `Correction (RH-40)` 0.

Do not touch any other finding, the section 2 measurement tables, the section 4
priority table (row 16 and row 17 of the summary table stay exactly as
measured), or any other T-task block.

### 2. AGENTS.md - no change

I checked, and the convention is already stated, mechanically and by name. RH-54
added a `# Database Row Types` section to AGENTS.md (L269-L290 at `ca91de2`),
immediately after `# Transactions`. It states the `DbRow = Record<string, unknown>`
default on both `query()` and `Queryable.query()`; it states explicitly that
dropping the default instead of replacing it does nothing, and why
(`QueryResultRow` is `{ [column: string]: any }`); it forbids a cast on
`res.rows` in favour of a type argument, naming RH-25 F16 as the reason; it
names `src/lib/dbRows.ts` as the home for non-domain row shapes with the
`<Subject>Row` naming rule and the `songs.ts` line-ceiling rationale; and it
records that `knip` fails on an unconsumed row interface. That is the whole
convention, including the correction this task records in the review document.

F17 needs no AGENTS.md entry either: it is a bug fix on one module, not a
repository-wide convention, and the existing `A2` / L1 error-handling
conventions already describe how `moderation.ts` behaves.

A restatement would add nothing, so **AGENTS.md is not edited and is not on the
ER9 whitelist**. If a reviewer disagrees, the change belongs in a follow-up, not
here: adding it would widen this task's diff for no mechanical gain.

### 3. `src/lib/auth.ts:84` - deliberately left untyped

`src/lib/auth.ts:84` is the one `await pool.query(` in the tree. RH-58 excluded
it on purpose and ER1 of that task pinned it as unchanged. This close-out keeps
that decision rather than typing it as `pool.query<never>(`, for four reasons:

- **No untyped row escapes.** The statement is
  `INSERT INTO profiles (id, email, full_name) VALUES ($1::uuid, $2, $3) ON CONFLICT (id) DO NOTHING`
  inside the Better Auth `user.create.after` hook. The returned `QueryResult` is
  discarded; no column is read off it and no cast hides behind it. F16's harm -
  "untyped rows fan out across the codebase" - does not occur at this site.
- **It is not the helper F16 is about.** The receiver is `pg`'s own `Pool`, not
  the project's `query()` / `Queryable.query()` contract. Typing it would
  document a property of `@types/pg`, not of `src/lib/db.ts`.
- **It costs the close-out its cleanest result.** With `src/` untouched, ER9 can
  assert `git diff --name-only ca91de2 -- src migrations e2e eslint.config.mjs vitest.config.ts`
  prints nothing - one command, no exceptions to reason about. Typing one line
  would force a whitelist exception plus a SQL-byte-identity diff for zero
  type-safety gain.
- **The right owner already exists.** RH-58's post-merge note proposes a
  repo-wide guard (a `no-restricted-syntax` rule or a source-scan test in the
  style of `dbRowTypes.test.ts`) over all four receivers - `query(`,
  `client.query(`, `db.query(` and `pool.query(`. That task either types this
  site first or exempts it explicitly, and it is the place where the decision
  belongs, because a lone type argument with no guard behind it does not stay.

The F16 `**Status:**` line above names the site and the reason, so the exclusion
is on the record rather than an omission. ER1 pins the file unchanged.

### 4. Version bump

`package.json` goes from `0.1.88-202609090956` to `0.1.89-YYYYMMDDHHmm` with the
local-time stamp of the commit. The Version Bumping Rule in AGENTS.md applies to
every commit that merges to master, documentation-only ones included.

### 5. Running the verification

Everything in the Expected Results is a re-run, not a change. Run the whole set
once after the documentation edit and the version bump are in the tree, so the
evidence describes the commit that will actually merge. The DB precondition in
ER5 and ER7 is not optional: without Postgres and `SUPABASE_SERVICE_ROLE_KEY`,
six files skip 51 tests, the seven real-database suites - the only proof that a
re-typed row still matches its SELECT list - do not run at all, and neither the
suite counts nor the coverage number can be reached.

## Expected Results

ER1 - F16's final state holds at the merge commit: no untyped row-reading query call site is left in the tree. Run from the repository root; append `; echo $?` to read each exit status. `sh -c "grep -rnE 'await (client|db)?\.?query\(' src --include='*.ts' | grep -v __tests__ | grep -v '^src/lib/db.ts:'"` prints nothing and exits non-zero; at the pre-split commit `246313f` the same command printed 80 lines. The helper contract is the non-`any` one: `grep -c "^export type DbRow = Record<string, unknown>$" src/lib/db.ts` prints `1`, `grep -c "= DbRow>" src/lib/db.ts` prints `2` (the `query` function and the `Queryable.query` member), `grep -c "params?: unknown\[\]" src/lib/db.ts` prints `2`, `grep -c "Promise<QueryResult<T>>" src/lib/db.ts` prints `2`, `grep -c "eslint-disable" src/lib/db.ts` prints `0`, and `grep -c ": any\|= any\|any\[\]" src/lib/db.ts` prints `0`. Transaction control is untouched: `grep -cE "await client\.query\('(BEGIN|COMMIT|ROLLBACK)'\)" src/lib/db.ts` prints `3`. The one deliberately excluded call site is still there and still untouched: `grep -c 'await pool.query(' src/lib/auth.ts` prints `1` and `git diff ca91de2 -- src/lib/auth.ts` prints nothing - it is an `INSERT ... ON CONFLICT DO NOTHING` on `pg`'s own `Pool.query` whose result is discarded, so no column is ever read off it (see Approach 3; the F16 `**Status:**` line of ER8 records the exclusion).

ER2 - the compiler, not convention, is what enforces the contract: an untyped row is `unknown`. From the repository root, first confirm the clean state - `./node_modules/.bin/tsc --noEmit` prints nothing and exits 0. Then create a probe with `printf 'import { query } from "./db"\nexport async function probe() {\n  const r = (await query("SELECT 1 AS n")).rows[0]\n  const x: number = r.n\n  return x\n}\n' > src/lib/rh40Probe.ts` and run `./node_modules/.bin/tsc --noEmit` again: it prints a line containing `src/lib/rh40Probe.ts(4,9): error TS2322: Type 'unknown' is not assignable to type 'number'.` and exits non-zero. Then rewrite the probe with the only difference being the named type argument - `printf 'import { query } from "./db"\nexport async function probe() {\n  const r = (await query<{ n: number }>("SELECT 1 AS n")).rows[0]\n  const x: number = r.n\n  return x\n}\n' > src/lib/rh40Probe.ts` - and re-run `./node_modules/.bin/tsc --noEmit`: it prints nothing and exits 0. Finally `rm src/lib/rh40Probe.ts`, after which `test ! -e src/lib/rh40Probe.ts && echo restored` prints `restored` and `git status --porcelain -- src` prints nothing. Scoping that status check to `src` is deliberate: an unscoped run also reports this task's own documentation changes and would fail a correct implementation. This is the enforceable form of F16's intent; the form F16's own remediation prescribes (`query<T extends QueryResultRow>` with no default) would let this probe compile clean, which is what the `**Correction (RH-40):**` line of ER8 records.

ER3 - no cast, launder or escape hatch was substituted for a named row type, and the row-type home holds only interfaces that are consumed. From the repository root, `sh -c "grep -rn 'as [A-Z][A-Za-z]*\[\]\|rows\[0\] as \|\.rows as ' src --include='*.ts' | grep -v __tests__"` prints exactly one line and nothing else: `src/lib/spotify.ts:30:    const data = await response.json() as SpotifyTrack[]` (the count was 26 at `246313f`). That line is a cast on an HTTP JSON body rather than on a `QueryResult` row, is documented as outside F16's scope, and stays put: `git diff ca91de2 -- src/lib/spotify.ts` prints nothing. Laundering is excluded: `grep -rn "as unknown as" src --include='*.ts' --include='*.tsx' | grep -v __tests__ | wc -l` prints `2`, and `grep -rc "@ts-ignore\|@ts-expect-error\|@ts-nocheck" src --include='*.ts' --include='*.tsx' | grep -v ":0$" | wc -l` prints `0`. `grep -c "^export interface " src/lib/dbRows.ts` prints `10`, and `grep -oE "^export interface [A-Za-z]+" src/lib/dbRows.ts | sort` lists exactly `BandByInviteCodeRow`, `BandMemberRoleRow`, `GlobalSongLinksRow`, `JoinBandByInviteRow`, `PlaylistAccessRow`, `PlaylistEntryRow`, `PlaylistSongIdRow`, `PlaylistSongLinksRow`, `RepertoireAccessRow` and `SpotifyTokenRow`. `grep -rl "from '@/lib/dbRows'" src --include='*.ts' | grep -v __tests__ | sort` lists exactly seven paths: `src/app/api/spotify/playlists/[id]/sync/route.ts`, `src/lib/bands.server.ts`, `src/lib/bands.ts`, `src/lib/playlists.ts`, `src/lib/songs.ts`, `src/lib/spotifyAuth.ts`, `src/lib/spotifyPlaylistSync.ts`. `npm run lint:dead` exits 0 and prints no file or symbol list, which is what proves no speculative interface survives, and `rtk proxy npx vitest run src/lib/__tests__/dbRowTypes.test.ts` reports `Test Files 1 passed (1)` and `Tests 3 passed (3)`.

ER4 - F17's final state holds: the moderation payload is validated on both paths and the ad-hoc narrowing is gone. From the repository root, `test -f src/lib/globalSongEditPayload.ts` succeeds; `grep -c "^export " src/lib/globalSongEditPayload.ts` prints `2` (the `GlobalSongEditPayload` type and the `parseGlobalSongEditPayload` function, nothing else); `grep -cE "(title|artist|album|standard_key|cover_url|duration_seconds|links)\?:" src/lib/globalSongEditPayload.ts` prints `7`, one optional field per mutable `global_songs` column. In `src/lib/moderation.ts`, `grep -c "parseGlobalSongEditPayload(" src/lib/moderation.ts` prints `2` (once in `submitGlobalSongEdit`, once in `reviewGlobalSongEdit`), `grep -c "from '@/lib/globalSongEditPayload'" src/lib/moderation.ts` prints `1`, and `grep -c "!== undefined" src/lib/moderation.ts`, `grep -c "typeof proposed" src/lib/moderation.ts` and `grep -c "eslint-disable\|any\[\]" src/lib/moderation.ts` each print `0`. The complexity override that file carried is deleted rather than re-pinned: `grep -c "src/lib/moderation.ts" eslint.config.mjs` prints `0`. Behaviourally, with the database precondition of ER5 satisfied, `rtk proxy npx vitest run src/lib/__tests__/globalSongEditPayload.test.ts src/lib/__tests__/moderation.test.ts src/lib/__tests__/moderationPayload.db.test.ts` reports `Test Files 3 passed (3)` and `Tests 31 passed (31)`, with `0 failed` and `0 skipped`.

ER5 - the five parts' guard suites and the real-database suites pass together in one run. With Postgres running at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied (`npm run db:migrate`) and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in the environment or `.env.local` (for example `set -a; . ./.env.local; set +a`), `rtk proxy npx vitest run src/lib/__tests__/dbRowTypes.test.ts src/lib/__tests__/globalSongEditPayload.test.ts src/lib/__tests__/moderation.test.ts src/lib/__tests__/moderationPayload.db.test.ts src/lib/__tests__/complexityBudget.test.ts src/app/actions/__tests__/authzRepertoire.db.test.ts src/app/actions/__tests__/authzBands.db.test.ts src/app/actions/__tests__/authzPlaylists.db.test.ts src/app/actions/__tests__/authzTabs.db.test.ts src/lib/__tests__/transactionAtomicity.db.test.ts src/lib/__tests__/spotifySyncAtomicity.db.test.ts src/lib/__tests__/spotifyPlaylistRouteAuthz.db.test.ts` exits 0 and reports exactly `Test Files 12 passed (12)` and `Tests 116 passed (116)`, with no `failed` and no `skipped` segment on either line. All twelve paths must exist; a missing path makes vitest fail rather than silently pass. The seven `.db` suites are the load-bearing part: a row interface is a hand-written assertion the compiler cannot check against a SQL string, so only a real-database run proves the re-typed rows still carry the columns their SELECT lists return - without the two preconditions those files skip and the `skipped` condition above fails even for a correct tree. If and only if the single named flake of ER7 appears in this run (`complexityBudget.test.ts > complexity budget (F20) > sets the base budget for src at complexity 15, max-depth 4, max-lines-per-function 200, max-params 4 and max-lines 400` failing with `Error: Test timed out in 5000ms.`), the same disposal rule applies: re-run `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts` in isolation and require `Tests 6 passed (6)`; any other failure fails ER5.

ER6 - every static gate is exactly at its `ca91de2` baseline, run from the repository root. `./node_modules/.bin/tsc --noEmit` writes nothing to stdout or stderr and exits 0 (use that exact binary path; `npx tsc` is intercepted by a shell hook in this environment). `rtk proxy npx eslint .` prints a final summary line reading exactly `22 problems (8 errors, 14 warnings)`, unchanged, because this task edits no file ESLint lints; use `rtk proxy`, because the same hook rewrites plain `npx eslint` output. None of those 8 errors is a typing error: `rtk proxy npx eslint . 2>&1 | grep -c "no-explicit-any"` prints `0`, and `rtk proxy npx eslint . 2>&1 | grep -c "src/lib/db.ts\|src/lib/dbRows.ts\|src/lib/globalSongEditPayload.ts\|src/lib/moderation.ts"` prints `0`. `npm run lint:dead` exits 0 and reports no unused files, exports, types or dependencies. `npm run lint:dup` exits 0 and prints `Found 19 clones.` with a Total row showing `242 (0.71%)` duplicated lines, below the 2 % threshold. `npm run audit` exits 0 and prints `found 0 vulnerabilities`, which it does at `ca91de2` because RH-60 pinned `next` to 16.3.4 and cleared the five advisories that had opened after `55656fe`. The RH-39 ratchet is untouched and still tightened by RH-55: `grep -c 'complexity-budget/override' eslint.config.mjs` prints `23` and `git diff ca91de2 -- eslint.config.mjs` prints nothing.

ER7 - the whole suite, the coverage gate, the production build and the SSR smoke are green, modulo one named pre-existing flake. With the same database precondition as ER5, `rtk proxy npx vitest run` reports at least 92 test files passed and at least 1064 tests passed, with 0 skipped; those are the exact counts at `ca91de2` (`Test Files 92 passed (92)`, `Tests 1064 passed (1064)`) and, since this task adds no test, they are equalities in practice, stated as floors only so an unrelated concurrent addition cannot fail the result. The only tolerated failure is the single test `src/lib/__tests__/complexityBudget.test.ts > complexity budget (F20) > sets the base budget for src at complexity 15, max-depth 4, max-lines-per-function 200, max-params 4 and max-lines 400` failing with `Error: Test timed out in 5000ms.` on `await loadConfig()`: that is a pre-existing flake under full-suite parallel load, unrelated to RH-40 and owned by RH-59. If it appears, re-run `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts` in isolation and it must report `Tests 6 passed (6)` for ER7 to count as passed; any other failing test, any skipped test, fewer than 92 files or fewer than 1064 tests fails ER7. `npm run test:coverage` runs the same suite and carries the same rule for its exit code, and regardless of exit code its `All files` row must show statements >= 80, branches >= 65, functions >= 78 and lines >= 80 (measured `97.38 | 85.43 | 99.41 | 97.95` at `ca91de2`) with no `does not meet threshold` line anywhere in the output. `npx next build` exits 0 and its output contains no line matching `^Error|^Failed|Failed to compile` (do not grep for `Compiled successfully`: this Next version does not print that phrase on success). Immediately afterwards, `PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" npx playwright test e2e/ssr-smoke.spec.ts` prints `4 passed` and exits 0.

ER8 - the review document records the close-out and F16's correction, additively. `grep -c "^\*\*Status:\*\* Resolved" docs/plans/code-quality-review.md` prints `7` (it prints `5` at `ca91de2`); the two new lines are the ones appended to `### F16 - The query helper defaults its row type to any, so untyped rows fan out across the codebase` and to `### F17 - Moderation payload fields reach SQL without type narrowing`, the F16 one naming the four commit ids `f92c0f3`, `b293e82`, `9e37072` and `55656fe` and the F17 one naming `b024a87`. `grep -c "^\*\*Status:\*\* Delivered" docs/plans/code-quality-review.md` prints `3` (it prints `2` at `ca91de2`); the new one is on `### T7 - Type the query helper and validate the moderation payload` in section 5 and names all five of `f92c0f3`, `b024a87`, `b293e82`, `9e37072` and `55656fe`. `grep -c "^\*\*Correction (RH-40):\*\*" docs/plans/code-quality-review.md` prints `1`, that line sits inside the F16 block, and it states that `query<T extends QueryResultRow>` with no default types nothing because `@types/pg` declares `QueryResultRow` as `{ [column: string]: any }` and TypeScript falls back to the constraint, that the delivered fix is the `DbRow = Record<string, unknown>` default, and that the row interfaces live in `src/lib/dbRows.ts` rather than beside each SQL string because `src/lib/songs.ts` is at its `max-lines` ceiling. `grep -c "^\*\*Correction (RH-37):\*\*" docs/plans/code-quality-review.md` still prints `2` and `grep -c "^\*\*Correction (RH-38):\*\*" docs/plans/code-quality-review.md` still prints `1`, both unchanged. The edit is purely additive and adds exactly four lines: `git diff --numstat ca91de2 -- docs/plans/code-quality-review.md` prints exactly `4	0	docs/plans/code-quality-review.md` (four insertions, zero deletions), so no finding's heading or analysis prose, no section 2 measurement table, no row of the section 4 summary table and no other T-task block was reworded, and no finding other than F16, F17 and T7 gained a marker.

ER9 - the version was bumped and the blast radius is documentation only. `node -p "require('./package.json').version"` prints a string matching `^0\.1\.89-20[0-9]{10}$` (patch 89, then a 12-digit `YYYYMMDDHHmm` local-time stamp), strictly greater than the `0.1.88-202609090956` at `ca91de2`. `git diff --name-only ca91de2` prints a subset of exactly this whitelist and nothing else: `docs/plans/code-quality-review.md`, `docs/tasks/RH-40-spec.md`, `docs/suggestions-log.md`, `package.json`. `AGENTS.md` is deliberately absent: the convention this task would have documented is already stated in full by the `# Database Row Types` section RH-54 added, which names the `DbRow` default, the reason dropping the default achieves nothing, the ban on casting `res.rows`, and `src/lib/dbRows.ts` as the row-type home. `src/lib/auth.ts` is deliberately absent too (Approach 3). `git diff --name-only ca91de2 -- src migrations e2e eslint.config.mjs vitest.config.ts` prints nothing, so no source file, migration, end-to-end spec, lint config or test config was touched, and in particular no further typing work was smuggled in. This task ships no user-facing feature - it is internal type safety plus a documentation close-out - so under the AGENTS.md Landing Page Rule it is not a selling point: `git diff --stat ca91de2 -- src/components/landing src/i18n/dictionaries` prints nothing.

## Out of Scope

- **Any further typing or refactoring.** ER9 forbids touching `src/` at all.
  `src/lib/auth.ts:84` stays untyped for the reasons in Approach 3;
  `src/lib/spotify.ts:30` and every other HTTP-body cast stays, because those
  parse network payloads rather than `QueryResult` rows; the three
  `client.query('BEGIN' | 'COMMIT' | 'ROLLBACK')` lines in `src/lib/db.ts` stay.
- **A repo-wide guard against untyped `query(` call sites.** The tree only
  reached zero at `55656fe`, so a `no-restricted-syntax` rule or a source-scan
  test in the style of `dbRowTypes.test.ts` is now possible - and worth doing -
  but it needs an exemption for `src/lib/db.ts` and a decision about the
  `pool.query(` receiver, which makes it its own task with its own evidence.
  ER2's probe is this task's proof, and it is a one-shot check, not a ratchet.
- **Correcting F16's "~44 such casts overall".** The figure is approximate and I
  could not reproduce the counting method against `13da8b2` (the DB-row cast
  inventory gives 32, `rows.* as ` gives 29, every `as X` under `src/lib` gives
  64). Calling it wrong would replace an imprecise claim with an unverified one.
  Only the remediation, which is verifiably unenforceable, is corrected.
- **Rewriting the review's measured baseline.** Section 2's tables, F16's and
  F17's headings and "Why it matters" prose, and section 4's summary rows 16 and
  17 describe `13da8b2` and stay as measured. The correction is an additive,
  dated line in section 3.
- **Closing any other finding.** Only F16, F17 and T7 get markers. F1-F15,
  F18-F26 and T1-T3, T6, T8-T10 keep their current text even where later tasks
  have in fact addressed them; sweeping the whole document is separate work with
  its own evidence requirements.
- **Schema changes.** No migration is added. The two follow-ups RH-55 recorded -
  a `duration_seconds >= 0` CHECK constraint on `global_songs`, and rejecting
  unknown keys once `CorrectionModal` stops sending `reason` inside `data` - are
  captured in `.meridian/reports/RH-55-spec-1.md` and belong to new tasks.
- **RH-59 / the `complexityBudget.test.ts` full-suite timeout.** ER5 and ER7
  tolerate exactly that one named failure with an isolated re-run. Fixing it is
  RH-59's job and must not be folded into this diff.
- **A new AGENTS.md section.** See Approach 2: already covered by
  `# Database Row Types`.

## Post-merge checks (orchestrator)

- RH-40 is fully delivered once this merges: RH-54, RH-55, RH-56, RH-57, RH-58
  and this close-out together satisfy T7, and both findings it covers (F16, F17)
  are closed. No successor task is implied by RH-40 itself.
- Two follow-ups are worth capturing as new tasks, both already argued in child
  reports rather than invented here: (a) the repo-wide guard forbidding an
  untyped `query(` / `client.query(` / `db.query(` / `pool.query(` outside
  `src/lib/db.ts`, which must decide about `src/lib/auth.ts:84` explicitly
  (RH-58's post-merge note); (b) the two moderation follow-ups in
  `.meridian/reports/RH-55-spec-1.md` - a `duration_seconds >= 0` CHECK
  constraint and rejecting unknown payload keys once `CorrectionModal` stops
  sending `reason` inside `data`.
- RH-59 remains open and owns the `complexityBudget.test.ts` 5000ms timeout
  under full-suite load. Every RH-40 ER that runs the whole suite tolerates it by
  name; that tolerance should disappear once RH-59 lands.
- `src/lib/spotify.ts:30` is now the only cast the DB-row inventory matches. If
  validating HTTP boundaries is worth doing, capture it as a new finding rather
  than reopening F16.

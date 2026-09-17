# RH-75 — Purge Supabase from application code, tests and dependencies

> **Filename mapping.** This repository's spec filenames run one ahead of the
> board id: this file, `docs/tasks/RH-76-spec.md`, is the spec for board task
> **RH-75**. (`docs/tasks/RH-75-spec.md` belongs to board RH-74, which was split
> into RH-75 and RH-76 and therefore has no spec of its own.)

## Scope

Part 1 of the RH-74 split. Removes every trace of Supabase from the application
source, the vitest suite, the npm dependency tree and the CI/doc wording that
names it. The app has not talked to Supabase since the Better Auth migration;
what remains is a fake Supabase client used as a query builder by the DB-backed
tests, a globally-registered `vi.mock` for a package nothing imports, a set of
`vi.mock` calls aimed at `@/lib/supabase/*` modules that do not exist, and an
env var named after a Supabase credential that is really just the
"a database is present, run the DB suites" switch.

**Not covered — RH-76 (part 2) owns the docker stack.** Do not touch
`docker-compose.yml`, `docker/kong.yml`, `docker/supabase.env.example`,
`docker/app.env.example`, `docker/init-migrations.sh`, the `supabase/`
directory, or `poli-runner.yml`. Those still define a working local
Supabase-flavoured Postgres stack and removing half of it breaks it.

### The `.env.example` boundary (both tasks touch it)

`.env.example` and `.env.local.example` are root developer templates, not docker
templates, so **this task removes every Supabase key they contain** and RH-76
leaves both files alone:

| File | Removed by **this** task | Left for RH-76 |
|---|---|---|
| `.env.example` | lines 1–7: the `# Supabase — get these from …` header, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, the `# Service role key …` / `# Find it at: Supabase dashboard …` comment pair, and `SUPABASE_SERVICE_ROLE_KEY` (replaced by a **commented-out** `# RUN_DB_TESTS=1` line under a test-setup comment — see Decision 1 for why it must not ship as an assigned-but-empty `RUN_DB_TESTS=`) | nothing |
| `.env.local.example` | lines 1–2: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | nothing |
| `docker/app.env.example`, `docker/supabase.env.example` | nothing | everything |

## Decisions the implementer does not get to make

### 1. The DB-test gate is renamed to `RUN_DB_TESTS`

`SUPABASE_SERVICE_ROLE_KEY` never holds a service-role key here — CI sets it to
the literal `"ci-integration-tests-enabled"`. It is an opt-in switch, so it gets
a switch's name: `RUN_DB_TESTS`. The name matches the existing `*.db.test.ts`
file convention, and because it is not credential-shaped it needs no
`# pragma: allowlist secret` and produces no secret-scanner noise. The local
constant in each file (`SERVICE_ROLE_KEY`, and the exported
`SERVICE_ROLE_KEY` in `src/app/actions/__tests__/authzFixtures.ts`) is renamed
to `RUN_DB_TESTS` with it; the gate stays truthiness-based
(`describe.skipIf(!RUN_DB_TESTS)`), so `RUN_DB_TESTS=1` enables it.

**What happens to an environment that still exports only the old name.** There
is no compatibility shim and there cannot be one: ER5 and ER6 forbid the old
name and the word "supabase" from appearing anywhere under `src/`, `.github/`
or `vitest.config.ts`, so nothing in the repo may read it or warn about it by
name. Such an environment therefore behaves exactly like an environment with no
gate at all — the DB suites skip. To stop that being a *silent* coverage loss,
`vitest.config.ts` gains a one-line warning printed after it loads `.env.local`,
whenever `RUN_DB_TESTS` is **falsy** — i.e. unset **or** set to the empty
string:

> `[vitest] RUN_DB_TESTS is not set — database-backed suites will skip. See AGENTS.md.`

**The banner condition must be `!process.env.RUN_DB_TESTS`, not
`=== undefined`.** The two are not equivalent here. `vitest.config.ts`'s
`loadEnv` assigns `process.env[key] = ''` for any `KEY=` line it reads, so a
developer who runs the ordinary `cp .env.example .env.local` would end up with
the variable *set and falsy*: `describe.skipIf(!RUN_DB_TESTS)` skips the DB
suites while an `=== undefined` banner stays silent — exactly the failure mode
the banner exists to prevent. For the same reason `.env.example` ships the line
**commented out** (`# RUN_DB_TESTS=1`), so the copy leaves the variable genuinely
unset; the banner's falsy test is the belt to that suspenders.

The banner names no old variable, fires for the stale developer and the
never-had-a-database developer alike, and is the only new runtime behaviour this
task adds. CI cannot regress this way: `.github/workflows/ci.yml` is updated to
set `RUN_DB_TESTS` in the same commit that renames the reads.

### 2. `migrations/0001_initial_schema.sql` — the comment edit is safe

`scripts/migrate.mjs` records applied migrations in `_migrations` **by filename
only** (`SELECT 1 FROM _migrations WHERE name = $1` / `INSERT INTO _migrations
(name)`); there is no checksum, hash or content comparison anywhere in the
runner. The edit is confined to the `--` header comment on line 4 ("No RLS or
Supabase-specific dependencies."), which Postgres never executes. A database
that already applied `0001` skips it by name regardless of content; a fresh
database runs identical DDL. The change is therefore in scope, and the test
criterion below pins it to comment lines.

## Approach

### Behavior required

1. `@supabase/supabase-js` is gone from the dependency tree; nothing under
   `src/` imports it, mocks it, or imitates its client shape.
2. The DB-backed test suites keep running, against the same Postgres, gated on
   `RUN_DB_TESTS`, with no test removed and no `it()` deleted.
3. `src/lib/__tests__/test-helpers.ts` no longer ships a fake Supabase client.
   `createAdminTestClient` and the private `SupabaseMockChain` /
   `SupabaseMockClient` classes are deleted; the four user helpers
   (`createTestUser`, `deleteTestUser`, `createTestUserWithGoTrue`,
   `deleteTestUserWithGoTrue`) lose their now-meaningless first `admin`
   parameter — they already ignore it and write through `query()` — and every
   call site drops the argument and the `const admin = createAdminTestClient()`
   line. The other exports of that file (`stripComments`, `listSourceFiles`,
   `findViolations`, `formatViolations`) are untouched.
4. The 59 fluent `admin.from(table).select()/.insert()/.update()/.delete()`
   chains that the fake client translated into SQL become direct parameterized
   `query()` calls, following the repo's no-ORM rule: 43 in
   `src/lib/__tests__/spotify.test.ts`, 13 in `src/lib/__tests__/playlists.test.ts`,
   2 in `src/lib/__tests__/songs.test.ts`, 1 in
   `src/app/actions/__tests__/authzTabs.db.test.ts`. Do **not** introduce a
   replacement generic table helper — that would rebuild the same mini-ORM under
   a new name. Assertions of the form `expect(insertErr).toBeNull()` disappear
   with the `{ data, error }` envelope: `query()` throws on failure, which fails
   the test more loudly than the assertion did.
5. `src/lib/__tests__/spotify.test.ts` additionally loses its
   `createOriginalClient` import, `mockTestClient`, `activeServerClient`, the
   three dead `vi.mock('@/lib/supabase/{server,admin,client}')` calls, and the
   `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` reads. Its gate
   becomes `!RUN_DB_TESTS` alone (the `|| !ANON_KEY` term goes). The
   `mockTestClient.auth.signInWithPassword(...)` / `signOut()` calls are deleted
   rather than re-stubbed: the fake returned a canned `{ error: null }` and the
   code under test resolves identity through the mocked `@/lib/auth-session`,
   so the calls assert nothing. They sit inside existing `it()` bodies, so the
   file's **12 tests must still be 12 and still pass**.
6. Remaining Supabase wording — a production comment, two `describe` titles,
   file headers, config comments and docs — is reworded to say what the code
   actually does. Renaming a `describe` title changes no test count.
7. `AGENTS.md` stops describing `NEXT_PUBLIC_SUPABASE_*` as live leftovers while
   **keeping** the clause about the `supabase/` directory and the docker stack,
   which is still true until RH-76 lands.

### Files touched

**Dependency**
- `package.json` — drop `@supabase/supabase-js` from `dependencies`; bump `version` per the AGENTS.md version rule.
- `package-lock.json` — regenerated by `npm install`; the `node_modules/@supabase/supabase-js` entry and its transitive-only deps disappear.

**Test harness**
- `src/lib/__tests__/setup.ts` — delete the `vi.mock('@supabase/supabase-js')` block and the `createAdminTestClient` import. If the file ends up empty, keep it as a comment-only module (it is `vitest.config.ts`'s `setupFiles` entry) or delete it and the `setupFiles` line together — either is acceptable; do not leave a dangling reference.
- `src/lib/__tests__/test-helpers.ts` — delete both mock classes and `createAdminTestClient`; drop the `admin` parameter from the four user helpers.

**Gate rename + call-site cleanup** (all read the env or the fixture const today)
- `src/app/actions/__tests__/authzFixtures.ts` — export `RUN_DB_TESTS`.
- `src/app/actions/__tests__/authzBands.db.test.ts`, `authzPlaylists.db.test.ts`, `authzRepertoire.db.test.ts`, `authzTabs.db.test.ts` — import/`skipIf` the new name; drop `admin`.
- `src/lib/__tests__/bands.test.ts` — rename the gate, drop `admin`, delete `vi.mock("@/lib/supabase/admin")`.
- `src/lib/__tests__/playlists.test.ts`, `profile.test.ts` — same, plus convert their `.from()` chains (playlists) to `query()`.
- `src/lib/__tests__/songs.test.ts` — same, plus the "local running Supabase instance" header comment.
- `src/lib/__tests__/joinBandByInvite.test.ts`, `emailChangeVerification.db.test.ts`, `moderationPayload.db.test.ts`, `transactionAtomicity.db.test.ts`, `spotifySyncAtomicity.db.test.ts`, `spotifyPlaylistRouteAuthz.db.test.ts` — rename the gate; drop `admin` where present.
- `src/lib/__tests__/spotify.test.ts` — the full rewrite described in behavior 4–5.

**Wording**
- `src/app/api/auth/spotify/callback/route.ts` — line 19 comment: "upserts the token row in Supabase" → in Postgres.
- `src/lib/__tests__/errors.test.ts` — `describe("Supabase Error Handling")` → a data-layer title.
- `src/lib/__tests__/edge_cases.test.ts` — `describe('Supabase Edge Cases')` → a data-layer title.
- `sonar-project.properties` — drop the non-existent `src/lib/supabase/**` path from `sonar.coverage.exclusions`.
- `vitest.config.ts` — reword the port-54322 comment (keep the default value unchanged) and add the `RUN_DB_TESTS` banner.
- `migrations/0001_initial_schema.sql` — line 4 comment only.
- `.env.example`, `.env.local.example` — per the boundary table above.
- `plan.md`, `tasks.md` — replace the Supabase-era descriptions with the Postgres/Better Auth reality; these are historical planning docs, so rewording in place (not deleting the entries) is what is wanted.
- `.github/workflows/ci.yml` — the coverage job's explanatory comment near line 107 and the env at line 129 become `RUN_DB_TESTS: "1"` (drop the `# pragma: allowlist secret`).
- `AGENTS.md` — line 59 (drop the `NEXT_PUBLIC_SUPABASE_*` clause, keep the `supabase/` directory clause) and line 94 (the gate's new name).

**Not touched:** `src/lib/__tests__/migrationsSingleSource.test.ts`. It names
`supabase/migrations/` on purpose, as the guardrail that the directory never
reappears, and it must survive this task verbatim.

### Test criteria

- `npx vitest run` reports **≥ 125 test files passed and ≥ 1426 tests passed,
  with 0 skipped** (measured baseline on a clean tree at `583021c`, with a live
  Postgres on `127.0.0.1:54322` and the gate enabled: `125 passed (125)` /
  `1426 passed (1426)`, no skipped line).
  **Counting the parenthesised totals is not enough.** `describe.skipIf` does
  not remove a suite from vitest's totals — a fully skipped file still counts as
  a test file and its tests still count, reported as `N skipped (N)`, and the
  run still exits 0. A rename that lands on a variable name nothing in the
  environment sets would therefore satisfy any bare "≥ 125 files / ≥ 1426 tests"
  check while the entire DB coverage is gone. The **passed** and **skipped**
  numbers are what discriminates, so read those.
- `npx vitest run src/lib/__tests__/spotify.test.ts` → 12 passed, 0 skipped
  (baseline: 12 passed).
- With the gate unset — and, separately, with it set to the empty string — the
  run still exits 0 and prints the new banner in both cases.
- `npm run lint` exits 0; `npm run lint:dead` (knip) reports no unused
  dependency and no unused export left behind by the harness removal.
- `git diff migrations/0001_initial_schema.sql` shows only lines beginning with
  `--`.
- `git diff --stat` lists no file under `docker/`, `supabase/`, nor
  `docker-compose.yml` or `poli-runner.yml`.

## Expected Results

- [ ] ER1 — `package.json` lists `@supabase/supabase-js` in neither `dependencies` nor `devDependencies`, `package-lock.json` contains no `node_modules/@supabase/supabase-js` entry, and `npm ls @supabase/supabase-js` reports it absent.
- [ ] ER2 — The `vi.mock("@supabase/supabase-js")` call in `src/lib/__tests__/setup.ts` and the `vi.mock("@/lib/supabase/admin")` call in `src/lib/__tests__/bands.test.ts` are gone, along with every other `vi.mock` under `src/` targeting a Supabase module; `grep -rn "vi.mock(.*supabase" src/` returns no matches.
- [ ] ER3 — The `SupabaseMock*` harness is gone from `src/lib/__tests__/test-helpers.ts` (`createAdminTestClient` and both mock classes deleted) and `grep -rn "SupabaseMock" src/` returns no matches.
- [ ] ER4 — `src/lib/__tests__/spotify.test.ts` imports no `@supabase/supabase-js` and reads neither `NEXT_PUBLIC_SUPABASE_URL` nor `NEXT_PUBLIC_SUPABASE_ANON_KEY`; `grep -n "SUPABASE" src/lib/__tests__/spotify.test.ts` returns no matches, and the file still reports 12 passing tests when the gate is on.
- [ ] ER5 — The DB-test gate is named `RUN_DB_TESTS` in every `src/` file that reads it, in `.github/workflows/ci.yml` (which sets `RUN_DB_TESTS: "1"` in the coverage job) and in `AGENTS.md`; `grep -rn "SUPABASE_SERVICE_ROLE_KEY" src/ .github/ AGENTS.md` returns no matches, and with `RUN_DB_TESTS=1` exported `npx vitest run src/app/actions/__tests__/authzTabs.db.test.ts src/lib/__tests__/moderationPayload.db.test.ts` reports `2 passed (2)` test files and `0 skipped` tests.
- [ ] ER6 — `grep -ril supabase src/` matches exactly one file, `src/lib/__tests__/migrationsSingleSource.test.ts`, which is unchanged by this task.
- [ ] ER7 — `grep -il supabase sonar-project.properties vitest.config.ts migrations/0001_initial_schema.sql .env.example .env.local.example plan.md tasks.md` returns no matches, and the only changed lines in `migrations/0001_initial_schema.sql` begin with `--`.
- [ ] ER8 — With `RUN_DB_TESTS=1` exported and Postgres up, `npx vitest run` exits 0 reporting at least 125 test files **passed** and at least 1426 tests **passed**, with **0 test files skipped and 0 tests skipped** (baseline at `583021c`: `Test Files 125 passed (125)`, `Tests 1426 passed (1426)`, no skipped line). A run whose summary contains any `skipped` count fails this result, even if the parenthesised totals still read 125/1426.
- [ ] ER9 — `npm run lint` exits 0.
- [ ] ER10 — `vitest.config.ts` prints a warning whose text contains `RUN_DB_TESTS` whenever that variable is **unset or empty** (the check is falsiness-based, not `=== undefined`): both `env -u RUN_DB_TESTS npx vitest run src/lib/__tests__/errors.test.ts` and `RUN_DB_TESTS= npx vitest run src/lib/__tests__/errors.test.ts` print it, while `RUN_DB_TESTS=1 npx vitest run src/lib/__tests__/errors.test.ts` does not.
- [ ] ER11 — `package.json`'s `version` is bumped per the AGENTS.md version rule (patch increment plus a `-YYYYMMDDHHmm` suffix, strictly higher than any version in `git log`).
- [ ] ER12 — `.env.example` carries the gate as a commented-out `# RUN_DB_TESTS=1` line, so that `cp .env.example .env.local` leaves the variable unset rather than set-and-empty: `grep -n "RUN_DB_TESTS" .env.example` matches only a line beginning with `#`.

## Out of Scope

- Every file RH-76 owns: `docker-compose.yml`, `docker/` (including `app.env.example`, `kong.yml`, `supabase.env.example`, `init-migrations.sh`), `supabase/`, `poli-runner.yml`.
- `docs/**` historical records (`docs/suggestions-log.md`, earlier `docs/tasks/*-spec.md`, `docs/plans/mobile-app-analysis.md`, `docs/superpowers/**`). They describe the state of the tree at the time they were written and are not corrected retroactively.
- Any behavioural change to the application. No production code path changes; the single production-file edit is a comment.
- `src/lib/__tests__/migrationsSingleSource.test.ts`.
- Landing-page copy: this is internal cleanup, not a selling point (AGENTS.md Landing Page Rule).

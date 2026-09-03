# RH-17 — Synchronize `supabase/migrations` with the numbered `migrations` directory

## Summary of the decision

The repository keeps two parallel migration directories. They are not "slightly
out of sync" — the `supabase/migrations/` copy **cannot build the schema at all**:

1. It has no counterpart for `0002_add_tabs_and_lyrics.sql`, so a database built
   from it has no `repertoire_tabs` table and no `repertoire.lyrics` column —
   even though `0005_add_tab_annotations.sql`, which *is* mirrored, does
   `ALTER TABLE repertoire_tabs ADD COLUMN … annotations`.
2. Its initial schema is named `20260707000000_initial_schema.sql`, which sorts
   **after** `0003_add_band_color.sql`. Both consumers apply files in
   lexicographic order (`docker/init-migrations.sh` uses `find … | sort`; the
   Supabase CLI orders by version prefix), so `ALTER TABLE bands ADD COLUMN …`
   runs before `bands` exists. `init-migrations.sh` does run under `set -e`, but
   its `psql -f` calls do **not** set `ON_ERROR_STOP`, so psql exits 0 even when
   every statement in a file errors and `set -e` never fires. A fresh
   `docker compose up -d` therefore does not abort on the first file: it prints
   the errors, keeps going through the remaining files, and reports
   "Database initialization complete!" over a silently incomplete schema. The
   conclusion is unchanged — a local database built from `supabase/migrations/`
   is broken — but it fails quietly rather than loudly, which is worse. §3 below
   fixes the missing `ON_ERROR_STOP`.

Files 0003–0006 *are* byte-identical to their `migrations/` counterparts, so the
"mirrored byte-for-byte" convention adopted by RH-5 / RH-12 / RH-4 has been
honoured; the divergence is entirely historical. But once the two remaining
differences are removed, the mirror is a literal duplicate carrying zero
information.

**Chosen approach: `migrations/` becomes the single source of truth and
`supabase/migrations/` is deleted, not synchronised.** Its one real in-repo
consumer — the `docker-compose.yml` bind mount — is repointed at `migrations/`.
Drift becomes structurally impossible rather than policed by a sync script.

Rejected alternatives:

- *Generate + verify the mirror with a script and a CI check.* This
  institutionalises the duplication and, once the ordering fix renames the
  initial schema, amounts to copying a directory onto itself and testing that
  the copy matches.
- *Make `supabase/migrations/` the source of truth and repoint
  `scripts/migrate.mjs` at it.* The `_migrations` ledger in every already-migrated
  database (production on Neon, CI, developer machines) stores the applied
  **filename**. Renaming `0001_initial_schema.sql` would make the runner treat the
  initial schema as unapplied and re-execute DDL against live databases. Not
  worth it for a directory-layout preference.

**Effect on existing databases: none.** This task changes no SQL file. Every
filename under `migrations/` is preserved exactly, so the six names recorded in
`_migrations` still map 1:1 and the next `npm run db:migrate` skips all six. All
migrations are idempotent anyway (`CREATE … IF NOT EXISTS`, `ADD COLUMN IF NOT
EXISTS`, `CREATE OR REPLACE FUNCTION/TRIGGER`, and a
`DO $$ … pg_type` guard for the `song_status` enum), and `scripts/migrate.mjs`
wraps each file in `BEGIN`/`COMMIT` with `ROLLBACK` on failure.

**Landing Page Rule (AGENTS.md): explicitly evaluated — this is NOT a selling
point.** RH-17 is build/repository hygiene with no user-visible behaviour. No
musician or band would choose the app because of it.
`src/components/landing/LandingPage.tsx` and both dictionaries
(`src/i18n/dictionaries/en.json`, `pt-BR.json`) must remain untouched, and an
expected result asserts that.

## Scope

This task covers:

- Deleting the duplicate `supabase/migrations/` directory from git and the
  working tree.
- Repointing the `docker-compose.yml` bind mount from `./supabase/migrations` to
  `./migrations`, which also fixes the apply-order bug and makes a fresh local
  database include `0002` for the first time.
- Making `docker/init-migrations.sh` record what it applies in the `_migrations`
  ledger, so the docker path and `scripts/migrate.mjs` agree on what "applied"
  means.
- Turning the Supabase CLI migration path off explicitly in
  `supabase/config.toml` rather than leaving it silently broken.
- Adding a vitest guard that fails if a second migrations directory reappears,
  if a migration filename departs from the `NNNN_name.sql` convention, if the
  numbering has gaps or duplicates, or if the docker mount is repointed away
  from `migrations/`.
- Updating `AGENTS.md` so it stops documenting two schema directories.
- The mandatory version bump.

This task does **not** cover anything in *Out of Scope* below.

## Approach

### 1. Delete the duplicate directory

`git rm -r supabase/migrations/` — removes all five files:
`0003_add_band_color.sql`, `0004_join_band_by_invite_already_member.sql`,
`0005_add_tab_annotations.sql`, `0006_add_system_admin_and_moderation.sql`,
`20260707000000_initial_schema.sql`.

Nothing under `migrations/` is touched: no rename, no content edit, no new
migration. `supabase/config.toml` and `supabase/seed.sql` stay — `seed.sql` is
still bind-mounted by `docker-compose.yml` and referenced by
`config.toml` (`[db.seed] sql_paths = ["./seed.sql"]`).

### 2. Repoint the docker-compose mount

In `docker-compose.yml`, service `db`, the volume line currently reading

```yaml
      - ./supabase/migrations:/docker-entrypoint-initdb.d/migrations:ro
```

becomes

```yaml
      - ./migrations:/docker-entrypoint-initdb.d/migrations:ro
```

The neighbouring `./supabase/seed.sql` and `./docker/init-migrations.sh` mounts
are unchanged. With this mount, `find … | sort` inside `init-migrations.sh`
yields `0001 … 0006` in the correct order.

### 3. Record applied migrations from the docker init path

`docker/init-migrations.sh` currently `psql -f`s each file and never touches
`_migrations`, so a later `npm run db:migrate` re-executes all six. Extend it to
create the same ledger `scripts/migrate.mjs` uses and insert each basename:

- **Fail loudly first — this is a prerequisite, not a nicety.** Every `psql`
  invocation that applies a migration or writes the ledger must run with
  `-v ON_ERROR_STOP=1`. Without it psql exits 0 on SQL errors, `set -e` never
  fires, and the ledger insert below would record a migration that *did not
  apply*. `npm run db:migrate` would then print `Skipping migration:` for it
  forever, leaving a permanently broken local database whose ledger claims
  health — strictly worse than today's behaviour, where no ledger rows are
  written and the next `db:migrate` repairs the database idempotently. An
  explicit exit-status check (`psql … -f "$f" || exit 1` with the error surfaced)
  is an acceptable equivalent, but `-v ON_ERROR_STOP=1` is the intended form.
  The ledger insert for a file must be reachable only when that file's
  `psql -f` succeeded.
- Before the loop, create the table if absent, with the same shape as
  `scripts/migrate.mjs` (`id SERIAL PRIMARY KEY`, `name VARCHAR(255) UNIQUE NOT
  NULL`, `executed_at TIMESTAMPTZ DEFAULT NOW()`).
- After each successful `psql -f`, insert the file's **basename** (e.g.
  `0001_initial_schema.sql`, not a path) with `ON CONFLICT (name) DO NOTHING`.

Keep `set -e`; combined with `ON_ERROR_STOP=1` it now actually aborts
initialisation on a failing migration.

The trailing seed invocation (`psql … -f /docker-entrypoint-initdb.d/seed.sql
|| true`) keeps its deliberately tolerant `|| true` and is **not** given
`ON_ERROR_STOP`: seed data is allowed to fail on a re-run without breaking
initialisation, and it is not recorded in `_migrations`.

### 4. Make the Supabase CLI path explicitly inert

The Supabase CLI hardcodes `supabase/migrations`; the path cannot be redirected.
With the directory gone, `supabase db push` would silently no-op. Make that
explicit in `supabase/config.toml`:

```toml
[db.migrations]
# Migrations live in the top-level `migrations/` directory and are applied by
# `npm run db:migrate` (scripts/migrate.mjs) — see AGENTS.md. The Supabase CLI
# migration flow is not used by this project; disabled so `supabase db push`
# and `supabase db reset` cannot apply a stale or partial schema.
enabled = false
```

`schema_paths`, `[db.seed]` and every other section stay as they are.

### 5. Drift guard — `src/lib/__tests__/migrationsSingleSource.test.ts`

New vitest file, following the shape of the existing repo-scanning guard
`src/lib/__tests__/noBrowserDialogs.test.ts` (pure Node `fs`/`path`, no
database, exported helper plus unit tests for the helper itself, then the
repo-wide assertions). It must assert:

1. **Single directory.** No directory named `migrations` exists anywhere in the
   repository other than `<repoRoot>/migrations`. Walk the tree from the repo
   root, skipping any directory entry whose name is one of:

   ```
   node_modules  .git  .next  coverage  .vercel  playwright-report
   postgres-data  .temp  .branches  .claude  .gemini  .agents  .meridian  .idea
   ```

   The agent/tooling directories in that list are **required**, not decorative.
   `.claude/worktrees/` is gitignored (`.gitignore` line 48) and currently holds
   two full agent checkouts of this repository — right now
   `.claude/worktrees/agent-a07877df156fb9085/supabase/migrations/` and
   `.claude/worktrees/agent-a4bcf3351ffad24c5/supabase/migrations/` both exist
   and contain `20260601000000_initial_schema.sql`. Being gitignored, they
   survive the §1 `git rm` untouched. A guard that walked into them would report
   `supabase/migrations` as still present and fail on a correct implementation,
   on this machine, today. `.gemini` is listed for symmetry with the
   `vitest.config.ts` `exclude` array, which already skips `**/.claude/**` and
   `**/.gemini/**`; `.agents`, `.meridian` and `.idea` all exist at the repo root
   and are skipped for the same reason. Skipping bare `.temp`/`.branches` by name
   covers `supabase/.temp` and `supabase/.branches`.

   Do **not** implement this invariant as a walk over `git ls-files` output
   instead. That would also exclude the worktrees, but it would break the drift
   probe in Expected Result 9: an *untracked* `supabase/migrations/0007_x.sql`
   would be invisible to the guard, and drift arrives untracked before it arrives
   committed. The filesystem walk with the skip list above is the required
   implementation.

   In particular, after this task `<repoRoot>/supabase/migrations` must not
   exist, and a newly created `<repoRoot>/supabase/migrations` — tracked or not —
   must make this assertion fail.
2. **Filename convention.** Every entry under `migrations/` is a file whose name
   matches `/^\d{4}_[a-z0-9_]+\.sql$/`. This is what makes lexicographic sort
   equal intended apply order in `scripts/migrate.mjs` and
   `docker/init-migrations.sh`, and it is precisely what
   `20260707000000_initial_schema.sql` violated.
3. **Contiguous, unique numbering.** The four-digit prefixes, sorted, equal
   `['0001', '0002', …]` with no gaps and no duplicates. Catches two branches
   both adding `0007_`, and catches an accidental deletion.
4. **Docker mount.** `docker-compose.yml` contains a volume entry mounting
   `./migrations` at `/docker-entrypoint-initdb.d/migrations`, and contains no
   occurrence of the string `supabase/migrations`.

Failure messages must name the offending path and say what to do (e.g. "schema
migrations live only in `migrations/`; do not create a second copy").

Export the detector helpers (e.g. `findMigrationDirectories(root)`,
`findMigrationNamingViolations(names)`) and unit-test them against synthetic
inputs so the guard itself is covered, mirroring how `noBrowserDialogs.test.ts`
tests `findBrowserDialogCalls`.

The test must not require a running database — the current suite passes with no
DB and must continue to.

### 6. Documentation — `AGENTS.md`

Remove every claim that the schema lives in two directories:

- Architecture diagram: `PostgreSQL  (schema in /migrations, /supabase/migrations)`
  → `/migrations` only.
- Stack section: "Raw SQL migrations in `/migrations` and `/supabase/migrations`"
  → `/migrations` only.
- Directory Structure: drop the `supabase/migrations/  Mirrors migrations/ …`
  line; expand the `migrations/` line to state that it is the single source of
  truth, applied by `scripts/migrate.mjs` (`npm run db:migrate`, and on
  `npm run build`) and bind-mounted by `docker-compose.yml` for local
  first-boot initialisation, and that new files must be named
  `NNNN_snake_case.sql` continuing the existing numbering.
- The parenthetical in the "Legacy/unused code" paragraph that says a
  `supabase/` directory with local migrations still exists → update to say
  `supabase/` retains only `config.toml` and `seed.sql` for the local
  docker-compose stack, and that the Supabase CLI migration flow is disabled.

The `<!-- BEGIN:nextjs-agent-rules -->` block and the Meridian block must not be
modified.

### 7. Version bump

`package.json` is at `0.1.56-202609030144`. Bump to `0.1.57-<YYYYMMDDHHmm>`
using local time at commit — strictly greater, per the AGENTS.md rule that the
version only ever goes up.

## Expected Results

Throughout this section, **the baseline commit is `a51951f`** (`fix(RH-16):
replace native confirm() with inline ConfirmPanel and toasts`), which was `HEAD`
immediately before RH-17 started. Every `git diff` below is run from the repo
root against that literal SHA.

- [ ] The directory `supabase/migrations/` does not exist in the working tree, and `git ls-files supabase/migrations` prints nothing; `supabase/config.toml` and `supabase/seed.sql` still exist and are still tracked by git.
- [ ] `migrations/` contains exactly six `.sql` files and no subdirectories: `0001_initial_schema.sql`, `0002_add_tabs_and_lyrics.sql`, `0003_add_band_color.sql`, `0004_join_band_by_invite_already_member.sql`, `0005_add_tab_annotations.sql`, `0006_add_system_admin_and_moderation.sql`.
- [ ] No file under `migrations/` was modified, renamed, added or deleted by this task: `git diff --stat a51951f..HEAD -- migrations/` produces empty output.
- [ ] `docker-compose.yml` mounts `./migrations:/docker-entrypoint-initdb.d/migrations:ro` on the `db` service, and `grep -rn "supabase/migrations" docker-compose.yml docker/ scripts/ package.json .github/workflows/ AGENTS.md` returns no matches (exit status 1).
- [ ] `docker/init-migrations.sh` creates the `_migrations` table if it does not exist (columns `id`, `name`, `executed_at`, with `name` UNIQUE) and, after applying each `.sql` file, inserts that file's basename into `_migrations` using `ON CONFLICT (name) DO NOTHING`; the script still begins with `set -e`.
- [ ] `docker/init-migrations.sh` cannot record a migration that failed to apply. Verifiable by reading the script: every `psql` invocation in it that applies a migration file or writes to `_migrations` either passes `-v ON_ERROR_STOP=1` or is immediately followed by an explicit non-zero exit-status check that aborts the script; and the `_migrations` insert for a file is reachable only if that file's `psql -f` succeeded. Concretely, `grep -c 'ON_ERROR_STOP' docker/init-migrations.sh` is at least 1, and no migration-applying or ledger-writing `psql` line in the script ends in `|| true`. The trailing `seed.sql` invocation is the one exemption: it keeps its `|| true` and needs no `ON_ERROR_STOP`.
- [ ] `supabase/config.toml` contains a `[db.migrations]` section with `enabled = false` and an adjacent comment stating that migrations live in the top-level `migrations/` directory and are applied by `npm run db:migrate`; the `[db.seed]` section is unchanged and still has `sql_paths = ["./seed.sql"]`.
- [ ] The file `src/lib/__tests__/migrationsSingleSource.test.ts` exists and `npx vitest run src/lib/__tests__/migrationsSingleSource.test.ts` exits 0 with every test passing and zero skipped, without any database running.
- [ ] That guard asserts all four invariants: (a) no directory named `migrations` exists anywhere in the repo except `<repoRoot>/migrations`; (b) every filename in `migrations/` matches `^\d{4}_[a-z0-9_]+\.sql$`; (c) the four-digit prefixes are unique and contiguous starting at `0001`; (d) `docker-compose.yml` mounts `./migrations` at `/docker-entrypoint-initdb.d/migrations`.
- [ ] Invariant (a) is implemented as a filesystem walk (not a walk over `git ls-files`), and its skip list — the directory names it refuses to descend into — includes at least `node_modules`, `.git`, `.next`, `coverage`, `.vercel`, `playwright-report`, `postgres-data`, `.temp`, `.branches`, `.claude`, `.gemini`, `.agents` and `.meridian`. `.claude` in particular is mandatory: `.claude/worktrees/` is gitignored and currently contains two agent checkouts that each have a `supabase/migrations/` directory, so a guard that descends into it fails on a correct implementation. Verify by reading the test file's skip list and by confirming that `ls -d .claude/worktrees/*/supabase/migrations` still lists at least one directory while the guard passes.
- [ ] The guard actually fails on drift, including untracked drift: with `mkdir -p supabase/migrations && touch supabase/migrations/0007_x.sql` (never `git add`ed), `npx vitest run src/lib/__tests__/migrationsSingleSource.test.ts` exits non-zero; after `rm -rf supabase/migrations` the same command exits 0 again.
- [ ] The guard actually fails on a bad filename: creating an empty file at `migrations/20260707000000_initial_schema.sql` makes `npx vitest run src/lib/__tests__/migrationsSingleSource.test.ts` exit non-zero, and deleting that file makes it exit 0 again.
- [ ] `npx vitest run` exits 0 with at least 20 test files and at least 186 tests passing, and zero failures, with no database running (the pre-task baseline was 19 files / 186 tests, all passing).
- [ ] `npx eslint src/lib/__tests__/migrationsSingleSource.test.ts` reports 0 errors and 0 warnings.
- [ ] `npx eslint` over the whole repo reports no more than 24 errors and no more than 20 warnings (the pre-existing baseline; lint is not required to exit 0, but the totals must not grow).
- [ ] `AGENTS.md` no longer contains the string `supabase/migrations` anywhere, its architecture diagram and stack section name only `/migrations` as the schema location, and its Directory Structure section describes `migrations/` as the single source of truth applied by `scripts/migrate.mjs` and states the `NNNN_snake_case.sql` naming rule for new migrations.
- [ ] `git diff a51951f..HEAD -- scripts/migrate.mjs` produces empty output, and the `db:migrate` and `build` entries in `package.json` `scripts` are byte-identical to their values at `a51951f`.
- [ ] Running `npm run db:migrate` twice in a row against a Postgres database that already has all six migrations recorded in `_migrations` prints a `Skipping migration:` line for each of the six files, prints `All migrations executed successfully`, exits 0, and executes no DDL.
- [ ] `package.json` `version` is `0.1.57-YYYYMMDDHHmm` (patch bumped from `0.1.56` with a 12-digit local-time timestamp suffix), and is strictly greater than the previous value `0.1.56-202609030144`.
- [ ] This task is internal tooling and not a selling point: `git diff a51951f..HEAD -- src/components/landing/LandingPage.tsx src/i18n/dictionaries/en.json src/i18n/dictionaries/pt-BR.json` produces empty output.

## Out of Scope

- **Editing any SQL.** No migration content changes, no new migration file, no
  renames under `migrations/`.
- **Removing the Supabase docker-compose stack** or the `@supabase/ssr` /
  `@supabase/supabase-js` dependencies or the `NEXT_PUBLIC_SUPABASE_*` env vars.
  The stack is still the supported local database — `vitest.config.ts` defaults
  `DATABASE_URL` to its port `54322`. Dismantling it is a separate decision.
- **`supabase/seed.sql`** — still consumed by `docker-compose.yml`; unchanged.
- **Stale historical documents.** `docs/security-audit.md` (references
  `supabase/migrations/20240101000000_initial_schema.sql`, a file that no longer
  exists), `docs/test-coverage-plan.md` (`supabase start` in CI), `plan.md`,
  `tasks.md`, and `docs/superpowers/**` all still mention the Supabase CLI flow.
  Cleaning them up is a separate documentation task; only `AGENTS.md` is updated
  here.
- **Prior task specs** under `docs/tasks/` that documented the
  "mirrored byte-for-byte in `supabase/migrations/`" convention (RH-5, RH-12) —
  they are historical records of what those tasks required and are left as-is.
- **CI workflow changes.** `.github/workflows/ci.yml` already runs
  `npm run db:migrate` against `migrations/`; the guard runs as part of the
  normal vitest suite, so no workflow edit is needed.
- **Any change to `scripts/migrate.mjs`**, including its `_migrations` schema or
  transaction handling.

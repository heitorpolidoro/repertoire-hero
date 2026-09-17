# RH-75 (board id RH-74) — Integration close-out for the Supabase removal and the poli-runner compose adoption

Parent task of RH-75 and RH-76 (board ids), both `done`:

- board RH-75 (`ef525f5`) purged the vendor from `src/`, the vitest suite, `package.json`,
  CI and the config/doc files, and renamed the DB-test gate
  `SUPABASE_SERVICE_ROLE_KEY` → `RUN_DB_TESTS`.
- board RH-76 (`47f32f2`) replaced the ten-service vendor compose stack with a profiled
  `postgres` + profile-less `app`, added `poli-runner.yml`, deleted `supabase/`,
  `docker/kong.yml` and the docker env templates, moved the seed catalogue to
  `scripts/seed-catalog.sql`, and made `.env.example` a tracked template.

**Numbering note.** This repository's spec filenames run one ahead of the board id:
board `RH-74` → `docs/tasks/RH-75-spec.md` (this file), board `RH-75` owns
`docs/tasks/RH-76-spec.md`, board `RH-76` owns `docs/tasks/RH-77-spec.md`. The commit
scope is the board id: `docs(RH-74): ...`. This is the same divergence
`docs/tasks/RH-53-spec.md` records for its own split.

## Scope

Both children landed the whole removal. What is left is the close-out, in the shape
RH-53 used: **verify the delivered state mechanically, re-state the two expected
results that were written wrong, and repair the handful of tracked documents that
still describe the current architecture incorrectly.**

This task changes **nothing** under `src/`, `e2e/`, `migrations/`, `scripts/`,
`docker/`, `docker-compose.yml`, `poli-runner.yml`, `.env.example` or
`eslint.config.mjs`. If verification finds a real defect, that is a new task, not a
fix here. The only files it writes are documentation plus the `package.json` version
bump.

## Approach

### Behavior

**1. Verify the eight already-delivered results, with no source edits.** Each is a
command, listed under *Test criteria*. Two of the parent's ten are restated below
because they are not true as written.

**2. ER1's grep is restated over tracked files, as RH-76's ER8 already is.** Measured
at `47f32f2`: `git ls-files -z | xargs -0 grep -ril supabase`, minus `docs/` and
`package-lock.json`, yields exactly `src/lib/__tests__/migrationsSingleSource.test.ts`
— the guardrail asserting `supabase/migrations/` never reappears, which must be kept.
A literal untracked `grep -ril supabase .` additionally matches `./.env`,
`./.env.local`, `./.env.development.local`, `./.env.production.local`,
`./tsconfig.tsbuildinfo` and `./.claude/settings.local.json`. Those are the
maintainer's real credentials, a TypeScript build cache and the machine owner's local
Claude Code permission file: **none of them may be read into the repo, edited or
deleted by this task**, as RH-76's spec review established. `docs/` is excluded
because historical specs and audits legitimately describe what the codebase *was*
(see step 4 for the exceptions).

**3. ER10 is wrong as written and is replaced by two separate criteria.**

- *Lint.* `npm run lint` does **not** exit 0 in this repository and did not before any
  of this work. Baseline measured at `47f32f2`: **8 errors, 12 warnings, 20 messages
  across 14 distinct (file, rule) pairs**, all `react-hooks/set-state-in-effect`,
  `@next/next/no-html-link-for-pages` and `@typescript-eslint/no-unused-vars`. The
  criterion is *introduces no new problem*: identical counts and identical (file,
  rule) pairs, warnings counted as well as errors. Fixing those 20 is application
  behaviour work and is out of scope (below), exactly as it was for board RH-75 and
  RH-76.
- *Tests.* The suite must be run with the database gate **on**. With `RUN_DB_TESTS`
  unset it reports 110 files passed / 15 skipped and still exits 0 — a green run that
  proves nothing. The criterion therefore requires `RUN_DB_TESTS=1` and **zero skipped
  files**; a skipping run fails it. *Which Postgres:* `vitest.config.ts` sets
  `DATABASE_URL` to `postgresql://postgres:postgres@127.0.0.1:54322/postgres` when the
  variable is unset, and 54322 is held by the maintainer's Homebrew Postgres (measured
  at HEAD), so that is the instance the run hits; it must already carry the migrations
  (`npm run seed` in the criteria below runs against the same URL). *How the gate is
  confirmed genuinely on:* `vitest.config.ts` calls `loadEnv('.env.local')` and
  `loadEnv('.env.development.local')`, both of which **overwrite** `process.env`, so a
  bare `RUN_DB_TESTS=` line in either file silently defeats a shell-level
  `RUN_DB_TESTS=1`. The proof is therefore the run's own output, not the shell
  invocation: the line `[vitest] RUN_DB_TESTS is not set` must be **absent** and the
  summary must report 0 skipped files. If that warning appears despite
  `RUN_DB_TESTS=1`, the local env file is overriding it — that is a real defect and a
  new task, per the Scope rule above. It is **not** licence to edit `.env.local`.

**4. Repair the tracked documents that state the *current* architecture wrongly.**
These four are the only real remaining work found; each gains an addendum in the
style the file already uses, and no historical measurement is rewritten:

- `docs/plans/code-quality-review.md`, "Environment preconditions" (~line 20) — names
  `SUPABASE_SERVICE_ROLE_KEY` as the precondition for re-running the review's
  commands. The document opens by promising "Every claim below is traceable to a
  command anyone can re-run", so this is a live instruction, not a measurement.
  Append one sentence recording that RH-75 renamed the gate to `RUN_DB_TESTS`, so a
  re-run today uses `RUN_DB_TESTS=1`. The pinned `13da8b2` measurements stay
  untouched.
- `docs/test-coverage-plan.md`, superseded banner (~line 19) — points readers at
  AGENTS.md for "the live-Postgres + `SUPABASE_SERVICE_ROLE_KEY` precondition". That
  is a forward pointer to the *live* rule and is now wrong; replace the variable name
  with `RUN_DB_TESTS` in that pointer only. The banner's item 1 (the exclusion table
  still lists `src/lib/supabase/**`) is a correct statement of the document's own
  staleness and stays verbatim.
- `docs/plans/mobile-app-analysis.md` §1.2 (~line 48) — claims `NEXT_PUBLIC_SUPABASE_*`
  entries are "still sitting in `.env.example`" and `@supabase/*` packages "still in
  `package.json`". Both are now false. Extend the existing `> **Correction note
  (RH-43, 2026-09-09).**` block, or add a sibling correction note, recording that
  RH-75/RH-76 removed them; leave the snapshot prose itself standing.
- `docs/security-audit.md` — dated 2026-05-13, scoped to "Supabase RLS policies" and
  reviewing files that no longer exist (`supabase/migrations/…`, `src/middleware.ts`).
  It is a historical record, but an undated reader could take it as a statement that
  RLS protects this app today. Add **one** banner block immediately under the title
  saying the audited architecture was removed by RH-75/RH-76, that the app now runs on
  plain Postgres + Better Auth with no RLS layer, and that the findings are kept as a
  record. Do not edit any finding.

**Left untouched, deliberately** (historical records of what the codebase was):
`docs/superpowers/**`, every `docs/tasks/RH-*-spec.md`, `docs/suggestions-log.md`, and
the body of the four files above.

**5. README.md — a discretionary addition, not a repair.** It fails step 4's criterion
for what earns an edit: it is still create-next-app boilerplate, it mentions no vendor
and it states nothing false. It is added to anyway because it is the only human-facing setup document and it says
nothing about the convention RH-76 introduced, where `cp .env.example .env` is step one
for everyone. Add **one** `## Local development` section — `cp .env.example .env`,
`COMPOSE_PROFILES=standalone POSTGRES_PORT=54323 docker compose up -d --wait` (inline
override, since 54322 is commonly taken),
`poli-runner start repertoire_hero` for the shared-Postgres mode, `npm run seed`, and
`RUN_DB_TESTS=1` for the full suite. Do not rewrite or delete the existing boilerplate
sections. This is the one judgement call in the task; it is bounded to that section.

**6. AGENTS.md.** Measured at `47f32f2` it is already accurate: it documents the
two-service compose with both `COMPOSE_PROFILES` modes, `poli-runner.yml`,
`scripts/seed-catalog.sql`, `scripts/ensure-db.sh`, the `RUN_DB_TESTS` gate and the
one-tracked-match grep, and contains the vendor's name zero times. Verify, do not
rewrite. If verification shows it accurate, its expected result is satisfied by the
greps below with no diff.

**7. Version bump** in `package.json` per the AGENTS.md rule.

### Files touched

- `docs/tasks/RH-75-spec.md` — this spec (new).
- `docs/plans/code-quality-review.md` — one appended sentence in Environment preconditions.
- `docs/test-coverage-plan.md` — one variable name in the banner's live-rule pointer.
- `docs/plans/mobile-app-analysis.md` — one correction-note sentence for §1.2.
- `docs/security-audit.md` — one historical banner block under the title.
- `README.md` — one new `## Local development` section.
- `package.json` — version bump.

### Test criteria

No new tests; the existing suites and the commands below are the verification. The
developer records each command's output in the PR body. Ports 54321, 54322, 55432,
3001, 8001, 4444 and 27017 are occupied on the maintainer's machine, and the compose
default is `${POSTGRES_PORT:-54322}`, so the standalone check collides with the
Homebrew Postgres on 54322. The port must be redirected to 54323 (free, measured at
HEAD; RH-76's spec names the same port) **by inline shell override only**:

    COMPOSE_PROFILES=standalone POSTGRES_PORT=54323 docker compose up -d --wait

This works because shell environment beats `.env` in Compose interpolation. Editing
`.env` — or any of the six protected files — is forbidden outright (see Out of Scope);
there is no "for the duration of the check" exemption.

```bash
git ls-files -z | xargs -0 grep -ril supabase | grep -v '^docs/' | grep -v package-lock.json
grep -c '@supabase' package.json ; npm ls @supabase/supabase-js
ls src/lib/supabase supabase docker/kong.yml docker/supabase.env.example 2>&1
ls src/lib/__tests__/setup.ts 2>&1   # must report No such file or directory (RH-75 deleted it)
grep -rn "supabase" src/lib/__tests__/bands.test.ts src/lib/__tests__/spotify.test.ts ; echo "exit=$?"
npm run seed
COMPOSE_PROFILES=standalone docker compose config --services
docker compose config --services   # no profile: app only
COMPOSE_PROFILES=standalone POSTGRES_PORT=54323 docker compose up -d --wait \
  && curl -o /dev/null -w '%{http_code}\n' http://localhost:3000/
poli-runner start repertoire_hero && curl -o /dev/null -w '%{http_code}\n' http://localhost:3000/
RUN_DB_TESTS=1 npx vitest run
npx eslint -f json > /tmp/lint.json   # count severities and (file, rule) pairs
git diff --stat
# ER17 protected-file guard: the six files are gitignored, so `git status --porcelain`
# can never report them. Hash them before and after the whole task instead:
shasum -a 256 .env .env.local .env.development.local .env.production.local \
  tsconfig.tsbuildinfo .claude/settings.local.json
```

## Expected Results

- [ ] `git ls-files -z | xargs -0 grep -ril supabase | grep -v '^docs/' | grep -v package-lock.json`
      prints exactly `src/lib/__tests__/migrationsSingleSource.test.ts`, that file still
      exists, and `npx vitest run src/lib/__tests__/migrationsSingleSource.test.ts` passes.
- [ ] `grep -c '@supabase' package.json` prints `0` and `npm ls @supabase/supabase-js`
      reports the package absent (`(empty)`).
- [ ] `src/lib/supabase/` and `supabase/` do not exist, and `src/lib/__tests__/setup.ts`
      no longer exists either (RH-75 deleted it; `vitest.config.ts` declares no
      `setupFiles`). `grep -rn "supabase" src/lib/__tests__/bands.test.ts src/lib/__tests__/spotify.test.ts`
      prints nothing **and exits 1** (no match), not 2 (missing file) — no
      `vi.mock('@supabase/supabase-js')`, no `vi.mock('@/lib/supabase/admin')`, no
      `NEXT_PUBLIC_SUPABASE_*` read.
- [ ] `docker/kong.yml` and `docker/supabase.env.example` do not exist,
      `scripts/seed-catalog.sql` does, and `npm run seed` exits 0 against a live
      migrated Postgres.
- [ ] `COMPOSE_PROFILES=standalone docker compose config --services` prints exactly
      `postgres` and `app` (without the profile it prints `app` only — the parenthetical
      is part of the result);
      `postgres` carries `profiles: [standalone]`, `app` carries no profile, and its
      `depends_on.postgres` carries `required: false`.
- [ ] `.env.example` is tracked (`git ls-files .env.example` prints it) and sets
      `COMPOSE_PROFILES`, `POSTGRES_URL`, `POSTGRES_PORT` and `DATABASE_URL`, with no
      secret slot carrying a value.
- [ ] `poli-runner.yml` declares `depends_on: [postgres]` and an
      `integrations.postgres.local` scenario setting `COMPOSE_PROFILES` and
      `POSTGRES_URL`.
- [ ] `COMPOSE_PROFILES=standalone POSTGRES_PORT=54323 docker compose up -d --wait`
      (inline shell override, no `.env` edit) starts the app against the repo's own
      Postgres and `curl -o /dev/null -w '%{http_code}' http://localhost:3000/` prints
      `200`;
      `poli-runner start repertoire_hero` starts it against the shared Postgres and the
      same curl prints `200`.
- [ ] `RUN_DB_TESTS=1 npx vitest run` — against the Postgres at the effective
      `DATABASE_URL`, i.e. `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
      (`vitest.config.ts`'s fallback; the Homebrew instance), already migrated — exits 0,
      reports **125 test files, 0 skipped**, and its output does **not** contain
      `[vitest] RUN_DB_TESTS is not set`. Any skipped file, or that warning appearing
      (which would mean `.env.local` overwrote the shell variable), fails this result.
- [ ] `npx eslint -f json` reports exactly **8 errors and 12 warnings** over the same
      14 (file, rule) pairs as the `47f32f2` baseline — no new problem is introduced,
      and none of the 20 existing ones is required to be fixed.
- [ ] `docs/plans/code-quality-review.md`'s Environment preconditions paragraph names
      `RUN_DB_TESTS` and records that RH-75 renamed the gate, and the pinned `13da8b2`
      measurements below it are unchanged (`git diff` touches only that paragraph).
- [ ] `grep -c 'SUPABASE_SERVICE_ROLE_KEY' docs/test-coverage-plan.md` prints `0` and
      the banner's live-rule pointer names `RUN_DB_TESTS`; the banner's item 1 about
      `src/lib/supabase/**` is unchanged.
- [ ] `docs/plans/mobile-app-analysis.md` carries a correction note stating that
      RH-75/RH-76 removed the `NEXT_PUBLIC_SUPABASE_*` entries from `.env.example` and
      the `@supabase/*` packages from `package.json`, and the original §1.2 prose is
      left standing.
- [ ] `docs/security-audit.md` carries a banner immediately under its title recording
      that the audited architecture was removed by RH-75/RH-76 and that the app now
      runs on plain Postgres + Better Auth with no RLS layer; no finding body is edited.
- [ ] *(discretionary addition, not a correction: README states nothing false today)*
      `README.md` has a `## Local development` section naming `cp .env.example .env`,
      `docker compose up`, `poli-runner start repertoire_hero`, `npm run seed` and
      `RUN_DB_TESTS=1`, and the pre-existing boilerplate sections are unchanged.
- [ ] `grep -ci supabase AGENTS.md` prints `0`, and AGENTS.md contains `RUN_DB_TESTS`,
      `COMPOSE_PROFILES`, `poli-runner.yml` and `scripts/seed-catalog.sql`.
- [ ] `git diff --stat` for this task touches only `README.md`,
      `docs/plans/code-quality-review.md`, `docs/plans/mobile-app-analysis.md`,
      `docs/security-audit.md`, `docs/test-coverage-plan.md`,
      `docs/tasks/RH-75-spec.md` and `package.json`. The six protected files —
      `.env`, `.env.local`, `.env.development.local`, `.env.production.local`,
      `tsconfig.tsbuildinfo`, `.claude/settings.local.json` — have **byte-identical
      sha256 hashes before and after the task**, compared against the hashes recorded
      before the work started. `git status --porcelain` is explicitly **rejected** as
      the check here: all six are gitignored, so it can never report a change to them
      and the guard would be vacuous. `AGENTS.md` is correctly absent from both lists:
      it is already accurate at HEAD (ER16) and is not edited.
- [ ] `package.json` `version` is higher than every version in `git log` and carries a
      `YYYYMMDDHHmm` suffix.

## Out of Scope

- Any change under `src/`, `e2e/`, `migrations/`, `scripts/`, `docker/`, or to
  `docker-compose.yml`, `poli-runner.yml`, `.env.example`, `eslint.config.mjs` or the
  CI workflows. The children own those and they are `done`.
- Fixing the 8 lint errors / 12 warnings. They predate this chain, are
  application-behaviour changes (`react-hooks/set-state-in-effect` in five components,
  `@next/next/no-html-link-for-pages` in `src/app/settings/page.tsx`, unused bindings in
  tests and scripts), and deserve their own task.
- **Hard constraint.** Editing, deleting or reading into the repo any of these six
  untracked files: `.env`, `.env.local`, `.env.development.local`,
  `.env.production.local`, `tsconfig.tsbuildinfo`, `.claude/settings.local.json`. This
  admits no temporary exception for a verification command: where a command needs a
  different value, it is passed as an inline shell override. All six are gitignored, so
  the diff cannot police them — their sha256 hashes are compared instead (ER17).
- Rewriting historical documents: `docs/superpowers/**`, `docs/tasks/RH-*-spec.md`,
  `docs/suggestions-log.md`, and the finding bodies of `docs/security-audit.md`,
  `docs/test-coverage-plan.md`, `docs/plans/mobile-app-analysis.md` and
  `docs/plans/code-quality-review.md`.
- Removing `src/lib/__tests__/migrationsSingleSource.test.ts` or its vendor-named
  constants: it is the guardrail and is the single intended match.
- Rewriting README's create-next-app boilerplate beyond adding the one section.
- Renaming the board-id / spec-filename divergence anywhere in the repo.

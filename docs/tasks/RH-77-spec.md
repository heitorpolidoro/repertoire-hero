# RH-77 — Replace the Supabase docker stack with a poli-runner-ready Postgres and app compose

> **Filename mapping.** This file is the spec for **board task RH-76** (`parent: RH-74`,
> sibling `RH-75` done at `ef525f5`). Spec filenames in this repository run one ahead of
> the board id: `docs/tasks/RH-76-spec.md` is board RH-75's, so board RH-76's spec is
> `docs/tasks/RH-77-spec.md`.

## Scope

Part 2 of the RH-74 split: the **infrastructure** surface only. RH-75 already removed
Supabase from `src/`, the vitest suite, `package.json`, CI and the config/doc files, and
renamed the DB-test gate to `RUN_DB_TESTS`. What is left is:

- delete `supabase/` (`config.toml`, `seed.sql`, `snippets/`, `.branches/`, `.temp/`),
  relocating the one live thing inside it;
- replace the ten Supabase services in `docker-compose.yml` with a two-service file
  (`postgres` + `app`) shaped by the profile convention in
  `/Users/heitor/workspace/polidoro-runner/README.md` → *Making a compose repo runner-ready*;
- delete `docker/kong.yml`, `docker/supabase.env.example` and `docker/app.env.example`;
- add `poli-runner.yml` at the repo root and a minimal `scripts/ensure-db.sh`;
- settle the `.env*.example` tracking question RH-75's reviewer deferred here;
- close the repo-wide `grep -ril supabase` guarantee.

**Not in scope:** fixing the pre-existing ESLint errors/warnings (see Expected Result 10),
any change to application behaviour, `src/`, the migrations themselves, `Dockerfile`
contents, CI workflows, or Vercel deployment. No UI changes, so no HTML mockup.

## Approach

### Behaviour that must be true when this is done

1. **Two compose modes, one file** (the cash_lens/apras pattern — `poli-runner.yml` is
   patterned on **cash_lens**, which is the closest sibling: a compose repo bundling its
   own Postgres, with `depends_on: [postgres]`, no `mock` scenario, and a header comment
   naming both modes).
   - *standalone*: `COMPOSE_PROFILES=standalone` comes from `.env`; the repo starts its
     own `postgres` service and the `app` talks to it over the compose network.
   - *poli-runner*: the runner injects `COMPOSE_PROFILES=poli-runner` (a profile no service
     declares, so the bundled `postgres` stays down) plus the connection URL for the shared
     `poli-postgres` on `host.docker.internal:54321`.
2. **Connection variable naming.** The compose-only variable is **`POSTGRES_URL`**, and the
   `app` service maps it in as `DATABASE_URL=${POSTGRES_URL}`. It must **not** be named
   `DATABASE_URL` at the compose level: the host-side tooling (`scripts/migrate.mjs`,
   `scripts/deduplicate-songs.mjs`, `vitest.config.ts`) reads `DATABASE_URL` from
   `.env.local`, and a compose-network host (`postgres:5432`) in that name would be
   ambiguous. Those three loaders read only `.env.local`/`.env.development.local` — never
   `.env` — so `.env` is compose-only territory and `POSTGRES_URL` there is invisible to
   host tooling.
   **Database identity — the single decision every other section must quote.** The two modes
   talk to two different servers, so they legitimately use two database names, and each name
   is fixed here:
   - *standalone* (the bundled, dedicated server): `POSTGRES_DB=postgres`, i.e. the compose
     variable is `POSTGRES_URL=postgresql://postgres:postgres@postgres:5432/postgres`
     (container-network host `postgres`, port 5432). From the host the same database is
     `postgresql://postgres:postgres@127.0.0.1:${POSTGRES_PORT:-54322}/postgres`. The name
     `postgres` is not a free choice: `vitest.config.ts:36` and `AGENTS.md:94` both pin the
     host-side test URL to `…:54322/postgres`, and neither file is in scope to change.
   - *poli-runner* (the shared `poli-postgres` cluster, which hosts many apps and therefore
     cannot use `postgres`): database `repertoire_hero`, injected by `poli-runner.yml` as
     `POSTGRES_URL=postgresql://postgres:postgres@host.docker.internal:54321/repertoire_hero`.
   Every reference in this spec — §5, §8, `.env.example`, `scripts/dev-seed`,
   `scripts/ensure-db.sh` — uses exactly these two strings and no third variant. In
   particular `.env.example`'s existing `DATABASE_URL=…@localhost:5432/repertoire_hero` is
   corrected to `postgresql://postgres:postgres@127.0.0.1:54322/postgres` so the tracked
   template, the vitest fallback and AGENTS.md agree.
3. **Profiles and `depends_on`.** `postgres` carries `profiles: [standalone]`; `app`
   carries no profile (so it always starts *and always stops*); `app`'s `depends_on` entry
   for `postgres` uses `condition: service_healthy` **and `required: false`** — without it
   an inactive profile makes the whole project invalid.
   **`docker compose config --services` is profile-scoped**, so it has two correct answers,
   not one. Measured on Docker Compose v5.5.1 against the exact shape prescribed here:
   `COMPOSE_PROFILES=standalone` → `postgres, app`; `COMPOSE_PROFILES=poli-runner` → `app`
   only; unset → `app` only; `docker compose --profile '*' config --services` → `postgres,
   app`. That is the mechanism, not a defect: the same thing that drops `postgres` in
   poli-runner mode is what ER4 requires. ER2 therefore asserts both answers separately.
4. **Published Postgres port is overridable**: `"${POSTGRES_PORT:-54322}:5432"`. 54322 is
   the port `vitest.config.ts:36` falls back to and `AGENTS.md:94` documents, so it stays
   the repository default and no host-side default changes. On *this* machine every nearby
   port is taken — Homebrew Postgres holds 54322, the shared `poli-postgres` container holds
   54321, `apras58-pgtest` holds 55432 — so the implementer verifies ER9 with
   `POSTGRES_PORT=54323` (measured free), or stops the Homebrew service first. A clash
   surfaces as `port is already allocated`, not as a hang.
5. **Seed relocation.** `npm run seed` is `bash scripts/dev-seed`, which today does **not**
   read `supabase/seed.sql` at all — it seeds Better Auth users, profiles, a band and six
   `global_songs` rows straight through `psql`. The only live content in `supabase/seed.sql`
   is its 12-row `INSERT INTO global_songs … ON CONFLICT DO NOTHING` catalogue (which
   `docker/init-migrations.sh` applies on first boot); its trailing commented-out block
   targets `user_repertoire`, a table that no longer exists, and carries the maintainer's
   personal email in a comment. **Decision:** move the `global_songs` INSERT to
   `scripts/seed-catalog.sql` (header rewritten, no Supabase CLI references), drop the
   commented-out block entirely, and have `scripts/dev-seed` apply `scripts/seed-catalog.sql`
   after its own inserts so the file has a live runner on the host as well as at first boot.
   `scripts/dev-seed`'s default `DATABASE_URL` changes from
   `…@127.0.0.1:5432/repertoire_hero` to the standalone string fixed in §2,
   `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
6. **initdb ordering.** The catalogue must **not** be bind-mounted as a `*.sql` file inside
   `/docker-entrypoint-initdb.d/`: `postgres:16-alpine`'s entrypoint runs `*.sql` there
   alphabetically with `ON_ERROR_STOP=1`, so `seed.sql` would run before
   `99-migrations.sh` and abort initialisation against a schema-less database. Mount it at
   `/seed/catalog.sql` and point `docker/init-migrations.sh` at that path.
7. **`.env*.example` tracking — the decision.** Add `!.env*.example` after the `.env*` line
   in `.gitignore` and **track `.env.example`**; it is the tracked template and the file ER5
   is checked against, so the check survives a fresh clone. It needs no credential scrubbing
   (it already ships `you@example.com` / the literal placeholder `devpassword` and empty
   secret values) — it gains a Docker block (`COMPOSE_PROFILES`, `POSTGRES_URL`,
   `POSTGRES_PORT`, `POSTGRES_PASSWORD`) and a one-line `cp .env.example .env` instruction.
   **`.env.local.example` is deleted, not tracked**: it carries the maintainer's personal
   email and all three of its variables already exist in `.env.example`, so tracking it
   would publish a personal credential for no gain. `docker/app.env.example` (Supabase anon
   and service-role JWTs) and `docker/supabase.env.example` are deleted for the same reason
   — `.env.example` supersedes both.
8. **poli-runner start must land on a usable database.** Nothing else creates the
   `repertoire_hero` database or applies migrations on the shared Postgres, so
   `commands.start` runs `./scripts/ensure-db.sh && docker compose up -d --wait` (the
   precedent is aequitas' `./scripts/ensure-role.sh`). The script creates the
   `repertoire_hero` database on `poli-postgres` if missing and runs `node
   scripts/migrate.mjs` against
   `postgresql://postgres:postgres@127.0.0.1:54321/repertoire_hero`; it **exits 0 with a
   notice** when `poli-postgres` is not running, so `poli-runner start repertoire_hero
   --no-deps` still falls through to the standalone bundled database.
8b. **`app` needs its own healthcheck, or `--wait` proves nothing.** `--wait` returns as soon
   as a service without a healthcheck reaches *running*, and for `CMD ["node", "server.js"]`
   running precedes Next.js binding :3000 — an ER9 curl fired at that moment races the boot.
   So `app` gets a healthcheck too: busybox `wget` is present at `/usr/bin/wget` in
   `node:24-alpine` (verified), so `test: ["CMD-SHELL", "wget -q -O /dev/null
   http://127.0.0.1:3000/ || exit 1"]` with `interval: 5s`, `timeout: 5s`, `retries: 24`,
   `start_period: 30s`. With it, `docker compose up -d --wait` exits 0 only once `/` is
   actually answering, in **both** modes — which is why `commands.start` above also carries
   `--wait`, rather than a bare `up -d`.
9. **Repo-wide grep closes — and its exclusion list is honest about what cannot be edited.**
   Beyond the files deleted above, two editable matches remain and must go: the
   `supabase/.temp/` entry in `.gitignore` and the Supabase paragraphs in `AGENTS.md`. The one
   permitted source match stays: `src/lib/__tests__/migrationsSingleSource.test.ts`, whose
   prose and `SKIPPED_DIRECTORY_NAMES` document why the guardrail exists.
   Six further on-disk matches exist and are **deliberately out of reach** — measured today:
   `./.env` (1 match), `./.env.local` (5), `./.env.development.local` (4),
   `./.env.production.local` (2), `./tsconfig.tsbuildinfo` (1) and
   `./.claude/settings.local.json` (a `"Bash(supabase *)"` permission entry). All six are
   untracked and git-ignored; the four env files hold the maintainer's real service-role keys
   and are not this task's to rewrite, `tsconfig.tsbuildinfo` is a regenerated TypeScript
   build cache, and `.claude/settings.local.json` is the machine owner's local Claude Code
   tool configuration, not repository infrastructure — **this task must not touch it at all.**
   ER8 is therefore stated over **tracked** files so a fresh clone gives the same answer, and
   all six untracked paths are excluded by construction.
10. **The `./migrations` bind-mount is preserved verbatim**
    (`- ./migrations:/docker-entrypoint-initdb.d/migrations:ro`) — the guardrail test
    matches it with a regex and also asserts the file never mentions `supabase/migrations`.

### Files touched

- `docker-compose.yml` — replaced: header comment naming both modes, `postgres` (profiled,
  healthchecked, `POSTGRES_DB=postgres`, `${POSTGRES_PORT:-54322}:5432`, migrations +
  `/seed/catalog.sql` + `99-migrations.sh` mounts, own named volume) and `app` (no profile,
  its own `wget` healthcheck per §8b, `DATABASE_URL=${POSTGRES_URL}` plus the
  `BETTER_AUTH_*` passthroughs, `depends_on` with `required: false`); the eight other
  Supabase services and their volumes deleted.
- `poli-runner.yml` — new; `name: repertoire_hero`, `alias: rh`, the four `commands`,
  `status.url: http://localhost:3000/` (the home route is a client component, so it renders
  200 without a session), `depends_on: [postgres]`, and the `postgres` integration point
  with a `local` scenario only.
- `scripts/ensure-db.sh` — new, executable; creates `repertoire_hero` if missing + `node
  scripts/migrate.mjs` against
  `postgresql://postgres:postgres@127.0.0.1:54321/repertoire_hero`, tolerant exit when the
  shared container is down.
- `scripts/seed-catalog.sql` — new; the 12-row `global_songs` catalogue moved out of
  `supabase/seed.sql`, header rewritten.
- `scripts/dev-seed` — default `DATABASE_URL` updated; applies `scripts/seed-catalog.sql`.
- `docker/init-migrations.sh` — seed path `/docker-entrypoint-initdb.d/seed.sql` →
  `/seed/catalog.sql`.
- `.env.example` — Docker/compose block added (`COMPOSE_PROFILES`, `POSTGRES_URL`,
  `POSTGRES_PORT`, `POSTGRES_PASSWORD`), `DATABASE_URL` corrected to
  `postgresql://postgres:postgres@127.0.0.1:54322/postgres` per §2; becomes tracked.
- `.gitignore` — `!.env*.example` added; `supabase/.temp/` entry removed.
- `AGENTS.md` — the legacy-Supabase paragraph (§ *Legacy/unused code*), the Deployment
  bullet's "Kong/Supabase-style" phrase, and the `docker/` line in the directory tree
  rewritten to describe the two compose modes, `.env.example` as the tracked template and
  `poli-runner.yml`.
- `package.json` — version bump per the AGENTS.md rule.
- **Deleted:** `supabase/` (whole directory), `docker/kong.yml`,
  `docker/supabase.env.example`, `docker/app.env.example`, `.env.local.example`.

### Test criteria

- `COMPOSE_PROFILES=standalone docker compose config --services` prints exactly `postgres`
  and `app`; `COMPOSE_PROFILES=poli-runner docker compose config --services` prints exactly
  `app` (this is the measured, intended behaviour — see §3), and the bundled `postgres`
  is likewise absent from `docker compose ps` in that mode.
- `npx vitest run src/lib/__tests__/migrationsSingleSource.test.ts` passes.
- `npx vitest run` (note: `npm test` is watch-mode `vitest`; use `--run`) and the ESLint
  baseline comparison in ER10.
- The full ER9 round trip is genuinely runnable: ~35 GB was reclaimed in the Docker VM, so
  disk is no longer the blocker. The Supabase image family was deleted along with the build
  cache, so the **first `docker compose up` pulls `postgres:16-alpine` and rebuilds the app
  image from scratch** — several minutes of pull/build is expected progress, not a hang.
  `npm run build` inside the image is safe without a database: both `scripts/migrate.mjs`
  and `scripts/deduplicate-songs.mjs` warn and exit 0 when they cannot connect.

## Expected Results

- [ ] **ER1** `supabase/` does not exist (no `config.toml`, `seed.sql`, `snippets/`,
      `.branches/`, `.temp/`); its live catalogue lives at `scripts/seed-catalog.sql`; with the
      compose Postgres up and migrated, `npm run seed` exits 0 against
      `postgresql://postgres:postgres@127.0.0.1:${POSTGRES_PORT:-54322}/postgres` (pass the
      URL as `scripts/dev-seed`'s argument when the port is overridden), and
      `scripts/dev-seed`'s built-in default is that same string with port 54322.
- [ ] **ER2** Service listing is correct in both modes:
      `COMPOSE_PROFILES=standalone docker compose config --services | sort` prints exactly
      `app` and `postgres`, while `COMPOSE_PROFILES=poli-runner docker compose config
      --services` prints exactly `app` and nothing else; and none of `db`, `auth`, `rest`,
      `realtime`, `storage`, `imgproxy`, `meta`, `kong`, `studio`, `mailpit` appears
      anywhere in `docker-compose.yml`.
- [ ] **ER3** `docker/kong.yml`, `docker/supabase.env.example` and `docker/app.env.example`
      no longer exist; `docker/init-migrations.sh` remains.
- [ ] **ER4** `docker-compose.yml` gives the `postgres` service `profiles: [standalone]`,
      gives `app` no `profiles` key, and `app`'s `depends_on.postgres` carries
      `required: false`; `docker compose config` exits 0 under both
      `COMPOSE_PROFILES=standalone` and `COMPOSE_PROFILES=poli-runner`.
- [ ] **ER5** `.env.example` is tracked by git (`git ls-files .env.example` is non-empty)
      and contains `COMPOSE_PROFILES=standalone` plus every Postgres variable the compose
      file interpolates (`POSTGRES_URL`, `POSTGRES_PORT`, `POSTGRES_PASSWORD`), with
      `POSTGRES_URL=postgresql://postgres:postgres@postgres:5432/postgres`,
      `POSTGRES_PORT=54322` and
      `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`; no secret slot
      gains a value and no personal email appears; `.env.local.example` no longer exists.
- [ ] **ER6** `poli-runner.yml` exists at the repo root, parses as valid YAML
      (`python3 -c "import yaml,sys;yaml.safe_load(open('poli-runner.yml'))"` exits 0),
      declares `depends_on: [postgres]`, defines `integrations.postgres.local` setting
      `COMPOSE_PROFILES=poli-runner` and
      `POSTGRES_URL=postgresql://postgres:postgres@host.docker.internal:54321/repertoire_hero`,
      and has a `commands.start` ending in `docker compose up -d --wait`.
- [ ] **ER7** `docker-compose.yml` still carries the line
      `- ./migrations:/docker-entrypoint-initdb.d/migrations:ro`, and
      `npx vitest run src/lib/__tests__/migrationsSingleSource.test.ts` passes.
- [ ] **ER8** `git ls-files -z | xargs -0 grep -il supabase`, filtered to drop `docs/` and
      `package-lock.json`, matches exactly one path:
      `src/lib/__tests__/migrationsSingleSource.test.ts`. The untracked, git-ignored `.env`,
      `.env.local`, `.env.development.local`, `.env.production.local`, `tsconfig.tsbuildinfo`
      and `.claude/settings.local.json` are excluded by construction and stay untouched (§9).
- [ ] **ER9** Both modes come up and answer, with readiness actually gated: `app` declares a
      healthcheck in `docker-compose.yml`, so `COMPOSE_PROFILES=standalone POSTGRES_PORT=54323
      docker compose up -d --wait` exits `0` (54322 is taken by Homebrew Postgres on this
      machine; the default stays 54322) and `curl -s -o /dev/null -w '%{http_code}'
      http://localhost:3000/` immediately returns `200` against the bundled database
      `postgres`. After `docker compose down`, `poli-runner start repertoire_hero` (from
      `~/workspace`) exits `0` — its `commands.start` ends in `docker compose up -d --wait`,
      not a bare `up -d` — `docker compose ps` shows an `app` container and no bundled
      `postgres` container, and the same curl returns `200` against `repertoire_hero` on the
      shared `poli-postgres` at `host.docker.internal:54321`.
- [ ] **ER10** The change introduces no new lint problem: `npx eslint --format json .`
      reports the **same 8 errors and 12 warnings** in the same (file, rule) pairs as the
      baseline measured at `ef525f5` (`react-hooks/set-state-in-effect`,
      `@next/next/no-html-link-for-pages`, `@typescript-eslint/no-unused-vars`), and
      `npx vitest run` exits 0.

## Out of Scope

- Fixing the 8 pre-existing ESLint errors and 12 warnings. They predate RH-74, live in
  page/layout components, and are application-behaviour work that belongs to its own task —
  `npm run lint` has never exited 0 in this repository, so "lint exits 0" would be an
  acceptance criterion that can never pass.
- Any change under `src/`, `e2e/`, `migrations/`, `.github/workflows/` or `Dockerfile`.
- Adding a dedicated `/api/health` route: `/` already answers 200 without a session.
- Registering the repo in `polidoro-runner/systems/` — `poli-runner.yml` at the repo root is
  the whole integration; the shared `postgres` system already exists there.

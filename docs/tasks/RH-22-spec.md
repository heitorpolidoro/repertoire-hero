# RH-22 — Remove dead code from the project

Baseline commit for every measurement in this spec: **`bd24bbc`** (`refactor(RH-21): standardize
error handling across lib, actions and routes`), the current `master` HEAD.

## Scope

Delete code, assets and dependencies that no consumer in the repository reaches, and install a
mechanical guard so the same rot cannot re-accumulate silently.

In scope:

1. Delete 11 unreferenced files (6 source/script files, 5 create-next-app template SVGs).
2. Delete 6 unreferenced exports (4 Server Actions, 1 `src/lib` function, 1 type).
3. Collapse the never-triggered `'error'` variant out of the Toast state in `src/app/bands/[id]/page.tsx`.
4. Uninstall 3 unused npm dependencies **via `npm uninstall`**, so `package-lock.json` stays in sync.
5. Add `knip` + a committed `knip.json` + an `npm run lint:dead` script + a CI job, so `knip` exits 0
   on the post-sweep tree and fails the build on any future regression.
6. Ignore the generated `coverage/` directory in ESLint (it is a build artifact, not source).
7. Update `AGENTS.md` (the "Legacy/unused code to be aware of" paragraph and the directory tree) and
   fix one stale comment in `supabase/seed.sql`.

Not in scope (see **Out of Scope** for the full "looks unused but keep" list): any behaviour change,
any refactor of live code, declaring the two phantom dependencies, or retiring the Supabase-era test
scaffolding.

**Landing Page Rule** (AGENTS.md): this task ships **no** user-facing feature. Removing dead code is
internal cleanup with zero observable product change — explicitly **not a selling point**.
`src/components/landing/LandingPage.tsx`, `src/i18n/dictionaries/en.json` and
`src/i18n/dictionaries/pt-BR.json` MUST be byte-identical to `bd24bbc` when this task lands.

**Error Handling Conventions** (AGENTS.md): this task only deletes code. No `try`/`catch` is added,
moved or reshaped. `src/lib/__tests__/errorHandlingStyle.test.ts` must keep passing untouched.

## How the sweep was performed (evidence)

Tooling actually run on the `bd24bbc` tree, then re-run on a scratch copy with every deletion below
applied:

- `npx knip@6.34.0 --no-progress` — understands Next.js entry points (pages, layouts, route
  handlers, `src/proxy.ts`, `next.config.ts`, `vitest.config.ts`, `playwright.config.ts`,
  `sentry.*.config.ts`, `scripts/*.mjs`) out of the box; no config was needed to get a correct
  baseline report.
- `npx depcheck` — cross-check for dependencies.
- Targeted `grep -rn` over `src e2e scripts migrations docs *.md *.ts *.mjs` for every candidate,
  plus `git log -S` to find *why* a suspicious dependency was added.

Every candidate below was read before being listed. Framework-consumed exports, string-referenced
packages, test-only helpers and Docker/CI-referenced files were checked and are in the keep list.

## Approach

### 1. Files to delete (11)

| File | Evidence it is unreferenced |
|---|---|
| `src/lib/mongodb.ts` | knip "Unused files". Exports a `MongoClient` promise; the app runs on `pg` (`src/lib/db.ts`). `grep -rn "lib/mongodb\|from '@/lib/mongodb'" src e2e scripts` → no hits. |
| `src/types/index.ts` | knip "Unused files". Declares `Song`/`Playlist` with `_id`/`userEmail` (Mongo shape). Live types are `src/types/database.ts`. `grep -rn "from '@/types'" src e2e` → no hits. |
| `seed.js` | knip "Unused files". `require('mongodb')`, connects to `mongodb://localhost:27017/repertoire`. Referenced by no npm script (`package.json#scripts.seed` runs `scripts/dev-seed`), no Dockerfile line, no workflow. |
| `seed-users.mjs` | knip "Unused files". Imports `@supabase/supabase-js` and calls the GoTrue admin API — the app no longer uses Supabase Auth. Its only mention repo-wide is a stale comment in `supabase/seed.sql:11` (`npm run dev:seed-users`), a script that does not exist in `package.json`. |
| `src/components/Sidebar.tsx` | knip "Unused files". `grep -rn "Sidebar" src e2e` finds only a JSX comment in `src/app/songs/[id]/fast-view/page.tsx:1341` and the AGENTS.md tree. Live chrome is `src/components/layout/AppLayout.tsx` / `ConditionalLayout.tsx`. No `dynamic()`/`import()` reaches it (`grep -rn "dynamic(\|import(" src` audited). |
| `src/components/songs/SongCard.tsx` | knip "Unused files". `grep -rn "SongCard" src e2e` → only the file itself + the AGENTS.md tree. |
| `public/file.svg` | Unmodified create-next-app template asset. `grep -rn "file.svg" .` (excl. `node_modules/.git/.next/public`) → only `docs/plans/mobile-app-analysis.md:68`, which itself documents these five as unused template leftovers. |
| `public/globe.svg` | idem |
| `public/next.svg` | idem |
| `public/vercel.svg` | idem |
| `public/window.svg` | idem |

Deleting all of `public/` is safe: `scripts/copy-pdf-worker.mjs:62` calls
`fs.mkdirSync(path.dirname(DEST), { recursive: true })` before writing `public/pdf.worker.min.mjs`,
so the `postinstall`/`prebuild` hook recreates the directory. ESLint already ignores `public/**`.

### 2. Exports to delete (6)

| Export | File | Evidence |
|---|---|---|
| `joinBandByInviteAction` | `src/app/actions/bands.ts:72` | knip "Unused exports". No caller in `src/app`; the live invite flow is `src/app/join/[code]/page.tsx` → `joinBandByInviteServer` (`src/lib/bands.server.ts`). Already documented as caller-less in `docs/tasks/RH-12-spec.md:395`. Also prune the now-unused `joinBandByInviteClient` name from the import list at line 15 (the `src/lib` function itself stays — see keep list). |
| `updatePersonalKeyAction` | `src/app/actions/repertoire.ts:53` | knip "Unused exports". Only other repo hit is a historical snippet in `docs/superpowers/plans/2026-06-03-auth-migration.md`. Prune `updatePersonalKey` from the `@/lib/songs` import list. |
| `getBandWeakestStatusAction` | `src/app/actions/repertoire.ts:115-153` (incl. its doc comment) | knip "Unused exports". Zero references outside its own definition. It is the **only** consumer of `STATUS_ORDER` in that file (`grep -n STATUS_ORDER src/app/actions/repertoire.ts` → lines 6, 144, 145 only), so delete the `import { STATUS_ORDER } from '@/lib/statusConfig'` line too. `SongStatus` stays (still used at lines 39 and 83). |
| `mergeSongsAction` | `src/app/actions/repertoire.ts:252` | knip "Unused exports". Zero references. |
| `mergeGlobalSongs` | `src/lib/songs.ts:374-445` | Its only consumer repo-wide is the dynamic `import()` inside `mergeSongsAction` (`src/app/actions/repertoire.ts:253`). **No vitest test imports it** (`grep -rn mergeGlobalSongs src/lib/__tests__ e2e` → no hits). Build-time duplicate handling already lives in `scripts/deduplicate-songs.mjs`. No Meridian backlog task depends on it. Delete together with `mergeSongsAction`; `git` retains the history if a merge UI is ever specced. |
| `SpotifyToken` | `src/types/database.ts:64-72` | knip "Unused exported types". `grep -rn "\bSpotifyToken\b" src e2e scripts` → the declaration only. `src/lib/spotifyAuth.ts` does not use it. |

Deleting the four Server Actions also removes four unreachable Server Action endpoints from the
built bundle — a small attack-surface win on top of the cleanup.

### 3. Toast `'error'` variant — `src/app/bands/[id]/page.tsx`

The union has an `'error'` member no call site ever passes. Both `showToast` calls pass `"success"`
(lines 124 and ~259); the default parameter is `"success"`; error paths in this page use the inline
banner (`setError`, rendered at line 373), not the Toast. No e2e spec references the Toast
(`grep -rn "toast" e2e` → no hits). Remove the variant *and* the now-meaningless discriminator:

- state: `useState<{ message: string; type: "success" | "error" } | null>(null)` →
  `useState<{ message: string } | null>(null)`
- `function showToast(message: string, type: "success" | "error" = "success")` →
  `function showToast(message: string)`, body `setToast({ message })`
- both call sites drop the trailing `"success"` argument
- the render at ~line 702 drops the `toast.type === "error" ? … : …` template literal and uses the
  static success class string
  `"rounded-xl px-4 py-3 shadow-xl border flex items-center justify-between gap-3 text-xs font-semibold backdrop-blur-md bg-emerald-950/90 text-emerald-100 border-emerald-800"`.

The rendered success toast must look identical to `bd24bbc` (same classes, same message, same
dismiss button). This is a type/branch deletion only.

### 4. Dependencies to uninstall (3)

Run exactly:

```
npm uninstall mongodb @supabase/ssr @types/bcryptjs
```

`npm uninstall` (not a hand-edit of `package.json`) is mandatory: `Dockerfile:12` and
`.github/workflows/ci.yml:61` both run `npm ci`, which **hard-fails** with `EUSAGE` when
`package.json` and `package-lock.json` disagree. Regenerating the lock through npm is what keeps
those two green. (`vercel.json` uses `installCommand: "npm install"`, which is tolerant either way,
but must still see a consistent lock.) No `npm ci` invocation needs editing — only the lock content
changes.

| Dependency | Evidence |
|---|---|
| `mongodb` | knip + depcheck. Its only importers were `src/lib/mongodb.ts` and `seed.js`, both deleted above. |
| `@supabase/ssr` | knip + depcheck. `grep -rn "@supabase/ssr" src e2e scripts *.ts *.mjs docker*` → only the `package.json` line. Present since the initial commit (`b5b0019`), never imported. |
| `@types/bcryptjs` | knip "Unused devDependencies". `bcryptjs@3.0.3` ships its own declarations: `npx tsc --noEmit --traceResolution` shows `Module name 'bcryptjs' was successfully resolved to '…/node_modules/bcryptjs/index.d.ts'` — the `@types` package is only pulled in as an ambient *type reference directive* and describes the older v2 API. `npx tsc --noEmit` must still exit 0 after removal (acceptance criterion). |

### 5. Dead-code guard

- `npm install --save-dev --save-exact knip@6.34.0`.
- Commit `knip.json` at the repo root:

```json
{
  "$schema": "https://unpkg.com/knip@6/schema.json",
  "ignoreExportsUsedInFile": true,
  "ignoreDependencies": ["kysely", "webpack", "@sentry/browser", "@better-auth/utils"]
}
```

  - `ignoreExportsUsedInFile: true` suppresses the 7 "exported but only consumed inside its own
    module" findings (`openEditDialog`, `INSTRUMENT_LIST`, `parseTags`, `isSupportedLocale`,
    `checkSystemAdmin`, `BandContext`, `EditStatus`) — these are live code, not dead code.
  - `kysely` / `webpack` are deliberately-kept dependencies (see Out of Scope).
  - `@sentry/browser` / `@better-auth/utils` are knip "Unlisted dependencies": real imports resolved
    transitively. Declaring them properly is a separate change (logged in
    `docs/suggestions-log.md`), so they are ignored here rather than silently added.
- `package.json#scripts`: add `"lint:dead": "knip"`.
- `.github/workflows/ci.yml`: add a job alongside `build` and `e2e`:

```yaml
  dead-code:
    name: "Dead code (knip)"
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Node.js 24.x
        uses: actions/setup-node@v4
        with:
          node-version: "24.x"
          cache: "npm"
      - name: Install dependencies
        run: npm ci
      - name: Knip
        run: npm run lint:dead
```

`knip` exits non-zero on any finding, so the baseline is exact by construction: the job passes only
while the tree is clean. This was verified on the post-sweep scratch tree — the only remaining
report line was `Unlisted binaries (1) knip`, which disappears once `knip` is a real devDependency.

### 6. ESLint: ignore the generated coverage report

`coverage/` is gitignored but still linted, contributing the 20th (spurious) warning
(`coverage/block-navigation.js 1:1 Unused eslint-disable directive`) — already flagged in
`docs/suggestions-log.md` under RH-21. Add to `globalIgnores` in `eslint.config.mjs`, next to
`public/**`:

```js
    // Generated coverage report (gitignored) — not source.
    "coverage/**",
```

Verified: with a `coverage/` directory present, `npx eslint .` then reports exactly
`13 errors, 19 warnings` — the same totals as a clean checkout without `coverage/`.

### 7. Documentation updates

`AGENTS.md`:

- Rewrite the "Legacy/unused code to be aware of" paragraph (line 54): drop the `src/lib/mongodb.ts`
  and `src/types/index.ts` clause entirely (they no longer exist); keep the Supabase paragraph,
  which is still accurate (`supabase/config.toml`, `supabase/seed.sql`,
  `NEXT_PUBLIC_SUPABASE_*` are still live for the docker-compose stack and the vitest scaffolding).
- Directory tree: remove the `Sidebar.tsx` line (118), remove `SongCard` from the `songs/` line
  (117), remove the `mongodb.ts` line (133), and change the `types/` block so only `database.ts`
  remains (140).
- "Testing & quality": add a bullet for `knip` (`npm run lint:dead`, config in `knip.json`, enforced
  by the `dead-code` CI job).

`supabase/seed.sql:11`: change `run: npm run dev:seed-users` to `run: npm run seed` (the real script,
`scripts/dev-seed`, which creates Better Auth users + profiles).

`docs/suggestions-log.md`: append an `## [RH-22] Remover codigo morto do projeto — <date>` section
recording the deliberate non-deletions (phantom deps `@sentry/browser` / `@better-auth/utils`,
Supabase-era scaffolding in `src/lib/__tests__/spotify.test.ts`, `joinBandByInviteClient` /
`updatePersonalKey` kept alive only by tests).

### 8. Version bump

Per AGENTS.md, bump `package.json#version` above the highest used so far
(`0.1.62-202609030636`) — i.e. `0.1.63-<YYYYMMDDHHmm>` in local time. The version must only go up.

## Expected Results

- [ ] The 11 files listed in §1 no longer exist and are untracked.
- [ ] The 6 exports listed in §2 no longer appear anywhere under `src/` or `e2e/`.
- [ ] The Toast state in `src/app/bands/[id]/page.tsx` has no `'error'` variant and no `toast.type`.
- [ ] `mongodb`, `@supabase/ssr` and `@types/bcryptjs` are gone from `package.json` **and**
      `package-lock.json`, and `npm ci --dry-run` exits 0.
- [ ] `npm run lint:dead` exits 0; `knip.json` and the `dead-code` CI job are committed.
- [ ] `npx tsc --noEmit` exits 0.
- [ ] `npx vitest run` passes 25 files / 249 tests.
- [ ] `npx eslint .` reports exactly 13 errors and 19 warnings (all pre-existing; lint is not
      expected to exit 0).
- [ ] `npx next build` exits 0.
- [ ] AGENTS.md no longer references the deleted files; landing page and dictionaries unchanged.
- [ ] Version bumped above `0.1.62-202609030636`; diff vs `bd24bbc` stays inside the whitelist.

## Out of Scope — "looks unused, but keep, because…"

| Item | Reported by | Why it stays |
|---|---|---|
| `kysely` | knip + depcheck "Unused dependencies" | Named as a **string** in `next.config.ts:18` `serverExternalPackages: ["better-auth", "@better-auth/kysely-adapter", "kysely", "pg"]`, and used internally by Better Auth's adapter. Removing it would silently change server bundling. |
| `webpack` | knip + depcheck "Unused dependencies" | `git log -S'"webpack":' -- package.json` → commit `7360bfd` *"fix: add webpack as explicit dep to satisfy npm ci lock file check"*. It exists precisely to keep `npm ci` green; removing it re-opens a fixed bug. (`next dev --webpack` itself uses `next/dist/compiled/webpack`.) |
| `@supabase/supabase-js` | not flagged, but Supabase is dead in the app | Still imported by `src/lib/__tests__/setup.ts:5` (global `vi.mock`) and `src/lib/__tests__/spotify.test.ts:2,26` (`importActual`). Removing it breaks 12 passing tests. Retiring that Supabase-era test scaffolding is a separate task (logged). |
| `@tailwindcss/postcss`, `tailwindcss`, `@types/react-dom` | depcheck "Unused devDependencies" | depcheck false positives: `@tailwindcss/postcss` is referenced from `postcss.config.mjs`, Tailwind 4 is consumed through CSS `@import`, and React DOM types are required by TS. knip does not flag any of them. |
| `@sentry/browser`, `@better-auth/utils/password` | knip "Unlisted dependencies" | Real imports (`sentry.client.config.ts:2`, `src/lib/auth.ts:5`) resolved transitively. This is an *addition*, not a deletion — out of scope; logged as a follow-up. |
| `openEditDialog` (`e2e/helpers.ts:64`) | knip "Unused exports" | Called at `e2e/helpers.ts:76` inside the same module. Live code; only the `export` keyword is redundant. Covered by `ignoreExportsUsedInFile`. |
| `INSTRUMENT_LIST`, `parseTags`, `isSupportedLocale`, `checkSystemAdmin`, `BandContext`, `EditStatus` | knip "Unused exports"/"types" | Each is used inside its own module (`InstrumentPicker.tsx:65`, `SongForm.tsx:197,464`, `i18n.ts:52`, `moderation.ts:38,87`, `bandContextStore.ts:9`, `database.ts:55`). Deleting the `export` keyword is churn with no benefit. |
| `updatePersonalKey` (`src/lib/songs.ts:113`) | becomes action-less after §2 | Covered by 3 vitest tests (`songs.test.ts:181`, `errors.test.ts:211`, `edge_cases.test.ts:164`). Deleting it would shrink the pinned 249-test baseline; kept as domain API and logged. |
| `joinBandByInviteClient` (`src/lib/bands.ts:225`) | becomes action-less after §2 | Covered by `errors.test.ts` and `joinBandByInvite.test.ts` (the latter is RH-18's real-DB test). Same reasoning. |
| `supabase/seed.sql`, `supabase/config.toml` | look like Supabase leftovers | `supabase/seed.sql` is bind-mounted by `docker-compose.yml:30` into `/docker-entrypoint-initdb.d/`. Live infrastructure. |
| `NEXT_PUBLIC_SUPABASE_*` in `.env*` | look like leftovers | Read by `src/lib/__tests__/spotify.test.ts:6-8` to decide whether its suite runs. |
| `docs/superpowers/**`, `plan.md`, `spec.md`, `tasks.md`, `SDS.md`, `js_issues.json`, `docker_issues.json`, `run` | tracked, stale-looking | Documentation/tooling artefacts, not code. Pruning docs is a judgement call for a separate task, not a code sweep. |
| `src/store/repertoireStore.ts`, `src/components/layout/LanguageSelector.tsx` | lose a consumer when `Sidebar.tsx`/`SongCard.tsx` go | Both keep live consumers (`src/app/page.tsx`, `AppLayout.tsx`, `SongForm.tsx`; `LandingPage.tsx:52`). |

Also out of scope: RH-32 (`GET /` SSR 500 locally). This task is verified entirely by tooling —
**no browser-based acceptance criteria**.

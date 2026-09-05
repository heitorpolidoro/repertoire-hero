# RH-24 — Evaluate and improve the project's test coverage

One deliverable: a measured coverage assessment turned into (a) a widened, honest
coverage universe with an enforced threshold gate, (b) a first-ever DOM/component
test setup with five high-value tests, and (c) targeted logic tests that close the
worst gaps. Tests, test infrastructure, config, CI and docs only — no production
behaviour changes.

---

## 1. Measurement (real, on `0f2833b`)

Everything below was **re-measured on 2026-09-05** on the working tree at commit
`0f2833b` (the tip after RH-32 landed; the earlier revision of this spec was pinned to
`adef622`, which is now stale), with a live local Postgres (`DATABASE_URL` default
`postgresql://postgres:postgres@127.0.0.1:54322/postgres`) and
`SUPABASE_SERVICE_ROLE_KEY` set, so the six DB-backed integration files run instead of
skipping.

What RH-32 changed between `adef622` and `0f2833b`, and why every pin had to move:
added `src/lib/__tests__/serverExternalPackages.test.ts` (+2 tests) and
`e2e/ssr-smoke.spec.ts`; `playwright.config.ts` gained `PLAYWRIGHT_WEB_SERVER`;
`next.config.ts` no longer externalizes `better-auth`; `src/app/layout.tsx`'s comment
changed. Consequently `GET /` no longer SSR-500s under `next build && next start` —
that failure mode is fixed and must not be cited as a caveat anywhere in this task.

### 1.1 Suite

`npx vitest run` → **30 files / 281 tests passed, 0 skipped**, ~2.7s.
30 files = 29 in `src/lib/__tests__/` (+ `setup.ts`, `test-helpers.ts`, which are not
test files) and 1 in `src/app/actions/__tests__/tabs.test.ts`. **Zero `*.test.tsx`
files exist** — there is no component/DOM test infrastructure at all.

Six files are gated on a live database via `describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)`:
`bands.test.ts`, `joinBandByInvite.test.ts`, `playlists.test.ts`, `profile.test.ts`,
`songs.test.ts`, `spotify.test.ts`. Without the key/DB they skip 51 tests and the
files themselves error out. This is why every coverage number in this spec carries
that precondition.

Beyond the classic unit tests, the suite already contains six *guard* tests that
assert on config/source text rather than behaviour, and they are cheap and effective:
`errorHandlingStyle.test.ts` (the `catch (x: any)` / `console.error` ban),
`noBrowserDialogs.test.ts`, `migrationsSingleSource.test.ts`, `pdfWorkerAsset.test.ts`,
`landingCopy.test.ts`, and (new in RH-32) `serverExternalPackages.test.ts`. That
pattern stays.

### 1.2 Coverage as currently configured — the number is not what it looks like

`npx vitest run --coverage` prints:

```
All files          |   91.79 |    70.63 |   96.05 |   94.02
Statements: 91.79% (593/646)   Branches: 70.63% (279/395)
Functions : 96.05% (73/76)     Lines    : 94.02% (567/603)
```

That 91.79% is measured over **646 statements**, because `vitest.config.ts`
`coverage.exclude` removes `src/app/**`, `src/components/**`, `src/store/**`,
`src/types/**`, `src/lib/spotify*.ts`, `src/lib/logger.ts`, plus two paths that no
longer exist (`src/lib/supabase/**`, `src/lib/mongodb.ts`). The whole Server Action
layer, every route handler, both hooks and every component are outside the
denominator. The exclusion list also *hides real coverage*: `spotify.test.ts` (27.6K)
and `spotifyPlaylistSync.test.ts` (8K) do cover `src/lib/spotify*.ts`, but the glob
suppresses it.

Two more measured facts about the reporter, both of which matter for verification:
- The `text` reporter **omits files at 100% on every metric**. `annotationMath.ts`,
  `bandAdminLoad.ts`, `filterSongs.ts`, `sqlUpdate.ts`, `stageInteraction.ts`,
  `statusConfig.ts`, `uiTones.ts` are all at 100% and simply do not appear in the
  table. Per-file verification in this spec therefore uses `json-summary`.
- `src/i18n/dictionaries/*.json` appear in the report as 100% (they are imported by
  `landingCopy.test.ts`); they are noise, not coverage.

### 1.3 Coverage over the real logic surface

Re-measured with the stale excludes removed and the untested layers added
(`src/lib/**/*.ts`, `src/app/actions/*.ts`, `src/app/api/**/*.ts`, `src/proxy.ts`,
`src/hooks/**/*.ts`):

```
TOTAL   Statements 55.67%   Branches 45.00%   Functions 46.39%   Lines 56.30%
```

(Unchanged from `adef622` — RH-32 added only a guard test, which covers no new
statements in this universe.)

Per file, grouped by what it says:

**Zero coverage, real logic:**

| File | Stmts | Note |
|---|---|---|
| `src/hooks/useBandAdmin.ts` | 0% (138 stmts) | 345-line controller shared by `/bands/[id]` **and** `/profile`; owns load policy, edit-save, destructive confirmations, playlist creation |
| `src/app/actions/repertoire.ts` | 0% (71) | owner resolution, lyrics SQL, link auto-labelling, personal-entry lookup |
| `src/app/actions/bands.ts` | 0% (32) | incl. `uploadBandCoverAction` (Vercel Blob) |
| `src/app/actions/playlists.ts` | 0% (21) | |
| `src/app/actions/profile.ts` / `moderation.ts` | 0% (7 + 7) | A2 thin actions |
| `src/lib/bandColors.ts` | 0% (23) | pure luminance/contrast math |
| `src/lib/imageCompressor.ts` | 0% (34) | needs `Image`/`canvas` |
| `src/hooks/useToast.ts` | 0% (13) | 4s auto-dismiss timer |
| `src/lib/auth*.ts`, `pdfWorker.ts` | 0% (24) | third-party wiring |

**Zero coverage, route handlers:** `spotify/callback` (47), `spotify/search` (38),
`spotify/playlists` (17), `authorize` (15), `dev/profiles` (12), `tracks` (11),
`disconnect` (8), `auth/[...all]` (1). Note `spotify/playlists/[id]/import` (92.1%)
and `.../sync` (90.41%) *are* covered, via `spotify.test.ts`.

**Partial:** `src/app/actions/tabs.ts` 36.36%, `src/lib/logger.ts` 38.46%,
`src/lib/profile.ts` 70.45% (B 60 / F 66.66), `src/lib/spotifyRouteAuth.ts` 71.42%,
`src/lib/songSanitizer.ts` 75% (B 50), `src/lib/moderation.ts` 84%,
`src/lib/spotifyAuth.ts` 84.37%, `src/lib/db.ts` 87.5%, `src/lib/bands.ts` 88.28%
(B 54), `src/lib/playlists.ts` 93.42% (B 61.11), `src/lib/songs.ts` 100% stmts but
B 70.19, `src/proxy.ts` 96.42%.

**`.tsx` is 0% by construction** — 11,784 lines of components and pages, no
`*.test.tsx` file in the repo.

### 1.4 Other measured baselines at `0f2833b`

- `npx tsc --noEmit` → exit 0, `TypeScript: No errors found`.
- `npx eslint .` → **12 errors, 18 warnings** (pre-existing). Lint is never required to exit 0.
- `npm run lint:dead` (knip) → exit 0.
- `npm run lint:dup` (jscpd) → exit 0; 19 clones, **239 duplicated lines (1.19%)**,
  1428 duplicated tokens (1.37%), threshold 2. jscpd scans `src`, so *new test files
  count*. Headroom is 0.8 points — repetitive copy-pasted test blocks can break the gate.
- `npx next build` → exit 0. Since RH-32, `GET /` also renders under
  `next build && next start` rather than SSR-500ing; RH-24 must not regress that, and
  must not repeat the old caveat. (`next dev` may still behave differently; the
  production build is the pinned baseline.)
- Highest version used: `0.1.65-202609051646` (this is `package.json`'s current value).

---

## 2. Decisions

### D1 — Widen the coverage universe to the logic layer, and gate it

The current 91.73% is a comfortable number over a hand-picked denominator. Replace
the exclude-only config with an explicit `coverage.include` over the code that is
*supposed* to be unit-testable, and put a threshold gate on it:

```
include: src/lib/**/*.ts, src/app/actions/*.ts, src/hooks/**/*.ts, src/proxy.ts
exclude: **/__tests__/**,
         src/lib/auth.ts, src/lib/auth-client.ts, src/lib/auth-session.ts,   # better-auth wiring, exercised by e2e
         src/lib/logger.ts,                                                  # Sentry shim
         src/lib/pdfWorker.ts,                                               # asset-path shim, guarded by pdfWorkerAsset.test.ts
         src/lib/imageCompressor.ts                                          # needs canvas/Image; covered by manual QA + e2e
```

Measured baseline of exactly that universe on `0f2833b`:
**Statements 62.68% · Branches 53.17% · Functions 53.12% · Lines 63.72%**
(reproduced on 2026-09-05 via `npx vitest run --coverage` with the include/exclude
lists above passed as `--coverage.include` / `--coverage.exclude` flags).

That is the honest starting point this task must improve on, and the number the gate
protects afterwards.

### D2 — Yes to component testing; five tests; docblock environment, not a second project

**Prototyped on this tree and confirmed working** (deps installed with `--no-save`,
probe tests written, run, then removed; `package.json`/`package-lock.json` were left
untouched and `npm ci` restored `node_modules`):

- `environmentMatchGlobs` **does not exist in Vitest 4** (the project is on 4.1.6;
  the option is absent from `node_modules/vitest` types). Do not use it.
- A **per-file `// @vitest-environment jsdom` docblock** works with **zero changes to
  `vitest.config.ts`**: the default `include` already matches `*.test.tsx`, the root
  `setupFiles` (`src/lib/__tests__/setup.ts`, a `@supabase/supabase-js` mock) runs
  fine under jsdom, and the existing `@vitejs/plugin-react` handles JSX. This is
  cheaper and less invasive than `test.projects`, so it is the chosen mechanism.
- Cost is three devDependencies: `jsdom` (^29), `@testing-library/react` (^16.3),
  `@testing-library/dom` (^10.4, RTL's peer). React 19.2 + RTL 16.3 works.
- Because `globals: false`, RTL's automatic cleanup does **not** self-register. Every
  `*.test.tsx` must do `import { cleanup } from '@testing-library/react'` and
  `afterEach(cleanup)` explicitly.
- The React Compiler babel plugin (`reactCompiler: true` in `next.config.ts`) is
  **not** applied by `@vitejs/plugin-react` in tests. Component tests exercise the
  source semantics, not the compiled output. That is acceptable and must be stated
  in AGENTS.md so nobody reads a green DOM test as a statement about the compiled bundle.
- `npm run lint:dead` was re-run with the three devDependencies present in
  `package.json` and **exited 0** — knip does not flag `jsdom` or
  `@testing-library/dom` even though neither is imported directly. No `knip.json`
  change is needed.

Probes that were written and **passed on the first run** (so the five tests below are
known-feasible, not hoped-for):

- `ConfirmPanel` under jsdom: `role="alertdialog"` present, `Cancel` focused on
  mount, `keyDown Escape` on `document` calls `onCancel`, `busy` renders `Delete...`
  and disables the confirm button.
- `useToast` via `renderHook` + `vi.useFakeTimers()`: still set at 3999ms, `null` at 4000ms.
- `useBandAdmin` via `renderHook` with `vi.mock('@/app/actions/bands')`,
  `vi.mock('@/lib/auth-client')`, `vi.mock('@/lib/imageCompressor')`: load success,
  `BAND_PROFILE_LOAD_POLICY` error branch, `BANDS_PAGE_LOAD_POLICY` not-found branch,
  `removeMember` confirm flow.
- `join/[code]` **async Server Component**: awaiting the component and rendering the
  returned element works, including `next/link` and `next/image`, with
  `@/lib/bands.server` and `@/lib/auth-session` mocked. All five branches reachable.

### D3 — Route handlers stay out of the gate (accepted risk, logged)

`src/app/api/**` is *not* added to `coverage.include`. Rationale: the two handlers
with real orchestration logic (`playlists/[id]/import`, `.../sync`) are already at
~90% through `spotify.test.ts`; the shared authorization helper
`src/lib/spotifyRouteAuth.ts` **is** inside the gate; the rest are thin
`NextResponse` wrappers whose failure mode is an HTTP status, which the e2e suite and
manual QA already exercise. Pulling them in now would add ~150 uncovered statements
and force a round of `NextRequest`/cookie plumbing that is a task of its own. The
one genuinely risky file — the Spotify OAuth **callback** (state parameter, cookie
handling, 47 statements at 0%) — is recorded in `docs/suggestions-log.md` as a
follow-up so it is not silently dropped.

### D4 — What stays on manual QA / e2e, permanently

- **Stage Mode canvas rendering and pinch/zoom gestures** (`TabDrawingStage.tsx`,
  817 lines). jsdom has no canvas and no multi-touch; a jsdom test here would assert
  on mocks. The *decisions* underneath it are already extracted and at **100%**
  (`annotationMath.ts`, `stageInteraction.ts`, plus the `erasePersistence.test.ts`
  source guard). No new test; the extraction pattern is the right answer and is
  already applied.
- **Page-level `.tsx`** (`playlists/[id]` 1344 lines, `fast-view` 1586, `page.tsx`
  626, `profile` 721, `SongForm` 575). These stay out of `coverage.include`; they are
  covered by Playwright and manual QA. Adding them to the denominator would produce
  a number nobody can move and the gate would become meaningless.
- **`imageCompressor.ts`** — `Image`/`canvas`-dependent, excluded with a comment.

### D5 — Landing Page Rule

RH-24 ships **no user-facing feature**. Test infrastructure, coverage thresholds and
CI wiring are internal/operational, exactly the category AGENTS.md says must *not*
reach the landing page. **`src/components/landing/LandingPage.tsx` and the `landing.*`
keys in `src/i18n/dictionaries/en.json` and `pt-BR.json` must not change.**

---

## 3. Scope

**In scope:** new test files; three test devDependencies; `vitest.config.ts` coverage
universe + thresholds; a `test:coverage` npm script; a `coverage` job in
`.github/workflows/ci.yml`; the AGENTS.md "Testing & quality" bullet list; a
`docs/suggestions-log.md` entry; superseding note in `docs/test-coverage-plan.md`;
the version bump.

**Not in scope:** any change to production behaviour. No file under `src/` other than
new `__tests__/` files may change. The prototypes proved that every target is
testable **as written** — no `export`-for-testing refactor, no dependency injection,
no seam-opening is required. If the implementer nonetheless finds one strictly
necessary, it must be named in the PR description and be behaviour-preserving.

---

## 4. Approach

### 4.1 `vitest.config.ts`

Replace the `coverage` block with:

```ts
coverage: {
  include: [
    'src/lib/**/*.ts',
    'src/app/actions/*.ts',
    'src/hooks/**/*.ts',
    'src/proxy.ts',
  ],
  exclude: [
    '**/__tests__/**',
    // better-auth wiring — configuration, not logic; exercised end-to-end by Playwright.
    'src/lib/auth.ts',
    'src/lib/auth-client.ts',
    'src/lib/auth-session.ts',
    // Sentry/console shim.
    'src/lib/logger.ts',
    // Asset-path shim; guarded by src/lib/__tests__/pdfWorkerAsset.test.ts.
    'src/lib/pdfWorker.ts',
    // Needs canvas/Image; verified by e2e + manual QA (see docs/tasks/RH-24-spec.md D4).
    'src/lib/imageCompressor.ts',
  ],
  thresholds: {
    statements: 80,
    branches: 65,
    functions: 78,
    lines: 80,
  },
},
```

Nothing else in `vitest.config.ts` changes — in particular `environment: 'node'` and
`setupFiles` stay, because the DOM tests select jsdom per file.

### 4.2 New logic tests (node environment, `*.test.ts`)

Mock at the module boundary, following the existing `src/app/actions/__tests__/tabs.test.ts`
pattern (`vi.mock('@/lib/db')`, `vi.mock('@/lib/auth-session')`), plus
`vi.mock('next/cache')` for `revalidatePath`.

1. `src/app/actions/__tests__/repertoire.test.ts` — **≥ 10 tests** — the owner-resolution fork
   (`bandId` → `{ bandId }`, absent/null → `{ userId }`) across the delegating
   actions; `updateLyricsAction` emitting the `band_id` vs `user_id` UPDATE;
   `fetchLyricsAction` ok / `!res.ok` / thrown-fetch → `null`; `updateSongLinksAction`
   resolving via `repertoire` first, falling back to `global_songs`, throwing
   `Song entry not found`, and auto-labelling a blank-label link through
   `fetchUrlTitle`; `getPersonalEntryForSongAction` found / `rowCount === 0` / throw → `null`.
2. `src/app/actions/__tests__/bands.test.ts` — **≥ 4 tests** — delegation with the resolved session
   user id, and `uploadBandCoverAction`'s result envelope (A1) on success and failure.
3. `src/app/actions/__tests__/playlists.test.ts` — **≥ 4 tests** — delegation, plus the branching in
   `getPlaylistDetailsWithEntriesAction` / `getPlaylistEntryIdsAction`.
4. `src/app/actions/__tests__/thinActions.test.ts` — **≥ 4 tests** — `profile.ts` and `moderation.ts`:
   assert they pass the session user id through and, per convention A2, that a
   rejection from `src/lib` **propagates** rather than being converted into an envelope.
5. `src/lib/__tests__/bandColors.test.ts` — **≥ 6 tests** — `getContrastTextColor` (null, 3-digit hex,
   6-digit hex, malformed length, the brightness>140 boundary both ways) and
   `getBandThemeStyles` (non-`#` input falling back to `DEFAULT_BAND_COLOR`).
6. Extend `src/lib/__tests__/profile.test.ts` and `songSanitizer.test.ts` with
   non-DB cases closing their measured gaps (`profile.ts` lines 38–39 and the
   `updateEmail` BEGIN/COMMIT/ROLLBACK path 72–81; `songSanitizer.ts` lines 13, 21).

**Duplication guard:** these action tests are structurally repetitive and jscpd has
only 0.8 points of headroom. Use `it.each` / table-driven cases over a single shared
assertion body rather than copy-pasted blocks.

### 4.3 New DOM tests (jsdom via docblock, `*.test.tsx`)

Every file starts with `// @vitest-environment jsdom` on line 1 and registers
`afterEach(cleanup)`.

1. `src/components/ui/__tests__/ConfirmPanel.test.tsx` — **≥ 6 tests** — a11y role, focus-lands-on-Cancel,
   Escape cancels, Escape is inert while `busy`, busy label + disabled buttons,
   `danger` vs `warning` tone classes.
2. `src/hooks/__tests__/useToast.test.tsx` — **≥ 5 tests** — `showToast` default tone `info`,
   explicit tone, auto-dismiss at exactly 4000ms with fake timers, `dismissToast`,
   timer cleared when the toast is replaced.
3. `src/hooks/__tests__/useBandAdmin.test.tsx` — **≥ 4 tests** — both load policies against
   `BANDS_PAGE_LOAD_POLICY` / `BAND_PROFILE_LOAD_POLICY` (not-found → `onNotFound`,
   `clearLoadingOnNotFound` true vs false; failure → error banner vs propagation),
   `isAdmin` derivation from the session user, `inviteUrl`, the `removeMember`
   confirm flow (member dropped from state + success toast), and `handleSaveEdit`
   surfacing an upload error without closing the modal.
4. `src/app/join/__tests__/joinPage.test.tsx` — **≥ 5 tests** — all five branches of
   `src/app/join/[code]/page.tsx`: lookup failure → "Something went wrong" + "Try again"
   href, unknown code → "Invalid invite link", anonymous → sign-in link carrying
   `?redirect=%2Fjoin%2F<code>`, `joined=already` interstitial, `error=technical` banner.
   Place the file under `src/app/join/__tests__/` (not inside `[code]/`) so no glob
   has to cope with literal brackets — verified working.
5. `src/components/ui/__tests__/feedbackSurfaces.test.tsx` — **≥ 3 tests** — `Toast` renders the
   `TOAST_TONE_CLASSES` entry that `uiTones.test.ts` only pins as a string, and its
   dismiss control fires the callback; `AlertBanner` renders its message and tone.

### 4.4 Test-count arithmetic (this is what ER1 and ER2 pin)

Ten new files; the per-file minima above sum to
`10 + 4 + 4 + 4 + 6 + 6 + 5 + 4 + 5 + 3 = 51` new tests. Against the `0f2833b`
baseline of 30 files / 281 tests that gives the floors **≥ 40 test files** and
**≥ 332 tests**. The two *extended* files (§4.2 item 6) add further tests on top and
are therefore headroom, not part of the 51.

### 4.5 Scripts and CI

`package.json`: add `"test:coverage": "vitest run --coverage"`.

`.github/workflows/ci.yml`: add a `coverage` job alongside `dead-code` and
`duplication`. Because six test files need a real database, it must copy the
**`e2e` job's** database setup (a `postgres:16` service on 5432 with the same
health-check options, `DATABASE_URL` env, `npm ci`, `npm run db:migrate`) and add
`SUPABASE_SERVICE_ROLE_KEY` with a non-empty value so the integration `describe`s
run instead of skipping. Final step: `npm run test:coverage`.

### 4.6 Docs

- **AGENTS.md → "Testing & quality"**: node is the default environment; `*.test.tsx`
  opt into jsdom with a first-line `// @vitest-environment jsdom` docblock;
  `@testing-library/react` with mandatory explicit `afterEach(cleanup)` because
  `globals: false`; the React Compiler is not applied in tests; the coverage universe
  and thresholds and what deliberately sits outside them (pages/components/route
  handlers → Playwright + manual QA); `npm run test:coverage` and the CI job; the
  live-Postgres + `SUPABASE_SERVICE_ROLE_KEY` precondition for the full suite.
- **`docs/test-coverage-plan.md`**: prepend a note that it is superseded by this
  spec (its exclusion table still refers to `src/lib/supabase/**` and
  `src/lib/mongodb.ts`, which no longer exist).
- **`docs/suggestions-log.md`**: log the deferred items — Spotify OAuth callback
  route untested (47 statements, security-relevant), `src/app/api/**` outside the
  gate, `imageCompressor.ts` untestable without canvas, and the jscpd headroom of
  0.8 points.

---

## 5. Expected Results

These are character-for-character the Meridian task's `expected_results` for RH-24
(the `- ` bullet prefix aside). QA receives only this list, so each item is
self-contained and mechanically checkable. Every commit pin below is `0f2833b`.

- ER1 - Precondition for every test/coverage result below: a local PostgreSQL reachable at DATABASE_URL (default postgresql://postgres:postgres@127.0.0.1:54322/postgres) with npm run db:migrate applied, and a non-empty SUPABASE_SERVICE_ROLE_KEY in the environment or in .env.local/.env.development.local; without it 51 DB-backed tests skip and 6 test files error. With that in place, npx vitest run exits 0 and its summary reports at least 40 test files passed and at least 332 tests passed, with 0 failed and 0 skipped. Baseline at commit 0f2833b was exactly 30 files / 281 tests passed and 0 skipped.
- ER2 - These ten files exist and all pass: npx vitest run src/app/actions/__tests__/repertoire.test.ts src/app/actions/__tests__/bands.test.ts src/app/actions/__tests__/playlists.test.ts src/app/actions/__tests__/thinActions.test.ts src/lib/__tests__/bandColors.test.ts src/components/ui/__tests__/ConfirmPanel.test.tsx src/components/ui/__tests__/feedbackSurfaces.test.tsx src/hooks/__tests__/useToast.test.tsx src/hooks/__tests__/useBandAdmin.test.tsx src/app/join/__tests__/joinPage.test.tsx exits 0 and reports 10 test files passed and at least 51 tests passed, each file meeting its own floor: repertoire >= 10, bands >= 4, playlists >= 4, thinActions >= 4, bandColors >= 6, ConfirmPanel >= 6, feedbackSurfaces >= 3, useToast >= 5, useBandAdmin >= 4, joinPage >= 5 (10+4+4+4+6+6+3+5+4+5 = 51, which is where ER1's 332 = 281 + 51 comes from). Additionally git diff --stat 0f2833b..HEAD -- src/lib/__tests__/profile.test.ts src/lib/__tests__/songSanitizer.test.ts shows both files gained lines.
- ER3 - git diff 0f2833b..HEAD -- package.json shows exactly three added dependency entries, all in devDependencies: jsdom, @testing-library/react, @testing-library/dom, and no removed or otherwise changed dependency entry. package-lock.json is also modified, and npm ci && npx vitest run exits 0.
- ER4 - Every DOM test file opts into jsdom explicitly: for each file listed by git ls-files 'src/**/*.test.tsx' (at least 5 files), head -1 <file> prints exactly // @vitest-environment jsdom. Each such file also contains the literal string afterEach(cleanup) (mandatory because vitest.config.ts sets globals: false, which disables Testing Library auto-cleanup). grep -rn environmentMatchGlobs vitest.config.ts prints nothing.
- ER5 - vitest.config.ts declares coverage.include with exactly these four globs and nothing else: src/lib/**/*.ts, src/app/actions/*.ts, src/hooks/**/*.ts, src/proxy.ts; coverage.exclude contains exactly these seven entries: **/__tests__/**, src/lib/auth.ts, src/lib/auth-client.ts, src/lib/auth-session.ts, src/lib/logger.ts, src/lib/pdfWorker.ts, src/lib/imageCompressor.ts; and coverage.thresholds is exactly { statements: 80, branches: 65, functions: 78, lines: 80 }. The obsolete globs src/lib/supabase/**, src/lib/mongodb.ts, src/lib/spotify*.ts, src/app/**, src/components/**, src/store/**, src/types/** no longer appear anywhere in the file.
- ER6 - package.json has the script "test:coverage": "vitest run --coverage", and npm run test:coverage exits 0 (it exits non-zero if any threshold in ER5 is unmet). Running npx vitest run --coverage --coverage.reporter=json-summary --coverage.reportsDirectory=/tmp/rh24-cov then node -e "const t=require('/tmp/rh24-cov/coverage-summary.json').total;console.log(t.statements.pct,t.branches.pct,t.functions.pct,t.lines.pct)" prints statements >= 80, branches >= 65, functions >= 78, lines >= 80. Baseline over the identical universe at 0f2833b was 62.68 / 53.17 / 53.12 / 63.72.
- ER7 - From the same /tmp/rh24-cov/coverage-summary.json (per-file statements.pct; the text reporter must NOT be used because it silently omits files at 100%), these floors hold, with the 0f2833b value in parentheses: src/app/actions/repertoire.ts >= 80 (was 0), src/app/actions/bands.ts >= 80 (was 0), src/app/actions/playlists.ts >= 80 (was 0), src/app/actions/profile.ts >= 80 (was 0), src/app/actions/moderation.ts >= 80 (was 0), src/lib/bandColors.ts >= 90 (was 0), src/hooks/useToast.ts == 100 (was 0), src/hooks/useBandAdmin.ts >= 60 (was 0), src/lib/profile.ts >= 85 (was 70.45), src/lib/songSanitizer.ts >= 90 (was 75).
- ER8 - The gate is really enforced: npx vitest run --coverage --coverage.thresholds.statements=100 exits 1 and its output contains the line ERROR: Coverage for statements ( followed by ) does not meet global threshold (100%). This exact behaviour was verified on 0f2833b, where the printed line was ERROR: Coverage for statements (91.79%) does not meet global threshold (100%).
- ER9 - .github/workflows/ci.yml contains a new job (sibling of the existing dead-code and duplication jobs) that runs npm run test:coverage as its final step, and that job declares a postgres:16 service, a DATABASE_URL env var pointing at it, a non-empty SUPABASE_SERVICE_ROLE_KEY env var, and a step running npm run db:migrate before the coverage step. npx js-yaml .github/workflows/ci.yml > /dev/null (or any YAML parser) exits 0.
- ER10 - The "Testing & quality" section of AGENTS.md contains all of these literal strings: @vitest-environment jsdom, @testing-library/react, afterEach(cleanup), npm run test:coverage, 80, 65, 78, plus a sentence stating that page-level components and src/app/api/** route handlers are deliberately outside the coverage gate and are verified by Playwright/manual QA, and a sentence stating that the React Compiler babel plugin is not applied in vitest runs.
- ER11 - Static gates unchanged or better: npx tsc --noEmit exits 0 with no error output; npm run lint:dead exits 0; npm run lint:dup exits 0 and its Total row reports duplicated lines strictly below 2.00% (baseline at 0f2833b: 19 clones, 239 lines, 1.19%); npx eslint . reports at most 12 errors and at most 18 warnings (exactly the 0f2833b baseline - eslint is NOT required to exit 0); npx next build exits 0.
- ER12 - git diff --name-only 0f2833b..HEAD lists only paths from this whitelist and nothing else: docs/tasks/RH-24-spec.md, docs/suggestions-log.md, docs/test-coverage-plan.md, AGENTS.md, package.json, package-lock.json, vitest.config.ts, .github/workflows/ci.yml, and files whose path matches src/**/__tests__/**. In particular no production file under src/ outside a __tests__/ directory is modified.
- ER13 - git diff 0f2833b..HEAD -- src/components/landing/LandingPage.tsx src/i18n/dictionaries/en.json src/i18n/dictionaries/pt-BR.json produces empty output. RH-24 is internal test infrastructure, not a selling point, so per the AGENTS.md Landing Page Rule the landing copy must be untouched.
- ER14 - The version field in package.json matches the regular expression ^0\.1\.(6[6-9]|[7-9][0-9])-[0-9]{12}$ and is strictly greater than the version at 0f2833b, which is 0.1.65-202609051646.
- ER15 - docs/suggestions-log.md gained a section mentioning RH-24 that records at least these deferred items: the Spotify OAuth callback route src/app/api/auth/spotify/callback/route.ts being at 0% statement coverage while handling OAuth state/cookies, src/app/api/** remaining outside the coverage gate, and src/lib/imageCompressor.ts being excluded because it needs canvas/Image.

---

## 6. Out of Scope

- Any production-code change (see §3).
- Tests for `src/app/api/**` route handlers beyond what `spotify.test.ts` already covers (D3).
- Component tests for `TabDrawingStage.tsx`, `SongForm.tsx`, `AppLayout.tsx`,
  `LandingPage.tsx` or any page-level `.tsx` (D4).
- New Playwright specs, or any change to `e2e/`.
- Fixing the 12 pre-existing eslint errors / 18 warnings.
- Raising SonarCloud/DeepSource configuration to match the new thresholds.

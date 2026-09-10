# RH-72 — E2E job still red on master: fast-view mobile fails, auth test flaky

Baseline for every measurement in this document: `c8fffd1`
(`feat: complete RH-27 ... bump to v0.1.49`, package version
`0.1.99-202609092308`), CI run `34429486831`, job report downloaded from that
run (`20 passed, 1 flaky, 1 failed`).

## Scope

Make the `E2E Tests (Playwright)` job deterministic by removing the two causes
the CI report actually shows: the Fast View route crashes on the client under
the **webpack** dev bundler that `npm run dev` forces, and `e2e/auth.spec.ts`
cannot spend the retry budget RH-44 gave it because that budget equals the
per-test timeout.

This task changes the `dev` script in `package.json`, two files under `e2e/`, one
new guard test under `src/lib/__tests__/`, and the two AGENTS.md sentences that
describe the dev bundler. No application code under `src/` changes, no
`next.config.ts`, no `playwright.config.ts`, no `.github/workflows/ci.yml`.

## Audit at c8fffd1

### The CI job does not test a production build — it runs `npm run dev`

`.github/workflows/ci.yml` sets no `PLAYWRIGHT_WEB_SERVER`, so
`playwright.config.ts`'s `webServer.command` falls back to `npm run dev`, which
is `next dev --webpack --hostname 127.0.0.1`. The downloaded trace confirms it:
the failing page opened a `ws://127.0.0.1:3000/_next/hmr` socket, posted to
`/__nextjs_original-stack-frames`, rendered the "Open Next.js Dev Tools" button
and called `/api/dev/profiles` (the dev-only Fast Login endpoint). Next.js 16
defaults both `next dev` and `next build` to Turbopack — `--webpack` is an
opt-in flag on both — so `npm run build`, Vercel and the local
`PLAYWRIGHT_WEB_SERVER="npx next start ..."` runs all use Turbopack, and this
one script is the only webpack surface left in the repository. It was added on
2026-06-04 by `a9b0990` as a workaround for a Turbopack HMR websocket problem
at `127.0.0.1`; that workaround is obsolete (see ER1).

### (1) Fast View dies on the client under webpack dev — deterministic, not timing

The failure is not a slow heading and not a missing `<h1>`. Every attempt in CI
captured the same aria snapshot: Next.js's client error shell (one level-1
heading with a generic load-failure message plus `Reload` and `Back` buttons),
so `getByRole('heading').filter({ hasText: songTitle })` genuinely has nothing
to match. `src/components/fastview/SongIdentityHeader.tsx:24` does render the
title as `<h1>`, so the assertion at `e2e/fast-view-mobile.spec.ts:104` is
correct as written.

The trace carries the cause as a `pageError`:

```
TypeError: Object.defineProperty called on non-object
  at __webpack_require__.r (webpack.js:256)
  at ./node_modules/pdfjs-dist/build/pdf.mjs
  at ./node_modules/react-pdf/dist/Document.js
  at ./src/components/tabs/TabDrawingStage.tsx
  at ./src/components/fastview/PdfStageOverlay.tsx
  at ./src/components/fastview/FastViewOverlays.tsx
  at ./src/app/songs/[id]/fast-view/page.tsx
```

`pdfjs-dist`'s ESM build fails to evaluate under Next 16's webpack dev runtime,
and because the Fast View page imports `FastViewOverlays` eagerly, that failure
takes down the whole route's client module graph before the page ever renders.

Reproduced locally at `c8fffd1`, with no CPU throttling and no CI emulation:
`npx playwright test --workers=1` against the default web server (`npm run dev`)
gives `1 failed, 21 passed (1.3m)`, the failure being exactly this test, and the
server log carries `[browser] Uncaught TypeError: Object.defineProperty called
on non-object` pointing at `pdf.mjs`. The identical command with
`PLAYWRIGHT_WEB_SERVER="npx next dev --hostname 127.0.0.1 -p 3000"` (same dev
server, Turbopack instead of webpack) gives `22 passed (30.4s)`, twice in a row,
and `--repeat-each=5` on the mobile spec gives `15 passed`. That is the whole
delta: the bundler.

### (2) The auth flake is a retry budget that can never be spent

Not the rate limiter. Better Auth enables its limiter only outside development,
and the CI server is a dev server; the recorded attempt answered
`POST /api/auth/sign-in/email` with `200` in 129 ms. What the failed first
attempt shows is `Test timeout of 30000ms exceeded` with
`14 x unexpected value "http://127.0.0.1:3000/login?redirect=%2Fprofile"`: the
`toPass({ timeout: 30_000 })` wrapper in `signInAndLandOn`
(`e2e/auth.spec.ts:50-58`) is exactly as large as `playwright.config.ts`'s
`timeout: 30_000`, and the test also spends up to 8 s before it on
`goto`/`waitForURL`, so the test always dies before the retry loop reaches its
budget. On a cold dev server the login route compiles on demand and the submit
button is inert until hydration, which is what the loop was written to absorb —
it simply is not allowed to. `e2e/fast-view-mobile.spec.ts:38` already carries
the fix shape (`test.describe.configure({ timeout: 90_000 })`) for the same
reason.

## Approach

**A. Stop forcing the webpack dev bundler.** Drop `--webpack` from the `dev`
script in `package.json`, keeping `--hostname 127.0.0.1`. This aligns the dev
server with `next build`, Vercel and the production-build e2e runs, fixes Fast
View for anyone running `npm run dev` (it is unusable there today), and makes
the CI job green. The HMR reason `a9b0990` cited no longer applies: measured at
`c8fffd1`, `npx next dev --hostname 127.0.0.1` reports
`Next.js 16.3.4 (Turbopack)`, `Ready in 310ms`, and a browser at
`http://127.0.0.1:3000/login` opens `ws://127.0.0.1:3000/_next/hmr` and logs
`[HMR] connected` followed by `[Fast Refresh] done`.

**B. Pin the invariant with a guard test.** Add one vitest file under
`src/lib/__tests__/` that reads `package.json` and fails if the `dev` script
selects the webpack bundler, carrying the `pdfjs-dist` crash in its comment.
This is the same shape as `src/lib/__tests__/serverExternalPackages.test.ts`,
which guards the RH-32 `next.config.ts` invariant, and it is the only new file
under `src/`.

**C. Let the auth retry loop finish.** Give `e2e/auth.spec.ts` a per-test
timeout strictly larger than the pre-login navigation budget plus the 30 s
`toPass` budget — `test.describe.configure({ timeout: 90_000 })` at the top of
the file, mirroring `e2e/fast-view-mobile.spec.ts:38` — with a comment saying
why. Nothing else in the file changes: the retry wrapper, the destination
assertions and the four test names stay.

**D. Give the fast-view heading assertion an honest load budget.** The
assertion at `e2e/fast-view-mobile.spec.ts:104` runs on the default 5 s expect
timeout, but it is reached right after a client navigation that is followed by
`useSongEntry`'s fetch. Give it an explicit timeout of at least 15 s with a
one-line comment. This is a budget, not a sleep: no `waitForTimeout` and no
extra `retries` are introduced anywhere.

### Whitelist

Required:

```
AGENTS.md
docs/tasks/RH-72-spec.md
e2e/auth.spec.ts
e2e/fast-view-mobile.spec.ts
package.json
src/lib/__tests__/<guard>.test.ts
```

Permitted but not required, and nothing else:

```
docs/suggestions-log.md
```

**Landing Page Rule decision.** This task ships no user-facing capability — it
repairs the dev bundler and two tests. The landing copy must not change; ER8
asserts it mechanically.

**Version.** Bump `package.json` to `0.1.100-YYYYMMDDHHmm` with a real local
timestamp, from `0.1.99-202609092308`. `0.1.100` sorts above `0.1.99` under
semver, which compares the patch field numerically (100 > 99); nothing in the
repository compares versions as strings — `package.json`'s version is read once
in `next.config.ts` into `NEXT_PUBLIC_APP_VERSION` and only ever rendered
(`src/components/layout/AppLayout.tsx:233`, `src/app/settings/page.tsx:141`).
No script, test or CI job parses or orders it.

## Expected Results

ER1 - The development server no longer forces the webpack bundler, and the reason the flag was added in the first place is confirmed gone. In package.json the `dev` script no longer contains the string `--webpack` (it was `next dev --webpack --hostname 127.0.0.1` at c8fffd1) and still binds the host explicitly with `--hostname 127.0.0.1`; `grep -c -- "--webpack" package.json` prints 0. Running `npm run dev` from the repository root prints a startup banner naming Turbopack (`Next.js 16.3.4 (Turbopack)`) and a Ready line, and opening `http://127.0.0.1:3000/login` in a browser with the devtools console open shows a websocket to `ws://127.0.0.1:3000/_next/hmr` and a console line reading `[HMR] connected`. Editing any visible English string in a client component under `src/components/` while that page is open updates the browser within a few seconds without a manual reload, and reverting the edit restores it - this is the HMR-over-127.0.0.1 behaviour that commit a9b0990 added `--webpack` to obtain, so it must still hold. No other script in package.json changes.

ER2 - The mobile Fast View spec passes repeatedly against the repository's own default web server, which is the exact configuration CI uses. With Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied, a `.env.local` present, no `PLAYWRIGHT_WEB_SERVER` set and nothing already listening on port 3000, `npx playwright test e2e/fast-view-mobile.spec.ts --project=mobile --repeat-each=5 --workers=1 --reporter=list` exits 0 and prints `15 passed`, with no `failed` and no `flaky` line. At c8fffd1 the same command fails every repetition of `fast-view page renders the song title on mobile` (measured there without `--repeat-each`: `1 failed, 2 passed`, the failure being `expect(locator).toBeVisible() failed ... element(s) not found` at line 104), which is byte for byte the CI failure of run 34429486831.

ER3 - The Fast View route no longer blows up on the client, and the specific crash is gone rather than waited out. Capture the run of ER2 to a log (`... --reporter=list 2>&1 | tee /tmp/rh72-mobile.log`); `grep -c "Object.defineProperty called on non-object" /tmp/rh72-mobile.log` prints 0 and `grep -c "pdfjs-dist/build/pdf.mjs" /tmp/rh72-mobile.log` prints 0. At c8fffd1 the same greps print non-zero: the browser throws `TypeError: Object.defineProperty called on non-object` inside `pdfjs-dist/build/pdf.mjs`, reached from `src/app/songs/[id]/fast-view/page.tsx` through `FastViewOverlays` -> `PdfStageOverlay` -> `TabDrawingStage` -> `react-pdf`, and the page renders Next.js's client error shell (a single level-1 heading with a generic load-failure message and Reload/Back buttons) instead of the song. As a manual cross-check, with `npm run dev` running and signed in, opening any song's `/songs/<id>/fast-view` shows the song title as a level-1 heading and the browser console reports no uncaught exception.

ER4 - The whole suite is green twice in a row against the default web server, with no manual cleanup between runs. With the setup of ER2 and no `PLAYWRIGHT_WEB_SERVER`, run `npx playwright test --workers=1 --reporter=list` twice in succession without touching the database, the `e2e/.auth` directory or `E2E_USER_EMAIL` between them. Both runs exit 0 and both print `22 passed`; neither prints a `failed` or a `flaky` line. Measured at c8fffd1 the identical command prints `1 failed, 21 passed (1.3m)`; measured with the bundler of ER1 it printed `22 passed (30.4s)` and `22 passed (29.8s)`. `--workers=1` mirrors playwright.config.ts, which uses one worker under CI.

ER5 - The sign-in retry loop in the auth spec can actually spend its budget instead of being killed by the per-test timeout. `e2e/auth.spec.ts` declares a file- or describe-level timeout (for example `test.describe.configure({ timeout: 90_000 })`, the shape `e2e/fast-view-mobile.spec.ts:38` already uses) whose value is strictly greater than the sum of the `toPass({ timeout: 30_000 })` budget in `signInAndLandOn` and the 8_000 ms `waitForURL` that precedes it, and a comment states that reason; at c8fffd1 the file declared no timeout at all and therefore inherited `timeout: 30_000` from playwright.config.ts, which is why CI logged `Test timeout of 30000ms exceeded` with `14 x unexpected value "http://127.0.0.1:3000/login?redirect=%2Fprofile"` on `redirect param is honoured after login`. The file still contains exactly four tests and all four names are unchanged. `npx playwright test e2e/auth.spec.ts --repeat-each=3 --workers=1 --reporter=list` exits 0 and prints `12 passed`, with the setup of ER2.

ER6 - No sleep and no extra retry was introduced anywhere, and the one assertion that races a post-navigation fetch says so explicitly. `grep -rn "waitForTimeout" e2e/` prints nothing at all, unchanged from c8fffd1. `grep -rn "retries" e2e/ playwright.config.ts` prints only the pre-existing `retries: process.env.CI ? 2 : 0` line of playwright.config.ts. The heading assertion at `e2e/fast-view-mobile.spec.ts:104` carries an explicit timeout of at least 15000 ms with a one-line comment naming what it covers (the client navigation plus `useSongEntry`'s entry fetch); at c8fffd1 it ran on the 5000 ms default from playwright.config.ts's `expect` block, which is unchanged. `git diff c8fffd1 -- playwright.config.ts .github/workflows/ci.yml next.config.ts vitest.config.ts eslint.config.mjs` prints nothing at all.

ER7 - A guard test fails the unit suite if anyone puts the webpack dev bundler back, and every existing gate is unchanged. A new vitest file under `src/lib/__tests__/` reads package.json and asserts that the `dev` script does not select webpack, with a comment naming the crash it prevents (`pdfjs-dist` failing module evaluation and taking the Fast View route down); temporarily re-adding `--webpack` to the `dev` script makes exactly that test fail, and removing it again makes it pass. With Postgres at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (migrations applied) and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`: `rtk proxy npx vitest run` exits 0 and prints `Test Files 108 passed (108)` and a `Tests` line of at least 1210 passed with no failed and no skipped entry (107 files / 1209 tests at c8fffd1). `rtk proxy npx eslint .` still prints `22 problems (8 errors, 14 warnings)`; `./node_modules/.bin/tsc --noEmit` exits 0 printing nothing; `npm run lint:dead` exits 0; the number of per-file entries between `// BEGIN:complexity-budget-overrides` and `// END:complexity-budget-overrides` in eslint.config.mjs is still 20 and `grep -c "MAX_OVERRIDES = 20" src/lib/__tests__/complexityBudget.test.ts` still prints 1.

ER8 - Release hygiene, documentation and a closed change set. AGENTS.md no longer describes the stack as using the webpack dev server: the phrase `Webpack dev server` is gone (`grep -c "Webpack dev server" AGENTS.md` prints 0, it printed 1 at c8fffd1) and a short entry under `Key architectural decisions` records that dev, build and deploy all run Turbopack, that `--webpack` must not be reintroduced because `pdfjs-dist` fails to evaluate under the webpack dev runtime and kills the Fast View route, and names the guard test of ER7; the `nextjs-agent-rules` block of AGENTS.md is byte-identical to c8fffd1 (if `next dev` regenerated it, that regeneration is reverted before the commit). `package.json` version is `0.1.100-YYYYMMDDHHmm` with a real local timestamp, above `0.1.99-202609092308`. `git diff c8fffd1 -- src/components/landing src/i18n/dictionaries` prints nothing at all. `git diff --name-only c8fffd1 | sort` lists only paths drawn from this closed set and no others: `AGENTS.md`, `docs/suggestions-log.md`, `docs/tasks/RH-72-spec.md`, `e2e/auth.spec.ts`, `e2e/fast-view-mobile.spec.ts`, `package.json`, and exactly one new `src/lib/__tests__/*.test.ts` file - any other path fails this result, and in particular no existing file under `src/` is modified.

## Out of Scope

- **Running the CI e2e job against a production build.** Serving
  `npm run build` + `next start` in CI would be closer to what ships (and is
  the only way an RH-32-class production-only crash could be caught), but it
  also switches Better Auth's rate limiter on, which is the flake RH-44 wrapped
  in `toPass`. It is a separate decision with its own trade-off - record it in
  `docs/suggestions-log.md`, do not do it here. `playwright.config.ts` already
  supports it through `PLAYWRIGHT_WEB_SERVER`.
- **Loading `react-pdf` lazily on the Fast View route.** Deferring
  `TabDrawingStage` behind `next/dynamic` would keep roughly a megabyte of
  `pdfjs-dist` out of the route's first client payload - a real win for a page
  meant to open on stage over a phone connection - but it would hide the crash
  rather than remove it (Stage Mode would still die on any webpack dev build)
  and it touches `src/`. Log it as a suggestion.
- **The `webpack` dependency and its `knip.json` `ignoreDependencies` entry.**
  Nothing imports it and `next dev --webpack` remains available ad hoc; whether
  the dependency can be dropped is a dead-code question of its own.
- **Fixing `pdfjs-dist` under the webpack dev runtime**, or reporting it
  upstream. Not this repository's code.
- **`.github/workflows/ci.yml`, `playwright.config.ts`, `next.config.ts`,
  `vitest.config.ts`.** All four are pinned unchanged by ER6.
- **The open suggestions from RH-44** (the unused `chromium` import in
  `e2e/global-setup.ts`, the duplicated word in the mobile spec's comment, the
  fail-fast hardening of `signInAndLandOn`). They stay in
  `docs/suggestions-log.md`.

## Post-merge checks (orchestrator)

After the merge commit lands on master, the `Node.js CI` run for it must show
`E2E Tests (Playwright)` with conclusion `success` alongside the five jobs that
are already green, and the job log must report `22 passed` with no `flaky` and
no `failed` entry - so the result does not rest on `retries: 2`. Compare against
run `34429486831` (`20 passed, 1 flaky, 1 failed`). No expected result above
depends on this.

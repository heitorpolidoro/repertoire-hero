# RH-44 — Corrigir CI vermelho na master: job build/Test e job E2E

Baseline for every measurement in this document: `68a605b`
(`docs(RH-43): consolidate naming, module layout and i18n conventions in AGENTS.md`),
CI run `34421317184`, E2E job `102697152412`.

## Scope

Make the `E2E Tests (Playwright)` job green on master by repairing the four
tests that fail there, and record — with evidence, without redoing it — that the
coverage-threshold half of this task's title was already resolved before the
task was picked up.

Everything this task changes lives under `e2e/`. No file under `src/` changes:
each of the four failures is a test asserting behaviour the application
deliberately no longer has, or a fixture that cannot survive being run twice.
If the implementer finds a genuine application bug while doing this, the spec's
whitelist forbids fixing it here — it is reported and becomes its own task.

## Audit at 68a605b

### The coverage half is already resolved — do not redo it

The task was filed on 2026-09-06 because the reused job `build / Test (Node
24.x)` (`heitorpolidoro/.github/.github/workflows/node-ci.yml@master`, invoked
from `.github/workflows/ci.yml:9-14`) failed with
`ERROR: Coverage for branches (64.12%) does not meet global threshold (65%)`.
That job runs `vitest --run --coverage.enabled --coverage.reporter=lcov
--reporter=dot` without `SUPABASE_SERVICE_ROLE_KEY`, so the database-gated
suites skip and the branch percentage drops.

It no longer fails. On the three most recent `Node.js CI` runs on master —
`34421317184` (`68a605b`), `34414088458` (`bb5070b`), `34406504171`
(`890a27b`) — both `build / Test (Node 24.x)` and `Coverage (vitest)` have
conclusion `success`, and the only failing job is `E2E Tests (Playwright)`. The
log of job `102697152410` shows the skip still happening
(`Test Files 92 passed | 15 skipped (107)`, `Tests 1049 passed | 160 skipped
(1209)`) and no threshold error: the unit tests added between `27e44a8` and
`68a605b` (RH-41, RH-42, RH-62, RH-63) lifted branch coverage over the 65 gate
on their own. Nothing in `.github/workflows/ci.yml` or `vitest.config.ts` was
changed to achieve it — `git log -S "database: postgres" -- .github/workflows/ci.yml`
returns only `3e8d712` (2026-07-26), long before the thresholds landed in
`13da8b2` (RH-24).

Consequence for this task: **do not touch the CI workflow or the vitest
config.** ER7 pins both as byte-identical to `68a605b`, and the post-merge check
confirms the two jobs stay green.

### The four E2E failures

`npx playwright test` runs 22 tests (19 chromium + 3 mobile). In CI the job
reports `4 failed`, `18 passed (3.3m)`. Reproduced locally against a production
build (`npm run build`, `PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H
127.0.0.1"`, Postgres at `postgresql://postgres:postgres@127.0.0.1:54322/postgres`),
with `--workers=1` and a never-before-used `E2E_USER_EMAIL`: `3 failed`,
`19 passed (33.1s)` — the same three deterministic failures; the fourth is a CI
flake described below.

**(1) and (2) — `e2e/auth.spec.ts:52` and `:59` assert that `/` is private.**
Both do `page.goto('/')` and then wait for `/login`. `/` has been the public
landing page since the landing work, and `src/proxy.ts`'s matcher (twelve
entries, RH-65) does not list it. Measured against the ER7 build with
`npx next start -p 3210` and no cookie:

```
/                     -> 200
/profile              -> 307  http://127.0.0.1:3210/login?redirect=%2Fprofile
/bands                -> 307  http://127.0.0.1:3210/login?redirect=%2Fbands
/songs/x/fast-view    -> 307  http://127.0.0.1:3210/login?redirect=%2Fsongs%2Fx%2Ffast-view
```

`e2e/ssr-smoke.spec.ts:19,30` already pins the opposite of what these two tests
assert (`GET / signed out returns a 200 SSR document`, `signed-out / renders the
landing page in a browser`) and is green. The suite currently contradicts
itself; `ssr-smoke` is the half that is right.

**(3) — `e2e/songs-crud.spec.ts:47` asserts a rename the catalog refuses.**
The test adds `E2E Song Before Edit`, opens the edit dialog, types a new title
and artist, saves, and expects the old card to be gone. `src/lib/songs.ts:257-267`
(`updateSong`) writes the shared `global_songs` row **fill-if-empty**:
`title = CASE WHEN title IS NULL OR title = '' THEN $1 ELSE title END`, and the
same for `artist`, `album`, `standard_key`, `cover_url`, `duration_seconds` and
`links`. An already-set title is never overwritten, by design (commit `d102d28`,
RH-15: a correction to an already-set field goes through `Correct Global Info`
-> `submitGlobalSongEditAction` -> the admin moderation queue). Only the
owner-scoped `repertoire` columns (`status`, `tags`, `personal_key`) are written
unconditionally. So the card keeps its title, the assertion at line 58 receives
`1` where it expects `0`, and this is the application behaving as specified. The
local database confirms it: after many runs, `global_songs` holds
`E2E Song Before Edit` and no `E2E Song After Edit` row at all.

**(4) — `e2e/fast-view-mobile.spec.ts:58` is a CI-only flake, amplified by (5).**
Its first CI attempt failed on `page.waitForURL(/\/songs\/.+\/fast-view/)` with
`waiting for navigation until "load"` and **no navigation logged at all** — the
click on the card link produced nothing. The two retries then failed differently
(see below). The test passes locally in 1.2s on every run performed for this
spec. The card link is a `next/link` inside a client-rendered list
(`src/app/page.tsx:396`), and this repository already carries the fix for
exactly this failure mode twice, with the diagnosis in a comment:
`e2e/bands-confirm.spec.ts:43-50` and `e2e/server-pages.spec.ts:60-65` —
"The button paints before React hydrates, so a click can be swallowed on a cold
route. Retry opening the dialog until the name field actually appears." —
implemented with `await expect(async () => { ... }).toPass({ timeout: 30_000 })`.

**(5) — the fixtures cannot survive a second run, which is why retries never
rescue anything.** `songs-crud` and `fast-view-mobile` create songs under
module-level constant titles (`SONG_ADD`, `SONG_EDIT_BEFORE`, `SONG_DELETE`,
`MOBILE_SONG_TITLE`, `MOBILE_SONG_FAST_VIEW`) for a single fixed user
(`e2e-test@example.com`, `e2e/global-setup.ts:17`) against a database that is
never reset. `createAndAddSong` (`src/lib/songs.ts:369`) throws
`Song already in your repertoire` when the row is already there; `SongForm`
renders that in the dialog's `role="alert"` and leaves the dialog open; the
`addSong` helper then times out on `expect(page.locator('dialog[open]'))
.toHaveCount(0)` (`e2e/helpers.ts:57`). That is precisely what both CI retries
of (3) and (4) hit — the job log carries four
`[WebServer] [error] Failed to create and add song Error: Song already in your
repertoire` lines, interleaved with the retries — so a test that fails once can
never pass on retry, and `retries: 2` buys nothing. Locally the same defect
shows up as the second run of the suite failing: with a database already
carrying the five `E2E %` rows, the three specs report `7 failed / 3 passed`,
versus `3 failed / 7 passed` for the identical command with a fresh
`E2E_USER_EMAIL`. Two other specs already solved this the right way and are the
precedent: `e2e/bands-confirm.spec.ts:36` (`E2E Band Confirm ${Date.now()}`) and
`e2e/server-pages.spec.ts:52` (`E2E Server Playlist ${Date.now()}`, which also
deletes what it created).

A secondary consequence of the constant titles: `MOBILE_SONG_TITLE` is a strict
prefix of `MOBILE_SONG_FAST_VIEW`, and `songCard` filters by `hasText`, so once
both rows exist the search test's `expect(songCard(page, MOBILE_SONG_TITLE))
.toBeVisible()` matches two elements and violates strict mode.

## Approach

Four changes, all under `e2e/`. No `src/` change, no CI change, no
`playwright.config.ts` change, and no `retries` or `waitForTimeout` anywhere.

**A. Point the two auth tests at a route that is actually private.**
Replace `page.goto('/')` in `e2e/auth.spec.ts:52` and `:59` with a route that
appears in the `src/proxy.ts` matcher — `/profile` is the natural pick, it is
the route `e2e/ssr-smoke.spec.ts` already uses for the signed-in shell and it
carries no per-test data. The first test keeps asserting the bounce to `/login`
and additionally asserts the `redirect` query parameter names the requested
route; the second keeps the `?redirect=` wait, logs in, and now expects to land
on that route rather than on `/`. The first test is renamed to say what it
tests; the second keeps its name. Neither test may assert anything about `/`:
`e2e/ssr-smoke.spec.ts` owns that route's behaviour and is not modified.

**B. Rewrite the edit test against the catalog contract that exists.**
`e2e/songs-crud.spec.ts:47` becomes a test of fill-if-empty, which is the rule
the code implements and the one worth guarding: add a song with a title and
**no** artist; open the edit dialog; type both a new title and an artist; save;
then assert (a) the card is still there under its original title and now shows
the artist that was typed into the empty field, and (b) no card exists under the
typed-in title. One test, both halves of the rule, no new helper: the existing
`editSong(page, title, { title, artist })` already does the interaction. The
test is renamed accordingly. That the form silently discards a typed title with
no feedback to the user is a real UX gap, but it is an application change and
belongs in its own task — record it in `docs/suggestions-log.md`, do not fix it
here.

**C. Make every fixture unique per test invocation.**
Add one exported helper to `e2e/helpers.ts` that builds a run-unique song title
from a prefix, and call it **inside the test body (or a `beforeEach`), never at
module scope** — a retry can execute in the same worker process, so a suffix
computed once at import time would repeat and collide exactly as today's
constants do. The suffix must be unique per call (a timestamp plus a
process-local counter is sufficient; `bands-confirm` and `server-pages` use
`Date.now()`). Every `addSong` call in `e2e/songs-crud.spec.ts` and
`e2e/fast-view-mobile.spec.ts` uses it, and the two mobile prefixes stop being
prefixes of one another. Deleting the created rows afterwards is welcome but not
required: with unique titles a leftover row can never be looked up again.

**D. Retry the two clicks that can be swallowed before hydration.**
In `e2e/helpers.ts`, wrap the "Add song" button click of `addSong` in the
`expect(async () => { ... }).toPass({ ... })` shape used at
`e2e/bands-confirm.spec.ts:46-50`, retrying until `dialog[open]` appears. The
**submit** click is explicitly not wrapped — retrying a submit could add the
song twice. In `e2e/fast-view-mobile.spec.ts`, wrap the fast-view link click the
same way, retrying until the URL matches `/songs/<id>/fast-view`, which removes
the CI failure mode of (4). Optionally (recommended, not pinned): when the
dialog fails to close after a submit, have `addSong` report the text of the
in-dialog `role="alert"` instead of a bare `toHaveCount` timeout, so the next
fixture regression names itself.

### Whitelist

Required:

```
docs/tasks/RH-44-spec.md
e2e/auth.spec.ts
e2e/fast-view-mobile.spec.ts
e2e/helpers.ts
e2e/songs-crud.spec.ts
package.json
```

Permitted but not required, and nothing else:

```
docs/suggestions-log.md
e2e/global-setup.ts
```

**Landing Page Rule decision.** This task ships no user-facing capability at
all — it repairs tests. The landing copy must not change; ER8 asserts it
mechanically.

**Version.** Bump `package.json` to `0.1.99-YYYYMMDDHHmm` with a real local
timestamp, from `0.1.98-202609092108`.

## Expected Results

ER1 - The two authentication tests exercise a route that is actually private instead of the public landing page. In `e2e/auth.spec.ts`, `grep -c "goto('/')" e2e/auth.spec.ts` prints `0` (it printed `2` at `68a605b`, at lines 54 and 61), and both former `page.goto('/')` calls now name a path that appears in the matcher array of `src/proxy.ts` (for example `/profile`). The file still contains exactly four tests; two of them keep the names `valid credentials redirect to home` and `invalid credentials show an error message` verbatim; the test at former line 52 is renamed to `unauthenticated visitor to a private route is redirected to /login` and asserts both that the browser lands on `/login` and that the `redirect` query parameter names the private route it asked for; the test at former line 59 keeps the name `redirect param is honoured after login` and, after signing in, asserts the browser lands on that same private route. `npx playwright test e2e/auth.spec.ts --reporter=list` exits `0` and prints `4 passed`; at `68a605b` the same command prints `2 failed` and `2 passed`, both failures being `TimeoutError: page.waitForURL` after `navigated to "http://127.0.0.1:3000/"`. Run it with a production build present (`npm run build`), `BETTER_AUTH_SECRET` exported from `.env.local`, Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied, and `PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1"`.

ER2 - The song-edit test asserts the catalog rule the code implements. `e2e/songs-crud.spec.ts` still contains exactly three tests; the first and third keep the names `add a new song and verify it appears in the list` and `delete a song and verify it is removed from the list` verbatim; the second is renamed from `edit an existing song and verify the changes` to a name that states the fill-if-empty rule, for example `editing a song fills the empty catalog fields and leaves the shared title unchanged`. That test adds a song with a title and no artist, opens the edit dialog, types both a new title and an artist, saves, and then asserts that a card carrying the original title is visible and contains the typed artist, and that no card carrying the typed-in title exists. `npx playwright test e2e/songs-crud.spec.ts --reporter=list` exits `0` and prints `3 passed`, run with the same server, build and database setup as ER1; at `68a605b` the same command prints `1 failed` and `2 passed`, the failure being `expect(locator).toHaveCount(expected) failed / Expected: 0 / Received: 1` at line 58. No file under `src/` is edited to make this pass.

ER3 - Every song the suite creates carries a title that is unique per test invocation, so a retry or a second run can no longer collide with its own leftovers. `grep -rn "toHaveCount\|addSong" e2e/songs-crud.spec.ts e2e/fast-view-mobile.spec.ts` shows no `addSong` call passing a title that is a module-level constant string; the unique part is produced inside the test body or a `beforeEach`, never at module import time. With a production build present and the server and database of ER1, `npx playwright test e2e/songs-crud.spec.ts e2e/fast-view-mobile.spec.ts --repeat-each=3 --workers=1 --reporter=list 2>&1 | tee /tmp/rh44-repeat.log` exits `0` and prints `18 passed`, and `grep -c "already in your repertoire" /tmp/rh44-repeat.log` prints `0`. At `68a605b` that command fails: the second repetition of each test hits `[WebServer] [error] Failed to create and add song Error: Song already in your repertoire` and then times out on `locator('dialog[open]')` `Expected: 0 / Received: 1`, which is the exact failure both CI retries of the two red tests hit in job `102697152412`.

ER4 - The whole suite is green twice in a row against the same database, with no manual cleanup between the runs - the property whose absence is the reason CI retries never rescued anything. With a production build present, `BETTER_AUTH_SECRET` exported from `.env.local`, Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied, and `PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1"`, run `npx playwright test --workers=1 --reporter=list` twice in succession without touching the database, the `e2e/.auth` directory or `E2E_USER_EMAIL` between them. Both runs exit `0`, both print `22 passed`, neither prints a `failed` line, and the second run's output contains no occurrence of the string `already in your repertoire`. `--workers=1` mirrors `playwright.config.ts`, which uses one worker under `CI`. Baselines at `68a605b` for the identical command: with a database that has never seen the suite, `3 failed` (`e2e/auth.spec.ts:52`, `e2e/auth.spec.ts:59`, `e2e/songs-crud.spec.ts:47`) and `19 passed (33.1s)`; a second run against that same database fails additionally on every test that adds a song.

ER5 - The two clicks that CI could swallow before hydration are retried rather than raced, and no sleep was introduced anywhere. `grep -c "toPass(" e2e/helpers.ts` prints at least `1` and `grep -c "toPass(" e2e/fast-view-mobile.spec.ts` prints at least `1` (both printed `0` at `68a605b`; the pattern already exists at `e2e/bands-confirm.spec.ts:50` and `e2e/server-pages.spec.ts:65`, whose comments diagnose this exact failure mode). The retried actions are the click that opens the add-song dialog and the click on the card's fast-view link; the form submit inside `addSong` is not inside a retry block, because retrying a submit could create the song twice. `grep -rn "waitForTimeout" e2e/` prints nothing at all, unchanged from `68a605b`, and `grep -rn "retries" e2e/ playwright.config.ts` prints only the pre-existing `retries: process.env.CI ? 2 : 0` line of `playwright.config.ts`. `npx playwright test e2e/fast-view-mobile.spec.ts --repeat-each=3 --workers=1 --reporter=list` exits `0` and prints `9 passed`.

ER6 - Nothing outside `e2e/` changed shape, and no test was dropped. `git diff 68a605b -- src` prints nothing at all: all four failures are test-side, and if the implementer found a genuine application bug it is reported in `docs/suggestions-log.md` and named in the pull request instead of being fixed here. `git diff 68a605b -- .github playwright.config.ts vitest.config.ts eslint.config.mjs e2e/ssr-smoke.spec.ts e2e/server-pages.spec.ts e2e/bands-confirm.spec.ts` prints nothing at all. `ls e2e/*.ts | sort | tr '\n' ' '` prints exactly `e2e/auth.spec.ts e2e/bands-confirm.spec.ts e2e/fast-view-mobile.spec.ts e2e/global-setup.ts e2e/helpers.ts e2e/server-pages.spec.ts e2e/songs-crud.spec.ts e2e/ssr-smoke.spec.ts` - no spec file was deleted, added or renamed. The suite still holds 22 tests in total, four of them in `e2e/bands-confirm.spec.ts` and four in `e2e/server-pages.spec.ts`, all eight untouched.

ER7 - The coverage-threshold half of this task's title was already resolved before the task was picked up and is not redone here. `gh run list --branch master --limit 5` and `gh run view <id> --json jobs` for the three most recent `Node.js CI` runs preceding this task's branch show `build / Test (Node 24.x)` and `Coverage (vitest)` with conclusion `success` on every one of them, the only failing job being `E2E Tests (Playwright)`; for reference those runs are `34421317184`, `34414088458` and `34406504171`, and job `102697152410` shows `Tests 1049 passed | 160 skipped (1209)` with no `does not meet global threshold` line anywhere in its log. Consistent with that, the local gates are byte-for-byte unchanged: `rtk proxy npx vitest run` exits `0` printing `Test Files 107 passed (107)` and `Tests 1209 passed (1209)` with no failed and no skipped entry (Postgres at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`); `rtk proxy npx eslint .` prints `22 problems (8 errors, 14 warnings)`; `./node_modules/.bin/tsc --noEmit` exits `0` printing nothing; `npm run lint:dead` exits `0`; the number of lines matching `complexity-budget/override` in `eslint.config.mjs` is `20` and `grep -c "MAX_OVERRIDES = 20" src/lib/__tests__/complexityBudget.test.ts` prints `1`, both unchanged.

ER8 - Release hygiene and a closed change set. `package.json` version is `0.1.99-YYYYMMDDHHmm` with a real local timestamp, sorting above `0.1.98-202609092108`. `git diff 68a605b -- src/components/landing src/i18n/dictionaries` prints nothing at all: this task ships no user-facing capability, so the landing page gains nothing. `git diff --name-only 68a605b | sort` lists only paths drawn from this closed set and no others: `docs/suggestions-log.md`, `docs/tasks/RH-44-spec.md`, `e2e/auth.spec.ts`, `e2e/fast-view-mobile.spec.ts`, `e2e/global-setup.ts`, `e2e/helpers.ts`, `e2e/songs-crud.spec.ts`, `package.json` - any other path fails this result. In particular that list contains no path under `src/`, no `.github/workflows/ci.yml`, no `playwright.config.ts`, no `vitest.config.ts`, no `AGENTS.md` (if `next build` regenerated the `nextjs-agent-rules` block, that regeneration is reverted before the commit) and none of `e2e/ssr-smoke.spec.ts`, `e2e/server-pages.spec.ts` or `e2e/bands-confirm.spec.ts`.

## Out of Scope

- **Any change under `src/`.** In particular: the fill-if-empty rule in
  `src/lib/songs.ts:257-267`, the fact that `SongForm` accepts a typed title it
  will silently discard (a real UX gap - log it as a suggestion), the
  `Correct Global Info` / moderation-queue path that *is* how a title gets
  corrected, and `src/proxy.ts`'s matcher.
- **An end-to-end test of the global-song correction queue.** The rewritten edit
  test pins what the repertoire owner can change; covering
  `submitGlobalSongEditAction` and `/admin/moderation` end to end is its own
  task.
- **`.github/workflows/ci.yml` and `vitest.config.ts`.** The coverage half is
  resolved (see the audit); re-tuning thresholds, adding
  `SUPABASE_SERVICE_ROLE_KEY` to the reused job, or dropping `--coverage` from
  it are all explicitly not done here.
- **The local parallel-worker flake in `e2e/server-pages.spec.ts:81`.** Running
  the full suite locally *without* `--workers=1` failed once during this spec's
  measurements with `locator.fill: ... element was detached from the DOM` inside
  `createPlaylist` (90s timeout), while the same test passes in 333ms under
  `--workers=1` and is green in CI, which runs one worker. It is a different
  root cause from the four failures this task owns - a `toPass` block that
  re-clicks a modal toggle - and belongs in its own item; record it in
  `docs/suggestions-log.md`.
- **Purging the `E2E %` rows a developer's local database already holds**, and
  deleting the per-run `global_songs` rows the suite creates from now on. There
  is no UI to delete a global song, and with unique titles a leftover row can
  never be matched again.
- **Adding a database reset or a per-run user to `e2e/global-setup.ts`.**
  Permitted if the unique-title helper is more natural there, but a fixture
  teardown strategy, a seeded database or a per-run e2e account is not required
  by any result above and must not be introduced as a substitute for unique
  titles.

## Post-merge checks (orchestrator)

After the merge commit lands on master, the `Node.js CI` run for it must show
`E2E Tests (Playwright)` with conclusion `success` alongside the five jobs that
are already green (`build / Test (Node 24.x)`, `Coverage (vitest)`,
`Dead code (knip)`, `Duplication (jscpd)`, `Dependency audit (npm audit)`) -
i.e. the whole run green, which is the point of the task. The job log must
report `22 passed` with no `flaky` entry, so the result is not resting on
`retries: 2`. No expected result above depends on this.

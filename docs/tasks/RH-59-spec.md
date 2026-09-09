# RH-59 - Corrigir flake do complexityBudget.test.ts (timeout de loadConfig sob carga da suite completa)

## Scope

`src/lib/__tests__/complexityBudget.test.ts` is the F20/RH-39 ratchet guard: no CI job runs
eslint, so this file is the only thing that makes the complexity budgets bite. Under full-suite
parallel load its first test intermittently dies with `Error: Test timed out in 5000ms.` on
`await loadConfig()` - the dynamic `import()` of `eslint.config.mjs` - even though the guard itself
is perfectly healthy. Since RH-58 every QA has had to carry a hand-written "disposal rule" (a
single isolated re-run of this file counts as a pass) to work around it.

This task removes the need for that disposal rule by making the guard's own timing honest: the
expensive module import happens once, in a `beforeAll` hook with its own generous timeout, and the
four currently-untimed tests get an explicit timeout large enough that a *correct* guard can never
lose a race against machine load. Nothing about what the guard checks changes: the six test names,
the twelve `expect(...)` assertions, `BASE`, `MAX_OVERRIDES = 23` and the two existing `120_000`
timeouts on the ESLint-running tests stay byte-identical, because RH-39, RH-55 and RH-56 expected
results and `docs/tasks/RH-39-spec.md` all pin them by name.

The deliverable is one edited test file plus the usual version bump and docs. It does **not**
change `eslint.config.mjs`, the override list, any source file under `src/` outside
`__tests__`, `vitest.config.ts`, or any other test file. It does not weaken, skip, retry or
conditionally disable any assertion, and it does not replace the real `ESLint` run with a static
read of the config: the guard must keep linting all of `src` through the real config.

## Audit at 459de39

HEAD confirmed: `git log --oneline -1` prints `459de39 docs(RH-40): close out the typed query helper
and moderation payload findings (F16, F17, T7)`. Working tree clean. Version `0.1.89-202609091027`.
Baselines re-measured and confirmed here: `./node_modules/.bin/tsc --noEmit` clean;
`rtk proxy npx eslint .` ends with `✖ 22 problems (8 errors, 14 warnings)`; `npm run lint:dup`
prints `Found 19 clones.` with `242 (0.71%)` duplicated lines; `npm run lint:dead` prints nothing
but the npm banner.

**Where the time goes.** Three isolated runs
(`rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts --reporter=verbose`) and three
full-suite runs (`rtk proxy npx vitest run --reporter=verbose`), per-test durations in ms:

| test | isolated (3 runs) | full suite (3 runs) | current timeout |
| --- | --- | --- | --- |
| 1. `sets the base budget ...` (`loadConfig`) | 1301 / 1133 / 1282 | **4469** / 2022 / 1990 | 5000 (default) |
| 2. `relaxes the budget for test files ...` | 1 / 1 / 2 | 5 / 5 / 1 | 5000 (default) |
| 3. `lists at most 23 per-file overrides ...` | 2 / 2 / 2 | 3 / 3 / 2 | 5000 (default) |
| 4. `relaxes only the five budget rules ...` | 1 / 1 / 1 | 2 / 1 / 8 | 5000 (default) |
| 5. `reports no budget violation anywhere under src` (`ESLint.lintFiles`) | 11004 / 4289 / 4034 | 14464 / 7955 / 7634 | 120_000 |
| 6. `pins every override ceiling ...` (`ESLint.lintFiles`) | 1914 / 1429 / 1694 | 1950 / 1818 / 2109 | 120_000 |

All six runs above passed (the flake did not reproduce on this machine in 3 of 3 full runs, versus 3
of 5 reported at `9e37072` on the QA machine), but the mechanism is unambiguous and the margin is
the whole story: **test 1 consumed 4469 ms of its 5000 ms budget in the first full-suite run** -
89 % of the timeout - while doing nothing but an import. A fourth full-suite run executed under
artificial CPU contention (eight busy-loop `node` processes) put test 1 at 2915 ms and test 5 at
17608 ms.

The cost is the dynamic import, not the ESLint runs. Timing the import alone in a cold, unloaded
Node process -
`node -e "const {pathToFileURL}=require('node:url'); const t=Date.now(); import(pathToFileURL('/Users/heitor/workspace/repertoire_hero/eslint.config.mjs').href).then(m=>console.log(Date.now()-t, m.default.length))"` -
prints `1195`, `766`, `745` ms for 37 config entries. That is essentially the whole of test 1's
isolated 1.1-1.3 s: `eslint.config.mjs` pulls the `eslint-config-next` module graph
(typescript-eslint, the Next/React/a11y plugins) through Node's ESM loader, with
`/* @vite-ignore */` so Vite hands it straight to Node untransformed. Tests 2, 3 and 4 also call
`loadConfig()`/`loadOverrides()` but cost 1-8 ms, because Node's ESM cache already holds the module
inside that worker - i.e. **the entire import bill is charged to whichever test runs first**, and
that test is the only one racing a 5 s deadline. The two genuinely slow tests (5 and 6, real
`ESLint.lintFiles` over `src`) are already insulated by explicit `120_000` timeouts and have never
been the flake.

**Why load makes it cross.** `vitest.config.ts` sets no `pool`, no `fileParallelism` and no
`testTimeout`, so the run uses Vitest 4 defaults: the `forks`/threads pool at one worker per core
with file parallelism on, and a 5000 ms per-test timeout. With 92 files in flight the worker running
this file gets a fraction of a core while ~90 other files transform, import and hit Postgres; the
observed 1.2 s import inflates 2-4x (2022-4469 ms measured) and, on a busier machine or a cold
module cache, past 5000 ms. Nothing about that failure says anything about the complexity budgets -
it is pure scheduling noise on a guard that is passing.

**AGENTS.md.** `grep -c "complexityBudget" AGENTS.md` prints `1`, and that single mention (the F20
paragraph, "no CI job runs eslint, so `src/lib/__tests__/complexityBudget.test.ts` is the
enforcement") describes the guard, not the flake. AGENTS.md never documented the disposal rule, so
there is nothing to retire there; the rule lives only in `docs/tasks/RH-58-spec.md` ER9 and in
`docs/suggestions-log.md`, both of which are historical records of RH-58 and must not be rewritten.

## Approach

One file changes: `src/lib/__tests__/complexityBudget.test.ts`. `vitest.config.ts` is deliberately
**not** touched - a global `testTimeout` would slow down the failure of every unrelated hanging test
in 92 files to hide a problem that belongs to one file.

1. **Import `beforeAll`.** The import line becomes exactly
   `import { describe, it, expect, beforeAll } from 'vitest'`.

2. **Memoize the config load.** `loadConfig` keeps its name, its signature
   (`Promise<ConfigEntry[]>`) and its doc comment intent, but resolves from a module-level promise
   so the import is issued at most once per worker:

   ```ts
   let configPromise: Promise<ConfigEntry[]> | undefined

   function loadConfig(): Promise<ConfigEntry[]> {
     configPromise ??= (async () => {
       const href = pathToFileURL(resolve(ROOT, 'eslint.config.mjs')).href
       const mod = (await import(/* @vite-ignore */ href)) as { default: ConfigEntry[] }
       return mod.default
     })()
     return configPromise
   }
   ```

   `loadOverrides` is unchanged and keeps calling `loadConfig()`.

3. **Pay the import in `beforeAll`.** As the first statement inside
   `describe('complexity budget (F20)', ...)`, add a hook with its own explicit timeout and a
   comment naming RH-59 and the measured numbers:

   ```ts
   beforeAll(async () => {
     await loadConfig()
   }, 60_000)
   ```

4. **Give the four fast tests an explicit timeout.** The four `it(...)` calls that currently take
   the default 5000 ms (tests 1-4) each get a third argument `60_000`, so their closing line reads
   `}, 60_000)`. The two ESLint-running tests keep their existing `}, 120_000)` verbatim.

5. **Change nothing else.** The six `it` titles, the twelve `expect(...)` assertions and their
   message strings, `BUDGET_RULES`, `BASE`, `MAX_OVERRIDES = 23`, `toDiskPath`, `ceilingOf` and the
   two `new ESLint(...)`/`lintFiles` bodies stay byte-identical. No `it.skip`, no `retry`, no
   `it.concurrent`, no `vi.setConfig`, no conditional on `process.env.CI`.

After the change the first test's own clock covers assertions only (measured at 1-5 ms in the
isolated run), the import cost is attributed to the hook, and the smallest per-test budget in the
file is 60 s against a worst observed cost of ~4.5 s - a 13x margin instead of the current 1.1x.

## Expected Results

ER1 - the guard still asks the same six questions, named identically. Each of these commands, run
from the project root, prints `1`:
`grep -cF 'sets the base budget for src at complexity 15, max-depth 4, max-lines-per-function 200, max-params 4 and max-lines 400' src/lib/__tests__/complexityBudget.test.ts`,
`grep -cF 'relaxes the budget for test files to max-lines-per-function off and max-lines 800' src/lib/__tests__/complexityBudget.test.ts`,
`grep -cF 'lists at most 23 per-file overrides, each naming a file that exists' src/lib/__tests__/complexityBudget.test.ts`,
`grep -cF 'relaxes only the five budget rules, and never below the base threshold' src/lib/__tests__/complexityBudget.test.ts`,
`grep -cF 'reports no budget violation anywhere under src' src/lib/__tests__/complexityBudget.test.ts`,
`grep -cF 'pins every override ceiling to the current worst number in its file' src/lib/__tests__/complexityBudget.test.ts`.
`grep -c "  it(" src/lib/__tests__/complexityBudget.test.ts` prints `6` and
`grep -cE "it\.(skip|todo|concurrent|only)|\.retry\(|vi\.setConfig|process\.env\.CI" src/lib/__tests__/complexityBudget.test.ts`
prints `0` (no test was skipped, retried, made concurrent or made conditional).

ER2 - no assertion was removed, loosened or added. `git diff 459de39 -- src/lib/__tests__/complexityBudget.test.ts | grep '^-' | grep -c 'expect('`
prints `0` and `git diff 459de39 -- src/lib/__tests__/complexityBudget.test.ts | grep '^+' | grep -c 'expect('`
prints `0`; `grep -c 'expect(' src/lib/__tests__/complexityBudget.test.ts` prints `12`, the same as
at the baseline. The thresholds the guard compares against are untouched:
`git diff 459de39 -- src/lib/__tests__/complexityBudget.test.ts | grep '^-' | grep -cE "MAX_OVERRIDES = 23|complexity: 15|'max-depth': 4|'max-lines-per-function': 200|'max-params': 4|'max-lines': 400|new ESLint|lintFiles"`
prints `0`. `git diff 459de39 -- eslint.config.mjs` prints nothing and
`grep -c 'complexity-budget/override' eslint.config.mjs` prints `23`.

ER3 - the import is paid once, in a hook, and every test carries an explicit timeout.
`grep -c "^import { describe, it, expect, beforeAll } from 'vitest'$" src/lib/__tests__/complexityBudget.test.ts`
prints `1`; `grep -c 'beforeAll(async' src/lib/__tests__/complexityBudget.test.ts` prints `1`;
`grep -c 'configPromise' src/lib/__tests__/complexityBudget.test.ts` prints `3` (declaration,
assignment, return); `grep -cF '}, 60_000)' src/lib/__tests__/complexityBudget.test.ts` prints `5`
(the `beforeAll` hook plus the four previously-untimed tests) and
`grep -cF '}, 120_000)' src/lib/__tests__/complexityBudget.test.ts` prints `2` (the two
`ESLint.lintFiles` tests, unchanged). `git diff 459de39 -- vitest.config.ts` prints nothing and
`grep -c 'testTimeout\|hookTimeout\|fileParallelism\|pool:' vitest.config.ts` prints `0` - the fix is
file-local and the global run configuration is untouched.

ER4 - the flake is gone under full-suite parallel load. With Postgres live at
`postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied and a non-empty
`SUPABASE_SERVICE_ROLE_KEY` in `.env.local`, running
`for i in 1 2 3 4 5; do rtk proxy npx vitest run 2>&1 | grep -E 'Test Files|Tests '; done` prints
five consecutive pairs of `Test Files  92 passed (92)` and `Tests  1064 passed (1064)`, with no
occurrence of `failed`, `skipped` or `timed out` anywhere in the five runs (capture the full output
of the loop and confirm by
`for i in 1 2 3 4 5; do rtk proxy npx vitest run; done 2>&1 | grep -cE 'timed out|Test Files.*failed'`
printing `0` if a second pass is preferred). A single failing run fails this result - the point of
the task is that no isolated re-run is needed any more.

ER5 - in isolation the file is green and the import cost has visibly moved off the first test.
`rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts --reporter=verbose` exits 0,
reports `Test Files  1 passed (1)` and `Tests  6 passed (6)`, and prints a duration next to each of
the six test names. The duration printed for
`sets the base budget for src at complexity 15, max-depth 4, max-lines-per-function 200, max-params 4 and max-lines 400`
is under `1000ms` (it was 1133-1301 ms at the baseline and is 1-5 ms after the fix, because the
`eslint.config.mjs` import is now charged to the `beforeAll` hook), and the durations for
`reports no budget violation anywhere under src` and
`pins every override ceiling to the current worst number in its file` are still printed and still
under their `120_000` ms budgets. Record the six durations in the QA report.

ER6 - the guard still bites, in both directions. Record `shasum eslint.config.mjs` and run
`cp eslint.config.mjs /tmp/RH-59-eslint.bak`. Tamper A (an override removed without fixing the
file): delete the single override line whose `files` is `["src/lib/linkFetcher.ts"]`, then
`rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts` exits 1 with the test
`reports no budget violation anywhere under src` failing and the failure output naming
`src/lib/linkFetcher.ts` and `complexity`; restore with
`cp /tmp/RH-59-eslint.bak eslint.config.mjs`. Tamper B (an override ceiling lowered below the file's
real worst number): change the `src/lib/songs.ts` override from `"max-lines": ["error", 529]` to
`"max-lines": ["error", 528]`, then
`rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts` exits 1 with the test
`reports no budget violation anywhere under src` failing and the output naming `src/lib/songs.ts`
and `max-lines`; restore with
`cp /tmp/RH-59-eslint.bak eslint.config.mjs && rm /tmp/RH-59-eslint.bak`. After the restore
`shasum eslint.config.mjs` prints the digest recorded at the start of this result,
`git status --short eslint.config.mjs` prints nothing, and
`rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts` exits 0 with
`Tests  6 passed (6)`. Neither tamper may fail with `Test timed out`.

ER7 - the static gates hold exactly where they did. `./node_modules/.bin/tsc --noEmit` writes
nothing to stdout or stderr and exits 0. `rtk proxy npx eslint .` ends with the summary line
`✖ 22 problems (8 errors, 14 warnings)` - unchanged from `459de39` - and
`rtk proxy npx eslint . 2>&1 | grep -c 'complexityBudget.test.ts'` prints `0` (the edited file is
not listed by eslint today and may not become listed). `npm run lint:dup` prints `Found 19 clones.`
or fewer with a total of `242 (0.71%)` duplicated lines or fewer, `npm run lint:dead` reports no
unused file, export or dependency, and `npm run audit` prints `found 0 vulnerabilities`.

ER8 - the coverage gate stays green with no tolerated failure. With the same DB precondition as ER4,
`npm run test:coverage` exits 0, reports `Test Files  92 passed (92)` and `Tests  1064 passed
(1064)` with `0 skipped`, prints no line matching `timed out` and no line matching
`ERROR: Coverage for .* does not meet global threshold`, and its `All files` row shows statements
>= 80, branches >= 65, functions >= 78 and lines >= 80.

ER9 - the app still builds and renders, the version went up, and the diff stays inside the
whitelist. `npx next build` exits 0 and its output contains no line matching `^Error|^Failed|Failed
to compile` (do not grep for `Compiled successfully`: this Next version does not print that phrase
on success), and `npx playwright test e2e/ssr-smoke.spec.ts` reports `4 passed`.
`node -p "require('./package.json').version"` prints a string matching `^0\.1\.90-[0-9]{12}$`, which
sorts strictly after the baseline `0.1.89-202609091027`. This task ships no selling point (it is a
test-infrastructure fix, invisible to musicians), so
`git diff 459de39 -- src/components/landing/LandingPage.tsx src/i18n/dictionaries/en.json src/i18n/dictionaries/pt-BR.json`
prints nothing. `git diff --name-only 459de39 | sort` lists only paths drawn from this closed set:
`AGENTS.md`, `docs/suggestions-log.md`, `docs/tasks/RH-59-spec.md`, `package.json`,
`src/lib/__tests__/complexityBudget.test.ts` - any other path fails this result - and, because
AGENTS.md is only in that set to absorb the `next dev`-regenerated `nextjs-agent-rules` block,
`git diff 459de39 -- AGENTS.md | grep -cE 'complexityBudget|disposal|flake'` prints `0`.

## Out of Scope

- Speeding up the guard itself. The 4-17 s `ESLint.lintFiles(['src'])` run is the price of a real
  lint and stays; caching its result, narrowing the file set, or replacing it with a static read of
  `eslint.config.mjs` would weaken the enforcement and is forbidden here.
- Any change to `eslint.config.mjs`, the 23-entry override list, or any ceiling in it. Fixing a file
  so its override can shrink is a separate task.
- Any change to `vitest.config.ts` (global `testTimeout`, `pool`, `fileParallelism`, `maxWorkers`)
  or to any other test file. Other files' timeouts are their own concern.
- Rewriting the historical record of the disposal rule in `docs/tasks/RH-58-spec.md` or the RH-58
  entries in `docs/suggestions-log.md`; and editing the F20 paragraph in AGENTS.md, which describes
  the guard correctly and never mentioned the flake.
- The Playwright e2e suite beyond the `ssr-smoke` spec required by ER9.

## Post-merge checks (orchestrator)

After merge, the next task's QA should stop applying the RH-58 ER9 disposal rule: a
`complexityBudget.test.ts` timeout under full-suite load is, from this commit on, a real regression
to be reported rather than re-run away.

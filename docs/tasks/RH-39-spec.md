# RH-39 - Impose complexity, depth and size budgets in eslint.config.mjs

Baseline: `b85d0c6` (`docs(RH-38): close out the Fast View decomposition (F6, F26, T5)`).
Covers finding **F20** of `docs/plans/code-quality-review.md` (section 5, task T6).

## Scope

F20 says the complexity sweep of section 2.3 "works, is cheap, and reports 104
violations ... but it only runs when somebody types it". This task turns that
ad-hoc CLI invocation into a permanent, mechanical ratchet:

- add `complexity`, `max-depth`, `max-lines-per-function`, `max-params` and
  `max-lines` to `eslint.config.mjs` as errors, at the F6/F20 target thresholds
  (15 / 4 / 200 / 4 / 400) for everything under `src`;
- give test files a documented, looser budget rather than exempting them;
- give each file that is already over budget at `b85d0c6` a per-file override
  pinned to **its own current worst number**, collected in one clearly marked
  block, so the list is a ratchet that can only shrink;
- add a vitest guard, `src/lib/__tests__/complexityBudget.test.ts`, that makes
  the budget bite **in CI** (no CI job runs eslint today - see the Audit) and
  that fails if the override list grows, if an override is pointed at a file
  that no longer needs it, or if an override ceiling is looser than the file's
  actual current worst number;
- document the budget in `AGENTS.md` under **Testing & quality**.

This task does **not** fix any of the 34 files that are over budget. Every one
of them keeps its current shape and gains an override at its current numbers.
In particular `src/app/playlists/[id]/page.tsx` (finding F11, effort L) gets an
override at `complexity 34 / max-lines-per-function 1072 / max-lines 1344` and
is not touched; its decomposition is a separate follow-up task.

## Audit at b85d0c6

### How eslint runs today

`package.json` defines `"lint": "eslint"`. **No CI job runs it.** The jobs in
`.github/workflows/ci.yml` are `build` (delegating to the reusable workflow
`heitorpolidoro/.github/.github/workflows/node-ci.yml@master`), `e2e`,
`dead-code` (`npm run lint:dead`), `coverage` (`npm run test:coverage`),
`duplication` (`npm run lint:dup`) and `audit` (`npm run audit`). The reusable
workflow's `test` job runs `npm ci`, a Postgres container, `npm test -- --run
--coverage.enabled --coverage.reporter=lcov --reporter=dot` and a SonarCloud
scan - there is no eslint step anywhere.

That matters for two reasons. First, F20's real complaint ("invisible to CI")
is not fixed by putting rules in `eslint.config.mjs` alone. Second,
`rtk proxy npx eslint .` already **exits 1** at `b85d0c6` with
`24 problems (10 errors, 14 warnings)` - 7 `react-hooks/set-state-in-effect`
errors, 1 `@next/next/no-html-link-for-pages`, 2
`@typescript-eslint/no-explicit-any` and 14 `no-unused-vars` warnings, none of
them related to this task. Adding `npm run lint` as a CI gate now would
therefore fail the build on pre-existing findings.

**Decision (c): `.github/workflows/ci.yml` is not modified by this task.**
CI enforcement is delivered by the vitest guard, which lints all of `src`
through the real `eslint.config.mjs` using the ESLint Node API and fails only
on the five budget rules. It runs in both the reusable `test` job and the
`coverage` job. Cleaning the 10 pre-existing eslint errors and then adding a
real `npm run lint` gate is recorded as a suggestion, not done here. Nothing
that is a warning today becomes a hard failure as a result of this task: the
`rtk proxy npx eslint .` summary is unchanged at merge.

### The sweep

```
rtk proxy npx eslint src --rule '{"complexity":["error",15],"max-depth":["error",4],"max-lines-per-function":["error",200],"max-params":["error",4],"max-lines":["error",400]}'
```

reports `83 problems (74 errors, 9 warnings)`. Nineteen of those are the
pre-existing baseline problems inside `src` (the same ones that make up the
repo-wide 24). The remaining **64** are budget violations: 26
`max-lines-per-function`, 20 `complexity`, 13 `max-lines`, 3 `max-params`,
2 `max-depth`, spread over **34 files** (20 source files, 14 test files).

Per file, per rule, with the number the file actually reaches:

| File | complexity | max-depth | max-lines-per-function | max-params | max-lines |
|---|---|---|---|---|---|
| `src/app/admin/moderation/page.tsx` | 16 (L162) | | 295 (L12) | | |
| `src/app/api/spotify/playlists/[id]/import/route.ts` | 21 (L30) | | | | |
| `src/app/api/spotify/playlists/[id]/sync/route.ts` | 26 (L24) | 5 (L127, L167) | | | |
| `src/app/bands/[id]/page.tsx` | 30 (L19), 21 (L237) | | 490 (L19) | | 508 |
| `src/app/join/[code]/page.tsx` | | | 249 (L15) | | |
| `src/app/page.tsx` | 18 (L388) | | 511 (L112) | | 640 |
| `src/app/playlists/[id]/page.tsx` | 34 (L273), 29 (L1076) | | 1072 (L273) | | 1344 |
| `src/app/playlists/page.tsx` | | | 226 (L178), 208 (L690) | | 899 |
| `src/app/profile/page.tsx` | 23 (L34), 21 (L198) | | 394 (L34), 224 (L432) | | 723 |
| `src/components/landing/LandingPage.tsx` | | | 208 (L21) | | |
| `src/components/layout/AppLayout.tsx` | 21 (L139), 19 (L37) | | 202 (L139) | | |
| `src/components/songs/SongForm.tsx` | 17 (L219) | | 459 (L154) | | 612 |
| `src/components/tabs/TabDrawingStage.tsx` | 21 (L63) | | 757 (L63) | | 819 |
| `src/hooks/useBandAdmin.ts` | | | 298 (L73) | | |
| `src/hooks/useTabLibrary.ts` | | | | 5 (L78) | |
| `src/lib/bands.ts` | | | | 5 (L113) | |
| `src/lib/linkFetcher.ts` | 18 (L27) | | | | |
| `src/lib/moderation.ts` | 19 (L80) | | | | |
| `src/lib/songs.ts` | 21 (L308) | | | | 531 |
| `src/lib/tabs.ts` | | | | 5 (L109) | |
| `src/app/actions/__tests__/authzRepertoire.db.test.ts` | | | 253 (L41) | | |
| `src/hooks/__tests__/useBandAdmin.test.tsx` | | | | | 517 |
| `src/hooks/__tests__/useLyricsEditor.test.tsx` | | | 259 (L71) | | |
| `src/hooks/__tests__/usePdfStage.test.tsx` | | | 203 (L70) | | |
| `src/hooks/__tests__/useTabLibrary.test.tsx` | | | 308 (L82) | | |
| `src/lib/__tests__/edge_cases.test.ts` | 32 (L49) | | | | |
| `src/lib/__tests__/errors.test.ts` | 17 (L74) | | 307 (L149) | | 455 |
| `src/lib/__tests__/moderation.test.ts` | | | 270 (L17) | | |
| `src/lib/__tests__/playlists.test.ts` | | | 404 (L39) | | 442 |
| `src/lib/__tests__/songs.test.ts` | | | 488 (L46) | | 533 |
| `src/lib/__tests__/spotify.test.ts` | | | 743 (L62), 216 (L588) | | 804 |
| `src/lib/__tests__/spotifyPlaylistRouteAuthz.db.test.ts` | | | 307 (L66) | | |
| `src/lib/__tests__/test-helpers.ts` | 27 (L82) | | | | |
| `src/lib/__tests__/transactionAtomicity.db.test.ts` | | | 262 (L50) | | |

### What the test budget absorbs

Decision (a): test files get a **documented looser budget**, not an exemption.
`max-lines-per-function` is turned off for them (a `describe` block is a
container, not a function with logic - counting its lines measures nothing) and
`max-lines` is doubled to 800. `complexity`, `max-depth` and `max-params` stay
at the source thresholds, because those do measure something in a test.

That budget absorbs 13 of the 14 offending test files outright. Four test-file
overrides remain: `edge_cases.test.ts` (complexity 32), `errors.test.ts`
(complexity 17), `test-helpers.ts` (complexity 27) and `spotify.test.ts`
(`max-lines` 804, four lines over the doubled budget - so it is frozen at its
current size, which is the intended effect).

## Approach

### 1. `eslint.config.mjs`

Insert the following three blocks into the `defineConfig([...])` array, after
the existing `no-restricted-imports` (F21) block and **before** the closing
`globalIgnores([...])` call. Nothing else in the file changes.

```js
  // F20/RH-39: the complexity budget. These five rules are the mechanical
  // ratchet that keeps a FastViewPage (RH-38) or a PlaylistDetailPage from
  // being re-created after it is fixed. No CI job runs eslint, so
  // src/lib/__tests__/complexityBudget.test.ts is what actually enforces them.
  {
    name: "complexity-budget/base",
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      complexity: ["error", 15],
      "max-depth": ["error", 4],
      "max-lines-per-function": ["error", 200],
      "max-params": ["error", 4],
      "max-lines": ["error", 400],
    },
  },
  // A `describe` block is a container, not a function with logic, so
  // max-lines-per-function says nothing useful about a test file. max-lines
  // still does, at twice the source budget.
  {
    name: "complexity-budget/tests",
    files: ["src/**/__tests__/**", "src/**/*.test.ts", "src/**/*.test.tsx"],
    rules: {
      "max-lines-per-function": "off",
      "max-lines": ["error", 800],
    },
  },
  // The files that were already over budget at b85d0c6, each pinned to its own
  // current worst number. This list is a RATCHET: it may only shrink. Never add
  // an entry for new code - bring the new code under the budget instead. Note
  // the escaped brackets: in a glob, `[id]` is a character class, so an
  // unescaped Next.js dynamic segment silently matches nothing.
  // BEGIN:complexity-budget-overrides
  { name: "complexity-budget/override", files: ["src/app/admin/moderation/page.tsx"], rules: { complexity: ["error", 16], "max-lines-per-function": ["error", 295] } },
  { name: "complexity-budget/override", files: ["src/app/api/spotify/playlists/\\[id\\]/import/route.ts"], rules: { complexity: ["error", 21] } },
  { name: "complexity-budget/override", files: ["src/app/api/spotify/playlists/\\[id\\]/sync/route.ts"], rules: { complexity: ["error", 26], "max-depth": ["error", 5] } },
  { name: "complexity-budget/override", files: ["src/app/bands/\\[id\\]/page.tsx"], rules: { complexity: ["error", 30], "max-lines-per-function": ["error", 490], "max-lines": ["error", 508] } },
  { name: "complexity-budget/override", files: ["src/app/join/\\[code\\]/page.tsx"], rules: { "max-lines-per-function": ["error", 249] } },
  { name: "complexity-budget/override", files: ["src/app/page.tsx"], rules: { complexity: ["error", 18], "max-lines-per-function": ["error", 511], "max-lines": ["error", 640] } },
  { name: "complexity-budget/override", files: ["src/app/playlists/\\[id\\]/page.tsx"], rules: { complexity: ["error", 34], "max-lines-per-function": ["error", 1072], "max-lines": ["error", 1344] } },
  { name: "complexity-budget/override", files: ["src/app/playlists/page.tsx"], rules: { "max-lines-per-function": ["error", 226], "max-lines": ["error", 899] } },
  { name: "complexity-budget/override", files: ["src/app/profile/page.tsx"], rules: { complexity: ["error", 23], "max-lines-per-function": ["error", 394], "max-lines": ["error", 723] } },
  { name: "complexity-budget/override", files: ["src/components/landing/LandingPage.tsx"], rules: { "max-lines-per-function": ["error", 208] } },
  { name: "complexity-budget/override", files: ["src/components/layout/AppLayout.tsx"], rules: { complexity: ["error", 21], "max-lines-per-function": ["error", 202] } },
  { name: "complexity-budget/override", files: ["src/components/songs/SongForm.tsx"], rules: { complexity: ["error", 17], "max-lines-per-function": ["error", 459], "max-lines": ["error", 612] } },
  { name: "complexity-budget/override", files: ["src/components/tabs/TabDrawingStage.tsx"], rules: { complexity: ["error", 21], "max-lines-per-function": ["error", 757], "max-lines": ["error", 819] } },
  { name: "complexity-budget/override", files: ["src/hooks/useBandAdmin.ts"], rules: { "max-lines-per-function": ["error", 298] } },
  { name: "complexity-budget/override", files: ["src/hooks/useTabLibrary.ts"], rules: { "max-params": ["error", 5] } },
  { name: "complexity-budget/override", files: ["src/lib/bands.ts"], rules: { "max-params": ["error", 5] } },
  { name: "complexity-budget/override", files: ["src/lib/linkFetcher.ts"], rules: { complexity: ["error", 18] } },
  { name: "complexity-budget/override", files: ["src/lib/moderation.ts"], rules: { complexity: ["error", 19] } },
  { name: "complexity-budget/override", files: ["src/lib/songs.ts"], rules: { complexity: ["error", 21], "max-lines": ["error", 531] } },
  { name: "complexity-budget/override", files: ["src/lib/tabs.ts"], rules: { "max-params": ["error", 5] } },
  { name: "complexity-budget/override", files: ["src/lib/__tests__/edge_cases.test.ts"], rules: { complexity: ["error", 32] } },
  { name: "complexity-budget/override", files: ["src/lib/__tests__/errors.test.ts"], rules: { complexity: ["error", 17] } },
  { name: "complexity-budget/override", files: ["src/lib/__tests__/spotify.test.ts"], rules: { "max-lines": ["error", 804] } },
  { name: "complexity-budget/override", files: ["src/lib/__tests__/test-helpers.ts"], rules: { complexity: ["error", 27] } },
  // END:complexity-budget-overrides
```

Twenty-four override entries, one per file. Notes on the design:

- **`name` is the marker.** The guard test finds the blocks by
  `name === "complexity-budget/base" | "complexity-budget/tests" |
  "complexity-budget/override"` rather than by parsing comments, so it cannot
  drift from the config. `defineConfig` passes these objects through verbatim
  (verified: `node --input-type=module -e 'console.log((await
  import("./eslint.config.mjs")).default.length)'` prints `12` today).
- **Escaped brackets are load-bearing.** Written unescaped,
  `src/app/playlists/[id]/page.tsx` matches nothing and the sweep still reports
  13 violations. This was verified during specification.
- **Per-file granularity is the known limitation.** A `max-lines-per-function`
  ceiling is per file, so `src/app/profile/page.tsx` is pinned at 394 (its
  worst function) and its 224-line function could in principle grow to 394
  unnoticed. That is accepted: the ratchet's purpose is to stop the *worst*
  number from growing.
- This block, plus the whole config, is verified to produce **zero** budget
  violations: the same content was run as a probe at `b85d0c6` and
  `rtk proxy npx eslint .` printed exactly `24 problems (10 errors, 14 warnings)`.

### 2. The guard: `src/lib/__tests__/complexityBudget.test.ts`

New vitest file (node environment, the default). It loads the real
`eslint.config.mjs` at runtime through a `pathToFileURL` dynamic import (a
runtime-computed specifier, so Vite hands it to Node untouched) and uses the
ESLint Node API. `tsconfig.json` excludes `**/__tests__/**`, so importing a
`.mjs` from a `.ts` test raises no `tsc --noEmit` issue.

Shape:

```ts
import { describe, it, expect } from 'vitest'
import { ESLint } from 'eslint'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(__dirname, '../../..')
const BUDGET_RULES = ['complexity', 'max-depth', 'max-lines-per-function', 'max-params', 'max-lines'] as const
const BASE = { complexity: 15, 'max-depth': 4, 'max-lines-per-function': 200, 'max-params': 4, 'max-lines': 400 }
// The override list is a ratchet. Lower this number when an override is
// removed; never raise it.
const MAX_OVERRIDES = 24
```

with a `loadConfig()` helper and `describe('complexity budget (F20)', ...)`
containing exactly these six tests, in this order and with these names:

1. `sets the base budget for src at complexity 15, max-depth 4, max-lines-per-function 200, max-params 4 and max-lines 400`
   - the `complexity-budget/base` block exists, its `files` are exactly
     `src/**/*.ts` and `src/**/*.tsx`, and its five rules equal `BASE` at
     severity `error`.
2. `relaxes the budget for test files to max-lines-per-function off and max-lines 800`
   - the `complexity-budget/tests` block exists, matches
     `src/**/__tests__/**`, `src/**/*.test.ts`, `src/**/*.test.tsx`, and its
     rules are exactly `{'max-lines-per-function': 'off', 'max-lines': ['error', 800]}`.
3. `lists at most 24 per-file overrides, each naming a file that exists`
   - `overrides.length <= MAX_OVERRIDES`; every entry has exactly one glob in
     `files`; `existsSync(resolve(ROOT, glob.replace(/\\/g, '')))` is true for
     each. The bound is `<=`, not `===`, deliberately: an exact equality would
     make *fixing* a file (and deleting its override) fail the guard, which is
     the opposite of a ratchet. Growth past 24 is what must fail.
4. `relaxes only the five budget rules, and never below the base threshold`
   - every rule key in every override is in `BUDGET_RULES`, its value is
     `['error', n]` with `n > BASE[key]`. This is what makes "the override
     still violates the base budget" a consequence of test 6 rather than an
     extra lint pass.
5. `reports no budget violation anywhere under src`
   - `new ESLint({ cwd: ROOT })` (real config, auto-discovered),
     `lintFiles(['src'])`, keep only messages whose `ruleId` is in
     `BUDGET_RULES`, expect `[]`. Failure message must include
     `file: ruleId` per violation. Explicit per-test timeout of `120_000`
     (measured ~5.5 s locally).
6. `pins every override ceiling to the current worst number in its file`
   - one ESLint instance with `overrideConfig` set to, for each override entry,
     `{ files: [glob], rules: { <rule>: ['error', ceiling - 1] } }`
     (`overrideConfig` is applied after the config file, so it wins), then
     `lintFiles(<the 24 target paths>)`. Every `(file, rule)` pair present in
     the override list must appear at least once in the results. Combined with
     test 5 (clean at the ceiling) this proves the ceiling is *exactly* the
     file's current worst number, so improving a file forces its override down
     or out, and an override for a file that is already compliant fails here by
     name. Explicit per-test timeout of `120_000` (measured ~1.4 s locally).

All three ESLint mechanics above were prototyped against a probe copy of the
final config at `b85d0c6` and passed.

### 3. `AGENTS.md`

Additive only. Insert one bullet in the **Testing & quality** list, immediately
after the existing `- ESLint 9 (\`eslint-config-next\`)` line and before the
`- \`knip\`` line:

```
- **Complexity budgets (F20).** `eslint.config.mjs` sets `complexity` 15, `max-depth` 4, `max-lines-per-function` 200, `max-params` 4 and `max-lines` 400 as errors for everything under `src`. Test files (`**/__tests__/**`, `*.test.ts(x)`) turn `max-lines-per-function` off - a `describe` block is a container, not a function with logic - and get `max-lines` 800. The files already over budget when the rules landed each carry a per-file override pinned to their own current worst number, in the block between `// BEGIN:complexity-budget-overrides` and `// END:complexity-budget-overrides`: that list is a **ratchet and may only shrink** - never add an entry for new code. In a glob, `[id]` is a character class, so a Next.js dynamic segment must be escaped (`src/app/bands/\[id\]/page.tsx`) or the override silently matches nothing. No CI job runs eslint, so `src/lib/__tests__/complexityBudget.test.ts` is the enforcement: it lints all of `src` through the real config and fails on any budget violation, on an override ceiling that is not exactly the file's current worst number, and on the list growing past 24 entries.
```

### 4. Tamper checks the developer must run before handing over

The developer reproduces ER4 and ER6 (both below) and records the exact output
in the dev report. `shasum eslint.config.mjs` before and after any temporary
edit must match.

### 5. Version and scope

Bump `package.json` `version` from `0.1.81-202609072207` to
`0.1.82-<YYYYMMDDHHmm>` (strictly greater, per the Version Bumping Rule). The
only files this task may change are `eslint.config.mjs`, `AGENTS.md`,
`package.json`, `docs/tasks/RH-39-spec.md`, `docs/suggestions-log.md` and
`src/lib/__tests__/complexityBudget.test.ts`.

## Expected Results

ER1 - The five budget rules are declared in `eslint.config.mjs` at the F6/F20 thresholds, and the test relaxation is declared too. From the project root, `node --input-type=module -e 'const c=(await import("./eslint.config.mjs")).default; const b=c.find(x=>x&&x.name==="complexity-budget/base"); console.log([...b.files].sort().join(",")); for (const k of Object.keys(b.rules).sort()) console.log(k, JSON.stringify(b.rules[k])); const t=c.find(x=>x&&x.name==="complexity-budget/tests"); for (const k of Object.keys(t.rules).sort()) console.log("test:"+k, JSON.stringify(t.rules[k]));'` exits 0 and prints exactly these eight lines, in this order: `src/**/*.ts,src/**/*.tsx`, then `complexity ["error",15]`, then `max-depth ["error",4]`, then `max-lines ["error",400]`, then `max-lines-per-function ["error",200]`, then `max-params ["error",4]`, then `test:max-lines ["error",800]`, then `test:max-lines-per-function "off"`.

ER2 - Adding the budget produces zero new eslint findings at merge. From the project root, `rtk proxy npx eslint .` prints a final summary line reading exactly `24 problems (10 errors, 14 warnings)`, which is the same summary as at `b85d0c6`, and `rtk proxy npx eslint . 2>&1 | grep -c -E '  (complexity|max-depth|max-lines-per-function|max-params|max-lines)$'` prints `0` (grep exits 1 because nothing matched, which is the expected result). No new eslint rule is reported anywhere in the tree.

ER3 - The per-file override list exists as a single marked block with exactly 24 entries, every target file exists on disk, and the three spot-checked ceilings are the ones measured at `b85d0c6`. `grep -c 'BEGIN:complexity-budget-overrides' eslint.config.mjs` prints `1` and `grep -c 'END:complexity-budget-overrides' eslint.config.mjs` prints `1`. `node --input-type=module -e 'const c=(await import("./eslint.config.mjs")).default; const o=c.filter(x=>x&&x.name==="complexity-budget/override"); console.log(o.length); for (const e of o) console.log(e.files[0].replace(/\\/g,"")+" "+Object.entries(e.rules).map(([k,v])=>k+"="+v[1]).sort().join(","));'` exits 0, prints `24` as its first line, prints 24 further lines, and every one of those 24 paths exists (piping the same output through `tail -n +2 | cut -d' ' -f1 | xargs ls -1 | wc -l` prints `24` with no `No such file` error). Among those 24 lines are exactly these three, character for character: `src/app/playlists/[id]/page.tsx complexity=34,max-lines-per-function=1072,max-lines=1344`, `src/app/api/spotify/playlists/[id]/sync/route.ts complexity=26,max-depth=5`, and `src/lib/__tests__/spotify.test.ts max-lines=804`.

ER4 - The ratchet bites on new code and on growth in an already-overridden file. Part A: from the project root run `{ echo 'export function probeComplexity(n: number): number {'; echo '  let r = 0'; for i in $(seq 0 14); do echo "  if (n === $i) r += $i"; done; echo '  return r'; echo '}'; } > src/lib/probeComplexity.ts` then `rtk proxy npx eslint src/lib/probeComplexity.ts`; it exits 1 and prints a line containing `Function 'probeComplexity' has a complexity of 16. Maximum allowed is 15` with rule id `complexity`, and the summary `1 problem (1 error, 0 warnings)`; then `rm src/lib/probeComplexity.ts` and `git status --short` prints nothing for `src/lib/probeComplexity.ts`. Part B: record `shasum eslint.config.mjs`; confirm `rtk proxy npx eslint src/lib/linkFetcher.ts` currently exits 0 and prints nothing; run `cp eslint.config.mjs /tmp/RH-39-eslint.bak`, edit the single `src/lib/linkFetcher.ts` override in `eslint.config.mjs` from `complexity: ["error", 18]` to `complexity: ["error", 17]`, and `rtk proxy npx eslint src/lib/linkFetcher.ts` now exits 1 printing a line containing `Async function 'fetchUrlTitle' has a complexity of 18. Maximum allowed is 17` with rule id `complexity` and the summary `1 problem (1 error, 0 warnings)`; then `cp /tmp/RH-39-eslint.bak eslint.config.mjs && rm /tmp/RH-39-eslint.bak` and `shasum eslint.config.mjs` prints the same digest recorded before the edit.

ER5 - The vitest guard exists and passes. The file `src/lib/__tests__/complexityBudget.test.ts` exists, and `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts` exits 0 reporting `Test Files  1 passed (1)` and `Tests  6 passed (6)`. The six test names, all inside `describe('complexity budget (F20)')`, are exactly: `sets the base budget for src at complexity 15, max-depth 4, max-lines-per-function 200, max-params 4 and max-lines 400`; `relaxes the budget for test files to max-lines-per-function off and max-lines 800`; `lists at most 24 per-file overrides, each naming a file that exists`; `relaxes only the five budget rules, and never below the base threshold`; `reports no budget violation anywhere under src`; `pins every override ceiling to the current worst number in its file`. Running `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts --reporter=verbose` prints all six names.

ER6 - The guard itself is tamper-proof in both directions. Record `shasum eslint.config.mjs` and `cp eslint.config.mjs /tmp/RH-39-eslint.bak`. Tamper A (an override removed without fixing the file): delete the single override line whose `files` is `["src/lib/linkFetcher.ts"]`, then `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts` exits 1 with the test `reports no budget violation anywhere under src` failing and the failure output naming `src/lib/linkFetcher.ts` and `complexity`; restore with `cp /tmp/RH-39-eslint.bak eslint.config.mjs`. Tamper B (an override added for a file that does not need one): insert the line `{ name: "complexity-budget/override", files: ["src/lib/statusConfig.ts"], rules: { complexity: ["error", 20] } },` inside the marked block, then `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts` exits 1 with both `lists at most 24 per-file overrides, each naming a file that exists` failing (25 entries) and `pins every override ceiling to the current worst number in its file` failing with output naming `src/lib/statusConfig.ts`; restore with `cp /tmp/RH-39-eslint.bak eslint.config.mjs && rm /tmp/RH-39-eslint.bak`, after which `shasum eslint.config.mjs` prints the digest recorded at the start of this ER and `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts` exits 0 again.

ER7 - `AGENTS.md` documents the budget, additively. `git diff b85d0c6 -- AGENTS.md` shows only added lines (no line beginning with `-` other than the `---` file header), and `grep -c 'Complexity budgets (F20)' AGENTS.md` prints `1`. The added text sits inside the `**Testing & quality**` bullet list and mentions, verbatim, all of: `complexity` 15, `max-depth` 4, `max-lines-per-function` 200, `max-params` 4, `max-lines` 400, `max-lines` 800 for tests, `BEGIN:complexity-budget-overrides`, the phrase `may only shrink`, the bracket-escaping warning, and `src/lib/__tests__/complexityBudget.test.ts`.

ER8 - The existing static gates are unchanged. From the project root: `npm run lint:dead` exits 0 with no unused files, exports or dependencies reported; `npm run lint:dup` exits 0 and reports no more than 18 clones and no more than 230 duplicated lines (at most 0.69 %); `./node_modules/.bin/tsc --noEmit` exits 0 and writes nothing to stdout or stderr; `npm run audit` exits 0 reporting `found 0 vulnerabilities`.

ER9 - The whole unit suite and the coverage gate still pass. With Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` present in `.env.local` (without both, DB-backed files skip and the run is meaningless), `rtk proxy npx vitest run` exits 0 with at least 89 test files passed, at least 1034 tests passed, 0 failed and 0 skipped (baseline at `b85d0c6` was 88 files / 1034 tests / 0 skipped, and this task adds exactly one file with six tests). Under the same preconditions `npm run test:coverage` exits 0 with the configured thresholds met (statements 80, branches 65, functions 78, lines 80).

ER10 - The application still builds and serves. `rtk proxy npx next build` exits 0 with no error, and `rtk proxy npx playwright test e2e/ssr-smoke.spec.ts` exits 0 reporting `4 passed`.

ER11 - The version is bumped, the landing page is untouched, and the diff stays inside the task's whitelist. `package.json` `version` is `0.1.82-YYYYMMDDHHmm` with a real local-time timestamp and is strictly greater than the baseline `0.1.81-202609072207`. `git diff --name-only b85d0c6` lists nothing outside the set {`eslint.config.mjs`, `AGENTS.md`, `package.json`, `docs/tasks/RH-39-spec.md`, `docs/suggestions-log.md`, `src/lib/__tests__/complexityBudget.test.ts`}; in particular `.github/workflows/ci.yml` is not listed, because this task deliberately does not turn the warning-tolerant situation (no eslint job at all, `npx eslint .` exiting 1 on 10 pre-existing errors) into a hard CI failure. `git diff --name-only b85d0c6 -- src` prints exactly the single line `src/lib/__tests__/complexityBudget.test.ts`. `git diff --name-only b85d0c6 -- src/components/landing src/i18n/dictionaries` prints nothing: this is an internal quality gate, not a selling point, so the Landing Page Rule requires no landing copy change.

## Out of Scope

- **F11, the decomposition of `src/app/playlists/[id]/page.tsx`** (1344 lines, complexity 34, 24 `useState` calls, effort L). It is listed under the same T6 in `docs/plans/code-quality-review.md`, but it is a separate PR-sized deliverable: extracting `SongPicker`, a shared `useTagEditor`, collapsing the four focus effects and grouping the panel flags into a `useReducer`. Here it only receives a per-file override at its current numbers (`complexity 34`, `max-lines-per-function 1072`, `max-lines 1344`), which freezes it. The orchestrator creates the follow-up task; when it lands, that override must be lowered or deleted, and ER5's test 6 forces the issue.
- **F15, moving page reads into Server Components** - tracked as RH-41.
- **Fixing any of the other 33 over-budget files.** Each is frozen at its current numbers, no more.
- **Adding an eslint job to `.github/workflows/ci.yml`.** See the Audit: `npx eslint .` exits 1 today on 10 pre-existing errors unrelated to this task, so a lint gate would have to either fail the build immediately or be introduced non-blocking, and neither belongs in a task whose contract is "the budget is enforced". The guard test delivers the CI enforcement F20 asks for. Clearing the 10 errors and then wiring a real `npm run lint` gate is recommended as a follow-up.
- **Budgets for `e2e/`, `scripts/` and root-level config files.** The base block is scoped to `src/**` only, matching the measured baseline.
- **Ratcheting the thresholds below 15 / 4 / 200 / 4 / 400.** F20 says to ratchet down as F11 and F15 land; that is future work.

## Post-merge checks (orchestrator)

- Create the F11 follow-up task (see the spec report) and, when it lands, verify the `src/app/playlists/[id]/page.tsx` override is removed from `eslint.config.mjs` and `MAX_OVERRIDES` is lowered.
- Watch the first CI run: the guard adds roughly 7 s to the vitest suite in both the reusable `test` job and the `coverage` job.

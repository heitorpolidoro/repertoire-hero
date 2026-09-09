# RH-60 — Corrigir as 5 vulnerabilidades novas do npm audit (next critico, sharp, js-yaml, @vitest/mocker)

**Priority:** CRITICAL · **blockedBy:** none · **Baseline commit:** `55656fe`

## Scope

Bring the dependency tree back to `found 0 vulnerabilities` so the `Dependency audit (npm audit)`
CI job (added by RH-33) goes green again, and prove that the required `next` major-line patch
bump (16.3.0 -> 16.3.4) breaks neither the build, nor SSR, nor any gate.

`package-lock.json` at HEAD is byte-identical to `55656fe`: nothing in this repository changed.
Four advisories were published against packages already in the tree, so the gate turned red
without a single commit. One of them (`next`) is **critical** and its fix is outside the pinned
range, so `package.json` must change — which is why this is not a plain `npm audit fix` like
RH-33 was.

**In scope (the complete file whitelist for this task):**

| File | Change |
|---|---|
| `package.json` | version bump + `"next"` pin moved from `16.3.0` to `16.3.4` |
| `package-lock.json` | refreshed by `npm install` + `npm audit fix` + `npm update @vitest/coverage-v8` |
| `docs/tasks/RH-60-spec.md` | this file |
| `docs/suggestions-log.md` | optional, for out-of-scope observations found while working |

**Explicitly NOT in scope:** anything under `src/`, `e2e/`, `migrations/`, `scripts/`, `docker/`,
`public/`, `.github/`; `AGENTS.md` (see "AGENTS.md" below — the investigation proved no rule
changes and no regenerated block); `next.config.ts`; the landing page.

## Audit at 55656fe

`npm run audit` (i.e. `npm audit --audit-level=high`) exits **1** and reports
`5 vulnerabilities (2 moderate, 2 high, 1 critical)`. `npm audit --json` gives
`{"info":0,"low":0,"moderate":2,"high":2,"critical":1,"total":5}`.

`npm ls next sharp js-yaml @vitest/mocker vitest` at `55656fe` prints:

```
+-- @sentry/nextjs@10.69.0
| `-- next@16.3.0 deduped
+-- @vercel/analytics@2.0.1
| `-- next@16.3.0 deduped
+-- @vitest/coverage-v8@4.1.6
| `-- vitest@4.1.6 deduped
+-- better-auth@1.6.22
| +-- next@16.3.0 deduped
| `-- vitest@4.1.6 deduped
+-- eslint@9.39.4
| `-- @eslint/eslintrc@3.3.5
|   `-- js-yaml@4.3.1
+-- next@16.3.0
| `-- sharp@0.35.3
`-- vitest@4.1.6
  `-- @vitest/mocker@4.1.6
```

| Package | Installed | Severity | Advisory | Direct? | Fix | In declared range? |
|---|---|---|---|---|---|---|
| `next` | 16.3.0 | **critical** | GHSA-p293-qw3h-jr36 (unauthenticated RCE on Windows-hosted servers), GHSA-2xp9-vwfh-vxw4 (unauthenticated RCE in the Image Optimization API for AVIF) | **direct** prod dep, pinned exactly `"next": "16.3.0"` (also a peer of `@sentry/nextjs`, `@vercel/analytics`, `better-auth`, all deduped onto the root copy) | `16.3.4` | **No** — vulnerable range is `16.0.0 - 16.3.2`, so `package.json` must change. `npm audit fix` refuses it and only offers `--force`. |
| `sharp` | 0.35.3 | high | GHSA-rgj7-g3m4-5g8c (libheif GHSA-g89c-p67h-r497 + GHSA-2jg2-4ch7-h545) | transitive, **optional dependency of `next`** (`next@16.3.0` asks `sharp@^0.35.3`) | `>= 0.35.4` | Yes, transitively: `next@16.3.4` asks `sharp@^0.35.4`, so the `next` bump carries this one for free. `0.35.4` is the newest 0.35.x published. |
| `js-yaml` | 4.3.1 | high | GHSA-2883-xcg3-v3hh (`maxTotalMergeKeys` does not bound CPU for empty merge sources) | transitive: `eslint@9.39.4 > @eslint/eslintrc@3.3.5 > js-yaml` | `4.3.2` | **Yes** — `@eslint/eslintrc@3.3.5` asks `js-yaml@^4.1.1`, and `4.3.2` is the patched release inside that range. Plain `npm audit fix` handles it; no `overrides` and no `eslint` bump needed. |
| `@vitest/mocker` | 4.1.6 | moderate | GHSA-82fw-gwwq-j7x9 (path traversal / arbitrary file read via the redirect mock) | transitive: `vitest@4.1.6 > @vitest/mocker` | `>= 4.1.11` (via `vitest >= 4.1.11`) | **Yes** — `vitest` is declared `^4.1.6` and `4.1.11` is published. |
| `vitest` | 4.1.6 | moderate | reported as "depends on vulnerable versions of `@vitest/mocker`" | direct dev dep, `^4.1.6` | `4.1.11` | Yes. |

**The `@vitest/coverage-v8` trap.** `@vitest/coverage-v8@4.1.6` peer-depends on `vitest` at the
**exact** version `4.1.6`. `npm audit fix` moves `vitest` to `4.1.11` but leaves
`@vitest/coverage-v8` at `4.1.6`, and the tree then reports
`vitest@4.1.11 invalid: "4.1.6" from node_modules/@vitest/coverage-v8` on three `npm ls` nodes even
though `npm audit` is already clean. `@vitest/coverage-v8` is declared `^4.1.6`, so this is fixed
inside the existing range by one extra `npm update @vitest/coverage-v8`; `package.json` does not
change. Skipping this step is the single most likely way to ship a half-fixed tree.

### next 16.3.0 -> 16.3.4 risk assessment

Every release between the two is a backport/patch release; none introduces a feature or a breaking
change (release notes, `vercel/next.js`):

- **16.3.1** — Turbopack chunk/HMR fixes, `next/image` "preserve image response after optimization",
  a `@swc/helpers` bump (this is why the lockfile moves `@swc/helpers` 0.5.15 -> 0.5.23), restored
  live `headers()` view, `unstable_cache` naming, router prefetch-loop fixes.
- **16.3.2** — app-entry export validation scoped to the app directory, catch-all index page fix,
  Turbopack asset-prefix/WASM fixes.
- **16.3.3** — **the security release**: the two critical advisories above. It closes the AVIF RCE by
  disabling AVIF optimization.
- **16.3.4** — re-enables AVIF Image Optimization with the fix (PR #97949), plus three backports
  (testmode fetch recursion, build error when aliasing `typescript`, unset `crossOrigin` in
  Turbopack manifests).

Nothing in 16.3.1-16.3.4 touches `serverExternalPackages` semantics (the RH-32 rule in
`next.config.ts` stays exactly as written), `useSearchParams` Suspense behaviour, or the shape of
`next build` output. The project builds with Webpack (`next dev --webpack`, and `next build` with a
`turbopack: {}` stanza only to silence a config warning), so the Turbopack-only fixes are inert
here.

**The `nextjs-agent-rules` block does not move.**
`node_modules/next/dist/server/lib/generate-agent-files.js` is **byte-identical** between 16.3.0 and
16.3.4 (`shasum -a 256` matches:
`2b9149fa71f1e6feec027c92ce33357e71a4926d1d3c4a881d97621ac3ef97da`), so the block it writes into
`AGENTS.md` between `<!-- BEGIN:nextjs-agent-rules -->` and `<!-- END:nextjs-agent-rules -->` is the
text already committed. Confirmed empirically: in the probe, `AGENTS.md` was hashed before
`npx next build` and `shasum -a 256 -c` printed `AGENTS.md: OK` afterwards. The bundled
`node_modules/next/dist/docs/**` corpus does change between the two versions, but it is inside
`node_modules` and never enters the diff. **Therefore `AGENTS.md` must be byte-identical to
`55656fe` at the end of this task**; if a stray `next dev` rewrites it anyway, `git checkout --
AGENTS.md` it before committing.

### Probe results (already performed — do not redo)

Everything below was measured in a throwaway `cp`/`rsync` copy of the repository (no `git worktree`,
per the project rule), which was deleted afterwards. The repository tree was never installed into.

The sequence in **Approach** was run twice: once as a full `npm install` in a complete copy of the
repo, and once as `--package-lock-only` starting from `git show 55656fe:package.json` +
`git show 55656fe:package-lock.json`. **The two resulting lockfiles are identical package-for-package
(0 version differences)**, so the recipe is deterministic. Final state: `next@16.3.4`,
`sharp@0.35.4`, `js-yaml@4.3.2`, `vitest@4.1.11`, `@vitest/mocker@4.1.11`,
`@vitest/coverage-v8@4.1.11`, `npm audit --audit-level=high` exit 0 with `found 0 vulnerabilities`,
`npm ls` clean (no `invalid`, no `missing`).

The lockfile diff is 449 changed lines and moves exactly these packages, and nothing else
(`packages` count 874 -> 875, `lockfileVersion` stays 3):

```
next                      16.3.0  -> 16.3.4     @next/env, @next/swc-* (8)   16.3.0 -> 16.3.4
sharp                     0.35.3  -> 0.35.4     @img/sharp-*        (13)     0.35.3 -> 0.35.4
                                                @img/sharp-libvips-* (10)    1.3.2  -> 1.3.3
                                                @emnapi/runtime              ADDED 1.11.3
                                                  (nested under @img/sharp-wasm32)
js-yaml                   4.3.1   -> 4.3.2      @swc/helpers        0.5.15   -> 0.5.23
vitest                    4.1.6   -> 4.1.11     @vitest/{coverage-v8,expect,mocker,pretty-format,
                                                 runner,snapshot,spy,utils}  4.1.6 -> 4.1.11
```

Gate measurements in the probe, on `next@16.3.4` / `vitest@4.1.11`:

- `./node_modules/.bin/tsc --noEmit` — no output, exit 0.
- `rtk proxy npx eslint .` — `22 problems (8 errors, 14 warnings)`. **Identical to the `55656fe`
  baseline measured in the untouched repository**, so the Next bump does not move the lint baseline.
- `npm run lint:dead` (knip) — no finding, exit 0.
- `npm run lint:dup` (jscpd) — `Found 19 clones.`, Total row `19` clones / `242 (0.71%)` lines.
- `rtk proxy npx vitest run` — `Test Files 92 passed (92)`, `Tests 1064 passed (1064)`, exit 0, no
  skips, no flake on that run.
- `npm run test:coverage` — exit 0, `All files 97.38 | 85.43 | 99.41 | 97.95`.
- Guard files: `complexityBudget.test.ts` 6 passed, `dbRowTypes.test.ts` 3 passed,
  `serverExternalPackages.test.ts` 2 passed (the RH-32 guard file does exist under that exact name).
- `npx next build` — exit 0, no `^Error|^Failed|Failed to compile` line, `AGENTS.md` unchanged,
  tracked `next-env.d.ts` / `public/pdf.worker.min.mjs` unchanged.
- `PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" npx playwright test e2e/ssr-smoke.spec.ts`
  — `4 passed`, exit 0. **Caveat, and it is not a RH-60 regression:** this machine's
  `.env.production.local` (written by the Vercel CLI) contains `BETTER_AUTH_SECRET=""`, which in
  production mode takes precedence over the real value in `.env.local`; without an explicit override
  `next start` dies with `BetterAuthError: You are using the default secret` and the Playwright
  global setup fails with `sign-in failed (500)`. Export the real secret into the environment first
  (see ER9), because a process env var wins over every dotenv file.
- `npm install` a second time — lockfile unchanged (`shasum -a 256 -c` prints
  `package-lock.json: OK`). `rm -rf node_modules && npm ci` — exit 0, `added 690 packages`, no
  `npm error` line, lockfile still unchanged.

**Not published, so not an option:** there is no patched `16.3.x` below `16.3.3` and no 4.x `js-yaml`
below `4.3.2` that clears its advisory. `16.3.3` alone would clear the advisories but ships with AVIF
optimization disabled; `16.3.4` restores it, so `16.3.4` is the correct target.

## Approach

### 1. Move the `next` pin (and only that) in `package.json`

Edit `package.json` by hand — replace `"next": "16.3.0",` with `"next": "16.3.4",`. **Do not** run
`npm install next@16.3.4`: it rewrites the pin as `"^16.3.4"`, silently dropping the project's exact
pin. If you prefer the CLI, `npm install next@16.3.4 --save-exact` is the equivalent.

`eslint-config-next` stays at `16.0.1`. It is **not** required to match `next`: it declares no
peer dependency on `next` at all (its peers are `eslint >=9.0.0` and `typescript >=3.3.1`), it is
already three minors behind at `55656fe`, and the only thing that differs between `16.0.1` and
`16.3.4` is the pinned `@next/eslint-plugin-next` version — bumping it would move the lint baseline
for no security benefit. Leave it alone. Do not touch any other declared range.

### 2. Refresh the lockfile

Run, in this order, from the repository root:

```bash
npm install
npm audit fix
npm update @vitest/coverage-v8
```

- `npm install` resolves the new `next` pin and pulls `sharp` to `0.35.4` with it.
- `npm audit fix` (plain, **never `--force`**) closes `js-yaml` and `@vitest/mocker`/`vitest` inside
  their declared ranges.
- `npm update @vitest/coverage-v8` realigns the coverage reporter with `vitest@4.1.11` so `npm ls`
  reports no `invalid` peer. It changes `package-lock.json` only.

Then confirm `git diff --name-only 55656fe -- package.json` shows only the `next` line and the
version line, and that no `overrides` / `resolutions` block appeared. Do not hand-edit
`package-lock.json`. If `npm audit` still reports anything after these three commands, stop and
report rather than inventing an `overrides` block.

### 3. Verify the app still builds and serves

`npx next build` (not `npm run build`, which additionally runs `scripts/migrate.mjs` and
`scripts/deduplicate-songs.mjs` against a live database), then the RH-32 SSR guard:
`PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" npx playwright test e2e/ssr-smoke.spec.ts`,
with `BETTER_AUTH_SECRET` exported as described in ER9. `next start` (production) rather than
`next dev` is the point: RH-32's `Cannot read properties of null (reading 'useRef')` only ever
appeared in an SSR production render.

### 4. AGENTS.md

Do not touch it. The investigation above proves no rule changes (`serverExternalPackages` semantics
are unchanged; the audit-gate bullet added by RH-33 already describes this gate correctly) and that
the `nextjs-agent-rules` block is not regenerated by 16.3.4. If a `next dev` run rewrites the block
anyway, revert it (`git checkout -- AGENTS.md`) before committing: the regenerated text is identical,
so the change would be pure noise.

### 5. Numbers this spec pins

Because the probe measured them on `next@16.3.4`, the acceptance numbers below are the **post-bump**
numbers, and every one of them happens to equal its `55656fe` baseline: eslint
`22 problems (8 errors, 14 warnings)`, jscpd `19` clones / `242` duplicated lines, 92 test files /
1064 tests, budget guard 6 tests, `dbRowTypes` 3 tests. The Next bump moved no gate.

### 6. Version bump

Per the AGENTS.md Version Bumping Rule, bump `package.json` to `0.1.88-YYYYMMDDHHmm` in local time.
The highest version already used is `0.1.87-202609081036`; the new value must sort strictly above it.

### 7. Landing Page Rule

**This task ships no selling point.** Patching four CVEs in the dependency tree is internal and
operational, with no user-visible behaviour change. Per the Landing Page Rule,
`src/components/landing/LandingPage.tsx` and the `landing.*` keys in
`src/i18n/dictionaries/en.json` and `pt-BR.json` must not be touched — and in fact no file under
`src/` may change at all (ER10).

## Expected Results

ER1 - the audit gate is green again and every one of the five advisories is gone. From the
repository root, `npm run audit` exits 0 (`npm run audit; echo $?` prints `0`) and its output ends
with the line `found 0 vulnerabilities`. The machine-readable form agrees:
`npm audit --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify(JSON.parse(s).metadata.vulnerabilities)))"`
prints exactly `{"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}`. Named
individually, none of the five advisory subjects is reported any more:
`npm audit 2>&1 | grep -cE '^(next|sharp|js-yaml|@vitest/mocker) '` prints `0`. At the `55656fe`
baseline the same three commands gave exit `1`,
`5 vulnerabilities (2 moderate, 2 high, 1 critical)`,
`{"info":0,"low":0,"moderate":2,"high":2,"critical":1,"total":5}` and `4` (npm prints the fifth
subject, `vitest`, indented under `@vitest/mocker`, so the anchored pattern does not count it).

ER2 - `next` is pinned at exactly `16.3.4` in `package.json`, installed at `16.3.4`, and no escape
hatch was added. `grep -c '"next": "16.3.4"' package.json` prints `1` and
`grep -c '"next": "\^16.3.4"' package.json` prints `0` (the exact pin was preserved, not converted
to a caret range). `node -p "require('./node_modules/next/package.json').version"` prints `16.3.4`.
`node -e "const p=require('./package.json');console.log(('overrides' in p||'resolutions' in p)?'HAS-OVERRIDES':'NO-OVERRIDES')"`
prints `NO-OVERRIDES`. `package.json` moved on exactly two lines and only those two:
`git diff 55656fe -- package.json | grep -cE '^[+-][^+-]'` prints `4` (the removed and added
`"version"` line, the removed and added `"next"` line), and
`git diff 55656fe -- package.json | grep -E '^[+-] +"(eslint-config-next|react|react-dom|webpack|@sentry/nextjs|vitest|@vitest/coverage-v8)"'`
prints nothing and exits 1 - in particular `eslint-config-next` stays at `16.0.1`, since it has no
peer dependency on `next`.

ER3 - all four vulnerable packages are at or above their fixed versions and the installed tree is
internally consistent. `npm ls next sharp js-yaml @vitest/mocker vitest @vitest/coverage-v8` exits 0
and its output contains no occurrence of the words `invalid`, `missing`, `UNMET` or `extraneous`
(`npm ls next sharp js-yaml @vitest/mocker vitest @vitest/coverage-v8 2>&1 | grep -cE 'invalid|missing|UNMET|extraneous'`
prints `0`). In that same output `next` appears as `16.3.4`, `sharp` as `0.35.4` or higher (and below
`0.36.0`), `js-yaml` as `4.3.2` or higher (and below `5.0.0`), and `vitest`, `@vitest/mocker` and
`@vitest/coverage-v8` all as `4.1.11` or higher (and below `5.0.0`) at **the same** version as each
other - `@vitest/coverage-v8` peer-depends on the exact `vitest` version, so a mismatch here is a
failure even when `npm audit` is clean. At `55656fe` the same command printed `next@16.3.0`,
`sharp@0.35.3`, `js-yaml@4.3.1` and the `4.1.6` vitest trio.

ER4 - the lockfile changed, and only for the packages this fix is allowed to move. `git diff --stat
55656fe -- package-lock.json` prints a non-empty stat line for `package-lock.json`. The set of moved
entries is inside the allowed set - run, from the repository root:
```bash
git show 55656fe:package-lock.json > /tmp/rh60-base-lock.json
cat > /tmp/rh60-lockscope.mjs <<'EOF'
import fs from 'fs'
const B = JSON.parse(fs.readFileSync('/tmp/rh60-base-lock.json', 'utf8'))
const A = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'))
const V = l => Object.fromEntries(Object.entries(l.packages).filter(([k]) => k).map(([k, v]) => [k, v.version]))
const b = V(B), a = V(A)
const ok = n => ['next', 'sharp', 'js-yaml', 'vitest', '@swc/helpers', '@emnapi/runtime'].includes(n)
  || n.startsWith('@img/') || n.startsWith('@next/') || n.startsWith('@vitest/')
const bad = []
for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
  if (b[k] === a[k]) continue
  const name = k.split('node_modules/').pop()
  if (!ok(name)) bad.push((b[k] === undefined ? 'ADDED ' : a[k] === undefined ? 'REMOVED ' : 'CHANGED ') + k + ' ' + b[k] + ' -> ' + a[k])
}
console.log(bad.length === 0 ? 'LOCKFILE-SCOPE OK' : 'LOCKFILE-SCOPE FAIL\n' + bad.join('\n'))
EOF
node /tmp/rh60-lockscope.mjs
```
which prints exactly `LOCKFILE-SCOPE OK`. The root dependency range followed the pin:
`node -e "console.log(require('./package-lock.json').packages[''].dependencies.next)"` prints
`16.3.4`, and `node -e "console.log(require('./package-lock.json').lockfileVersion)"` still prints
`3`.

ER5 - the lockfile is settled and a clean install from it works. Running the installer again is a
no-op: `shasum -a 256 package-lock.json > /tmp/rh60-lock.sha && npm install; echo $?` prints `0` and
`shasum -a 256 -c /tmp/rh60-lock.sha` then prints `package-lock.json: OK`. A from-scratch install
succeeds: `rm -rf node_modules && npm ci; echo $?` prints `0`, its output contains no line matching
`npm error`, and `shasum -a 256 -c /tmp/rh60-lock.sha` still prints `package-lock.json: OK`
afterwards (the install did not rewrite the lockfile). In the probe `npm ci` reported
`added 690 packages`.

ER6 - every static gate holds at the number this spec pins, which is also its `55656fe` baseline -
the Next bump moved none of them. Run each from the repository root and append `; echo $?` to read
the exit status. `./node_modules/.bin/tsc --noEmit` prints nothing and exits 0. `rtk proxy npx
eslint .` ends with the line `22 problems (8 errors, 14 warnings)` (this exact count; a shell hook
rewrites a bare `npx eslint`, hence `rtk proxy`). `npm run lint:dead` prints no knip finding and
exits 0. `npm run lint:dup` prints `Found 19 clones.` and a `Total:` row whose clone column is `19`
and whose duplicated-lines column is `242 (0.71%)`, and exits 0. The three guard files still pass at
their own counts: `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts` prints
`Tests 6 passed (6)`, `rtk proxy npx vitest run src/lib/__tests__/dbRowTypes.test.ts` prints
`Tests 3 passed (3)`, and `rtk proxy npx vitest run src/lib/__tests__/serverExternalPackages.test.ts`
prints `Tests 2 passed (2)` - that last one is the RH-32 guard, and it passing is the mechanical
statement that `next.config.ts`'s `serverExternalPackages` still lists only Node-only packages after
the upgrade.

ER7 - the whole unit/integration suite is green and unchanged in size on `vitest@4.1.11`.
Precondition: a local Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
with the migrations applied (`npm run db:migrate`) and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in the
environment or in `.env.local`; without them six DB-backed files skip 51 tests and the run is
meaningless. `rtk proxy npx vitest run` prints `Test Files 92 passed (92)` and
`Tests 1064 passed (1064)`, with no `skipped` and no `todo` count in either line. This task adds and
removes no test, so fewer than 92 files or fewer than 1064 tests fails this result. **RH-59 flake
disposal:** the only tolerated failure is
`complexity budget (F20) > sets the base budget for src at complexity 15, ...` in
`src/lib/__tests__/complexityBudget.test.ts` timing out with `Test timed out in 5000ms` under
full-suite parallel load; if and only if that is the sole failure, re-run
`rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts` in isolation and it must print
`Tests 6 passed (6)` for this result to count as passed. Any other failing test, or any skipped
test, fails ER7. A warning line about `configLoader: 'native'` / `ESM syntax in a file loaded as
CommonJS (vitest.config.ts:1:1)` is pre-existing at `vitest@4.1.6` and is not a failure.

ER8 - the coverage gate still clears its thresholds. With the same Postgres and
`SUPABASE_SERVICE_ROLE_KEY` precondition as ER7, `npm run test:coverage` produces an `All files` row
whose four columns are each at or above the configured thresholds - statements >= 80, branches >= 65,
functions >= 78, lines >= 80 - and its output contains no line matching
`ERROR: Coverage for .* does not meet global threshold`. Its exit code may be non-zero only under
the ER7 RH-59 exception, attributed the same way and with the same isolated re-run; otherwise it
exits 0. The probe measured `All files 97.38 | 85.43 | 99.41 | 97.95`, so a value materially below
that is a finding even when it clears the threshold.

ER9 - the app still builds and still renders server-side on `next@16.3.4`. `npx next build` exits 0
(`npx next build; echo $?` prints `0`) and its output contains no line matching
`^Error|^Failed|Failed to compile` - do not grep for `Compiled successfully`, this Next version does
not print that phrase on success, and use `npx next build` rather than `npm run build`, which also
runs `scripts/migrate.mjs` and `scripts/deduplicate-songs.mjs` against a live database. Then the
RH-32 SSR guard, against the production server and not `next dev`:
```bash
export BETTER_AUTH_SECRET="$(grep '^BETTER_AUTH_SECRET=' .env.local | cut -d= -f2- | tr -d '"')"
PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" npx playwright test e2e/ssr-smoke.spec.ts
```
prints `4 passed` and exits 0. The explicit export is required and is not a code smell: this
machine's Vercel-generated `.env.production.local` sets `BETTER_AUTH_SECRET=""`, which outranks
`.env.local` in production mode, and without the override `next start` aborts with
`BetterAuthError: You are using the default secret` and the Playwright global setup fails with
`sign-in failed (500)` - a false negative unrelated to this task.

ER10 - the change stays inside the whitelist, the version went up, and neither the landing page nor
`AGENTS.md` moved. `git diff --name-only 55656fe | sort` lists only paths drawn from this closed
set: `docs/suggestions-log.md`, `docs/tasks/RH-60-spec.md`, `package-lock.json`, `package.json` - any
other path fails this result. No application or infrastructure file moved, tracked or untracked:
`git diff --name-only 55656fe -- src e2e migrations scripts docker public .github next.config.ts`
prints nothing and
`git status --porcelain src e2e migrations scripts docker public .github next.config.ts` prints
nothing. `AGENTS.md` is byte-identical to the baseline:
`git diff 55656fe -- AGENTS.md` prints nothing, which in particular means the
`<!-- BEGIN:nextjs-agent-rules -->` block was not committed in a regenerated form (the generator is
byte-identical between 16.3.0 and 16.3.4, so any diff there is noise and must be reverted). This
task ships no selling point, so per the Landing Page Rule
`git diff --name-only 55656fe -- src/components/landing src/i18n/dictionaries/en.json src/i18n/dictionaries/pt-BR.json`
prints nothing. Finally `node -p "require('./package.json').version"` prints a string matching
`^0\.1\.88-[0-9]{12}$`, which sorts strictly after the baseline `0.1.87-202609081036`.

## Post-merge checks (orchestrator/operator, not QA)

Not expected results: QA runs before the commit exists, so none of these can pass at QA time.

- **Dependabot alerts close.** After the commit reaches `master` and GitHub's dependency-graph rescan
  completes (asynchronous - a non-zero count immediately after the push is not a failure),
  `gh api repos/heitorpolidoro/repertoire-hero/dependabot/alerts?state=open --jq 'length'` should
  print `0`.
- **The audit job goes green.** `gh run list --branch master --limit 1 --json databaseId --jq '.[0].databaseId'`,
  then `gh run view <run-id> --json jobs --jq '.jobs[] | select(.name == "Dependency audit (npm audit)") | .conclusion'`
  should print `success`. This also unblocks RH-40 ER6.
- **Vercel deploy healthy on next 16.3.4.** The production deployment for the merge commit reaches
  `READY`, and a signed-out `GET /` on the deployed URL returns HTTP 200 with the landing markup
  (the deployed equivalent of ER9's SSR smoke).

## Out of Scope

- Any change under `src/`, `e2e/`, `migrations/`, `scripts/`, `docker/`, `public/`, `.github/`, or to
  `next.config.ts`. If a test or a lint rule fails after the bump, that is a finding to report, not a
  licence to edit application code.
- `AGENTS.md`. No rule changes; the `nextjs-agent-rules` block is not regenerated by 16.3.4.
- Bumping `eslint-config-next`, `eslint`, `react`, `react-dom`, `webpack`, `@sentry/nextjs`,
  `better-auth` or any other declared range. Exactly one declared range moves: `next`.
- Adding an `overrides` / `resolutions` block, and `npm audit fix --force`. Both are forbidden
  outright: the probe proved the fix needs neither.
- Moving to `next@16.4.x` or any later minor. `16.3.4` is the minimum published version that clears
  both critical advisories with AVIF optimization re-enabled; a minor bump is a different, larger
  risk that belongs to its own task.
- Fixing the RH-59 `complexityBudget.test.ts` flake. ER7 only prescribes how to dispose of it.
- Fixing the `.env.production.local` `BETTER_AUTH_SECRET=""` local-environment quirk described in
  ER9, or the pre-existing `configLoader: 'native'` Vite warning. Both predate this task; log them in
  `docs/suggestions-log.md` if desired.
- Enabling or configuring Dependabot version-update PRs (`.github/dependabot.yml`).
- Landing page copy in either dictionary.

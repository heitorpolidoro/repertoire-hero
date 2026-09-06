# RH-33 — Corrigir vulnerabilidades de dependências (Dependabot / npm audit)

**Priority:** HIGH · **blockedBy:** none · **Baseline commit:** `0f13814`

## Scope

Bring the dependency tree to zero high-severity advisories and add a permanent CI gate so it
cannot silently regress.

**In scope (the complete file whitelist for this task):**

| File | Change |
|---|---|
| `package.json` | version bump + one new `audit` script |
| `package-lock.json` | patched transitive versions (produced by `npm audit fix`) |
| `.github/workflows/ci.yml` | new `audit` job |
| `AGENTS.md` | one line in **Testing & quality** documenting the audit gate |
| `docs/tasks/RH-33-spec.md` | this file |
| `docs/suggestions-log.md` | optional, for out-of-scope observations found while working |

**Explicitly NOT in scope:**

- Anything under `src/`, `e2e/`, `migrations/`, `scripts/`, `docker/`. This task must not change a
  single line of application code. If a test fails after the dependency bump, that is a finding to
  report, not a licence to edit `src/`.
- Upgrading direct dependencies (`next`, `webpack`, `@sentry/nextjs`, `eslint-config-next`, ...).
  No direct dependency range in `package.json` changes.
- Adding an `overrides` block. The investigation (see below) proved it is unnecessary; introducing
  one anyway is a regression of this spec.
- `npm audit fix --force`. Forbidden outright: it performs semver-major upgrades.
- Moderate/low advisories, Dependabot version-update PRs, `Dockerfile`, `vercel.json`.
- Landing page copy (see "Landing Page Rule" below).

## Investigation results (already performed — do not redo)

At `0f13814`, `npm audit --json` reports **2 high-severity package-level vulnerabilities**, both
transitive, both `fixAvailable: true`:

| Package | Installed | Pulled in by | Advisories |
|---|---|---|---|
| `browserslist` | 4.28.2 (`<= 4.28.6` vulnerable) | `webpack@5.106.2` (direct **prod** dep) and `@sentry/nextjs > @sentry/bundler-plugin-core > @babel/core > @babel/helper-compilation-targets` | GHSA-c83g-rgw3-j3cx (unbounded memory growth / OOM), GHSA-73wf-gq98-2v4g (uncaught crash + prototype write via untrusted `browserslist-stats.json`) |
| `fast-uri` | 3.1.5 (`>= 3.0.0 < 3.1.6` vulnerable) | `webpack@5.106.2 > schema-utils@4.3.3 > ajv@8.20.0` (and `ajv-formats > ajv`) | GHSA-jqff-g426-hqxp, GHSA-f65p-4m7j-42xc, GHSA-fph4-wmhf-6fwf, GHSA-5jgf-p345-68v8 (host confusion / SSRF) |

**The "third" Dependabot alert.** `gh` is authenticated (account `heitorpolidoro`, scopes
`gist, read:org, repo, workflow`) and
`gh api repos/heitorpolidoro/repertoire-hero/dependabot/alerts?state=open` returns **6 open alerts,
not 3** — alert numbers 101 and 102 for `browserslist` and 103, 104, 105 and 106 for `fast-uri`.
Every one is `scope: runtime`, `relationship: transitive`, `severity: high`. There is **no third
package**: GitHub opens one alert per advisory while `npm audit` groups advisories per package, so
GitHub's 6 and npm's 2 describe the same two packages. Nothing is GitHub-only and nothing is
already resolved. Patching `browserslist` to `>= 4.28.7` and `fast-uri` to `>= 3.1.6` closes all
six.

**The fix is plain `npm audit fix`.** Both parents already accept the patched versions
(`webpack` requires `browserslist@^4.28.1`, `ajv@8` requires `fast-uri@^3.0.1`), so no `overrides`
entry is needed. Verified in a scratch copy of `package.json` + `package-lock.json`:
`npm audit fix --package-lock-only` left `package.json` byte-identical, changed exactly seven
lockfile entries, and `npm audit --audit-level=high` afterwards printed `found 0 vulnerabilities`
and exited 0. `npm ci --dry-run` on the patched lockfile resolved 689 packages with no error.

The seven entries that moved (the two vulnerable packages plus `browserslist`'s own data
dependencies, all inside existing semver ranges) were:

```
browserslist              4.28.2       -> 4.28.9
fast-uri                  3.1.5        -> 3.1.7
baseline-browser-mapping  2.10.30      -> 2.11.21
caniuse-lite              1.0.30001793 -> 1.0.30001810
electron-to-chromium      1.5.357      -> 1.5.422
node-releases             2.0.44       -> 2.0.54
update-browserslist-db    1.2.3        -> 1.3.2
```

`caniuse-lite` and `electron-to-chromium` publish daily, so the exact right-hand versions will
drift; the acceptance criteria below constrain the *set of packages allowed to move* and the
*minimum patched versions*, not the exact numbers.

## Approach

### 1. Patch the lockfile

```bash
npm audit fix
```

Nothing else. Do not pass `--force`. Do not hand-edit `package-lock.json`. If `npm audit fix`
leaves any high advisory behind (it did not in the scratch run), stop and report rather than
inventing an `overrides` block on your own authority.

### 2. Add the `audit` npm script

In `package.json`, immediately after `"lint:dup"`:

```json
    "audit": "npm audit --audit-level=high",
```

**Full tree, not `--omit=dev`.** Both vulnerable packages happen to sit in the production tree
(`webpack` is listed under `dependencies`), so `--omit=dev` would have caught these two. It is
still the wrong gate:

- Dependabot alerts on the **whole lockfile** regardless of scope. A `--omit=dev` gate would let a
  Dependabot alert sit open on `master` while CI reported green, which is exactly the failure this
  task exists to prevent.
- CI runs `npm ci` with dev dependencies installed and executes them (`vitest`, `eslint`, `knip`,
  `jscpd`, `playwright`), so dev-dependency code does run in the pipeline.
- The baseline after this task is `0 vulnerabilities` across the **full** tree, so the stricter
  gate starts noise-free today.

`--audit-level=high` keeps the gate at the severity the project actually acts on; moderate and low
advisories are reported but do not fail the build.

Note for whoever wires it up: `npm audit` is a built-in npm command, so bare `npm audit` never
invokes this script. CI must call `npm run audit`.

### 3. Wire it into CI

Add a fifth top-level job to `.github/workflows/ci.yml`, mirroring the shape of the existing
`dead-code` and `duplication` jobs:

```yaml
  audit:
    name: "Dependency audit (npm audit)"
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js 24.x
        uses: actions/setup-node@v4
        with:
          node-version: "24.x"
          cache: "npm"

      - name: npm audit (high and above)
        run: npm run audit
```

Deliberately **no `npm ci` step**: `npm audit` resolves the tree from `package-lock.json` alone and
`npm run` does not need `node_modules` to execute a script. This was verified in the scratch dir
with no `node_modules` present (`npm run audit` printed `found 0 vulnerabilities`, exit 0). The job
therefore finishes in seconds instead of paying for a full install.

### 4. Document the gate

Add one line to the **Testing & quality** bullet list in `AGENTS.md`, next to the `knip` and
`jscpd` entries, naming the script, the severity threshold, the reason the audit covers the full
tree rather than production-only, and the CI job that enforces it.

### 5. Version bump

Per the AGENTS.md Version Bumping Rule, bump `package.json` to `0.1.68-YYYYMMDDHHmm` using local
time. The highest version already used is `0.1.67-202609052124`; the new version must sort strictly
above it.

### 6. Landing Page Rule

**This task ships no selling point.** Patching two transitive CVEs and adding a CI audit gate is
internal and operational: no musician or band chooses the app for it, and there is no user-visible
behaviour change at all. Per the Landing Page Rule, `src/components/landing/LandingPage.tsx` and
the `landing.*` keys in `src/i18n/dictionaries/en.json` and `pt-BR.json` **must not be touched**.
This is also enforced mechanically by ER11's "no file under `src/` changed" check.

## Expected Results

ER1 - `package.json` changes are limited to the version bump and the new `audit` script, and no
`overrides` block is introduced. Verify: `git diff 0f13814 -- package.json | grep -cE '^[+-][^+-]'`
prints `3` (one removed and one added `"version"` line, one added `"audit"` line). Verify:
`node -e "const p=require('./package.json'); console.log(('overrides' in p ? 'HAS-OVERRIDES' :
'NO-OVERRIDES') + ' | ' + p.scripts.audit)"` prints exactly
`NO-OVERRIDES | npm audit --audit-level=high`. Verify no direct dependency range moved:
`git diff 0f13814 -- package.json | grep -E '^[+-] +"(next|webpack|react|react-dom|@sentry/nextjs|eslint-config-next)"'`
prints nothing and exits 1.

ER2 - `package-lock.json` moves only the vulnerable packages and their own data dependencies, adds
nothing and removes nothing. Verify by running:
```bash
git show 0f13814:package-lock.json > /tmp/rh33-base-lock.json
cat > /tmp/rh33-lockscope.mjs <<'EOF'
import fs from 'fs'
const B = JSON.parse(fs.readFileSync('/tmp/rh33-base-lock.json', 'utf8'))
const A = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'))
const V = l => Object.fromEntries(Object.entries(l.packages).filter(([k]) => k).map(([k, v]) => [k, v.version]))
const b = V(B), a = V(A)
const allow = new Set(['browserslist', 'fast-uri', 'baseline-browser-mapping', 'caniuse-lite', 'electron-to-chromium', 'node-releases', 'update-browserslist-db'])
const bad = []
for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
  if (b[k] === a[k]) continue
  const name = k.split('node_modules/').pop()
  if (b[k] === undefined) bad.push('ADDED ' + k)
  else if (a[k] === undefined) bad.push('REMOVED ' + k)
  else if (!allow.has(name)) bad.push('UNEXPECTED ' + k + ' ' + b[k] + ' -> ' + a[k])
}
console.log(bad.length === 0 ? 'LOCKFILE-SCOPE OK' : 'LOCKFILE-SCOPE FAIL\n' + bad.join('\n'))
EOF
node /tmp/rh33-lockscope.mjs
```
which prints exactly `LOCKFILE-SCOPE OK`. Verify the patched versions clear the advisories:
`npm ls browserslist fast-uri` reports `browserslist` at `4.28.7` or higher and `fast-uri` at
`3.1.6` or higher and below `4.0.0`, at every node it prints.

ER3 - The tree is free of high-severity advisories. Verify: `npm audit --audit-level=high` prints a
final line `found 0 vulnerabilities` and exits 0 (`echo $?` prints `0`). Verify the aggregate:
`npm audit --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify(JSON.parse(s).metadata.vulnerabilities)))"`
prints `{"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}`.

ER4 - The audit gate exists as an npm script and runs in CI. Verify: `npm run audit` prints
`found 0 vulnerabilities` and exits 0 even with `node_modules` absent. Verify:
`grep -nE '^  audit:$|Dependency audit \(npm audit\)|run: npm run audit' .github/workflows/ci.yml`
prints exactly 3 matching lines. Verify: `grep -c 'npm ci' .github/workflows/ci.yml` still prints
`4` (the audit job deliberately adds no install step). Verify the edited workflow is still valid
YAML: `npx js-yaml .github/workflows/ci.yml > /dev/null` exits 0 (`echo $?` prints `0`), so the new
job at least parses.

ER5 - A clean install from the lockfile still works. Verify:
`shasum -a 256 package-lock.json > /tmp/rh33-lock-before.sha && rm -rf node_modules && npm ci; echo $?`
prints `0` with no `npm error` line in the output, and afterwards
`shasum -a 256 -c /tmp/rh33-lock-before.sha` prints `package-lock.json: OK` (the install did not
rewrite the lockfile).

ER6 - The unit/integration suite is unchanged and green. With local Postgres reachable at
`postgresql://postgres:postgres@127.0.0.1:54322/postgres` (migrations applied) and a non-empty
`SUPABASE_SERVICE_ROLE_KEY`, verify: `npx vitest run` prints `Test Files  40 passed (40)` and
`Tests  478 passed (478)`, with no `skipped` count in either line, and exits 0. These are the
`0f13814` baseline numbers and must be identical, because this task adds and removes no test.

ER7 - Every static gate stays at its `0f13814` baseline. Verify each command, from the repo root:
`npx tsc --noEmit` prints no output and exits 0; `npm run lint:dead` prints no knip finding and
exits 0; `npm run lint:dup` prints a Total row of `19` clones and `239 (1.08%)` duplicated lines
and exits 0; `npx eslint .` ends with `30 problems (12 errors, 18 warnings)`.

ER8 - The production build still succeeds with the bumped `browserslist`. Verify: `npx next build`
exits 0 (`echo $?` prints `0`) and its output contains no line starting with
`Failed to compile`. Use `npx next build` rather than `npm run build`, which additionally runs
`scripts/migrate.mjs` and `scripts/deduplicate-songs.mjs` against a live database.

ER9 - The SSR smoke suite passes against that production build. With Postgres running and
migrations applied, verify:
`PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" npx playwright test e2e/ssr-smoke.spec.ts --project=chromium`
prints `4 passed` and exits 0. This is the RH-32 guard against a toolchain change breaking
server-side rendering, and it must run against `next start` (the production server), not `next dev`.

ER10 - `AGENTS.md` documents the gate. Verify: `grep -n 'npm run audit' AGENTS.md` prints at least
one line inside the **Testing & quality** section, and that line names both `--audit-level=high`
and the CI job, and states that the audit covers the full dependency tree (not `--omit=dev`).
Verify: `grep -c 'audit' AGENTS.md` is greater than at the baseline
(`git show 0f13814:AGENTS.md | grep -c 'audit'`).

ER11 - The change touches only the whitelisted files and bumps the version. Verify:
`{ git diff --name-only 0f13814; git ls-files --others --exclude-standard; } | sort -u` prints
exactly `.github/workflows/ci.yml`, `AGENTS.md`, `docs/tasks/RH-33-spec.md`, `package-lock.json`,
`package.json` (plus `docs/suggestions-log.md` only if a suggestion was logged) and nothing else.
Verify no application code moved: `git diff --name-only 0f13814 -- src e2e migrations scripts`
prints nothing and `git status --porcelain src e2e migrations scripts` prints nothing. Verify the
landing page is untouched, per the Landing Page Rule decision that this task ships no selling
point: `git diff --name-only 0f13814 -- src/components/landing src/i18n` prints nothing. Verify
the version bump: `node -e "console.log(require('./package.json').version)"` prints a value
matching `^0\.1\.68-20[0-9]{10}$` that sorts strictly above `0.1.67-202609052124`.

## Post-merge checks (orchestrator/operator, not QA)

These two checks are **not** expected results and must not be handed to QA: QA runs before the
commit exists, so neither can pass at QA time. They are for the orchestrator or the operator to run
after the commit is on `master`.

- **Dependabot alerts close.** After the commit is pushed to `master` and GitHub's dependency-graph
  rescan completes (may take minutes — the dismissal is asynchronous, so a `6` immediately after the
  push is not a failure), `gh api repos/heitorpolidoro/repertoire-hero/dependabot/alerts?state=open --jq 'length'`
  should print `0`. The six open alerts at `0f13814` (numbers 101-106, covering `browserslist` and
  `fast-uri`) are the ones expected to close.
- **The new CI job goes green.** Find the run with
  `gh run list --branch master --limit 1 --json databaseId --jq '.[0].databaseId'`, then
  `gh run view <run-id> --json jobs --jq '.jobs[] | select(.name == "Dependency audit (npm audit)") | .conclusion'`
  should print `success`.

## Out of Scope

- Any change under `src/`, `e2e/`, `migrations/`, `scripts/`, `docker/`.
- Upgrading `next`, `webpack`, `@sentry/nextjs`, `eslint-config-next` or any other direct dependency.
- Adding an `overrides` / `resolutions` block.
- `npm audit fix --force` and any semver-major dependency change.
- Acting on moderate or low severity advisories.
- Enabling or configuring Dependabot version-update PRs (`.github/dependabot.yml`).
- Landing page copy in either dictionary.

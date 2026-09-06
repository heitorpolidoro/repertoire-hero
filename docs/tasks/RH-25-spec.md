# RH-25 — Analisar código do projeto quanto a boas práticas, SOLID, DRY, KISS

**One deliverable: a document.** RH-25 produces a measured, prioritised code-quality
review at `docs/plans/code-quality-review.md`, plus 5–10 follow-up backlog task
proposals. **No source file changes at all.** The findings become new Meridian tasks;
they are not applied here.

The whole point of splitting the analysis from the fixes is that a broad sweep touching
`src/app`, `src/lib`, `src/components` and `src/hooks` would be an unreviewable PR. RH-25
is the sweep; its output is the backlog.

---

## 1. Baseline — measured on the current tree

All numbers below were **re-measured on 2026-09-05** on a clean working tree at commit
`13da8b2` (current `HEAD`, tip after RH-24). They are the pinned baseline: the report
must reproduce them, and QA re-runs the same commands.

### 1.1 Static gates (all clean, all must stay clean)

| Gate | Command | Result at `13da8b2` |
|---|---|---|
| Types | `npx tsc --noEmit` | exit 0, no output |
| Tests | `npx vitest run` | 40 files / 478 tests passed, 0 failed (needs live Postgres + `SUPABASE_SERVICE_ROLE_KEY`) |
| Lint | `npx eslint .` | 12 errors, 18 warnings (pre-existing; lint is **not** required to exit 0) |
| Dead code | `npm run lint:dead` | exit 0 |
| Duplication | `npm run lint:dup` | exit 0 — 19 clones, 239 duplicated lines (**1.08%**), threshold 2 |

Highest version used so far: `0.1.66-202609051735` (current `package.json`).

### 1.2 Size

`git ls-files 'src/*' | grep -E '\.tsx?$' | grep -v '__tests__' | xargs wc -l | sort -rn`
→ **79 production files, 14 661 lines**. Top ten:

```
1586  src/app/songs/[id]/fast-view/page.tsx
1344  src/app/playlists/[id]/page.tsx
 899  src/app/playlists/page.tsx
 817  src/components/tabs/TabDrawingStage.tsx
 721  src/app/profile/page.tsx
 626  src/app/page.tsx
 575  src/components/songs/SongForm.tsx
 506  src/app/bands/[id]/page.tsx
 375  src/lib/songs.ts
 363  src/components/layout/AppLayout.tsx
```

### 1.3 Cyclomatic complexity — the ad-hoc sweep works, and it is damning

ESLint's own `complexity` / `max-depth` / `max-lines-per-function` / `max-params` rules
can be turned on **from the CLI only**, over the project's existing flat config (so the
TypeScript parser resolves), without editing `eslint.config.mjs`. Verified working:

```
104 violations = complexity 43 · max-lines-per-function 40 · max-depth 19 · max-params 2
```

Worst production offenders (test files excluded from this list):

```
src/app/songs/[id]/fast-view/page.tsx:92    FastViewPage        complexity 82
src/app/playlists/[id]/page.tsx:273         PlaylistDetailPage  complexity 34
src/app/bands/[id]/page.tsx:18              BandDetailPage      complexity 30
src/app/playlists/[id]/page.tsx:1076        (arrow)             complexity 29
src/app/api/spotify/playlists/[id]/sync/route.ts:19  POST       complexity 27
src/app/profile/page.tsx:33                 BandProfileView     complexity 23
src/lib/moderation.ts:80    reviewGlobalSongEdit            complexity 21
src/lib/songs.ts:277        createAndAddSong                complexity 21 · 99 lines
```

A single React component with a cyclomatic complexity of **82** is the headline number of
this review.

### 1.4 Typing quality — surprisingly good, and worth saying so

Across the 79 production files: `: any` **3**, `as any` **1**, `as unknown as` **3**,
non-null assertions (`x!.` / `x![`) **0**, `@ts-ignore`/`@ts-expect-error` **0**. There
are ~44 `as <Type>` structural casts, most of them the sanctioned E1 Postgres error-code
form from AGENTS.md. The report must not manufacture a crisis here; it should record the
counts and spend its severity budget elsewhere.

### 1.5 Module boundaries and authorization — where the real findings are

Two probes already returned hard results, and they set the expectation for the depth this
review must reach:

**Domain logic living in the action layer.** `query(` call sites inside `src/app/actions/`:
`repertoire.ts` 6, `tabs.ts` 7, `playlists.ts` 2. AGENTS.md places all data access in
`src/lib/*`; these are actions writing SQL directly.

**Inward dependencies from components to actions.** `src/components/tabs/TabDrawingStage.tsx:6`
and `src/components/layout/AppLayout.tsx:8` import from `@/app/actions/*`, coupling
presentational components to the App Router tree.

**Server Actions with no session resolution.** Exported symbols vs. `getRequiredUserId()`
call sites per file: `bands.ts` 11/5, `moderation.ts` 3/3, `playlists.ts` 9/4,
`profile.ts` 3/3, `repertoire.ts` 14/2, `tabs.ts` 5/5. Spot-checking the gap found a real
one, not a false positive:

```ts
// src/app/actions/bands.ts
export async function deleteBandAction(bandId: string): Promise<void> {
  return deleteBand(bandId)
}
// src/lib/bands.ts
export const deleteBand = async (bandId: string): Promise<void> => {
  const sql = `DELETE FROM bands WHERE id = $1`
  ...
```

Neither layer checks that the caller is an admin of that band — or a member at all. A
Server Action is a public POST endpoint. The same shape holds for `removeBandMemberAction`
and `updateBandAction`. The review must reach conclusions of this calibre, which is why
the report is structured around measurement rather than impressions.

### 1.6 What is already done and must NOT be re-litigated

- **RH-21** — error-handling conventions, documented in AGENTS.md "Error Handling
  Conventions" and enforced by `src/lib/__tests__/errorHandlingStyle.test.ts`.
- **RH-22** — dead code removed; `npm run lint:dead` (knip) enforced in CI.
- **RH-23** — 22 clones de-duplicated into shared modules; jscpd at 1.08% enforced in CI.
- **RH-24** — coverage gate (statements 80 / branches 65 / functions 78 / lines 80 over
  `src/lib`, `src/app/actions`, `src/hooks`, `src/proxy.ts`), jsdom component tests.
- **RH-32** — SSR React-duplication bug fixed via `serverExternalPackages`.

"Add tests", "extract this duplicate", "use `logger` instead of `console.error`" and
"remove unused export" are all already-solved problem classes. A finding that restates one
of them is noise. Findings **may** cite these as context (e.g. "the coverage gate does not
reach page components, which is why an 82-complexity component is invisible to CI").

---

## 2. Scope

**In scope — exactly four files may change:**

| File | Change |
|---|---|
| `docs/plans/code-quality-review.md` | new — the deliverable |
| `docs/tasks/RH-25-spec.md` | this spec |
| `docs/suggestions-log.md` | an `## [RH-25]` section |
| `package.json` | version bump only |

**Out of scope — explicitly:**

- **Any change under `src/`, `e2e/`, `migrations/`, `scripts/`, or any config file**
  (`eslint.config.mjs`, `vitest.config.ts`, `.jscpd.json`, `knip.json`, `next.config.ts`,
  `tsconfig.json`, `.github/workflows/**`). Not one line. The complexity sweep in §3.2 is
  run from the CLI *precisely so that no config file has to be touched.*
- **Fixing anything the report finds.** Including the `deleteBandAction` authorization
  hole in §1.5 — it is severe, and it becomes a `critical`-priority follow-up task, not a
  patch inside RH-25. A security fix needs its own spec, its own regression test and its
  own QA pass.
- **Creating the follow-up Meridian tasks.** RH-25 *proposes* them in §5 of the report,
  ready for `meridian:new`; the operator decides which get created.
- **Fixing the 12 pre-existing eslint errors / 18 warnings.**
- **The landing page.** Per the AGENTS.md Landing Page Rule, RH-25 ships no user-facing
  feature — an internal code-quality review is not a selling point.
  `src/components/landing/LandingPage.tsx` and the `landing.*` keys in
  `src/i18n/dictionaries/en.json` / `pt-BR.json` must not change.

---

## 3. Approach

### 3.1 The report is a measurement, not an opinion

Every claim in the report must be traceable to a command anyone can re-run. Section 1 of
the report ("Method and Reproducibility") states the commit, the date, and the verbatim
commands; section 2 ("Measured Baseline") states their output. QA re-runs them and
compares. This is the mechanism that stops the deliverable from degenerating into a list
of received opinions about React.

### 3.2 The measurement commands (verbatim — the report must contain these)

**M1 — production file sizes**

```bash
git ls-files 'src/*' | grep -E '\.tsx?$' | grep -v '__tests__' | xargs wc -l | sort -rn
```

**M2 - cyclomatic complexity / depth / function length / arity**

This command must appear in the report **exactly as written below, on one line**, with no
shell line-continuation and nothing appended - ER5 greps for it verbatim:

```bash
npx eslint 'src/**/*.ts' 'src/**/*.tsx' --rule '{"complexity":["warn",10],"max-depth":["warn",3],"max-lines-per-function":["warn",120],"max-params":["warn",4]}' -f json
```

When *running* it, the developer may of course redirect its output to a file (e.g. append
`> /tmp/rh25-complexity.json`); that redirection is a local convenience and must not be
written into the command as quoted in the report. The aggregation step below reads that
file:

```bash
node -e "const r=require('/tmp/rh25-complexity.json');const R=['complexity','max-depth','max-lines-per-function','max-params'];const m=r.flatMap(f=>f.messages.filter(x=>R.includes(x.ruleId)).map(x=>({f:f.filePath.split('repertoire_hero/')[1],r:x.ruleId,l:x.line,msg:x.message})));const by={};m.forEach(x=>by[x.r]=(by[x.r]||0)+1);console.log(m.length,JSON.stringify(by));m.filter(x=>x.r==='complexity').sort((a,b)=>parseInt(/complexity of (\d+)/.exec(b.msg)[1])-parseInt(/complexity of (\d+)/.exec(a.msg)[1])).slice(0,15).forEach(x=>console.log(x.f+':'+x.l,x.msg))"
```

`npx eslint` exits non-zero here because of the 12 pre-existing errors; that is expected
and irrelevant — the JSON report is what is read.

**M3 — typing quality** (over the same 79-file production set)

```bash
SRC=$(git ls-files 'src/*' | grep -E '\.tsx?$' | grep -v '__tests__')
for p in ': any' 'as any' 'as unknown as' '@ts-ignore' '@ts-expect-error'; do
  printf '%s\t%s\n' "$p" "$(echo "$SRC" | xargs grep -n -- "$p" | wc -l)"
done
echo "$SRC" | xargs grep -nE '[A-Za-z_$)\]]![.[]' | wc -l   # non-null assertions
```

**M4 — layering / dependency direction**

```bash
grep -rn "from '@/app" src/lib src/hooks src/components | grep -v __tests__   # inward deps
grep -c 'query(' src/app/actions/*.ts                                          # SQL in the action layer
grep -rn "from '@/components\|from '@/app" src/lib | grep -v __tests__
```

**M5 — Server Action authorization**

```bash
for f in src/app/actions/*.ts; do
  echo "$f exports=$(grep -cE '^export (async )?(function|const)' "$f") requireCalls=$(grep -c 'getRequiredUserId()' "$f")"
done
```

**M6 — React surface**

```bash
for f in $(git ls-files 'src/**/*.tsx' | grep -v __tests__); do
  echo "$(grep -c 'useState' "$f") $(grep -c 'useEffect' "$f") $f"
done | sort -rn
```

**M7 — data access**

```bash
grep -rnE '\$\{[^}]+\}' src/lib/*.ts src/app/actions/*.ts | grep -iE 'select|insert|update|delete|from |where '
grep -rn -B3 'await ' src/lib/*.ts src/app/actions/*.ts | grep -E 'for \(|for await|\.map\(async'
grep -rln 'BEGIN' src --include='*.ts' | grep -v __tests__
```

**M8 — the existing gates** (§1.1 commands, re-run verbatim).

### 3.3 The eight areas the review must cover

Every area gets **at least one finding**. This is what makes the review a sweep rather
than a rant about the biggest file.

| Area label (use this exact string in the summary table) | What it means here |
|---|---|
| `Module boundaries` | dependency direction; domain logic in the wrong layer (M4) |
| `Complexity` | the M2 hot-spots; oversized files and functions (M1, M2) |
| `React patterns` | client/server boundaries, `useEffect` used as an event handler, derived state stored in state, prop drilling vs. `zustand` (M6) |
| `Next.js patterns` | `export const dynamic = "force-dynamic"` in the **root** layout, the `src/proxy.ts` matcher, route handlers vs. Server Actions |
| `Data access` | parameterisation, dynamic SQL fragments, transaction boundaries, N+1 (M7) |
| `Typing` | the M3 counts, weak return types, structural casts |
| `Naming & consistency` | `export const` vs. `export async function` in `src/lib`, `Action` suffix discipline, file/dir conventions |
| `Security` | authorization on every action and route (M5), input validation, dev-only endpoints |

### 3.4 Severity and effort scales (fixed vocabulary)

- **Severity** — exactly one of `High`, `Medium`, `Low`.
  `High` = a correctness, security or data-integrity risk, or a structural defect that
  actively blocks safe change. `Medium` = a real maintainability cost. `Low` = a
  consistency or polish issue.
- **Effort** — exactly one of `S` (< 1 day), `M` (1–3 days), `L` (> 3 days or needs its
  own design).

### 3.5 Report structure

`docs/plans/code-quality-review.md`, with these `## ` headings, in this order.

**Every separator shown below is an ASCII hyphen (`-`, U+002D), never an em dash.** ER1,
ER2 and ER8 grep for these strings literally, so an em dash in a heading fails the gate:

```
# Code Quality Review - RH-25
(intro line naming commit 13da8b2 and the review date)

## 1. Method and Reproducibility     <- M1-M8 verbatim, environment preconditions
## 2. Measured Baseline              <- their output; the §1 tables of this spec
## 3. Findings                       <- ### F1 ... F15+, one per finding
## 4. Prioritised Summary            <- the ranked table (all findings, area labels)
## 5. Proposed Follow-up Tasks       <- ### T1 ... T5-T10, ready for meridian:new
## 6. Already Addressed - Not Re-Litigated   <- RH-21/22/23/24/32
## 7. Out of Scope                   <- incl. the Landing Page Rule statement
```

**Finding block** - `### F<n> - <title>` (hyphen, spaces either side), then exactly these
five labels, each starting its own line at column 0:

```markdown
### F7 - deleteBandAction deletes any band by id, unauthenticated

**Location:** `src/app/actions/bands.ts:50`, `src/lib/bands.ts:128`
**Why it matters:** A Server Action is a public POST endpoint. Neither layer resolves a
session nor checks band admin membership, so any caller can delete any band. Violates
the fail-closed authorization rule and the single-responsibility split that puts
authorization at the layer boundary.
**Severity:** High
**Effort:** M
**Remediation:** Resolve `getRequiredUserId()` in the action and pass it to a
`deleteBand(bandId, userId)` that requires an `admin` row in `band_members`; add a
regression test asserting a non-admin caller is rejected.
```

On the `**Location:**` line, backticks are used **only** for repository paths, optionally
suffixed `:<line>` or `:<start>-<end>`. No globs, no prose in backticks: a QA script
strips the suffix and asserts every path exists.

**Prioritised summary table** - `## 4`, one row per finding, ranked severity-descending:

```markdown
| Rank | ID | Area | Severity | Effort | Finding |
|---|---|---|---|---|---|
| 1 | F7 | Security | High | M | deleteBandAction deletes any band by id |
```

**Follow-up task block** - `## 5`, `### T<n> - <title>` (hyphen, spaces either side), then:

```markdown
**Justification:** one line, in the voice of a Meridian `justification` field.
**Priority:** critical | high | medium | low
**Covers:** F7, F9
```

### 3.6 Required coverage of the §1.5 probes

The three Server Actions confirmed in §1.5 — `deleteBandAction`, `removeBandMemberAction`,
`updateBandAction` — must each be named in `## 3`, either inside a finding or with an
explicit statement of why the reviewer concluded it is not one. They are not allowed to
disappear silently.

### 3.7 `docs/suggestions-log.md`

Add an `## [RH-25]` section recording anything observed but deliberately left out of the
findings list, and noting that the report is a snapshot pinned to `13da8b2`.

---

## 4. Expected Results

These are character-for-character the Meridian task's `expected_results` for RH-25 (the
`- ` bullet prefix aside). QA receives only this list (no spec, no code), so each item is
self-contained and mechanically checkable. All commit pins are `13da8b2`, and every
command is run from the repository root.

- ER1 - The file docs/plans/code-quality-review.md exists. Its first line is a level-1 heading whose text contains RH-25, and within its first 10 lines it names the commit 13da8b2 that the review is pinned to. Running: grep -n '^## ' docs/plans/code-quality-review.md prints exactly these seven headings, in exactly this order and with no other level-2 heading anywhere in the file: "## 1. Method and Reproducibility", "## 2. Measured Baseline", "## 3. Findings", "## 4. Prioritised Summary", "## 5. Proposed Follow-up Tasks", "## 6. Already Addressed - Not Re-Litigated", "## 7. Out of Scope".
- ER2 - Section 3 of that file contains at least 15 finding blocks. Each begins with a level-3 heading of the form "### F<n> - <title>", numbered contiguously starting at F1 (F1, F2, ... F15 at minimum, no gaps, no duplicates). Let N be the number of lines matching ^### F. Then each of these five greps returns exactly N: grep -c '^\*\*Location:\*\*', grep -c '^\*\*Why it matters:\*\*', grep -c '^\*\*Severity:\*\*', grep -c '^\*\*Effort:\*\*', grep -c '^\*\*Remediation:\*\*'. Every ^\*\*Severity:\*\* line ends with exactly one of High, Medium or Low, and every ^\*\*Effort:\*\* line ends with exactly one of S, M or L. At least one finding has Severity High.
- ER3 - Every repository path cited by a finding exists. On a **Location:** line backticks wrap only repository paths, optionally suffixed with :<line> or :<start>-<end>. This check prints nothing: grep '^\*\*Location:\*\*' docs/plans/code-quality-review.md | grep -oE '`[^`]+`' | tr -d '`' | sed -E 's/:[0-9]+(-[0-9]+)?$//' | sort -u | while read -r p; do [ -e "$p" ] || echo "MISSING $p"; done. Additionally every ^\*\*Location:\*\* line contains at least one backticked path.
- ER4 - Section 4 contains a markdown table whose header row is exactly | Rank | ID | Area | Severity | Effort | Finding | and which has exactly one data row per finding (same count N as ER2), with Rank contiguous from 1 to N and the ID column listing each of F1..FN exactly once. Rows are ordered severity-descending: every High row precedes every Medium row, and every Medium row precedes every Low row. The Area column uses only these eight literal strings, and each of the eight appears in at least one row: Module boundaries, Complexity, React patterns, Next.js patterns, Data access, Typing, Naming & consistency, Security.
- ER5 - Section 1 contains, verbatim and inside fenced code blocks, the size command (git ls-files 'src/*' | grep -E '\.tsx?$' | grep -v '__tests__' | xargs wc -l | sort -rn) and the ESLint complexity command (npx eslint 'src/**/*.ts' 'src/**/*.tsx' --rule '{"complexity":["warn",10],"max-depth":["warn",3],"max-lines-per-function":["warn",120],"max-params":["warn",4]}' -f json). Section 2 quotes numbers that match re-running them on a clean tree at 13da8b2: 79 production .ts/.tsx files outside __tests__ totalling 14661 lines; the four largest being src/app/songs/[id]/fast-view/page.tsx at 1586 lines, src/app/playlists/[id]/page.tsx at 1344, src/app/playlists/page.tsx at 899 and src/components/tabs/TabDrawingStage.tsx at 817; and 104 total rule violations from the complexity sweep, broken down as complexity 43, max-lines-per-function 40, max-depth 19, max-params 2. It further names FastViewPage at src/app/songs/[id]/fast-view/page.tsx:92 with a cyclomatic complexity of 82 as the single worst function, and cites at least three of these four: PlaylistDetailPage 34, BandDetailPage 30, the sync route POST handler 27, BandProfileView 23.
- ER6 - Section 2 also quotes these measured counts, each matching a re-run on a clean tree at 13da8b2. Typing, over the production files (git-tracked .ts/.tsx under src/ excluding __tests__): ': any' 3 occurrences, 'as any' 1, 'as unknown as' 3, non-null assertions 0, '@ts-ignore' 0 and '@ts-expect-error' 0. Server Action session resolution, as pairs of (count of lines matching ^export (async )?(function|const), count of getRequiredUserId() call sites) per file: bands.ts 11 and 5, moderation.ts 3 and 3, playlists.ts 9 and 4, profile.ts 3 and 3, repertoire.ts 14 and 2, tabs.ts 5 and 5. Layering: grep -c 'query(' src/app/actions/*.ts reports repertoire.ts 6, tabs.ts 7, playlists.ts 2, and bands.ts, moderation.ts, profile.ts 0 each. Duplication and lint: 19 clones and 239 duplicated lines at 1.08% from npm run lint:dup, and 12 errors plus 18 warnings from npx eslint .
- ER7 - Section 3 explicitly names all three of these Server Actions - deleteBandAction, removeBandMemberAction and updateBandAction - each either inside a finding or with a stated reason why the reviewer concluded it is not a finding. Section 6 names all five of RH-21, RH-22, RH-23, RH-24 and RH-32 and states that their subject matter (error-handling conventions, dead code, duplication, test coverage, SSR React duplication) is deliberately not re-litigated. Section 7 states that RH-25 ships no user-facing feature and that the landing page is therefore untouched under the AGENTS.md Landing Page Rule.
- ER8 - Section 5 contains between 5 and 10 follow-up task blocks, each a level-3 heading of the form "### T<n> - <title>" numbered contiguously from T1, and each followed by three lines starting at column 0: "**Justification:**" with a one-line justification, "**Priority:**" ending in exactly one of critical, high, medium or low, and "**Covers:**" listing one or more finding IDs of the form F<n>. Every finding whose Severity is High appears in at least one **Covers:** line. No proposed task's title or justification is about adding tests, removing dead code, de-duplicating clones or changing error-handling style, since RH-21 through RH-24 already delivered those.
- ER9 - The change set is documentation only. git diff --name-only 13da8b2..HEAD lists exactly these four paths and nothing else: docs/plans/code-quality-review.md, docs/tasks/RH-25-spec.md, docs/suggestions-log.md, package.json. In particular no file under src/, e2e/, migrations/ or scripts/ is modified, no config file (eslint.config.mjs, vitest.config.ts, next.config.ts, tsconfig.json, knip.json, .jscpd.json, .github/workflows/**) is modified, and package-lock.json is unchanged. docs/suggestions-log.md gained a section whose heading contains RH-25.
- ER10 - The static gates are unchanged, which follows from ER9 but must be verified rather than assumed: npx tsc --noEmit exits 0 with no error output; npm run lint:dead exits 0; npm run lint:dup exits 0 and its Total row still reports 19 clones and 239 duplicated lines at 1.08%; npx eslint . still reports exactly 12 errors and 18 warnings (eslint is NOT required to exit 0); and, given a local PostgreSQL reachable at DATABASE_URL (default postgresql://postgres:postgres@127.0.0.1:54322/postgres) with npm run db:migrate applied plus a non-empty SUPABASE_SERVICE_ROLE_KEY, npx vitest run exits 0 reporting 40 test files and 478 tests passed with 0 failed and 0 skipped. Separately, the version field in package.json matches ^0\.1\.(6[7-9]|[7-9][0-9])-[0-9]{12}$ and is strictly greater than the previous highest version 0.1.66-202609051735.

---

## 5. Out of Scope

- Implementing any remediation the report proposes, including the `deleteBandAction`
  authorization hole (§2).
- Creating the follow-up Meridian tasks; §5 of the report only *proposes* them.
- Editing `eslint.config.mjs` (or any other config) to make the complexity sweep
  permanent — that is itself a good candidate for a proposed follow-up task, and it is
  the follow-up task that would land the config change.
- Re-auditing security in the depth of `docs/security-audit.md`; RH-25 records authz
  smells found by M5, it is not a full threat model.
- Any change to `docs/plans/mobile-app-analysis.md`, `docs/security-audit.md` or
  `docs/test-coverage-plan.md`.

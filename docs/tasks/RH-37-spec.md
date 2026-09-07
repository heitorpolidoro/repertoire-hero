# RH-37 - Mover acesso a dados das Server Actions para src/lib (integration and close-out)

RH-37 was split once, into RH-45, RH-46 and RH-47. All three are `done` and
merged (`a493731`, `51151d7`, `201a090`). A task is split at most once, so this
is not a second split: it is the reduced-scope spec for what is left after the
three parts, which is integration verification plus the documentation close-out.
Baseline: `201a090`, version `0.1.74-202609071451`, clean tree.

## Scope

This task covers exactly two things.

1. **Integration verification.** Prove that the three parts compose at
   `201a090`: findings F8, F21 and F22 of `docs/plans/code-quality-review.md` are
   all satisfied simultaneously, the mechanical guards each part introduced still
   pass together in one run, and every static gate, the whole suite, the
   production build and the SSR smoke spec are green at the same commit. Nothing
   here changes behaviour; the verification is the deliverable, and its evidence
   is the Expected Results below.
2. **Documentation close-out.** Mark F8, F21, F22 and task T4 (section 5) as
   resolved in `docs/plans/code-quality-review.md`, with the commit ids, and
   record the two factual corrections the split analysis turned up.

**This task changes no code.** The refactoring was delivered by RH-45 (SQL out of
`src/app/actions/*` into `src/lib`, dev profiles route on the shared pool),
RH-46 (`TabDrawingStage` and `AppLayout` inverted to props) and RH-47
(`SongForm`, `CorrectionModal` and `useBandAdmin` inverted, plus the ESLint
`no-restricted-imports` rule). Not one line under `src/`, `migrations/`, `e2e/`,
`eslint.config.mjs` or `vitest.config.ts` moves here - ER8 states that as a
checkable result.

## State at 201a090

Every claim below was re-measured from the repository root at `201a090` while
writing this spec, on a clean tree (`git status --porcelain` prints nothing).

**F8 - SQL in the Server Action layer. Closed by RH-45 (`a493731`).**
`grep -c "query(" src/app/actions/*.ts` prints:

```
src/app/actions/bands.ts:0
src/app/actions/moderation.ts:0
src/app/actions/playlists.ts:0
src/app/actions/profile.ts:0
src/app/actions/repertoire.ts:0
src/app/actions/tabs.ts:0
```

`grep -rn "@/lib/db" src/app/actions/*.ts` prints nothing and exits 1. At
`059d4c3` the same commands printed `playlists.ts:2`, `repertoire.ts:5`,
`tabs.ts:6` (13 sites) and three import lines. The statements now live in
`src/lib/tabs.ts`, `src/lib/songs.ts`, `src/lib/playlists.ts` and
`src/lib/devProfiles.ts`.

**F22 - a route handler with its own Postgres client. Closed by RH-45.**
`grep -rln "new Client" src` prints nothing and exits 1. At `059d4c3` it printed
exactly `src/app/api/dev/profiles/route.ts`. `src/lib/db.ts` constructs a
`new Pool`, never a client, so an empty result is the correct expectation rather
than a one-path result.

**F21 - inward imports. Closed by RH-46 (`51151d7`) and RH-47 (`201a090`).**
`grep -rn "@/app/" src/components src/lib src/hooks | grep -v __tests__` prints
nothing and exits 1 (the pipeline's exit status is `grep -v`'s). At `059d4c3`
the same command printed five lines. The enforcement rule exists in
`eslint.config.mjs` (lines 23-36 at `201a090`): `no-restricted-imports` set to
`error`, `patterns[0].group` is `["@/app/*", "@/app/**"]`, `files` is
`["src/components/**", "src/lib/**", "src/hooks/**"]` and `ignores` is
`["**/__tests__/**"]`. I proved it bites: a probe file
`src/lib/rh37RuleProbe.ts` importing `getBandsAction` from `@/app/actions/bands`
made `npx eslint src/lib/rh37RuleProbe.ts` print

```
  1:1  error  '@/app/actions/bands' import is restricted from being used by a pattern. src/components, src/hooks and src/lib must not import from the App Router tree. Pass the Server Action down from the page as a prop or an injected dependency (F21/RH-47)  no-restricted-imports
```

followed by `1 problem (1 error, 0 warnings)`. The probe was deleted and
`git status --porcelain -- src` prints nothing.

**The twelve guard and inversion suites exist and pass together.** I confirmed
each file is present and ran all twelve in one invocation:
`src/app/actions/__tests__/actionDataAccessGuard.test.ts` (RH-45),
`src/app/actions/__tests__/actionAuthorizationGuard.test.ts`,
`src/app/actions/__tests__/actionSessionGuard.test.ts`,
`src/lib/__tests__/transactionGuard.test.ts`,
`src/lib/__tests__/tabs.test.ts`,
`src/lib/__tests__/devProfiles.test.ts`,
`src/app/actions/__tests__/authzTabs.db.test.ts` (RH-45),
`src/components/tabs/__tests__/TabDrawingStage.test.tsx`,
`src/components/layout/__tests__/AppLayout.test.tsx` (RH-46),
`src/components/songs/__tests__/SongForm.test.tsx`,
`src/components/songs/__tests__/CorrectionModal.test.tsx`,
`src/hooks/__tests__/useBandAdmin.test.tsx` (RH-47). The run reports
`Test Files  12 passed (12)` and `Tests  146 passed (146)`, with no `failed` and
no `skipped` segment.

**Gate baselines, all measured at `201a090`.**

- `npx vitest run`: `Test Files  59 passed (59)`, `Tests  736 passed (736)`, no
  skipped. This needs Postgres at
  `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations
  applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`; without
  them six DB-backed files skip 51 tests.
- `npx eslint .`: final summary line `29 problems (12 errors, 17 warnings)`.
- `./node_modules/.bin/tsc --noEmit`: exits 0, prints nothing. Use that exact
  binary path; `npx tsc` is intercepted by a shell hook in this environment.
- `npm run lint:dead` (knip): clean, no output beyond the npm banner.
- `npm run lint:dup` (jscpd): `Found 19 clones.`, Total row 239 duplicated lines,
  `0.88%`, against the 2 % threshold.
- `npm run audit`: `found 0 vulnerabilities`.
- `npx next build`: exits 0.
- `npx playwright test e2e/ssr-smoke.spec.ts`: `4 passed`.

**The two factual corrections, re-measured against the review's own baseline.**
`docs/plans/code-quality-review.md` is pinned to `13da8b2` (its first line says
so). I measured that commit directly rather than trusting either the finding or
the dispatch note, and the two inaccuracies are not the same kind of thing:

- **F8's "Fifteen SQL statements" was correct at `13da8b2`.**
  `git show 13da8b2:src/app/actions/<f>.ts | grep -c "query("` gives
  `repertoire.ts` 6, `tabs.ts` 7, `playlists.ts` 2 - fifteen. `checkAccess` also
  genuinely existed there: `git show 13da8b2:src/app/actions/tabs.ts` declares it
  at L11 and calls it at L39, L91, L128 and L149. Both statements went stale
  later, in RH-34 and RH-36, and were already stale at `059d4c3` (13 sites, no
  `checkAccess`). So the honest correction is a dated note, **not** a rewrite:
  editing the heading to say "Thirteen" would replace a true statement about
  `13da8b2` with a false one.
- **F21's "the two inward dependencies" was wrong at `13da8b2` itself.**
  `git grep -n "@/app/" 13da8b2 -- src/components src/lib src/hooks`, minus
  `__tests__`, returns five lines, not two. The cause is mechanical and worth
  recording: the M4 command quoted in section 2.5 is
  `grep -rn "from '@/app" src/lib src/hooks src/components`, with a **single**
  quote in the pattern, and `SongForm.tsx`, `CorrectionModal.tsx` and
  `useBandAdmin.ts` all write their import source in double quotes. The grep
  could not have seen them.

## Approach

### 1. `docs/plans/code-quality-review.md` - six added lines, nothing removed

The edit is **purely additive**: six new lines, no line deleted, no line
reworded. That is a deliberate mechanical choice and it is what ER6 checks with
`git diff --numstat`. Rationale: section 2 of the document is an explicitly
dated measurement of `13da8b2` and section 3's findings are its analysis;
rewriting either would destroy the audit trail and, in F8's case, would inject a
new error (see State above). A dated `**Correction (RH-37):**` line carries the
same information, says when the claim stopped being true, and leaves the
original measurable claim intact.

Each new line is a single line in the file, appended at the end of the finding
block it belongs to, so every closed finding ends with a `**Status:**` line.

**After F8's `**Remediation:**` line (L303 at `201a090`), append these two
lines, in this order:**

```
**Correction (RH-37):** The counts above were accurate at this document's pinned baseline `13da8b2` and had drifted before the remediation started. At `059d4c3`, the commit RH-45 branched from, the count was thirteen, not fifteen (`repertoire.ts` 5, `tabs.ts` 6, `playlists.ts` 2), and the `checkAccess` helper described above no longer existed: RH-34 had already replaced it with `assertRepertoireAccess` in `src/lib/songs.ts`, which every tab action already called, so no authorization helper had to be re-homed.
**Status:** Resolved by RH-45 (`a493731`). Every statement now lives in `src/lib` (`tabs.ts`, `songs.ts`, `playlists.ts`, `devProfiles.ts`) and the actions are session resolution plus delegation plus `revalidatePath`; at `201a090`, `grep -c "query(" src/app/actions/*.ts` prints `0` for all six files and `grep -rn "@/lib/db" src/app/actions/*.ts` prints nothing. Re-entry is blocked by `src/app/actions/__tests__/actionDataAccessGuard.test.ts`.
```

**After F21's `**Remediation:**` line (L407 at `201a090`), append these two
lines, in this order:**

```
**Correction (RH-37):** There were five inward dependencies, not two. The M4 command quoted in section 2.5 greps for `from '@/app` with a single quote, so it missed the double-quoted imports at `src/components/songs/SongForm.tsx:16`, `src/components/songs/CorrectionModal.tsx:5` and `src/hooks/useBandAdmin.ts:11`, all three of which were already present at `13da8b2`.
**Status:** Resolved by RH-46 (`51151d7`) and RH-47 (`201a090`). All five now receive their server calls as props or as one injected actions object, and at `201a090`, `grep -rn "@/app/" src/components src/lib src/hooks | grep -v __tests__` prints nothing. The rule this remediation asks for is the `no-restricted-imports` block in `eslint.config.mjs`, banning `@/app/*` and `@/app/**` under `src/components/**`, `src/lib/**` and `src/hooks/**` with `**/__tests__/**` exempt.
```

**After F22's `**Remediation:**` line (L415 at `201a090`), append this line:**

```
**Status:** Resolved by RH-45 (`a493731`). The route now calls `listDevProfiles()` from `src/lib/devProfiles.ts`, which uses the shared pool through `query()`, and keeps its `NODE_ENV` 404 guard; at `201a090`, `grep -rln "new Client" src` prints nothing.
```

**After T4's `**Covers:** F8, F21, F22` line (L517 at `201a090`), append this
line:**

```
**Status:** Delivered by RH-45 (`a493731`), RH-46 (`51151d7`) and RH-47 (`201a090`); integrated and verified by RH-37. All three findings it covers are closed.
```

The T4 marker deliberately uses `Delivered` rather than `Resolved`, so that
`grep -c "^\*\*Status:\*\* Resolved"` counts the three findings and nothing else,
and `grep -c "^\*\*Status:\*\* Delivered"` counts the one task. Neither prefix
occurs anywhere in the document today (`grep -c "^\*\*Status:\*\*"` prints `0` at
`201a090`), so the counts in ER6 are unambiguous.

Do not touch any other finding, the section 2 measurement tables, the section 4
priority table, or any other T-task block.

### 2. AGENTS.md - no change

I checked both places the dispatch pointed at, and the convention is already
stated twice, mechanically and by name:

- The `A2 - thin Server Actions` paragraph (AGENTS.md L226-L230) already says
  that the action layer holds no data access at all - no `query()` call, no
  `@/lib/db` import under `src/app/actions/*.ts`, no hand-rolled `pg` client
  under `src/` outside `src/lib/db.ts` - and names
  `src/app/actions/__tests__/actionDataAccessGuard.test.ts` as the enforcer.
  That covers F8 and F22. (Added by RH-45.)
- The `**Import direction (F21).**` bullet at the end of the
  **Testing & quality** list (AGENTS.md L97) already says nothing under
  `src/components`, `src/hooks` or `src/lib` may import from `@/app/*`, names
  the `no-restricted-imports` block in `eslint.config.mjs` as the enforcer, and
  records the `__tests__` exemption and `src/app/bandAdminActions.ts` as the
  pattern. That covers F21. (Added by RH-47.)

A third restatement would add nothing, so **AGENTS.md is not edited and is not on
the ER8 whitelist**. If a reviewer disagrees, the change belongs in a follow-up,
not here: adding it would widen this task's diff for no mechanical gain.

### 3. Version bump

`package.json` goes from `0.1.74-202609071451` to `0.1.75-YYYYMMDDHHmm` with the
local-time stamp of the commit. The Version Bumping Rule in AGENTS.md applies to
every commit that merges to master, documentation-only ones included.

### 4. Running the verification

Everything in the Expected Results is a re-run, not a change. Run the whole set
once after the documentation edit and the version bump are in the tree, so the
evidence describes the commit that will actually merge. The whole-suite,
coverage-free path is the long pole; the DB precondition in ER4 is not optional,
because without it six files skip 51 tests and the counts in ER3 and ER4 cannot
be reached.

## Expected Results

ER1 - The three findings hold simultaneously at the merge commit, checked from the repository root. `grep -c "query(" src/app/actions/*.ts` prints exactly these six lines and nothing else: `src/app/actions/bands.ts:0`, `src/app/actions/moderation.ts:0`, `src/app/actions/playlists.ts:0`, `src/app/actions/profile.ts:0`, `src/app/actions/repertoire.ts:0`, `src/app/actions/tabs.ts:0`. `grep -rn "@/lib/db" src/app/actions/*.ts` prints nothing and exits with status 1 (check with `; echo $?`). `grep -rln "new Client" src` prints nothing and exits with status 1. `grep -rn "@/app/" src/components src/lib src/hooks | grep -v __tests__` prints nothing and exits with status 1. Together these are findings F8, F22 and F21 of `docs/plans/code-quality-review.md`, satisfied at one commit; at `059d4c3` the same four commands printed, respectively, three non-zero counts totalling 13, three import lines, `src/app/api/dev/profiles/route.ts`, and five inward-import lines.

ER2 - The import-direction rule is present in ESLint and is proved to bite, and the probe leaves no trace. `eslint.config.mjs` contains a config object whose `files` is exactly `["src/components/**", "src/lib/**", "src/hooks/**"]`, whose `ignores` is `["**/__tests__/**"]`, and whose `rules` sets `"no-restricted-imports"` to `"error"` with a `patterns` entry whose `group` contains both `"@/app/*"` and `"@/app/**"`. Then, from the repository root: `printf "import { getBandsAction } from '@/app/actions/bands'\n\nexport const probe = getBandsAction\n" > src/lib/rh37RuleProbe.ts` followed by `npx eslint src/lib/rh37RuleProbe.ts` prints a final summary line reading exactly `1 problem (1 error, 0 warnings)`, and the reported problem line names the rule id `no-restricted-imports` and quotes the import source `'@/app/actions/bands'`. Then `rm src/lib/rh37RuleProbe.ts`, after which `test ! -e src/lib/rh37RuleProbe.ts && echo restored` prints `restored` and `git status --porcelain -- src` prints nothing. Scoping that status check to `src` is deliberate: an unscoped run also reports this task's own documentation changes and would fail a correct implementation.

ER3 - The guards and inversion suites from all three parts pass together in one run. `npx vitest run src/app/actions/__tests__/actionDataAccessGuard.test.ts src/app/actions/__tests__/actionAuthorizationGuard.test.ts src/app/actions/__tests__/actionSessionGuard.test.ts src/lib/__tests__/transactionGuard.test.ts src/lib/__tests__/tabs.test.ts src/lib/__tests__/devProfiles.test.ts src/app/actions/__tests__/authzTabs.db.test.ts src/components/tabs/__tests__/TabDrawingStage.test.tsx src/components/layout/__tests__/AppLayout.test.tsx src/components/songs/__tests__/SongForm.test.tsx src/components/songs/__tests__/CorrectionModal.test.tsx src/hooks/__tests__/useBandAdmin.test.tsx` exits 0 and reports `Test Files  12 passed (12)` and `Tests  146 passed (146)`, with no `failed` and no `skipped` segment on either line. All twelve files must exist; a missing path makes vitest fail rather than silently pass. This run includes a real-database suite (`authzTabs.db.test.ts`), so it needs the same database preconditions as ER4: Postgres at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied (`npm run db:migrate`) and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` or the environment. Without them that file skips and the `skipped` condition above fails even for a correct tree.

ER4 - The whole suite is green and has not shrunk. With Postgres running at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied (`npm run db:migrate`) and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` or the environment, `npx vitest run` exits 0 reporting at least 59 test files passed and at least 736 tests passed, with 0 failed and 0 skipped. Those are the exact counts at the `201a090` baseline (`Test Files  59 passed (59)`, `Tests  736 passed (736)`), and since this task adds no test they are equalities in practice; they are stated as floors only so an unrelated concurrent addition cannot fail the result. Without the two preconditions six DB-backed files skip 51 tests and the run does not count.

ER5 - Every static gate is exactly at its `201a090` baseline, run from the repository root. `./node_modules/.bin/tsc --noEmit` exits 0 and prints nothing (use that exact binary path; `npx tsc` is intercepted by a shell hook in this environment). `npx eslint .` prints a final summary line reading exactly `29 problems (12 errors, 17 warnings)`, unchanged, because this task edits no file ESLint lints. `npm run lint:dead` exits 0 and reports no unused files, exports or dependencies. `npm run lint:dup` exits 0 and prints `Found 19 clones.` with a Total row showing 239 duplicated lines and a duplication percentage below 2 %. `npm run audit` exits 0 and prints `found 0 vulnerabilities`.

ER6 - The review document records the close-out and the two corrections, additively. `grep -c "^\*\*Status:\*\* Resolved" docs/plans/code-quality-review.md` prints `3`, one for each of F8, F21 and F22; `grep -n "^\*\*Status:\*\* Resolved" docs/plans/code-quality-review.md` shows those three lines and each names at least one of the commit ids `a493731`, `51151d7` and `201a090`. `grep -c "^\*\*Status:\*\* Delivered" docs/plans/code-quality-review.md` prints `1`, the marker on `### T4 - Move data access out of the Server Action layer into src/lib` in section 5, and that line names all three of `a493731`, `51151d7` and `201a090`. `grep -c "^\*\*Correction (RH-37):\*\*" docs/plans/code-quality-review.md` prints `2`, and `grep -c "thirteen, not fifteen" docs/plans/code-quality-review.md` and `grep -c "five inward dependencies, not two" docs/plans/code-quality-review.md` each print `1`. The edit is purely additive and adds exactly six lines: `git diff --numstat 201a090 -- docs/plans/code-quality-review.md` prints exactly `6	0	docs/plans/code-quality-review.md` (six insertions, zero deletions), so no finding's analysis prose, no section 2 measurement table and no section 4 row was reworded.

ER7 - The application still builds and server-renders at the merge commit. `npx next build` exits 0 with no error output, and `npx playwright test e2e/ssr-smoke.spec.ts` reports `4 passed`. Both were green at `201a090` and this task changes no code, so a failure here means something outside the task's footprint moved.

ER8 - The version was bumped and the blast radius is documentation only. `node -p "require('./package.json').version"` prints a string matching `^0\.1\.75-20[0-9]{10}$` (patch 75, then a 12-digit `YYYYMMDDHHmm` local-time stamp), which is strictly greater than the `0.1.74-202609071451` at `201a090`. `git diff --name-only 201a090` prints a subset of exactly this whitelist and nothing else: `docs/plans/code-quality-review.md`, `docs/tasks/RH-37-spec.md`, `docs/suggestions-log.md`, `package.json`. `AGENTS.md` is deliberately absent: the two conventions this task would have documented are already stated in AGENTS.md, in the `A2 - thin Server Actions` paragraph (which names `actionDataAccessGuard.test.ts`) and in the `**Import direction (F21).**` bullet of the Testing & quality list (which names the `no-restricted-imports` block in `eslint.config.mjs`). `git diff --name-only 201a090 -- src migrations e2e eslint.config.mjs vitest.config.ts` prints nothing, so no source file, migration, end-to-end spec, lint config or test config was touched. This task ships no user-facing feature, so it is not a selling point, and `git diff --stat 201a090 -- src/components/landing src/i18n/dictionaries` prints nothing.

## Out of Scope

- **Any further refactoring.** The `src/store/repertoireStore.ts` import of
  `@/app/actions/repertoire` (RH-47's recorded suggestion), server-side fetching
  of the band list in the root layout (RH-46's), a typed `query<T>` helper
  (RH-40 / F16) and the fast-view decomposition (RH-38 / F6) all stay where they
  are. ER8 forbids touching `src/` at all.
- **Widening the ESLint rule.** It bans `@/app/*` and `@/app/**` under three
  directories and exempts `__tests__`. It is not extended to `src/store`, to
  relative-path escapes such as `../../app/actions/x`, or to any other
  direction. `eslint.config.mjs` is not edited.
- **Closing any other finding.** Only F8, F21, F22 and T4 get markers. F1-F7,
  F9-F20 and F23-F26 keep their current text even where later tasks have in fact
  addressed them; sweeping the whole document is a separate piece of work with
  its own evidence requirements.
- **Rewriting the review's measured baseline.** Section 2's tables and section
  4's priority rows describe `13da8b2` and stay as measured. The corrections are
  additive, dated lines in section 3.
- **A new AGENTS.md section.** See Approach 2: already covered twice.
- **`npm run test:coverage`.** No file inside `coverage.include`
  (`src/lib/**/*.ts`, `src/app/actions/*.ts`, `src/hooks/**/*.ts`,
  `src/proxy.ts`) changes, so the coverage numbers cannot move and gating on
  them here would only re-run RH-47's ER10. ER4's full-suite run is the
  regression signal.
- **`e2e/songs-crud.spec.ts`.** All three of its tests are red at `201a090` for
  reasons unrelated to this work (tracked as RH-44), so it cannot distinguish a
  correct implementation from a broken one. ER7 gates on `e2e/ssr-smoke.spec.ts`
  only.

## Post-merge checks (orchestrator)

- RH-37 is fully delivered once this merges: RH-45, RH-46, RH-47 and this
  close-out together satisfy T4. No successor task is implied.
- The corrections recorded in F8 and F21 are worth carrying into how the next
  review is measured: an inward-import grep must match both quote styles
  (`grep -rn "@/app/"`, not `grep -rn "from '@/app"`), and any finding that
  quotes a count should name the commit the count was taken at, as this
  document's own header does.

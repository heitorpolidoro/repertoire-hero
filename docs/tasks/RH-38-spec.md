# RH-38 - Decompor a pagina Fast View (integration and close-out)

RH-38 was split once, into RH-48, RH-49, RH-50, RH-51 and RH-52. All five are
`done` and merged (`a49a295`, `6b30ddb`, `bf0c97e`, `aaf9a21`, `e985ba5`). A task
is split at most once, so this is not a second split: it is the reduced-scope
spec for what is left after the five parts, which is integration verification
plus the documentation close-out.

Baseline: `e985ba5`, version `0.1.80-202609072128`, clean tree
(`git status --porcelain` prints nothing).

## Scope

This task covers exactly two things.

1. **Integration verification.** Prove that the five parts compose at `e985ba5`:
   findings F6 and F26 of `docs/plans/code-quality-review.md` are satisfied
   simultaneously over the *whole* Fast View feature, not just the page; the
   complexity, function-length, depth and file-size budgets hold for every file
   the decomposition produced; the layering rule (F21/RH-47) still holds for the
   new hooks, libs and components; and all thirty-five suites the five parts
   introduced or must not have broken pass together in one run, alongside every
   static gate, the whole suite, coverage, the production build and the SSR
   smoke spec at the same commit. Nothing here changes behaviour; the
   verification is the deliverable and its evidence is the Expected Results
   below.
2. **Documentation close-out.** Mark F6, F26 and task T5 (section 5) as resolved
   in `docs/plans/code-quality-review.md`, with the commit ids, correct F6's
   stale numbers with a dated additive note, and record the Fast View
   architecture in AGENTS.md so the composition root is a stated convention
   rather than an accident of five commits.

**This task changes no code.** The refactor was delivered by RH-48 (playlist
navigation and setlist UI, plus both halves of F26's first part), RH-49 (tab
library, active tab, upload), RH-50 (PDF Stage Mode overlay), RH-51 (lyrics,
editor, auto-import, lyrics Stage Mode) and RH-52 (song entry, status, links,
and the composition root itself). Not one line under `src/`, `migrations/`,
`e2e/`, `eslint.config.mjs` or `vitest.config.ts` moves here; ER9 states that as
a checkable result.

## State at e985ba5

Every claim below was re-measured from the repository root at `e985ba5` while
writing this spec, on a clean tree.

**The page is a composition root.** `wc -l "src/app/songs/[id]/fast-view/page.tsx"`
prints `222`. `grep -o 'useState[<(]'` and `grep -o 'useEffect('` over it each
print nothing (0 occurrences). It imports nothing from `@/lib/db`, and
`grep -c "window.location"` over it prints `0`. Run with
`--rule '{"complexity":["error",1]}'` ESLint reports
`Function 'FastViewPage' has a complexity of 6`.

**The step-by-step progression, measured commit by commit.** Each row is the
page file's `wc -l`, then the ESLint `max-lines-per-function` and `complexity`
numbers for `FastViewPage`, then the `useState` and `useEffect` call-site counts.

| Commit | Task | File lines | `FastViewPage` lines | Complexity | `useState` | `useEffect` |
|---|---|---|---|---|---|---|
| `13da8b2` | RH-25 baseline | 1586 | 1495 | 82 | 39 | 4 |
| `c8665cd` | pre-split HEAD | 1625 | 1534 | 88 | 40 | 5 |
| `a49a295` | RH-48 | 1427 | 1328 | 76 | 36 | 5 |
| `6b30ddb` | RH-49 | 1091 | 976 | 67 | 24 | 5 |
| `bf0c97e` | RH-50 | 964 | 864 | 54 | 21 | 2 |
| `aaf9a21` | RH-51 | 658 | 567 | 30 | 13 | 1 |
| `e985ba5` | RH-52 | 222 | 191 | 6 | 0 | 0 |

**What each child delivered.**

- **RH-48 (`a49a295`)** - `src/lib/playlistNav.ts`, `src/hooks/usePlaylistNav.ts`,
  `src/app/fastViewNavActions.ts` and eight setlist components
  (`SetlistRow`, `SetlistPanel`, `SetlistDrawer`, `SetlistSidebar`,
  `SetlistSelect`, `SetlistPill`, `PlaylistPrevArrow`, `SwipeHint`). It also
  took the first half of F26: `useSearchParams()` replaced the navigation and
  back-button `window.location.search` reads, and the pure alias
  `getPlaylistEntryIdsAction` was deleted.
- **RH-49 (`6b30ddb`)** - `src/lib/tabLibrary.ts`, `src/hooks/useTabLibrary.ts`,
  `src/app/fastViewTabActions.ts` and `TabLibrarySection`, `TabList`,
  `TabViewer`, `TabUploadForm`, `TabDestinationModal`, `TabDeleteConfirm`.
- **RH-50 (`bf0c97e`)** - `src/lib/scrollHost.ts`, `src/lib/stageHistory.ts`,
  `src/hooks/usePdfStage.ts` and `PdfStageOverlay`.
- **RH-51 (`aaf9a21`)** - `src/lib/lyricsMarkdown.ts`, `src/lib/lyricsEditor.ts`,
  `src/hooks/useLyricsEditor.ts`, `src/app/fastViewLyricsActions.ts` and
  `LyricsSection`, `LyricsEditorPanel`, `LyricsStageOverlay`.
- **RH-52 (`e985ba5`)** - `src/lib/songEntry.ts`, `src/lib/songStatus.ts`,
  `src/lib/songLinks.ts`, `src/hooks/useSongEntry.ts`,
  `src/hooks/useSongStatus.ts`, `src/hooks/useSongLinks.ts`,
  `src/app/fastViewEntryActions.ts` and `LinkIcon`, `StatusDropdown`,
  `SongIdentityHeader`, `AddLinkForm`, `LinksSection`, `LinkDeleteConfirm`,
  `SongTagsSection`, `SongLoadStates`, `FastViewOverlays`. It also took the
  second half of F26, moving the load-effect query reads into `useSongEntry`
  with the search-params-derived band id in the effect dependency array.

The feature is therefore 61 files: the page, 27 components and 13 component test
files under `src/components/fastview`, 4 `src/app/fastView*Actions.ts` files, 7
hooks and 9 `src/lib` modules.

**The composed budget passes, over a scoped file list.** The command in the
dispatch note used the bare globs `src/hooks src/lib`. I ran it and it fails,
with 20 errors that have nothing to do with Fast View:
`src/hooks/useBandAdmin.ts` (298-line function), `src/lib/linkFetcher.ts`
(complexity 18), `src/lib/moderation.ts` (19), `src/lib/songs.ts` (21) and ten
pre-existing `src/lib/__tests__` files with long `describe` arrows. Those are
RH-39/F20 and T7 territory and predate this decomposition, so gating on them
here would fail a correct implementation. ER1 is therefore scoped to the 61 Fast
View files, which do pass: with
`--rule '{"complexity":["error",15],"max-lines-per-function":["error",200],"max-depth":["error",4]}'`
the run prints nothing and exits 0, including the 13 jsdom test files under
`src/components/fastview/__tests__`. The largest single file in the set is
`src/hooks/useTabLibrary.ts` at 302 lines; no file reaches 400.

**Layering and F26 hold.**
`grep -rn "@/app/" src/components src/lib src/hooks | grep -v __tests__` prints
nothing and exits 1. `grep -rn "getPlaylistEntryIdsAction" src` prints nothing
and exits 1. `grep -rn "window.location" src/components/fastview
src/hooks/usePlaylistNav.ts src/hooks/useSongEntry.ts src/lib/playlistNav.ts`
prints nothing and exits 1. The page reads `searchParams.get('returnTo')` and
`searchParams.get('bandId')` at lines 44-45.

**The thirty-five suites pass together.** One `npx vitest run` over the 9
fast-view `src/lib` test files, the 7 fast-view hook test files, the
`src/components/fastview` directory (13 files) and the 6 Stage Mode guards
(`erasePersistence`, `stageInteraction`, `annotationMath`, `pdfWorkerAsset`,
`noBrowserDialogs`, `TabDrawingStage.test.tsx`) reports
`Test Files  35 passed (35)` and `Tests  366 passed (366)`, no failed and no
skipped. `src/components/fastview/__tests__/FastViewShell.test.tsx` exists and is
the closest thing to an end-to-end jsdom smoke of the composition root's shell
pieces.

**Gate baselines, all measured at `e985ba5`.**

- `npx vitest run`: `Test Files  88 passed (88)`, `Tests  1034 passed (1034)`, no
  skipped. Needs Postgres at
  `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations
  applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`; without
  them six DB-backed files skip 51 tests.
- `npm run test:coverage`: passes the configured thresholds (statements 80,
  branches 65, functions 78, lines 80); the `All files` row reads
  `97.14 | 84.45 | 99.4 | 97.66`.
- `rtk proxy npx eslint .`: final summary line `24 problems (10 errors, 14 warnings)`.
- `./node_modules/.bin/tsc --noEmit`: exits 0, prints nothing.
- `npm run lint:dead` (knip): clean.
- `npm run lint:dup` (jscpd): `Found 18 clones.`, Total row 230 duplicated lines,
  `0.69%`, against the 2 % threshold.
- `npm run audit`: `found 0 vulnerabilities`.
- `npx next build`: exits 0, route table lists `/songs/[id]/fast-view` as dynamic.
- `npx playwright test e2e/ssr-smoke.spec.ts --project=chromium`: `4 passed`.

**Tooling note.** A shell hook in this environment rewrites the output of
`npx eslint` and `npx tsc`. Every ESLint result below must be produced with
`rtk proxy npx eslint ...` to see the raw output, and TypeScript with the exact
binary path `./node_modules/.bin/tsc --noEmit`.

**F6's numbers, re-measured against the review's own baseline.**
`docs/plans/code-quality-review.md` is pinned to `13da8b2` (its third line says
so). I measured that commit directly rather than trusting the finding, by
writing `git show 13da8b2:src/app/songs/[id]/fast-view/page.tsx` to a throwaway
`src/rh38probe.tsx`, linting it, and deleting it (`git status --porcelain -- src`
prints nothing afterwards). Three separate things are going on and only one of
them is a drift:

- **Complexity 82 was accurate at `13da8b2`** and had drifted to 88 by `c8665cd`,
  the commit RH-48 branched from. RH-34, RH-45 and RH-46 added branches in
  between.
- **"1586-line client component" is the file length, not the function's.**
  `FastViewPage` itself measured 1495 lines at `13da8b2` and 1534 at `c8665cd`,
  where the file had grown to 1625. The heading conflates the two.
- **"40 `useState` calls, 5 `useEffect` blocks" was wrong at `13da8b2` itself**:
  the counts there were 39 and 4 (`grep -o 'useState[<(]'` and
  `grep -o 'useEffect('`). They reached 40 and 5 only at `c8665cd`.

As with RH-37's corrections, the honest fix is a dated additive line, not a
rewrite of the heading: section 2 is an explicitly dated measurement of
`13da8b2` and section 3 is its analysis, so editing either destroys the audit
trail.

## Approach

### 1. `docs/plans/code-quality-review.md` - four added lines, nothing removed

The edit is **purely additive**: four new lines, no line deleted, no line
reworded. ER6 checks that with `git diff --numstat`. Each new line is a single
line in the file, appended at the end of the block it belongs to, so every closed
finding ends with a `**Status:**` line, exactly as RH-37 left F8, F21, F22 and T4
(lines 305, 411, 420 and 523 at `e985ba5`).

**After F6's `**Remediation:**` line (L287 at `e985ba5`), append these two lines,
in this order:**

```
**Correction (RH-38):** Three numbers in the heading and rationale above need dating. The complexity of 82 was accurate at this document's pinned baseline `13da8b2` and had drifted to 88 by `c8665cd`, the commit the remediation branched from. The `1586-line` figure is the file's length, not the function's: `FastViewPage` itself measured 1495 lines at `13da8b2` and 1534 lines at `c8665cd`, where the file had reached 1625 lines. And the `40 useState calls, 5 useEffect blocks` counts were 39 and 4 at `13da8b2` (measured with `grep -o 'useState[<(]'` and `grep -o 'useEffect('`); they reached 40 and 5 only by `c8665cd`.
**Status:** Resolved by RH-48 (`a49a295`), RH-49 (`6b30ddb`), RH-50 (`bf0c97e`), RH-51 (`aaf9a21`) and RH-52 (`e985ba5`), in five vertical slices rather than the three horizontal layers proposed above; each slice still landed its own pure logic in `src/lib`, its controller in `src/hooks` and its markup in `src/components/fastview`. The page went 1625 lines / complexity 88 at `c8665cd`, then 1427/76, 1091/67, 964/54, 658/30, and finally 222 lines with `FastViewPage` at complexity 6 at `e985ba5`, where it holds no `useState`, no `useEffect` and no data access at all. At `e985ba5` the whole feature - the page, 27 components under `src/components/fastview`, the four `src/app/fastView*Actions.ts` files, seven hooks and nine `src/lib` modules - passes `complexity` 15, `max-lines-per-function` 200 and `max-depth` 4 with no file over 400 lines, and the sixteen new `src/lib` and `src/hooks` modules carry sixteen new unit-test files inside the RH-24 coverage gate.
```

**After F26's `**Remediation:**` line (L453 at `e985ba5`), append this line:**

```
**Status:** Resolved by RH-48 (`a49a295`) and RH-52 (`e985ba5`). RH-48 replaced the navigation and back-button reads with `useSearchParams()` and deleted `getPlaylistEntryIdsAction`, whose two callers now read `.entries` from `getPlaylistDetailsWithEntriesAction`; RH-52 moved the load-effect reads into `src/hooks/useSongEntry.ts`, whose effect dependency array carries the search-params-derived band id, so a query-string-only navigation refetches. At `e985ba5`, `grep -c "window.location" "src/app/songs/[id]/fast-view/page.tsx"` prints `0` where it printed `4` at `c8665cd`, and `grep -rn "getPlaylistEntryIdsAction" src` prints nothing.
```

**After T5's `**Covers:** F6, F26` line (L529 at `e985ba5`), append this line:**

```
**Status:** Delivered by RH-48 (`a49a295`), RH-49 (`6b30ddb`), RH-50 (`bf0c97e`), RH-51 (`aaf9a21`) and RH-52 (`e985ba5`); integrated and verified by RH-38. Both findings it covers are closed.
```

As in RH-37, the T5 marker uses `Delivered` rather than `Resolved`, so that
`grep -c "^\*\*Status:\*\* Resolved"` counts findings only (3 today, 5 after this
edit) and `grep -c "^\*\*Status:\*\* Delivered"` counts tasks only (1 today, 2
after). Measured today at `e985ba5`: `Resolved` 3, `Delivered` 1,
`Correction (RH-37)` 2, `Correction (RH-38)` 0.

Do not touch any other finding, the section 2 measurement tables, the section 4
priority table, or any other T-task block. In particular F11 and F20 (the
ESLint budget wiring) stay open: this task proves the Fast View files pass the
budgets by invoking them with `--rule`, it does not add them to
`eslint.config.mjs`. That is RH-39.

### 2. AGENTS.md - one added line

Unlike RH-37, AGENTS.md **is** edited here, because the convention is not stated
anywhere. I checked: the only mentions of Fast View are the product-capability
bullet (L13), the Playwright bullet (L91), the directory-tree entry (L122), the
domain-concept entry (L181) and the Playlist Layout UI directive (L270). None of
them describes the composition root, the lib/hook/component layering inside the
feature, or the injected-actions pattern. RH-45 and RH-47 added the `A2 - thin
Server Actions` paragraph and the `**Import direction (F21).**` bullet, which
state the *general* rule but say nothing about Fast View's shape.

Append exactly one line to the end of the **Key architectural decisions** bullet
list (after the `**Observability**` bullet, L53 at `e985ba5`):

```
- **Fast View is a composition root (RH-38).** `src/app/songs/[id]/fast-view/page.tsx` holds no `useState`, no `useEffect` and no data access: it wires seven controller hooks (`usePlaylistNav`, `useTabLibrary`, `usePdfStage`, `useLyricsEditor`, `useSongEntry`, `useSongStatus`, `useSongLinks`) to the presentational components under `src/components/fastview/`, and the pure decisions live in `src/lib` (`playlistNav.ts`, `tabLibrary.ts`, `scrollHost.ts`, `stageHistory.ts`, `lyricsMarkdown.ts`, `lyricsEditor.ts`, `songEntry.ts`, `songStatus.ts`, `songLinks.ts`). Because of the import-direction rule below, no hook or component may import a Server Action: the page injects them as typed dependency objects from `src/app/fastViewNavActions.ts`, `fastViewTabActions.ts`, `fastViewLyricsActions.ts` and `fastViewEntryActions.ts`. New Fast View behaviour goes into a lib function, its hook and its component - never back into the page.
```

That is one physical line, so ER7 can pin `git diff --numstat` at `1	0	AGENTS.md`.
Note that `next dev` rewrites the `nextjs-agent-rules` block in this file; do not
run `next dev` against the tree before committing, or the numstat pin will not
hold. `npx next build` (ER8) does not touch it.

### 3. Version bump

`package.json` goes from `0.1.80-202609072128` to `0.1.81-YYYYMMDDHHmm` with the
local-time stamp of the commit. The Version Bumping Rule in AGENTS.md applies to
every commit that merges to master, documentation-only ones included.

### 4. Running the verification

Everything in the Expected Results is a re-run, not a change. Run the whole set
once after the two documentation edits and the version bump are in the tree, so
the evidence describes the commit that will actually merge. The DB precondition
in ER4 is not optional: without Postgres and `SUPABASE_SERVICE_ROLE_KEY`, six
files skip 51 tests and neither the suite count nor the coverage number in ER4
can be reached.

## Expected Results

ER1 - The composed budget holds over the whole Fast View feature at the merge commit, run from the repository root. Let FASTVIEW be this list of paths: `"src/app/songs/[id]/fast-view/page.tsx"`, `src/components/fastview`, `src/app/fastViewNavActions.ts`, `src/app/fastViewTabActions.ts`, `src/app/fastViewLyricsActions.ts`, `src/app/fastViewEntryActions.ts`, `src/hooks/usePlaylistNav.ts`, `src/hooks/useTabLibrary.ts`, `src/hooks/usePdfStage.ts`, `src/hooks/useLyricsEditor.ts`, `src/hooks/useSongEntry.ts`, `src/hooks/useSongStatus.ts`, `src/hooks/useSongLinks.ts`, `src/lib/playlistNav.ts`, `src/lib/tabLibrary.ts`, `src/lib/scrollHost.ts`, `src/lib/stageHistory.ts`, `src/lib/lyricsMarkdown.ts`, `src/lib/lyricsEditor.ts`, `src/lib/songEntry.ts`, `src/lib/songStatus.ts`, `src/lib/songLinks.ts`. Then `rtk proxy npx eslint <FASTVIEW> --rule '{"complexity":["error",15],"max-lines-per-function":["error",200],"max-depth":["error",4]}'` prints no output at all and exits 0. Use `rtk proxy`, because a shell hook in this environment rewrites plain `npx eslint` output. Every one of those paths must exist; `src/components/fastview` must contain exactly 27 `*.tsx` component files and exactly 13 `*.tsx` files under `src/components/fastview/__tests__` (`ls src/components/fastview/*.tsx | wc -l` prints `27` and `ls src/components/fastview/__tests__/*.tsx | wc -l` prints `13`). Size budget: `wc -l` over the page, `src/components/fastview/*.tsx`, `src/components/fastview/__tests__/*.tsx`, `src/app/fastView*.ts` and the seven hook and nine lib files above, piped through `grep -v ' total$' | awk '$1 >= 400'`, prints nothing, i.e. no file in the feature reaches 400 lines (the largest is `src/hooks/useTabLibrary.ts` at 302). `wc -l "src/app/songs/[id]/fast-view/page.tsx"` prints `222` (it printed `1625` at `c8665cd`). The page is a composition root with no state and no data access: `grep -c "useState\|useEffect" "src/app/songs/[id]/fast-view/page.tsx"` prints `0`, `grep -n "@/lib/db" "src/app/songs/[id]/fast-view/page.tsx"` prints nothing and exits with status 1, and `rtk proxy npx eslint "src/app/songs/[id]/fast-view/page.tsx" --rule '{"complexity":["error",1]}'` prints exactly one problem line, reading `Function 'FastViewPage' has a complexity of 6. Maximum allowed is 1`. This ER is deliberately scoped to the Fast View files rather than to whole `src/hooks` and `src/lib` globs: at `e985ba5` those globs fail with 20 pre-existing errors (`src/hooks/useBandAdmin.ts`, `src/lib/linkFetcher.ts`, `src/lib/moderation.ts`, `src/lib/songs.ts` and ten `src/lib/__tests__` files), none of which this decomposition created or was asked to fix.

ER2 - The layering rule and finding F26 hold at the merge commit, checked from the repository root; append `; echo $?` to read each exit status. `grep -rn "@/app/" src/components src/lib src/hooks | grep -v __tests__` prints nothing and exits with status 1, so none of the sixteen new hooks and libs and none of the 27 new components reaches up into the App Router tree (this is F21/RH-47, still holding after the decomposition). `grep -c "window.location" "src/app/songs/[id]/fast-view/page.tsx"` prints `0`; it printed `4` at `c8665cd`. `grep -rn "window.location" src/components/fastview src/hooks/usePlaylistNav.ts src/hooks/useSongEntry.ts src/lib/playlistNav.ts` prints nothing and exits with status 1, so the reads were removed rather than relocated. `grep -rn "getPlaylistEntryIdsAction" src` prints nothing and exits with status 1, so the pure alias action F26 objected to is gone. `grep -c "searchParams.get('returnTo')" "src/app/songs/[id]/fast-view/page.tsx"` and `grep -c "searchParams.get('bandId')" "src/app/songs/[id]/fast-view/page.tsx"` each print `1`, and `grep -nE "\}, \[[^]]*bandId[^]]*\]\)" src/hooks/useSongEntry.ts` prints at least one line, i.e. the load effect's dependency array carries the search-params-derived band id so a query-string-only navigation refetches. Together these are F26 fully closed, both halves.

ER3 - The five parts' suites and the Stage Mode guards pass together in one run. `npx vitest run src/lib/__tests__/playlistNav.test.ts src/lib/__tests__/tabLibrary.test.ts src/lib/__tests__/scrollHost.test.ts src/lib/__tests__/stageHistory.test.ts src/lib/__tests__/lyricsMarkdown.test.ts src/lib/__tests__/lyricsEditor.test.ts src/lib/__tests__/songEntry.test.ts src/lib/__tests__/songStatus.test.ts src/lib/__tests__/songLinks.test.ts src/hooks/__tests__/usePlaylistNav.test.tsx src/hooks/__tests__/useTabLibrary.test.tsx src/hooks/__tests__/usePdfStage.test.tsx src/hooks/__tests__/useLyricsEditor.test.tsx src/hooks/__tests__/useSongEntry.test.tsx src/hooks/__tests__/useSongStatus.test.tsx src/hooks/__tests__/useSongLinks.test.tsx src/components/fastview src/lib/__tests__/erasePersistence.test.ts src/lib/__tests__/stageInteraction.test.ts src/lib/__tests__/annotationMath.test.ts src/lib/__tests__/pdfWorkerAsset.test.ts src/lib/__tests__/noBrowserDialogs.test.ts src/components/tabs/__tests__/TabDrawingStage.test.tsx` exits 0 and reports exactly `Test Files  35 passed (35)` and at least 366 tests passed, with no `failed` and no `skipped` segment on either line. All 22 explicit paths must exist (a missing path makes vitest fail rather than silently pass), and the `src/components/fastview` argument must resolve to the 13 files under `src/components/fastview/__tests__`, among which `src/components/fastview/__tests__/FastViewShell.test.tsx` is present and passing: it is the jsdom smoke of the composition root's shell pieces. This run needs no database.

ER4 - The whole suite and the coverage gate are green and have not shrunk. With Postgres running at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied (`npm run db:migrate`) and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in the environment or `.env.local` (for example `set -a; . ./.env.local; set +a`), `npx vitest run` exits 0 reporting at least 88 test files passed and at least 1034 tests passed, with 0 failed and 0 skipped. Those are the exact counts at the `e985ba5` baseline (`Test Files  88 passed (88)`, `Tests  1034 passed (1034)`), and since this task adds no test they are equalities in practice; they are floors only so an unrelated concurrent addition cannot fail the result. Under the same precondition `npm run test:coverage` exits 0 with no threshold error (the configured gates are statements 80, branches 65, functions 78, lines 80) and its `All files` row shows statements at least 97, branches at least 84, functions at least 99 and lines at least 97 (measured `97.14 | 84.45 | 99.4 | 97.66` at `e985ba5`). Without the two preconditions six DB-backed files skip 51 tests, the counts above are unreachable and the coverage number is meaningless.

ER5 - Every static gate is exactly at its `e985ba5` baseline, run from the repository root. `rtk proxy npx eslint .` prints a final summary line reading exactly `24 problems (10 errors, 14 warnings)`, unchanged, because this task edits no file ESLint lints; use `rtk proxy`, because a shell hook rewrites plain `npx eslint` output. `./node_modules/.bin/tsc --noEmit` exits 0 and prints nothing (use that exact binary path; `npx tsc` is intercepted by the same hook). `npm run lint:dead` exits 0 and reports no unused files, exports, types or dependencies. `npm run lint:dup` exits 0 and prints `Found 18 clones.` with a Total row showing 230 duplicated lines and `0.69%`, below the 2 % threshold. `npm run audit` exits 0 and prints `found 0 vulnerabilities`.

ER6 - The review document records the close-out and F6's correction, additively. `grep -c "^\*\*Status:\*\* Resolved" docs/plans/code-quality-review.md` prints `5` (it prints `3` at `e985ba5`); the two new lines are the ones appended to `### F6 - FastViewPage is a single 1586-line client component with a cyclomatic complexity of 82` and to `### F26 - Route state is read from window.location instead of the router, and one action is a pure alias`, and between them they name all five of the commit ids `a49a295`, `6b30ddb`, `bf0c97e`, `aaf9a21` and `e985ba5`. `grep -c "^\*\*Status:\*\* Delivered" docs/plans/code-quality-review.md` prints `2` (it prints `1` at `e985ba5`); the new one is on `### T5 - Decompose the Fast View page` in section 5 and names all five of those commit ids. `grep -c "^\*\*Correction (RH-38):\*\*" docs/plans/code-quality-review.md` prints `1`, that line sits inside the F6 block, and it states all three of the corrected numbers: that complexity 82 was accurate at `13da8b2` and had drifted to 88 by `c8665cd`, that `FastViewPage` itself was 1495 lines at `13da8b2` and 1534 at `c8665cd` while 1586 and 1625 are the file lengths, and that the `useState` and `useEffect` counts were 39 and 4 at `13da8b2` rather than 40 and 5. `grep -c "^\*\*Correction (RH-37):\*\*" docs/plans/code-quality-review.md` still prints `2`, unchanged. The edit is purely additive and adds exactly four lines: `git diff --numstat e985ba5 -- docs/plans/code-quality-review.md` prints exactly `4	0	docs/plans/code-quality-review.md` (four insertions, zero deletions), so no finding's heading or analysis prose, no section 2 measurement table and no section 4 row was reworded, and no finding other than F6, F26 and T5 gained a marker.

ER7 - AGENTS.md states the Fast View architecture, in exactly one added line. `grep -c "Fast View is a composition root" AGENTS.md` prints `1` (it prints `0` at `e985ba5`), the line is a bullet inside the `Key architectural decisions` list of the `High-level Architecture` section, and it names all three layers plus the injected-actions pattern: `grep -n "Fast View is a composition root" AGENTS.md` returns a line that contains all seven hook names `usePlaylistNav`, `useTabLibrary`, `usePdfStage`, `useLyricsEditor`, `useSongEntry`, `useSongStatus`, `useSongLinks`, the directory `src/components/fastview/`, and all four of `src/app/fastViewNavActions.ts`, `fastViewTabActions.ts`, `fastViewLyricsActions.ts`, `fastViewEntryActions.ts`. `git diff --numstat e985ba5 -- AGENTS.md` prints exactly `1	0	AGENTS.md` (one insertion, zero deletions), so nothing else in AGENTS.md moved; in particular the `nextjs-agent-rules` block that `next dev` regenerates is byte-identical, which means `git diff e985ba5 -- AGENTS.md | grep -c "^-"` prints `1` (the `--- a/AGENTS.md` header line only).

ER8 - The application still builds and server-renders at the merge commit. `npx next build` exits 0 with no error output and no error mentioning a missing Suspense boundary or `useSearchParams`, and its route table lists `/songs/[id]/fast-view` as dynamic (server-rendered on demand). Immediately afterwards, `set -a; . ./.env.local; set +a; PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" npx playwright test e2e/ssr-smoke.spec.ts --project=chromium` prints `4 passed` and exits 0. Both were green at `e985ba5` and this task changes no code, so a failure here means something outside the task's footprint moved. `e2e/fast-view-mobile.spec.ts` and `e2e/songs-crud.spec.ts` are not gates: both are red at `e985ba5` for the unrelated RH-44 `addSong` helper reason, so their result may be recorded but never blocks this task.

ER9 - The version was bumped and the blast radius is documentation only. `node -p "require('./package.json').version"` prints a string matching `^0\.1\.81-20[0-9]{10}$` (patch 81, then a 12-digit `YYYYMMDDHHmm` local-time stamp), strictly greater than the `0.1.80-202609072128` at `e985ba5`. `git diff --name-only e985ba5` prints a subset of exactly this whitelist and nothing else: `AGENTS.md`, `package.json`, `docs/plans/code-quality-review.md`, `docs/tasks/RH-38-spec.md`, `docs/suggestions-log.md`, `.meridian/tasks.json`. `git diff --name-only e985ba5 -- src migrations e2e eslint.config.mjs vitest.config.ts` prints nothing, so no source file, migration, end-to-end spec, lint config or test config was touched, and in particular no further refactoring was smuggled in. This task ships no user-facing feature, so under the AGENTS.md Landing Page Rule it is not a selling point: `git diff --stat e985ba5 -- src/components/landing src/i18n/dictionaries` prints nothing and `npx vitest run src/lib/__tests__/landingCopy.test.ts` exits 0 with 0 failed tests.

## Out of Scope

- **Any further refactoring.** ER9 forbids touching `src/` at all. The known
  remaining offenders that the composed budget would flag - `useBandAdmin.ts`
  (298-line function), `linkFetcher.ts` (complexity 18), `moderation.ts` (19),
  `songs.ts` (21) and the long `describe` arrows in `src/lib/__tests__` - are
  pre-existing, unrelated to Fast View, and stay exactly as they are. So do the
  two latent behaviours the split recorded deliberately: the desktop
  previous-only arrow asymmetry and the removed `uploadDestination` dead state.
- **RH-39 / F20 / F11 - wiring the budgets into `eslint.config.mjs`.** This task
  proves the Fast View files pass `complexity`, `max-lines-per-function` and
  `max-depth` by invoking them with `--rule`. Adding them to the shared config,
  with the override list for the offenders above, is RH-39's job, and it must
  land after this close-out or `npx eslint .` goes red for reasons this task did
  not cause. `eslint.config.mjs` is not edited.
- **Closing any other finding.** Only F6, F26 and T5 get markers. F1-F5, F7,
  F9-F25 and T1-T3, T6-T10 keep their current text even where later tasks have in
  fact addressed them; sweeping the whole document is separate work with its own
  evidence requirements.
- **Rewriting the review's measured baseline.** Section 2's tables, F6's heading
  and section 4's priority rows describe `13da8b2` and stay as measured. The
  correction is an additive, dated line in section 3.
- **T8 / F25** - converting Fast View to a Server Component and dropping the
  `useEffect` data fetch. The load effect was moved into `useSongEntry`, not
  eliminated.
- **Repairing `e2e/fast-view-mobile.spec.ts` or `e2e/songs-crud.spec.ts`.** Both
  are red at `e985ba5` for the RH-44 `addSong` helper reason and cannot
  distinguish a correct implementation from a broken one. ER8 gates on
  `e2e/ssr-smoke.spec.ts` only.
- **A new e2e spec for the decomposed page.** The jsdom coverage the five parts
  landed (35 files, 366 tests) plus `FastViewShell.test.tsx` is the regression
  signal here; adding Playwright coverage for Fast View is worth doing but is not
  this task and would need its own fixture work on top of the RH-44 helper fix.

## Post-merge checks (orchestrator)

- RH-38 is fully delivered once this merges: RH-48, RH-49, RH-50, RH-51, RH-52
  and this close-out together satisfy T5, and both findings it covers (F6, F26)
  are closed. No successor task is implied by RH-38 itself.
- Unblock RH-39 (F20/F11) next, and hand it two inputs: the `24 problems
  (10 errors, 14 warnings)` summary it must ratchet against, and the concrete
  override list the composed budget produced - `src/hooks/useBandAdmin.ts`,
  `src/lib/linkFetcher.ts`, `src/lib/moderation.ts`, `src/lib/songs.ts` and the
  ten `src/lib/__tests__` files with `describe` arrows over 200 lines. Those are
  the only files standing between the repository and a repo-wide
  `complexity` 15 / `max-lines-per-function` 200 / `max-depth` 4 rule.
- A manual smoke on a phone-sized viewport is still worth doing once, end to end
  across all five slices in a single session, since no part exercised the
  composition root as a whole: open a band song in Fast View from a playlist,
  swipe between entries, change status, add and delete a link, edit and save
  lyrics, flip the personal/band lyrics switch, open lyrics Stage Mode and leave
  with the browser back button, then open a PDF tab, draw an annotation, leave
  with back, and reopen to confirm the annotation survived.

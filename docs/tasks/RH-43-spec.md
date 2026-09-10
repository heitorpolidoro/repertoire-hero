# RH-43 - Consolidar convencoes de nomes, divisao de modulos e i18n no AGENTS.md

RH-43 resolves F23, F24 and F25 in `docs/plans/code-quality-review.md` - the
three Low-severity "Naming & consistency" findings - and the section 5 task that
covers them, **T10 - Settle the naming, module-split and i18n conventions in
AGENTS.md**. It is one deliverable: the project's naming, module-layout and i18n
rules stop being folklore and become written, measured and (where a test can see
them) enforced.

Baseline: `bb5070b`, version `0.1.97-202609091918`. Every number in this spec was
re-measured from the repository root at that commit while writing this revision,
and the command that produced it is written next to it in the Audit, so a
reviewer can re-run any of them without reconstructing the query.

## Scope

This task covers four things.

1. **AGENTS.md gains three sections** - `# Naming Conventions`,
   `# Module Layout - where a thing goes` and `# Internationalisation` - written
   from what the code actually does at `bb5070b`, not from what would be nice.
   The `# Directory Structure` tree is brought back in line with the tree it
   claims to describe, and the one sentence in it that is false (`bands.ts` /
   `bands.server.ts` described as "client-safe + server-only halves", the subject
   of F24) is deleted.
2. **One mechanical code change**: `src/lib/bands.ts` is converted from
   `export const name = async (...) => {}` to `export async function`, which is
   the whole of F23's remediation beyond the write-up. Twelve exports, no
   signature change, no behaviour change. It is included rather than deferred
   because it is what turns "45 of 46 modules do X" into "the rule has no
   exceptions", and a convention with a standing exception is the thing this
   task exists to end.
3. **One guard test**, `src/lib/__tests__/namingConventions.test.ts`, so the
   parts of the new documentation that a machine *can* check are checked: five of
   the naming rules, the server-only import rule that replaces F24's broken
   `.server` promise, and the i18n scope decision. This repository enforces its
   conventions mechanically everywhere else (`errorHandlingStyle`,
   `transactionGuard`, `identityWriteGuard`, `actionDataAccessGuard`,
   `migrationsSingleSource`, `complexityBudget`, `serverExternalPackages`); a
   new convention section with nothing behind it would be the odd one out. The
   rules the guard does **not** cover are labelled as such in AGENTS.md rather
   than left to look enforced.
4. **Documentation close-out**: `**Status:**` lines for F23, F24, F25 and T10 in
   `docs/plans/code-quality-review.md`, in the house format; plus a dated
   correction note at the top of `docs/plans/mobile-app-analysis.md`, which two
   review rounds have now flagged as describing a pre-RH-61/RH-65 architecture.

**This task restructures nothing.** No module is merged, split, renamed or moved;
no page, action, hook or component changes behaviour. The only file under `src/`
that changes is `src/lib/bands.ts`, semantics-free, and the only file added is
the guard test.

## Audit at bb5070b

Every command below is run from the repository root. Where a number lands in
AGENTS.md or in a `**Status:**` line, the command that produced it is given
inline.

### F23 - two export styles in `src/lib`

The finding is still true, and its numbers have grown without changing shape.
There are **46** `.ts` modules directly under `src/lib`
(`ls src/lib/*.ts | wc -l` -> `46`); the finding counted 23 at `13da8b2`.
Exactly **one** of them declares its API with arrow consts:

```
grep -rnE '^export const [A-Za-z0-9_]+.* = (async )?\(' src/lib/*.ts
```

returns twelve matches, all in `src/lib/bands.ts`, at lines 7, 64, 108, 134, 172,
189, 203, 232, 265, 288, 303 and 348 -

```
getBands  getBandWithMembers  createBand  updateBand  deleteBand  leaveBand
removeBandMember  getBandPlaylists  createBandPlaylist  joinBandByInviteClient
regenerateBandInviteCode  getBandMembers
```

- alongside one export that is already a declaration, `assertBandMember`
(`grep -n '^export async function' src/lib/bands.ts` -> `36:`). Every other
module uses `export function` / `export async function` exclusively. Two of the
twelve are single-line (lines 7 and 348, matched by
`grep -nE '^export const [A-Za-z0-9_]+.* = (async )?\(.*\).*=> \{$' src/lib/bands.ts`);
the other ten have multi-line parameter lists, so the conversion touches two
lines each (the signature line and the `) => {` line). Predicted diff:
10 * 2 + 2 = **22 lines changed**, insertions equal to deletions.
`wc -l < src/lib/bands.ts` -> `350`, and that must not move.

Nothing else in the naming picture is drifting. Measured at `bb5070b`:

| Rule | Command | Population | Violations |
|---|---|---|---|
| `src/app/actions/*.ts` function exports end in `Action` | `grep -rhoE "^export async function [A-Za-z0-9_]+" src/app/actions/*.ts \| awk '{print $NF}' \| grep -c 'Action$'` -> `44`, against `grep -rh '^export async function' src/app/actions/*.ts \| wc -l` -> `44` | 44 | 0 |
| `src/hooks/*.ts` is `use<Name>.ts` exporting `function use<Name>` | `ls src/hooks/*.ts \| wc -l` -> `11` | 11 | 0 |
| `src/components/**/*.tsx` filenames are `PascalCase.tsx` | `find src/components -name '*.tsx' ! -path '*__tests__*' ! -name '*.test.tsx' \| wc -l` -> `51` | 51 | 0 |
| `src/lib/dbRows.ts` exported interfaces end in `Row` | `grep -c '^export interface' src/lib/dbRows.ts` -> `10`; `grep -oE '^export interface [A-Za-z0-9_]+' src/lib/dbRows.ts` shows all ten end in `Row` | 10 | 0 |
| Tests live in `__tests__/`, `<subject>.test.ts(x)` | `find src -name '*.test.ts' -o -name '*.test.tsx' \| wc -l` -> `106` | 106 | 1 (below) |

**Two exceptions that the previous round of this spec wrongly called zero.** They
are named in the documentation rather than papered over:

- `src/app/actions` carries **45** top-level `export` statements, not 44. The
  extra one is `src/app/actions/tabs.ts:17`, `export type { Stroke, TabAnnotations }` -
  a type re-export, not an action. Measured:
  `grep -rn "^export " src/app/actions/*.ts | grep -vE ":[0-9]+:export (async )?function"`
  returns exactly that one line. The rule is therefore about *function* exports,
  and the AGENTS.md bullet says so and names the re-export.
- The test-layout rule has one exception:
  `src/components/ui/__tests__/feedbackSurfaces.test.tsx` has no
  `feedbackSurfaces.tsx` subject file (`ls src/components/ui/` -> `AlertBanner.tsx`,
  `ConfirmPanel.tsx`, `Toast.tsx`). The bullet names it.

That is the point worth recording: the repository already has a naming
convention, it is followed nearly to the letter, and it is written down nowhere.
The only ambiguity left is which of two shapes an author of a new `src/lib`
module should copy, and F23 is about closing exactly that.

Vocabulary the code has settled on and AGENTS.md never names. Injected Server
Action bundles are typed `<Subject>Actions` and exported as SCREAMING_SNAKE
consts from `src/app/<area>Actions.ts` - **eight** of them across **five** files
(`grep -hoE '^export const [A-Z_]+' src/app/*Actions.ts` ->
`BAND_ADMIN_ACTIONS`, `SONG_ENTRY_ACTIONS`, `SONG_STATUS_ACTIONS`,
`SONG_LINKS_ACTIONS`, `LYRICS_EDITOR_ACTIONS`, `PLAYLIST_NAV_ACTIONS`,
`TAB_LIBRARY_ACTIONS`, `PDF_STAGE_ACTIONS`; `ls src/app/*Actions.ts` ->
`bandAdminActions.ts`, `fastViewEntryActions.ts`, `fastViewLyricsActions.ts`,
`fastViewNavActions.ts`, `fastViewTabActions.ts`). A parsed-and-narrowed input
shape is `<Subject>Payload` (`GlobalSongEditPayload`, `BandUpdatePayload`). A
DB-backed test file is `<subject>.db.test.ts` -
`find src -name '*.db.test.ts' | wc -l` -> `9` of the 106.

Hook return types are `<Subject>Controller`, but **not universally**: ten of the
eleven hooks annotate one
(`grep -lE "\): [A-Za-z0-9_]+Controller" src/hooks/*.ts | wc -l` -> `10`), and
`grep -LE "\): [A-Za-z0-9_]+Controller" src/hooks/*.ts` returns
`src/hooks/useToast.ts`, whose export is `export function useToast() {` at line 14
with no return annotation at all. The AGENTS.md bullet names that exception and
does not claim the vocabulary is checkable - no guard reads return types.

Three `src/lib` filenames sit outside `camelCase.ts`: `auth-client.ts`,
`auth-session.ts` (kebab, mirroring `better-auth`'s own module names) and
`bands.server.ts`. They stay; the section says so, because an undocumented
exception is what invites the next one.

### F24 - the bands split, and what the `.server` suffix really means

The finding is exactly right on the facts. `src/lib/bands.ts:1` is
`import { query } from "@/lib/db"` at module scope, so it pulls in `pg` precisely
as `bands.server.ts:1` does (`grep -n query src/lib/bands.ts` shows 15 call
sites, lines 22 through 327). AGENTS.md L143-144 promises the opposite. That
sentence is the defect: a reader who trusts it will import `@/lib/bands` into a
`'use client'` file and get a confusing build failure.

**What F24's remediation actually offers.** Two options, both structural:
(a) merge the two modules and name the functions for what they return
(`joinBandByInvite` returning the richer `JoinBandResult`, with the thin variant
deleted); or (b) make `bands.ts` genuinely dependency-free and move all `pg`
access into `bands.server.ts`. The sentence "Update the AGENTS.md directory
description to match whichever is chosen" is a **rider** on whichever option is
taken, not a third option. **RH-43 takes neither**, and the argument for why the
finding still closes is made below and in the F24 `**Status:**` line rather than
being left implicit.

The useful generalisation - which is checkable, unlike the suffix - is that
**server-only is decided by the `@/lib/db` import, transitively**. Measured at
`bb5070b`, `grep -l '@/lib/db' src/lib/*.ts | wc -l` -> `12`, and those twelve
are:

```
auth.ts  bands.ts  bands.server.ts  devProfiles.ts  moderation.ts  playlists.ts
profile.ts  songs.ts  spotifyAuth.ts  spotifyConnection.ts  spotifyPlaylistSync.ts
tabs.ts
```

No module uses a relative `./db` import (`grep -ln "from ['\"]\./db" src/lib/*.ts`
returns nothing).

**Three more modules pull `pg` in transitively**, which the previous round of
this spec missed and which is the reason the guard's rule is a closure and not a
one-hop check. Computing the fixed point of "imports a server-only `src/lib`
module" over the 46 modules yields three additions: `auth-session.ts` (imports
`@/lib/auth`), `emailChange.ts` (imports `@/lib/auth`) and `spotifyRouteAuth.ts`
(imports `@/lib/bands`, `@/lib/playlists` and `@/lib/spotifyAuth`, among others -
it also reaches `pg` through `@/lib/auth-session` at line 28; the three named are
the shortest paths). So the server-only closure is **15** of 46 and **31** are
genuinely free of `pg`. The one-hop version of the check would call those three
importable from client code, which is false.

**The closure is 15 either way, and the rule counts value imports only.** Two
readings of "imports" are available - one that counts `import type` clauses as
graph edges and one that does not - and the closure is `15`/`31` under both,
because all three transitive edges are value imports (`auth-session.ts:1`,
`emailChange.ts:1`, `spotifyRouteAuth.ts:28-31`). The rule this task writes down
nevertheless has to pick one, because the two guards differ on the next client
component that wants `import type { JoinBandResult } from '@/lib/bands.server'`.
**RH-43 counts only value imports as edges**, on both sides of the check: the
stated invariant is "pulls `pg` into the client bundle", and a type-only import
is erased by the compiler before anything is bundled, so it cannot. This is not
a hypothetical concession - at `bb5070b` the 60 `'use client'` files already
carry **23** whole-clause `import type ... from "@/lib/..."` statements (the
round-2 review counts 27 on a wider convention; the difference is what counts as
one import, not a disagreement about the tree), every one of them into a pure
module, so the type-counting guard is green today and would only start failing
later, on a change that is in fact harmless. The decision is stated in AGENTS.md
in the same sentence as the rule ("may be imported **for its values** from a file
carrying `'use client'`") rather than left to the reader of the test.

The 31 pure modules are what client code imports. Scanning the **60** non-test
files under `src/` that carry `'use client'`
(`grep -rl "use client" --include="*.ts" --include="*.tsx" src | grep -v "__tests__" | grep -v "\.test\." | wc -l`
-> `60`) for `@/lib/*` specifiers yields **nineteen** distinct modules, not the
seventeen the previous round claimed:

```
annotationMath  auth-client  bandAdminLoad  bandColors  i18n  imageCompressor
lyricsEditor  lyricsMarkdown  pdfWorker  playlistList  playlistNav  songEntry
songLinks  songStatus  spotify  stageInteraction  statusConfig  tabLibrary
uiTones
```

The two the earlier list dropped are exactly the two a naive scan misses:
`@/lib/auth-client`, whose hyphen a `[A-Za-z0-9_]+` module-name pattern truncates
to `auth` (which *is* server-only, so a truncating scan reports a violation that
does not exist), and `@/lib/pdfWorker`, imported for its side effect as
`import '@/lib/pdfWorker'` at `src/components/tabs/TabDrawingStage.tsx:5`, which a
`from "@/lib/..."` scan does not see at all. **Not one** of the nineteen is in
the 15-module server-only closure, checked directly.

Split by the value/type distinction the guard's rule turns on: **fifteen** of the
nineteen are imported for their values (`annotationMath`, `auth-client`,
`bandAdminLoad`, `bandColors`, `i18n`, `imageCompressor`, `lyricsMarkdown`,
`pdfWorker`, `playlistList`, `playlistNav`, `songStatus`, `spotify`,
`stageInteraction`, `statusConfig`, `uiTones`) and **seven** for their types only
(`lyricsEditor`, `playlistNav`, `songEntry`, `songLinks`, `songStatus`,
`tabLibrary`, `uiTones`), three appearing in both lists, union nineteen. Both
`auth-client` and `pdfWorker` are in the value set, so the two cases a naive scan
misses are inside the guard's rule and not excused by it. The invariant the `.server`
suffix only claimed already holds in practice; it just has nothing watching it.

What the suffix actually marks is a **second return shape for the same SQL
call**. `joinBandByInviteClient` (`bands.ts:288`) and `joinBandByInviteServer`
(`bands.server.ts:37`) both call `join_band_by_invite($1, $2)`; the first returns
a band id, the second the richer `JoinBandResult` that `src/app/join/[code]/page.tsx`
renders. `getBandByInviteCodeServer` is likewise used only by that page
(`grep -rn "@/lib/bands.server" src | grep -v __tests__` -> exactly
`src/app/join/[code]/page.tsx:8`).

**Why documentation plus the guard closes F24 without either structural option.**
The finding's stated harm is twofold: a reader has no correct rule for choosing
between the two modules, and "a future author may reasonably import the
'client-safe' module into a `'use client'` file and break the build in a
confusing way". The false sentence is deleted, so the first half of the harm is
gone at the source. The second half is closed *more* completely than either
option would close it: option (a) merges one pair and option (b) rearranges one
pair, and neither leaves anything watching the other 44 modules, whereas the
guard computes the server-only closure from source and fails CI on any client
import of any of the 15 - which is the isolation the `.server` suffix only ever
claimed, generalised to the whole directory. What the options would additionally
buy is a name that describes the return shape rather than a runtime, and that is
a rename of a public function plus a rewrite of the tests that call it. Both are
recorded in Out of Scope as declined, with the measurement that prices them.

**Option (a) is cheaper than the finding assumed.**
`grep -rn joinBandByInviteClient src` shows no caller outside tests at `bb5070b`:
the only references are `src/lib/__tests__/joinBandByInvite.test.ts`,
`src/lib/__tests__/bands.test.ts` and `src/lib/__tests__/errors.test.ts`. So the
merge is a delete plus a rewrite of three test files.

**Option (b) is more expensive than it sounds.** `bands.ts` has 15 `query()` call
sites, so "move all `pg` access into `bands.server.ts`" means moving almost the
whole module and re-pointing every importer of `@/lib/bands`:
`src/app/bands/page.tsx:3`, `src/app/actions/bands.ts:16`,
`src/app/actions/repertoire.ts:22`, `src/lib/playlists.ts:1` and
`src/lib/spotifyRouteAuth.ts:31`. It would also leave a `bands.ts` with almost
nothing in it while keeping the `.server` name that the finding calls
meaningless.

### F25 - the i18n half-state

Measured at `bb5070b`:

- `src/lib/i18n.ts` supports two locales, `DEFAULT_LOCALE` is `'pt-BR'`, and it
  resolves from the `NEXT_LOCALE` cookie then `Accept-Language`.
- `src/i18n/dictionaries/en.json` and `pt-BR.json` hold **49 keys each** and the
  two key sets are **identical** (flattening both to dotted paths and comparing
  returns `en 49 pt 49 same true`). Sections: `common` (12), `nav` (8), `status`
  (5), `landing` (24).
- **Exactly one** file reads copy from a dictionary:
  `src/components/landing/LandingPage.tsx` (line 5 imports `getDictionary`, line
  36 calls it). `grep -rn "getDictionary" src --include="*.ts" --include="*.tsx" | grep -v "__tests__"`
  returns those two lines plus `src/lib/i18n.ts:59`, which is the **definition**
  (`export function getDictionary(locale: Locale) {`) and not a consumer. There
  is no `t(` helper anywhere.
- `LanguageSelector.tsx` **reads no copy from a dictionary** - it imports only
  `COOKIE_NAME`, `SUPPORTED_LOCALES` and the `Locale` type - though it does
  hardcode four strings of its own (`Select Language` at line 28, the
  `Language selector` aria-label at line 33, and the two option labels at lines
  35-36, one of which is the app's only non-English literal). It is rendered in
  **exactly one place**, `LandingPage.tsx:52`
  (`grep -rn "LanguageSelector" src --include="*.tsx" | grep -v "__tests__"` ->
  the import at `LandingPage.tsx:6`, the render at `:52`, and the definition).
  So the remediation's parenthetical "(and hide the selector elsewhere)" is
  already satisfied by the tree and needs recording, not code.
- The other **68 of 69** non-test `.tsx` files under `src/`
  (`find src -name '*.tsx' ! -path '*__tests__*' ! -name '*.test.tsx' | wc -l`
  -> `69`) hardcode their copy in English, where they have any - some, like
  `layout.tsx` and `ConditionalLayout.tsx`, carry no user-visible copy at all -
  as does the user-visible error text assembled in `src/lib`
  (`Failed to fetch bands: ...`).
- **22 of the 49 keys are consumed by nothing**, not 23. Flattening `en.json` and
  testing each key against the text of `LandingPage.tsx` gives
  `used 27 unused 22`. The 27 consumed are all 24 `landing.*` keys (`f1..f6`
  referenced individually, `footer` via `.replace`) plus `common.appName`,
  `nav.signIn` and `nav.getStarted`; 49 - 27 = 22. The orphans enumerate as
  `common.*` except `appName` (11 keys), `nav.*` except `signIn` and `getStarted`
  (6 keys), and all five `status.*` - 11 + 6 + 5 = 22, which is also what the
  enumeration in the previous round of this spec summed to while the prose said
  23. They are the residue of an app-wide attempt that stopped; `knip` does not
  look inside JSON, so nothing reports them.

The finding's headline, "reaches 2 of 29 components", reads as **1 of 69** on
this tree once "reaches" is taken to mean "consumes copy" - `LanguageSelector` is
plumbing, not a translated component. That is a re-count of the same
observation, not a disagreement, and it goes in the `**Status:**` line rather
than in a separate `**Correction**`, exactly as RH-41 disposed of F15's "twelve
of fourteen".

**The decision this task records: i18n stays scoped to the landing page; the
application UI is English-only, written inline.** It is the option the code
already implements, it costs nothing to state, and the remediation's real demand
is that the ambiguity end. The alternative - extracting every string - is a
product decision with a large price tag and gets its own task if it is ever
wanted; recording the scope now does not close that door, it just stops the
half-state from being ambiguous, and it stops a well-meaning agent from
"translating" one page as a side errand and re-creating the exact spread the
finding is about.

Two consequences are deliberate and must be written down as accepted rather than
left to be discovered: a `pt-BR` visitor sees a Portuguese landing page and an
English application, and the 22 orphan keys stay in the dictionaries (deleting
them would be a change under `src/i18n/dictionaries`, which ER9 forbids, and they
are the head start for any future app-wide task).

**The dictionary-parity assertion already exists.**
`src/lib/__tests__/landingCopy.test.ts:27` is
`it('both dictionaries expose the same key set', ...)`, which flattens both
dictionaries, sorts, and compares. The new guard therefore does **not** re-assert
it; the Internationalisation section cross-references that test instead. This is
why the guard has seven tests rather than eight.

### The documented module layout versus the real one

`# Directory Structure` in AGENTS.md was last accurate several tasks ago. At
`bb5070b`:

- `src/components/` has **ten** area directories (`ls -d src/components/*/ | wc -l`
  -> `10`) - `admin` (3 files), `bands` (2), `fastview` (27), `landing` (1),
  `layout` (3), `playlists` (7), `profile` (2), `songs` (2), `tabs` (1), `ui` (3),
  51 files in all. AGENTS.md lists four (`layout`, `profile`, `songs`, `ui`) and
  names seven components (AppLayout, ConditionalLayout, InstrumentPicker,
  SongForm, ConfirmPanel, Toast, AlertBanner) out of the 51 that exist - 44
  unmentioned.
- `src/hooks/` has **eleven** hooks. AGENTS.md lists two (L136-137).
- `src/i18n/` is not in the tree at all.
- `src/app/*Actions.ts` - the five files holding the eight injected action
  bundles that make the F21 import direction work - are not in the tree either,
  although the architecture bullets above reference them by name.
- `docs/` is described as "security-audit.md, test-coverage-plan.md" (L173); it
  now also has `suggestions-log.md`, `plans/` and `tasks/` (50+ specs).
- The `bands.ts / bands.server.ts` line (L143-144) is false (F24).

This is the "divisao de modulos" half of the task: a reader deciding where a new
file goes gets no help from a tree that predates a third of the directories.

### Gate baselines, all measured at bb5070b

- `rtk proxy npx vitest run`: exit 0, `Test Files  106 passed (106)`,
  `Tests  1202 passed (1202)`, 0 skipped, 0 failed. Needs Postgres at
  `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations
  applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in the environment or
  `.env.local`; without them nine `.db.test.ts` files skip.
- `./node_modules/.bin/tsc --noEmit`: exits 0, prints nothing.
- `rtk proxy npx eslint .`: final summary line `22 problems (8 errors, 14 warnings)`.
- `npm run lint:dup` (jscpd): `Found 18 clones.`, Total row `231 (0.61%)` against
  the 2 % threshold.
- `grep -c 'complexity-budget/override' eslint.config.mjs` -> `20` - the ceiling
  the RH-39 ratchet allows. `grep -c 'src/lib/bands.ts' eslint.config.mjs` -> `1`,
  a `max-params: 5` entry; converting arrow consts to declarations changes
  neither the parameter count nor the line count, so that entry stays exactly as
  it is.
- `grep -c "^\*\*Status:\*\* Resolved" docs/plans/code-quality-review.md` -> `12`;
  `grep -c "^\*\*Status:\*\* Delivered"` -> `4`; `grep -c "^\*\*Correction"` ->
  `5`; `grep -c "RH-43"` -> `0`. Insertion anchors: F23's `**Remediation:**` is
  L438, F24's L446, F25's L455, and T10's `**Covers:** F23, F24, F25` is L574.
- AGENTS.md is 351 lines. `grep -c "client-safe"` -> `1`;
  `grep -c "<Subject>Row"` -> `1`; `grep -c "i18n/dictionaries"` -> `1`; and each
  of `^# Naming Conventions`, `^# Module Layout`, `^# Internationalisation`,
  `<Subject>Controller`, `PascalCase`, `camelCase`, `getDictionary`,
  `LanguageSelector`, `English-only` and `db.test.ts` -> `0`. Section anchors:
  `# Database Row Types` opens at L273 and ends at L294, `# UI & UX Behavioral
  Directives` opens at L296.
- `docs/plans/mobile-app-analysis.md` is 352 lines;
  `grep -c "force-dynamic"` -> `7`, `grep -c "Correction"` -> `0`,
  `grep -c "RH-43"` -> `0`. L7 is the "Every claim below is grounded in the code
  as of `v0.1.50-202609012115`." line, followed by a blank line and a `---` rule.

**Tooling note.** A shell hook in this environment rewrites the output of
`npx eslint`, `npx tsc`, `npx vitest`, `npx next` and `npx playwright`. Every
ESLint and vitest result below must be produced with `rtk proxy npx ...`, and
TypeScript with the exact binary path `./node_modules/.bin/tsc --noEmit`.

## Approach

### 1. `src/lib/bands.ts` - twelve mechanical conversions

Convert each of the twelve arrow-const exports to a function declaration,
preserving the name, the parameter list, the return type annotation and the body
byte for byte. Two shapes occur:

```ts
export const getBands = async (userId: string): Promise<Band[]> => {
// becomes
export async function getBands(userId: string): Promise<Band[]> {
```

```ts
export const getBandWithMembers = async (
  bandId: string,
  userId: string
): Promise<BandWithMembers | null> => {
// becomes
export async function getBandWithMembers(
  bandId: string,
  userId: string
): Promise<BandWithMembers | null> {
```

`getBandMembers` (line 348) is the one synchronous export and becomes
`export function`. Do not reorder the module, do not touch bodies, do not
"improve" anything while in there: the value of this change is that it is
provably empty of behaviour, and ER4 pins that by requiring insertions to equal
deletions.

Afterwards `src/lib/bands.ts` has `12` lines matching `^export async function`
(the eleven conversions plus the pre-existing `assertBandMember`) and `1`
matching `^export function`. No import changes; no caller changes, because a
function declaration and a const arrow are interchangeable at every call site
here and hoisting can only widen what works.

### 2. `src/lib/__tests__/namingConventions.test.ts` - the guard

A new node-environment vitest file that walks the source tree with `node:fs` and
asserts **seven** things. It must fit the base complexity budget (`complexity` 15,
`max-depth` 4, `max-lines` 800 for tests) so that
`src/lib/__tests__/complexityBudget.test.ts` still passes and the override list
stays at exactly 20 entries - keep the helpers small and flat.

Use these exact `describe` and `it` names, because ER5 pins them:

`describe('naming conventions')`
1. `every function exported from src/app/actions has a name ending in Action`
2. `every file in src/hooks is use<Name>.ts exporting a function of the same name`
3. `every component file under src/components is PascalCase.tsx`
4. `every exported interface in src/lib/dbRows.ts ends with Row`
5. `src/lib declares its exports as functions, never as arrow consts`

`describe('module layout')`

6. `no "use client" file imports a src/lib module that reaches @/lib/db`

`describe('i18n scope')`

7. `only the landing page reads copy from a dictionary`

Implementation notes that matter:

- **Test 1 is about function exports only, and reuses the existing scanner.**
  Import `allExportedActionNames()` and `actionFileNames()` from
  `src/app/actions/__tests__/actionScan.ts` rather than re-implementing the walk;
  `__tests__` is exempt from the F21 import restriction, so the import is legal,
  and `npm run lint:dup` would flag a second copy of the same `readdirSync` +
  regex scan. `exportedActionBodies()` matches `^export async function (\w+)`
  only, so `export type { Stroke, TabAnnotations }` at
  `src/app/actions/tabs.ts:17` is outside the scan by construction - which is
  exactly the rule as documented, and is why the test name says "function
  exported" rather than "export".
- **Test 5 must match a function-valued `export const` only**, so that
  `export const DEFAULT_LOCALE: Locale = 'pt-BR'` and
  `export const SUPPORTED_LOCALES = [...] as const` are not flagged. Require the
  initializer to be an arrow function or a `function` expression. It carries **no
  allow-list**: after step 1 the violation set is empty, and an empty rule is the
  point of doing step 1 at all.
- **Test 6 counts value imports as edges and type-only imports as nothing.**
  This is the one rule decision the guard has to make and it is settled here, not
  in the implementation: an `import type { X } from '@/lib/y'` clause is **not**
  an edge, on either side of the check, because the invariant the test is named
  after is "pulls `pg` into the client bundle" and the compiler erases type
  imports before anything is bundled. So a `'use client'` file may write
  `import type { JoinBandResult } from '@/lib/bands.server'` without failing the
  guard, and may not write `import { joinBandByInviteServer } from` the same
  module. Concretely: skip any import statement whose clause begins
  `import type`, and count the rest. (An inline `import { type X }` specifier is
  the same case in principle; at `bb5070b` there are none against `@/lib` in
  client files, so treating a mixed clause as a value import is acceptable and
  simpler.) The choice changes no number at `bb5070b` - the closure is 15/31
  under both readings and the tree is green under both, as the Audit records -
  and it is stated in the AGENTS.md rule sentence in the words "imported for its
  values", so the document and the test cannot drift apart.
- **Test 6 computes both sets from source and walks transitively.** A `src/lib`
  module is server-only if it value-imports `@/lib/db` (or `./db`), *or* if it
  value-imports another server-only `src/lib` module - iterate to a fixed point.
  This is not ceremony: at `bb5070b` the direct set has 12 members and the closure has 15,
  the three transitive ones being `auth-session.ts` (via `@/lib/auth`),
  `emailChange.ts` (via `@/lib/auth`) and `spotifyRouteAuth.ts` (via
  `@/lib/bands`, `@/lib/playlists`, `@/lib/spotifyAuth`). A one-hop check would
  declare those three importable from client code, which is false. The closure
  is over `src/lib` modules only - `src/hooks` and `src/components` may not
  import `@/app/*` at all (F21, already enforced), so no other edge exists.
- **Test 6 must resolve the full module specifier**, hyphens included. Match the
  module name with a character class that contains `-` and `.` (for example
  `@/lib/([A-Za-z0-9_.-]+)`), never `[A-Za-z0-9_]+`: a pattern without `-`
  truncates `@/lib/auth-client` to `auth`, which is in the server-only set, and
  the guard then fails on a violation that does not exist. It must also see
  **bare side-effect imports** - `import '@/lib/pdfWorker'` at
  `src/components/tabs/TabDrawingStage.tsx:5` has no `from` clause - so take the
  quoted specifier from anywhere in a (non-`import type`) `import` statement
  rather than matching `from "@/lib/..."`. At `bb5070b` the correct scan yields
  **fifteen** distinct value-imported client modules (nineteen if type-only
  imports are counted too, which per the bullet above they are not), and the test
  must be green against that tree; if it reports a violation, the scan is wrong,
  not the tree. Both `@/lib/auth-client` and `@/lib/pdfWorker` are in the
  fifteen, so neither of the two tricky cases is excused by the type rule. ER5
  forbids the allow-list an implementer might otherwise reach for.
- **Test 7 must exclude the definition site.** `src/lib/i18n.ts:59` is
  `export function getDictionary(locale: Locale) {`; a naive text scan reports it
  as a second consumer. Exclude it by requiring a call expression rather than a
  declaration (match `getDictionary(` not preceded by `function `), or by
  excluding `src/lib/i18n.ts` by path and saying so in a comment. The asserted
  consumer set is exactly `['src/components/landing/LandingPage.tsx']`.
- **There is no dictionary-parity test here.**
  `src/lib/__tests__/landingCopy.test.ts:27` already asserts `both dictionaries
  expose the same key set`; duplicating it would put the same invariant in two
  files. The Internationalisation section cross-references that test instead.
- Exclude `__tests__` directories and `*.test.ts(x)` from every scan.
- **Watch the vocabulary in comments.** ER5 greps the whole file, comments
  included, for `allowlist|allow_list|allowed|exempt|skip|todo` and requires 0.
  Three natural comments can trip that grep by accident: test 6's transitive
  rationale, the note about excluding `__tests__` directories, and the note about
  `import type` clauses not being edges (the obvious verb there is "skip"). Write
  "ignored", "outside the scan", "not an edge", "not covered" instead - and note
  that the same applies to identifier names, so no `skipTypeImports` helper.
- **Keep the helpers distinct.** This file adds roughly 200 lines of
  `readdirSync` / `filter` scanning to a directory that already has several such
  suites, and it is the most likely thing in this task to move the jscpd number
  (`231 (0.61%)` of a 2 % budget at `bb5070b`). Reusing `actionScan.ts` for test 1
  removes the largest duplicate; for the rest, write one shared `walk(dir)` helper
  and call it from each test rather than repeating the traversal per test.

### 3. AGENTS.md - fix the tree, then add three sections

**3a. `# Directory Structure` (L107-176).** Six targeted replacements inside the
fenced tree. Keep the file's existing comment-column alignment, box-drawing
characters and em dashes - do not ASCII-ify the tree while in there.

- Replace the `components/` block (L130-134) with all ten area directories, in
  alphabetical order, each with a one-line description: `admin` (ModerationQueue
  and the pending-edit cards), `bands` (BandsView island, BandColorPicker),
  `fastview` (the 27 Fast View pieces), `landing` (LandingPage - the only
  dictionary-driven component), `layout` (AppLayout, ConditionalLayout,
  LanguageSelector), `playlists` (PlaylistsView island, cards, Spotify import
  panel), `profile` (InstrumentPicker, EmailChangeSection), `songs` (SongForm,
  CorrectionModal), `tabs` (TabDrawingStage annotation canvas), `ui` (the only
  cross-area directory: ConfirmPanel, Toast, AlertBanner). Head the block
  `Presentational React, one directory per feature area`.
- Replace the `hooks/` block (L135-137) with `Client controller hooks, one
  use<Name>.ts per subject` and list all eleven, keeping `useToast.ts`'s existing
  note.
- Add an `i18n/dictionaries/` entry after `hooks/`, reading
  `en.json / pt-BR.json - landing-page copy only (see Internationalisation)`.
- Add one line under `app/` for the injected bundles:
  `bandAdminActions.ts, fastView*Actions.ts   Typed Server Action bundles injected
  into client islands`.
- Replace the two-line `bands.ts / bands.server.ts` entry (L143-144), whose
  current comment is `Band domain logic (client-safe + server-only halves)`, with
  a comment along the lines of `Band domain logic; both import @/lib/db, so both
  are server-only. The .server suffix marks a second return shape (see Module
  Layout)`. **The string `client-safe` must not survive anywhere in AGENTS.md**;
  ER2 pins that at 0, and 3b below is worded so that nothing reintroduces it.
- Update the `docs/` line (L173) to name `suggestions-log.md`, `plans/`
  (`code-quality-review.md`, `mobile-app-analysis.md`) and `tasks/` (one
  `<id>-spec.md` per Meridian task) alongside the two files it already lists.

**3b. Three new sections, inserted between the end of `# Database Row Types`
(L294) and `# UI & UX Behavioral Directives` (L296)**, in this order. The wording
below is the wording to use; it is derived from the audit above, every number in
it was measured at `bb5070b`, and it deliberately contains no occurrence of the
string `client-safe`.

```markdown
# Naming Conventions

These are the names the codebase already uses, measured at `bb5070b`. Every claim
below carries one of two tags. A **guarded** claim is one that
`src/lib/__tests__/namingConventions.test.ts` fails the run on when new code
breaks it; five claims are guarded. A **convention only** claim has nothing
enforcing it, so a reviewer has to; five claims are convention only. Of the
claims in this section, the guard covers exactly those five and nothing more - do
not read a green run as approval of the other five. The guard file also carries
two further tests, for rules stated in the Module Layout and Internationalisation
sections below. Where a rule has an exception in the tree, the exception is named
here rather than left for the next reader to discover.

- **Server Actions end in `Action`** `(guarded)`. All 44 *function* exports of
  `src/app/actions/*.ts` are `export async function <verb><Subject>Action(...)` -
  `createBandAction`, `getRepertoireAction`, `updateSongStatusAction`. The suffix
  is what tells a reader at the call site that this is a round trip to the server
  rather than a local call. The rule is about function exports only: the
  directory also carries one type re-export,
  `export type { Stroke, TabAnnotations }` at `src/app/actions/tabs.ts:17`, which
  is not an action and is not covered.
- **Injected action bundles are `<Subject>Actions`** `(convention only)`. Because
  of the import direction rule (F21) a hook or component never imports a Server
  Action; the page hands it down as one typed object. The eight bundles live in
  five `src/app/<area>Actions.ts` files (`bandAdminActions.ts`,
  `fastViewEntryActions.ts`, `fastViewLyricsActions.ts`, `fastViewNavActions.ts`,
  `fastViewTabActions.ts`) as SCREAMING_SNAKE consts -
  `BAND_ADMIN_ACTIONS: BandAdminActions`, `SONG_ENTRY_ACTIONS: SongEntryActions`.
  An island that receives its actions from a Server Component page declares the
  same `<Subject>Actions` shape as a prop type (`BandsViewActions`,
  `ModerationQueueActions`).
- **Hooks are `use<Subject>` in a file of exactly that name** `(guarded)`. All
  eleven files under `src/hooks` are `use<Name>.ts` exporting
  `export function use<Name>`. Ten of the eleven also annotate a
  `<Subject>Controller` return type - `SongEntryController`,
  `TabLibraryController`, `BandAdminController` - which is the vocabulary behind
  the phrase "controller hook" `(convention only)`; `useToast.ts` is the one hook
  with no return annotation, and no test reads return types.
- **Components are `PascalCase.tsx`** `(guarded)`, one component per file, named
  after the file: 51 files under `src/components`, no exception.
- **`src/lib` modules are `camelCase.ts`** `(convention only)`, named for the
  noun they own (`playlistNav.ts`, `songSanitizer.ts`, `stageHistory.ts`). Three
  legacy names stand outside that and stay: `auth-client.ts` and
  `auth-session.ts`, which mirror `better-auth`'s own module names, and
  `bands.server.ts` (see Module Layout).
- **`src/lib` exports are function declarations** `(guarded)` -
  `export function` / `export async function` - never
  `export const f = async () => {}`. The choice is arbitrary but settled:
  declarations hoist and produce better stack traces, and 45 of the 46 modules
  already did it. RH-43 converted the last outlier, `src/lib/bands.ts`, so the
  rule now has no exceptions and the guard allows none.
- **Type vocabulary.** Domain nouns live in `src/types/database.ts`; a raw SQL
  projection is `<Subject>Row` in `src/lib/dbRows.ts` `(guarded)`, see Database
  Row Types; a parsed-and-narrowed input shape is `<Subject>Payload`
  (`GlobalSongEditPayload`, `BandUpdatePayload`) `(convention only)`.
- **Tests sit in `__tests__/` beside the code they test** `(convention only)`,
  named `<subject>.test.ts`, or `.test.tsx` for a DOM test. A test that needs a
  live Postgres is `<subject>.db.test.ts` - nine of the 106 test files - which is
  how a reader knows why it skipped. One file stands outside the
  one-test-file-per-subject shape:
  `src/components/ui/__tests__/feedbackSurfaces.test.tsx` covers `Toast` and `AlertBanner`
  together (`ConfirmPanel` has its own test file), and there is no subject file of that name.

# Module Layout - where a thing goes

- **`src/lib/*.ts`** - domain logic and data access. Pure decision functions and
  SQL both live here, and this is the only place `@/lib/db` may be imported.
- **`src/app/actions/*.ts`** - `'use server'` entry points: resolve the session,
  delegate to `src/lib`. No SQL (enforced by `actionDataAccessGuard.test.ts`).
- **`src/app/<area>Actions.ts`** - the typed bundles that carry those actions
  into client code without breaking the import direction.
- **`src/hooks/use*.ts`** - client controllers: state plus intent commands. No
  JSX, no SQL, no `@/app/*` import.
- **`src/components/<area>/`** - presentational React, one directory per feature
  area (`admin`, `bands`, `fastview`, `landing`, `layout`, `playlists`,
  `profile`, `songs`, `tabs`, `ui`). `ui/` is the only cross-area one; anything
  else that two areas need moves there rather than being imported sideways.
- **`src/store/*.ts`** - zustand stores for UI state that outlives a route
  (`bandContextStore`, `repertoireStore`). Not a cache for server data.
- **`src/i18n/dictionaries/*.json`** - landing-page copy only (see
  Internationalisation).

**Server-only is decided by the `@/lib/db` import, not by a filename (F24).**
Twelve of the 46 modules under `src/lib` import it at module scope - `auth.ts`,
`bands.ts`, `bands.server.ts`, `devProfiles.ts`, `moderation.ts`,
`playlists.ts`, `profile.ts`, `songs.ts`, `spotifyAuth.ts`,
`spotifyConnection.ts`, `spotifyPlaylistSync.ts`, `tabs.ts` - and three more pull
`pg` in through them: `auth-session.ts` and `emailChange.ts` (via `@/lib/auth`)
and `spotifyRouteAuth.ts` (via `@/lib/bands`, `@/lib/playlists` and
`@/lib/spotifyAuth`, among others). None of those fifteen may be imported for its
values from a file carrying `'use client'`. A type-only import is not a
violation: `import type` is erased before bundling, so it pulls in no `pg`, and
client files already use it against `src/lib` today. The other thirty-one modules
are free of `pg`, and nineteen of them appear in the 60 client files - fifteen
imported for their values (`playlistNav.ts`, `statusConfig.ts`, `auth-client.ts`,
...) and the rest for their types only.
`src/lib/__tests__/namingConventions.test.ts` computes both sets from the source,
counting only value imports as graph edges, follows the graph to a fixed point,
and fails the run on any client value import of a server-only module.

The `.server` suffix on `bands.server.ts` does **not** mean that `bands.ts` is
safe to import from a `'use client'` file: `bands.ts` imports `@/lib/db` too, so
both halves pull in `pg` and the isolation the suffix suggests never existed.
What it actually marks is a second return shape for the same
`join_band_by_invite($1, $2)` call: `joinBandByInviteServer` returns the richer
`JoinBandResult` that `/join/[code]` renders, while `joinBandByInviteClient` in
`bands.ts` returns only the band id. Do not add another `.server` file - a new
server-only module is just `camelCase.ts` that imports `@/lib/db`.

# Internationalisation

**The decision (F25): i18n is scoped to the landing page. The application UI is
English-only, written inline.**

`src/lib/i18n.ts` resolves a locale (`pt-BR` by default, or `en`) from the
`NEXT_LOCALE` cookie and then `Accept-Language`, and returns one of the two
dictionaries in `src/i18n/dictionaries/`. Exactly one component reads copy from
them, `src/components/landing/LandingPage.tsx`, and `LanguageSelector` is
rendered in exactly one place - inside that same landing page. `LanguageSelector`
reads no copy from a dictionary itself; it hardcodes its four strings, including
the app's only non-English literal. Every other `.tsx` file under `src/` (68 of
69) hardcodes its copy in English where it has any, as does the user-facing error
text assembled in `src/lib` (`Failed to fetch bands: ...`).

So: do not add a `getDictionary` lookup to a component outside
`src/components/landing/`, do not add a `t()` helper, and do not translate a page
as a side errand while doing something else. New application copy is written
inline, in English.

Two tests hold the halves of this in place.
`src/lib/__tests__/namingConventions.test.ts` pins the consumer set: exactly one
file calls `getDictionary`. `src/lib/__tests__/landingCopy.test.ts` already pins
the other half - `both dictionaries expose the same key set` - so a landing-copy
edit cannot land in one dictionary only. There is no third test, and none is
needed.

Two consequences are deliberate, and are not bugs to fix in passing:

- A `pt-BR` visitor sees a Portuguese landing page and an English application.
  That is the accepted cost of scoping i18n to marketing.
- 22 of the 49 dictionary keys are consumed by nothing: `common.*` except
  `appName` (11 keys), `nav.*` except `signIn` and `getStarted` (6 keys), and all
  five `status.*`. They are the residue of an abandoned app-wide attempt, and
  `knip` cannot see inside JSON. They stay, so that revisiting the decision does
  not start by re-typing them.

Adopting i18n app-wide remains a live option, not a closed door - it just has to
be its own task, starting with the shared chrome (`AppLayout`, `nav.*`,
`status.*`, for which the dictionaries already carry keys) rather than with
whichever page happens to be open.
```

Nothing else in AGENTS.md changes. In particular the Landing Page Rule (L309)
already references both dictionaries and stays exactly as it is, and the
architecture bullets are correct as of RH-65 and are not restated.

### 4. `docs/plans/code-quality-review.md` - four added lines, nothing removed

Purely additive: four new lines, each one physical line, appended to the block it
belongs to. Insertion points by line number at `bb5070b`: after L438 (F23's
`**Remediation:**`), after L446 (F24's), after L455 (F25's), and after L574
(T10's `**Covers:** F23, F24, F25`).

**After F23's `**Remediation:**` line, append:**

```
**Status:** Resolved by RH-43 (the commit carrying this line, on top of `bb5070b`). Both halves of the remediation landed. `src/lib/bands.ts` was converted from `export const name = async (...) => {}` to `export async function` for all twelve of its arrow exports (`getBands`, `getBandWithMembers`, `createBand`, `updateBand`, `deleteBand`, `leaveBand`, `removeBandMember`, `getBandPlaylists`, `createBandPlaylist`, `joinBandByInviteClient`, `regenerateBandInviteCode`, `getBandMembers`) with no signature, body or behaviour change, so `src/lib` now declares its API exactly one way. The population grew since the review without changing shape: there are 46 modules directly under `src/lib` at `bb5070b` rather than the 23 counted at `13da8b2`, and the outlier count was still exactly one. The convention is recorded in AGENTS.md under **Naming Conventions**, next to the error-handling section as the remediation asked, together with the seven other naming rules the code already followed and had written down nowhere: the `Action` suffix on all 44 Server Action function exports (the one type re-export, `export type { Stroke, TabAnnotations }` at `src/app/actions/tabs.ts:17`, is named as outside the rule), the eight `<Subject>Actions` bundles across five `src/app/<area>Actions.ts` files, `use<Name>.ts` hooks of which ten of eleven return a `<Subject>Controller` (`useToast.ts` carries no return annotation and is named as the exception), PascalCase component files (51 of them), `camelCase.ts` in `src/lib` with its three named legacy exceptions, the `<Subject>Row` / `<Subject>Payload` type vocabulary, and the `__tests__/<subject>.test.ts` plus `.db.test.ts` test layout with `feedbackSurfaces.test.tsx` named as its one exception. Five of those claims are enforced rather than asserted, and the section tags each claim `(guarded)` or `(convention only)` so a reader is never told a green run means more than it does: `src/lib/__tests__/namingConventions.test.ts` fails the run on any function-valued `export const` under `src/lib`, and it carries no allow-list, because after the conversion there is nothing left to allow.
```

**After F24's `**Remediation:**` line, append:**

```
**Status:** Resolved by RH-43 (the commit carrying this line, on top of `bb5070b`) without taking either of the remediation's two structural options, and the reasoning is recorded here rather than left implicit. The finding is right on the facts: `src/lib/bands.ts:1` imports `query` from `@/lib/db` at module scope exactly as `bands.server.ts:1` does, so the "client-safe + server-only halves" description in AGENTS.md was false; that phrase is deleted and the string no longer appears anywhere in the file. The remediation offered (a) merging the two modules and naming the functions for what they return, or (b) making `bands.ts` genuinely dependency-free by moving all `pg` access into `bands.server.ts`, with the AGENTS.md update as a rider on whichever was chosen. RH-43 takes neither, and instead replaces the promise the suffix made with a rule a test can check across the whole directory. AGENTS.md's new **Module Layout** section states what is actually true of the tree: server-only is decided by the `@/lib/db` import and not by a filename; twelve of the 46 `src/lib` modules import it directly (`auth.ts`, `bands.ts`, `bands.server.ts`, `devProfiles.ts`, `moderation.ts`, `playlists.ts`, `profile.ts`, `songs.ts`, `spotifyAuth.ts`, `spotifyConnection.ts`, `spotifyPlaylistSync.ts`, `tabs.ts`) and three more pull `pg` in through them (`auth-session.ts`, `emailChange.ts`, `spotifyRouteAuth.ts`); none of those fifteen may be imported for its values from a `'use client'` file, while a type-only `import type` is deliberately not a violation, since the compiler erases it before bundling and 23 such imports already exist in client files; the other thirty-one are free of `pg`, and nineteen distinct ones are what the 60 client files import at `bb5070b` (fifteen for their values, the rest for types only), not one of them in the server-only closure. `src/lib/__tests__/namingConventions.test.ts` computes both sets from the source, counting only value imports as graph edges, follows the graph to a fixed point, and fails on any client value import of a server-only module. That is a stronger close than either option: (a) and (b) each rearrange one pair of modules and leave nothing watching the other forty-four, while the guard delivers, mechanically and directory-wide, exactly the isolation the `.server` suffix only ever claimed - which is the harm the finding predicted ("a future author may reasonably import the 'client-safe' module into a `'use client'` file"). What the structural options would additionally buy is a function name that describes the return shape rather than a runtime, and that is a public rename plus a test rewrite, not part of settling a convention. The section records what the suffix really marks - a second return shape for the same `join_band_by_invite($1, $2)` call, `joinBandByInviteServer` returning the richer `JoinBandResult` that `/join/[code]` renders while `joinBandByInviteClient` returns only the band id - and instructs that no further `.server` file be added. Both declined options are recorded as named follow-ups in `docs/tasks/RH-43-spec.md`, with their prices measured: (a) is cheap, since at `bb5070b` `joinBandByInviteClient` has no caller outside `src/lib/__tests__/joinBandByInvite.test.ts`, `bands.test.ts` and `errors.test.ts`, so it is a delete plus a rewrite of three test files; (b) is not, since `bands.ts` has fifteen `query()` call sites and five importers under `src/app` and `src/lib` to re-point, and it would leave the meaningless `.server` name in place.
```

**After F25's `**Remediation:**` line, append:**

```
**Status:** Resolved by RH-43 (the commit carrying this line, on top of `bb5070b`), which made the decision the remediation demanded and wrote it into AGENTS.md under **Internationalisation**: i18n is scoped to the landing page and the application UI is English-only, written inline. That is the option the code already implemented, so the change is a decision plus its enforcement rather than a migration. Re-measured at `bb5070b`, the finding's "2 of 29 components" reads as 1 of 69 once "reaches" means "consumes copy": `src/components/landing/LandingPage.tsx` is the only file that calls `getDictionary` (the third match in the tree, `src/lib/i18n.ts:59`, is the definition), and `LanguageSelector.tsx` imports only `COOKIE_NAME`, `SUPPORTED_LOCALES` and the `Locale` type - it reads no copy from a dictionary, hardcoding its own four strings instead - and is rendered in exactly one place, inside `LandingPage`, so the remediation's "(and hide the selector elsewhere)" was already true of the tree and needed recording rather than code. The other 68 `.tsx` files hardcode their copy in English where they have any, as does the user-visible error text assembled in `src/lib`. The decision is enforced by `src/lib/__tests__/namingConventions.test.ts`, which pins the `getDictionary` consumer set to exactly the landing page; the complementary invariant, that `en.json` and `pt-BR.json` declare the same 49 keys, was already asserted by `src/lib/__tests__/landingCopy.test.ts` and is cross-referenced rather than duplicated, so a landing-copy edit still cannot land in one dictionary only. Two consequences are documented as accepted rather than left to be rediscovered: a `pt-BR` visitor gets a Portuguese landing page and an English application, and the 22 keys that nothing consumes (`common.*` except `appName`, 11 of them; `nav.*` except `signIn` and `getStarted`, 6; and all five `status.*`) stay in both dictionaries as the head start for any future app-wide task, since `knip` cannot see inside JSON and deleting them would buy nothing. Adopting i18n app-wide stays a live option owned by a future task, starting with the shared chrome, and AGENTS.md says so.
```

**After T10's `**Covers:** F23, F24, F25` line, append:**

```
**Status:** Delivered by RH-43 (the commit carrying this line, on top of `bb5070b`). All three findings it covers are closed above. AGENTS.md gained three sections - **Naming Conventions**, **Module Layout - where a thing goes** and **Internationalisation** - written from what the tree does at `bb5070b` rather than from what would be nice, with every claim tagged `(guarded)` or `(convention only)` and every exception named, and its `# Directory Structure` block was brought back in line with the tree it describes (ten `src/components` area directories instead of four, all eleven hooks instead of two, `src/i18n/`, the five `src/app/<area>Actions.ts` bundle files, and the current `docs/` layout). The one export-style outlier was converted, so that rule now holds with no exceptions, and the three claims a test can check - five of the naming rules, the server-only import rule that replaces the `.server` suffix's broken promise, and the i18n scope - are enforced by `src/lib/__tests__/namingConventions.test.ts` rather than left as prose. What is deliberately not in it: both of F24's structural options (merging `bands.ts` with `bands.server.ts` and deleting the caller-less `joinBandByInviteClient`, or moving all `pg` access out of `bands.ts`), and any app-wide i18n extraction. All are code changes with their own review surface and are recorded as follow-ups in `docs/tasks/RH-43-spec.md`.
```

`Resolved` for findings and `Delivered` for the task keeps
`grep -c "^\*\*Status:\*\* Resolved"` counting findings (12 today, 15 after) and
`grep -c "^\*\*Status:\*\* Delivered"` counting tasks (4 today, 5 after), as
RH-37, RH-38, RH-40 and RH-41 established. No `**Correction**` line is added: the
F25 re-count goes inside its `**Status:**` line, which is how RH-41 disposed of
F15's "twelve of fourteen", so `grep -c "^\*\*Correction"` stays at `5`.

Do not touch any other finding, the section 2 measurement tables, rows 23, 24 and
25 of the section 4 summary table, T10's `**Justification:**` line, or any other
T-task block. Those describe `13da8b2` and stay as measured.

### 5. `docs/plans/mobile-app-analysis.md` - a correction note, not a rewrite

Two review rounds have now flagged this document, and RH-41 left it alone with a
reason. The reason still holds - its section 3.2 conclusion (`output: "export"`
is structurally impossible) is argued partly from the stale claims, so
rewriting them means re-deriving the conclusion - but a reader who opens the file
today is told seven times that the root layout forces dynamic rendering and once
that the proxy `fetch`es `/api/auth/get-session`, with nothing warning them
otherwise. The cheap, honest middle is a dated note at the top that says the
document is a snapshot and names what has since changed, leaving the analysis
itself untouched for the follow-up that will re-derive it.

Insert this block immediately after the "Every claim below is grounded in the
code as of `v0.1.50-202609012115`." line (L7), before the `---` rule. Purely
additive - no existing line is edited or deleted.

```markdown
> **Correction note (RH-43, 2026-09-09).** This document is a snapshot, and two
> of its load-bearing current-state claims have since been falsified by the
> code. (1) `src/app/layout.tsx` no longer declares
> `export const dynamic = "force-dynamic"`: RH-61 (`57bc60a`) removed it and did
> not push it down to any page segment, so the landing page and all four auth
> routes prerender again. The seven statements below that describe a globally
> dynamic route tree are stale. (2) `src/proxy.ts` no longer `fetch`es
> `/api/auth/get-session` with a 3 s abort: RH-65 (`66d9442`) made it a
> synchronous, header-only redirect convenience over a twelve-entry allow-list,
> explicitly not an authorization boundary. The single statement below that
> describes the fetching proxy is stale. The rest of the analysis is left
> verbatim on purpose - the section 3.2 conclusion about `output: "export"` is
> argued partly from claim (1), so correcting the text means re-deriving the
> conclusion, which is a follow-up task and not a text edit.
```

### 6. Version bump

`package.json` goes from `0.1.97-202609091918` to `0.1.98-YYYYMMDDHHmm` with the
local-time stamp of the commit, per the AGENTS.md Version Bumping Rule.

### 7. Order of work

Do step 1 before step 2 (the guard's test 5 fails until `bands.ts` is converted),
then steps 3 to 6 in any order, then run the whole gate set once against the tree
that will actually merge.

## Expected Results

ER1 - AGENTS.md states the naming conventions the code already follows, as a
section of its own, and is honest about which of them a test enforces. Run every
command from the repository root. `grep -c "^# Naming Conventions" AGENTS.md`
prints 1, where it prints 0 at `bb5070b`. The section is placed between the
existing `# Database Row Types` and `# UI & UX Behavioral Directives` sections:
`grep -n "^# " AGENTS.md` lists `# Database Row Types`, then
`# Naming Conventions`, then `# Module Layout - where a thing goes`, then
`# Internationalisation`, then `# UI & UX Behavioral Directives`, in that order
and consecutively. Each of these greps prints exactly 1 where it prints 0 at
`bb5070b`: `grep -c "Server Actions end in" AGENTS.md`,
`grep -c "exports are function declarations" AGENTS.md`,
`grep -c "in a file of exactly that name" AGENTS.md`. Enforcement is tagged claim
by claim rather than claimed wholesale: `grep -o "(guarded)" AGENTS.md | wc -l`
prints 5 and `grep -o "(convention only)" AGENTS.md | wc -l` prints 5, both 0 at
`bb5070b` (these are `grep -o` occurrence counts, not line counts). The preamble
scopes that statement to this section - it says that of the claims in this
section the guard covers exactly those five and nothing more, and that the guard
file carries two further tests for the Module Layout and Internationalisation
rules - so the three new sections do not appear to disagree about what the one
test file does. Reading the section, it names the 44 Server Action
*function* exports and their `Action` suffix together with the one type
re-export at `src/app/actions/tabs.ts:17` that the rule does not cover, the eight
`<Subject>Actions` bundles across five `src/app/<area>Actions.ts` files, the
eleven `use<Name>.ts` hooks and the `<Subject>Controller` return type that ten of
them annotate with `useToast.ts` named as the one that does not, the 51
PascalCase component files, the `camelCase.ts` rule for `src/lib` together with
its three named exceptions (`auth-client.ts`, `auth-session.ts`,
`bands.server.ts`), the function-declaration export rule, the `<Subject>Row` and
`<Subject>Payload` type vocabulary, and the `__tests__/<subject>.test.ts` plus
`.db.test.ts` test layout with `feedbackSurfaces.test.tsx` named as its
exception. The three named exceptions are mechanically checkable rather than only
readable: `grep -c "tabs.ts:17" AGENTS.md` prints 1 (0 at `bb5070b`),
`grep -c "useToast" AGENTS.md` prints a number greater than or equal to 2 (1 at
`bb5070b`, the `hooks/` line of the directory tree), and
`grep -c "feedbackSurfaces" AGENTS.md` prints 1 (0 at `bb5070b`) - that path is
written once, on a single physical line, so the count is 1 and not 2. Two terms
are new to the file: `grep -c "<Subject>Controller" AGENTS.md` prints a number
greater than or equal to 1 (0 at `bb5070b`), and `grep -c "<Subject>Row" AGENTS.md`
prints 2 (1 at `bb5070b`, in the Database Row Types section, which is unchanged).

ER2 - AGENTS.md says where a module goes and what makes it server-only, and the
false claim F24 is about is gone. From the repository root,
`grep -c "^# Module Layout" AGENTS.md` prints 1 (0 at `bb5070b`) and
`grep -c "client-safe" AGENTS.md` prints 0, where it prints 1 at `bb5070b` - that
one match is the `bands.ts / bands.server.ts` line in the directory tree reading
"Band domain logic (client-safe + server-only halves)", which is the sentence the
finding calls false and which must not survive in any form, including in the
prose of the new sections. The replacement rule is present and names its whole
population: `grep -c "Server-only is decided by the" AGENTS.md` prints 1, and the
section lists all twelve `src/lib` modules that import `@/lib/db` directly at
`bb5070b` - `auth.ts`, `bands.ts`, `bands.server.ts`, `devProfiles.ts`,
`moderation.ts`, `playlists.ts`, `profile.ts`, `songs.ts`, `spotifyAuth.ts`,
`spotifyConnection.ts`, `spotifyPlaylistSync.ts`, `tabs.ts` - which is exactly
the set the tree yields, since `grep -l "@/lib/db" src/lib/*.ts | wc -l` prints
12. It also names the three modules that reach `pg` transitively and are
therefore equally server-only - `auth-session.ts`, `emailChange.ts` and
`spotifyRouteAuth.ts`, each of the three appearing at least once in the section -
and states that none of the fifteen may be imported **for its values** from a
file carrying `'use client'`, while a type-only `import type` is not a violation
because it is erased before bundling. That value/type distinction is stated in
the rule sentence itself and not only in the test, and it is the reading the
guard implements (ER5). The section further explains what the `.server` suffix
does mark (a second return shape for the same `join_band_by_invite($1, $2)` call,
`joinBandByInviteServer` returning `JoinBandResult` for `/join/[code]` while
`joinBandByInviteClient` returns the band id), says not to add another `.server`
file, and lists the ten `src/components` area directories, calling out `ui/` as
the only cross-area one: `grep -c "the only cross-area one" AGENTS.md` prints a
number greater than or equal to 1, where it prints 0 at `bb5070b`. (No count is
pinned on `src/components/<area>/` itself: that string already occurs once at
`bb5070b`, at `AGENTS.md:49` in the Server Component page-pattern bullet this
task does not touch, so the pin would prove nothing about the new section. The
ten directory names are checked by ER3 instead.)

ER3 - AGENTS.md records the i18n decision explicitly, and its directory tree
matches the tree. From the repository root,
`grep -c "^# Internationalisation" AGENTS.md` prints 1 (0 at `bb5070b`) and
`grep -c "English-only" AGENTS.md` prints a number greater than or equal to 1 (0
at `bb5070b`); the section's first statement is that i18n is scoped to the
landing page and that the application UI is English-only, written inline. It
records the measured situation - one component reads copy from a dictionary
(`src/components/landing/LandingPage.tsx`), `LanguageSelector` is rendered only
inside it and reads no copy from a dictionary itself, both dictionaries carry the
same 49 keys, and **22** of those keys are consumed by nothing (`common.*` except
`appName`, 11; `nav.*` except `signIn` and `getStarted`, 6; all five
`status.*`) - and it instructs that no `getDictionary` lookup be added outside
`src/components/landing/`: `grep -c "getDictionary" AGENTS.md` prints a number
greater than or equal to 1 (0 at `bb5070b`). The section does not duplicate the
dictionary-parity assertion but cross-references the test that already makes it:
`grep -c "landingCopy.test.ts" AGENTS.md` prints a number greater than or equal
to 1 (0 at `bb5070b`). The string `23 of the 49` appears nowhere:
`grep -c "23 of the 49" AGENTS.md` prints 0. Separately, the
`# Directory Structure` tree now describes the real tree:
`grep -c "i18n/dictionaries" AGENTS.md` prints a number greater than or equal to
2 (1 at `bb5070b`, in the Landing Page Rule), and every one of the ten component
area directory names `admin`, `bands`, `fastview`, `landing`, `layout`,
`playlists`, `profile`, `songs`, `tabs` and `ui` appears in the tree, matching
`ls -d src/components/*/ | wc -l`, which prints 10. All eleven files that
`ls src/hooks/*.ts | wc -l` counts are named in the `hooks/` block, where
`bb5070b` named two. The `docs/` line names `suggestions-log.md`, `plans/` and
`tasks/` in addition to the two files it already listed.

ER4 - the one export-style outlier is converted, with no behaviour change. From
the repository root, `grep -cE "^export const [A-Za-z0-9_]+ = (async )?\(" src/lib/bands.ts`
prints 0, where the same command prints 12 against
`git show bb5070b:src/lib/bands.ts`. In its place,
`grep -c "^export async function" src/lib/bands.ts` prints 12 and
`grep -c "^export function" src/lib/bands.ts` prints 1 - eleven converted async
exports plus the pre-existing `assertBandMember`, and the one synchronous export
`getBandMembers`. All thirteen public names survive unchanged:
`grep -oE "^export (async )?function [A-Za-z0-9_]+" src/lib/bands.ts | awk '{print $NF}' | sort`
prints exactly, in this order, `assertBandMember`, `createBand`,
`createBandPlaylist`, `deleteBand`, `getBandMembers`, `getBandPlaylists`,
`getBandWithMembers`, `getBands`, `joinBandByInviteClient`, `leaveBand`,
`regenerateBandInviteCode`, `removeBandMember`, `updateBand`. The change is
signature-only: `git diff --numstat bb5070b -- src/lib/bands.ts` prints one line
whose insertion count equals its deletion count and whose insertion count is at
most 26, and `wc -l < src/lib/bands.ts` prints 350, exactly as at `bb5070b`. The
module still behaves identically:
`rtk proxy npx vitest run src/lib/__tests__/bands.test.ts src/lib/__tests__/bands.server.test.ts src/lib/__tests__/joinBandByInvite.test.ts src/app/actions/__tests__/bands.test.ts`
exits 0 with no failed and no skipped test (these need Postgres at
`postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied
and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in the environment or `.env.local`).
Its complexity waiver did not move: `grep -c "src/lib/bands.ts" eslint.config.mjs`
prints 1 and `git diff bb5070b -- eslint.config.mjs` prints nothing.

ER5 - the checkable claims in the new documentation are enforced by a test, not
asserted in prose, and the test asserts nothing another test already asserts.
From the repository root, `test -f src/lib/__tests__/namingConventions.test.ts`
succeeds, and
`rtk proxy npx vitest run src/lib/__tests__/namingConventions.test.ts` exits 0 and
reports `Test Files  1 passed (1)` and `Tests  7 passed (7)` with no failed and no
skipped test. Run with `--reporter=verbose`, the seven test names are exactly:
`every function exported from src/app/actions has a name ending in Action`;
`every file in src/hooks is use<Name>.ts exporting a function of the same name`;
`every component file under src/components is PascalCase.tsx`;
`every exported interface in src/lib/dbRows.ts ends with Row`;
`src/lib declares its exports as functions, never as arrow consts`;
`no "use client" file imports a src/lib module that reaches @/lib/db`;
`only the landing page reads copy from a dictionary`. There is no eighth test
asserting dictionary key parity, because
`src/lib/__tests__/landingCopy.test.ts:27` already asserts `both dictionaries
expose the same key set`: `grep -c "same key set" src/lib/__tests__/namingConventions.test.ts`
prints 0 and `grep -c "same key set" src/lib/__tests__/landingCopy.test.ts`
prints 1, unchanged from `bb5070b`. The client-import test resolves full module
specifiers rather than a truncated name, so hyphenated and side-effect imports
are covered: it reports no violation against the tree even though
`src/app/AppShell.tsx` imports `@/lib/auth-client` and
`src/components/tabs/TabDrawingStage.tsx:5` carries the bare
`import '@/lib/pdfWorker'`. It counts only value imports as edges, matching the
AGENTS.md rule sentence: adding
`import type { JoinBandResult } from "@/lib/bands.server"` to any `'use client'`
file leaves `rtk proxy npx vitest run src/lib/__tests__/namingConventions.test.ts`
at exit 0, while adding
`import { joinBandByInviteServer } from "@/lib/bands.server"` to the same file
makes it exit non-zero with a failure naming that file and
`bands.server.ts`; revert either probe afterwards, since ER9 pins the diff. This
is consistent with the tree as it stands, where 23 `import type ... from
"@/lib/..."` statements already sit in `'use client'` files. The file contains no
allow-list, exemption list or
skip, in code or in comments:
`grep -ciE "allowlist|allow_list|allowed|exempt|skip|todo" src/lib/__tests__/namingConventions.test.ts`
prints 0, and `grep -c "it.skip\|describe.skip\|it.todo" src/lib/__tests__/namingConventions.test.ts`
prints 0. The guard reads the tree rather than a hardcoded answer:
`grep -c "node:fs" src/lib/__tests__/namingConventions.test.ts` prints a number
greater than or equal to 1. Adding it does not need a complexity waiver:
`grep -c "complexity-budget/override" eslint.config.mjs` prints 20, exactly as at
`bb5070b`, and `grep -c "namingConventions" eslint.config.mjs` prints 0.

ER6 - the review document records the close-out, additively. From the repository
root, `grep -c "^\*\*Status:\*\* Resolved" docs/plans/code-quality-review.md`
prints 15, where it prints 12 at `bb5070b`; the three new lines are appended to
the blocks headed `### F23 - src/lib is split between two export styles, with one
module the outlier`, `### F24 - The bands module split and its Client/Server
suffixes do not mean what they say` and `### F25 - The i18n dictionary reaches 2
of 29 components`, and each of the three ends with a statement that RH-43 carries
it, phrased as "the commit carrying this line, on top of `bb5070b`".
`grep -c "^\*\*Status:\*\* Delivered" docs/plans/code-quality-review.md` prints 5
(4 at `bb5070b`); the new one is appended to `### T10 - Settle the naming,
module-split and i18n conventions in AGENTS.md` in section 5 and states that all
three findings it covers are closed. `grep -c "RH-43" docs/plans/code-quality-review.md`
prints exactly 4, one per added line, where it prints 0 at `bb5070b`. No
`**Correction**` block is added: `grep -c "^\*\*Correction" docs/plans/code-quality-review.md`
prints 5, exactly as at `bb5070b` - the F25 re-count from "2 of 29 components" to
1 of 69 lives inside its own `**Status:**` line. The three finding lines carry the
measurements this task made: `grep -c "46 modules" docs/plans/code-quality-review.md`
prints a number greater than or equal to 1; the F24 line names all twelve
directly `@/lib/db`-importing modules plus the three transitive ones
(`auth-session.ts`, `emailChange.ts`, `spotifyRouteAuth.ts`), states that the
60 client files import nineteen distinct pure modules, says in so many words that
RH-43 takes neither of the remediation's two structural options and why the
documentation-plus-guard route closes the finding anyway, and prices both
declined options; and the F25 line states that both dictionaries declare 49 keys
and that **22** of them are consumed by nothing.
`grep -c "23 of the 49\|the 23 keys" docs/plans/code-quality-review.md` prints 0.
The edit removes nothing and rewords nothing:
`git diff --numstat bb5070b -- docs/plans/code-quality-review.md` prints exactly
one line reading 4 insertions, 0 deletions, so T10's `**Justification:**` line,
rows 23, 24 and 25 of the section 4 table and every other finding stand exactly
as measured at `13da8b2`.

ER7 - the stale mobile-app document warns its reader, without being rewritten.
From the repository root, `grep -c "Correction note (RH-43" docs/plans/mobile-app-analysis.md`
prints 1, where `grep -c "RH-43" docs/plans/mobile-app-analysis.md` prints 0 at
`bb5070b`. The note sits in the first 20 lines of the file
(`head -20 docs/plans/mobile-app-analysis.md | grep -c "Correction note (RH-43"`
prints 1), it names both falsified claims and the commits that falsified them
(`grep -c "57bc60a" docs/plans/mobile-app-analysis.md` prints 1 and
`grep -c "66d9442" docs/plans/mobile-app-analysis.md` prints 1), and it says the
rest of the analysis is left verbatim because the section 3.2 `output: "export"`
conclusion is argued partly from the stale claim and re-deriving it is a separate
task. The body of the document is untouched:
`grep -c "force-dynamic" docs/plans/mobile-app-analysis.md` prints 8 - the seven
pre-existing mentions plus the one inside the new note - and
`git diff --numstat bb5070b -- docs/plans/mobile-app-analysis.md` prints exactly
one line with 0 deletions and at most 20 insertions.

ER8 - every gate is green at the merge commit and nothing regressed, run from the
repository root. With Postgres running at
`postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied
(`npm run db:migrate`) and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in the
environment or `.env.local` (for example `set -a; . ./.env.local; set +a`),
`rtk proxy npx vitest run` exits 0 and reports `Test Files  107 passed (107)` -
exactly one more file than the 106 at `bb5070b`, the new guard - and
`Tests  1209 passed (1209)`, which is the 1202 at `bb5070b` plus the seven tests
ER5 names, with 0 skipped and 0 failed. `npm run test:coverage` exits 0 with its
`All files` row at or above the thresholds statements 80, branches 65, functions
78 and lines 80, and no `does not meet threshold` line anywhere in the output.
`./node_modules/.bin/tsc --noEmit` writes nothing to stdout or stderr and exits 0
(use that exact binary path; `npx tsc` is intercepted by a shell hook in this
environment). `rtk proxy npx eslint .` prints a final summary line reading exactly
`22 problems (8 errors, 14 warnings)`, unchanged from `bb5070b`, so the converted
module and the new test introduce no lint finding of their own; use `rtk proxy`,
because the same hook rewrites plain `npx eslint` output. `npm run lint:dead`
exits 0 and reports no unused files, exports, types or dependencies.
`npm run lint:dup` exits 0 with its Total duplicated-lines cell below the 2 %
threshold, and the new scanning file contributes no clone group of its own:
`npm run lint:dup 2>&1 | grep -c "namingConventions"` prints 0 (jscpd prints
paths relative to `src/`, so a group involving the new file would read
`lib/__tests__/namingConventions.test.ts`), and the Total cell reads no worse
than `250 (0.67%)` against the `231 (0.61%)` and `Found 18 clones.` measured at
`bb5070b`. The eighteen pre-existing groups are not this task's to fix and are
not required to shrink: ten of them are intra-file pairs inside a single
`src/lib/__tests__` file (`bands.test.ts` twice, `moderation.test.ts` three
times, `songs.test.ts` twice, `spotify.test.ts` twice, `test-helpers.ts` once),
and removing them would mean editing test files that ER9's closed set excludes.
`npm run audit` exits 0 and prints
`found 0 vulnerabilities`.

ER9 - the version was bumped and the blast radius is the closed set this task
declares. From the repository root, `node -p "require('./package.json').version"`
prints a string matching `^0\.1\.98-20[0-9]{10}$` - patch 98, then a 12-digit
`YYYYMMDDHHmm` local-time stamp - which is strictly greater than the
`0.1.97-202609091918` at `bb5070b`. `git diff --name-only bb5070b | sort` lists
only paths drawn from this closed set of seven and no others: `AGENTS.md`,
`docs/plans/code-quality-review.md`, `docs/plans/mobile-app-analysis.md`,
`docs/suggestions-log.md`, `docs/tasks/RH-43-spec.md`, `package.json`,
`src/lib/bands.ts` - plus the single added file
`src/lib/__tests__/namingConventions.test.ts`. It is a subset rather than an exact
set because a review round that ends with nothing to append leaves
`docs/suggestions-log.md` out of the diff. Under `src/` the change is exactly the
two files named above and nothing else:
`git diff --name-only bb5070b -- src | sort` prints exactly
`src/lib/__tests__/namingConventions.test.ts` and `src/lib/bands.ts`, and
`git diff --name-only bb5070b -- migrations e2e scripts eslint.config.mjs vitest.config.ts next.config.ts knip.json .jscpd.json README.md`
prints nothing. This task ships no user-facing feature - it is a documentation
consolidation plus one mechanical refactor - so under the AGENTS.md Landing Page
Rule it is not a selling point and the landing copy is untouched:
`git diff bb5070b -- src/components/landing src/i18n/dictionaries` prints nothing,
which is also what keeps the 22 unused dictionary keys in place as ER3 records. No
command in any Expected Result of this task moves git state.

## Out of Scope

- **F24 option (a): merging `bands.ts` and `bands.server.ts`.** Declined. At
  `bb5070b` `joinBandByInviteClient` has no caller outside
  `src/lib/__tests__/joinBandByInvite.test.ts`, `bands.test.ts` and
  `errors.test.ts`, so the merge is a delete plus a test rewrite - genuinely
  small - but it renames a public function, changes what three test files assert,
  and risks quietly dropping the DB-level idempotency assertion in
  `joinBandByInvite.test.ts`. None of that bears on whether the convention is
  written down. **Suggestion for a follow-up task:** fold `bands.server.ts` into
  `bands.ts`, keep one `joinBandByInvite` returning `JoinBandResult`, delete the
  thin variant, and re-point `src/app/join/[code]/page.tsx` and the three test
  files. The guard added here keeps working unchanged through that.
- **F24 option (b): making `bands.ts` dependency-free by moving all `pg` access
  into `bands.server.ts`.** Also declined, and more expensive than (a).
  `bands.ts` has fifteen `query()` call sites, so "all `pg` access" is almost the
  whole module; every importer of `@/lib/bands` would have to be re-pointed
  (`src/app/bands/page.tsx:3`, `src/app/actions/bands.ts:16`,
  `src/app/actions/repertoire.ts:22`, `src/lib/playlists.ts:1`,
  `src/lib/spotifyRouteAuth.ts:31`), and the result would be a nearly empty
  `bands.ts` next to a `.server` file whose suffix the finding itself calls
  meaningless. RH-43 takes neither option; the argument that documentation plus
  the import guard closes F24 anyway is made in the Audit and recorded in the
  F24 `**Status:**` line, and rests on the guard covering all 46 `src/lib`
  modules rather than the one pair either option would touch.
- **Adopting i18n app-wide.** F25's other option. It means extracting every
  string in 68 `.tsx` files plus the `Failed to <verb>` messages assembled in
  `src/lib`, and it is a product decision about who the app is for, not a code
  cleanup. AGENTS.md records the scope decision and explicitly leaves the door
  open; the follow-up, if it is ever wanted, starts with the shared chrome
  (`AppLayout`, `nav.*`, `status.*`), for which the dictionaries already carry
  keys.
- **Deleting the 22 orphan dictionary keys.** They cost nothing, `knip` cannot
  see them, and ER9 forbids touching `src/i18n/dictionaries` at all. They are
  documented as the head start for the app-wide follow-up rather than removed.
- **Guards for the five `(convention only)` claims.** The `<Subject>Actions`
  bundle naming, the `camelCase.ts` filename rule, the `<Subject>Controller`
  return-type vocabulary, the `<Subject>Payload` half of the type vocabulary and
  the test-layout rule are documented and tagged as unenforced. Two of them
  already have named exceptions in the tree (`auth-client.ts` /
  `auth-session.ts` / `bands.server.ts`, and
  `src/components/ui/__tests__/feedbackSurfaces.test.tsx`), so a guard for either
  would need an allow-list on day one - which is exactly what this task's guard
  is designed not to have. If a later task wants them enforced, it should add the
  assertion and the allow-list together, with the exceptions justified, and move
  the tag in AGENTS.md at the same time.
- **Forbidding type-only client imports of server-only modules.** The guard
  counts value imports only, and AGENTS.md says so in the rule sentence. A
  stricter guard is a defensible future choice, but it would have to start by
  justifying the 23 `import type ... from "@/lib/..."` statements already in
  `'use client'` files, and it would fail on imports that the compiler erases and
  that therefore cannot pull `pg` into a bundle - which is the harm the rule
  exists to prevent. If a later task wants the stricter reading (for example to
  keep server type vocabulary out of client files as a design rule rather than a
  bundling one), it should change the AGENTS.md sentence and the test together.
- **Re-asserting dictionary key parity.** `src/lib/__tests__/landingCopy.test.ts:27`
  already does it; the new guard cross-references that test rather than
  duplicating the invariant in a second file.
- **Rewriting `docs/plans/mobile-app-analysis.md`.** The dated note at the top is
  the whole of what this task does to it. The seven `force-dynamic` statements
  and the one proxy statement stay verbatim in the body, because the document's
  section 3.2 conclusion is argued partly from them and correcting the text means
  re-deriving the conclusion. **Suggestion for a follow-up task:** update that
  document to the post-RH-65 architecture and re-check whether section 3.2 and
  the Option B recommendation still hold now that the auth and landing routes
  prerender and the proxy makes no network call. Already logged as item 4 of the
  `[RH-61] ... (code review 1)` entry in `docs/suggestions-log.md`.
- **Triaging `docs/suggestions-log.md`.** It is append-only. This task adds
  review-round entries to it if a round produces any, and reads it for context,
  but it does not clear, re-order or act on the backlog it holds.
- **Any other convention.** The error-handling section (RH-21), the transaction
  rule (RH-34), the Database Row Types section (RH-40), the complexity budgets
  (RH-39) and the import direction (F21) are already written down and already
  enforced; none of them is reworded here. Nor is a guard added for the
  Server Component page pattern, which RH-41 recorded as needing its own
  allow-list and therefore its own task.
- **Restructuring anything under `src/components`, `src/hooks` or `src/app`.**
  The Module Layout section describes where things go; it moves no file. The ten
  component directories, eleven hooks and five action-bundle files are documented
  exactly where they already are.
- **The remaining findings in the review.** Only F23, F24, F25 and T10 gain
  markers. Every other open finding keeps its current text.

## Post-merge checks (orchestrator)

- T10 is fully closed once this merges: F23, F24 and F25 are all the findings it
  covers, and all three are resolved.
- **Two follow-ups are worth capturing as tasks**, both named in Out of Scope:
  merging `bands.ts` with `bands.server.ts` and deleting the caller-less
  `joinBandByInviteClient` (F24 option (a), the cheaper of the two structural
  routes); and updating `docs/plans/mobile-app-analysis.md` to the current
  architecture, re-deriving its section 3.2 conclusion. The second has now been
  raised in three separate review rounds (RH-61, RH-41 and this one) and only
  ever gets a note; it should become a task or be closed as deliberately
  historical.
- **A third, larger one, only if the product wants it:** app-wide i18n. AGENTS.md
  now says the scope is deliberate, so this is a decision to reverse, not a gap
  to fill.
- The new guard is a ratchet with no allow-list. If a later task needs an
  exception to any of its seven rules, the honest move is to change the rule in
  AGENTS.md and the test together, in that task, with a reason - not to add a
  skip. The five `(convention only)` claims are the opposite case: they may be
  promoted to `(guarded)` by a task willing to write the assertion and justify
  the exceptions that already exist.

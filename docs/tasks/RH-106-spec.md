# RH-105 — Restructure the catalog into songs, albums and song_versions (integration close-out)

## Scope

RH-105 was split into RH-121…RH-126. **All six are done and in production**
(RH-126 landed at `f7ae8b1`). This task is the reduced scope its own
justification named: the *final integration and verification step over the six
children*. It implements no part of the restructure. Every table, column,
migration, re-key and authorization rule already exists and already has its own
expected results.

What each child already guarantees, and therefore what this task must not
re-specify:

| Child | Already guaranteed | Shipped as |
|---|---|---|
| RH-121 | `global_songs` → `songs`; `contributor_id` gone; the identifier and type renames across `src/`, `e2e/`, `scripts/` | `migrations/0013_rename_global_songs_to_songs.sql` |
| RH-122 | `albums` and `song_versions` exist with their uniques; the title *splits* instead of being stripped; the sanitizer is deleted | `migrations/0014_add_albums_and_song_versions.sql` |
| RH-123 | `repertoire_tabs` → `song_files` keyed by `(user_id, song_id)`, no `band_id`; annotations preserved; `OFFLINE_SCHEMA_VERSION` 3 | `migrations/0015_song_files.sql` |
| RH-124 | `repertoire` → `user_songs` + `band_songs` keyed by `version_id`; the resolution cascades; band admin on all seven repertoire mutators | `migrations/0016_split_repertoire_owner_songs.sql` |
| RH-125 | `playlist_songs` keyed by `version_id`; the reads and the picker re-pointed | `migrations/0017_playlist_songs_version_id.sql` |
| RH-126 | one write reaches exactly one owner, on the three fan-out paths it changed, with the three per-musician exceptions preserved | `f7ae8b1` |

Each child verified its own migration **against the database state at its own
time**, and its own call paths **in isolation**. Nothing in the repository
verifies the *seams*. This task covers exactly those, and nothing else:

1. **The migration chain composes from an empty database.** `0001` creates
   `global_songs`, `repertoire` and `repertoire_tabs`; `0013`…`0017` rename,
   re-key and drop them. No child ever ran all eighteen files in sequence on a
   virgin database, so no test proves the restructure is reachable by a new
   deployment rather than only by the dev box's accumulated history.
2. **The terminus schema is exactly the intended one.** Each child asserted its
   own table appeared or disappeared. The union — legacy relations absent *and*
   new relations present *and* the owner/version/album foreign-key chain whole —
   is asserted nowhere.
3. **The whole database-backed corpus is green in one process against one
   database.** Twenty-three `*.db.test.ts` suites now share one Postgres; each
   child ran its own. **This has already produced the task's first finding:
   that run is nondeterministic at `b2a73fa`** — see "The integration defect
   found while specifying this task" below.
4. **The two key spaces meet.** `song_files` is keyed by `song_id` (RH-123);
   everything else is keyed by `version_id` (RH-124, RH-125). Whether a file
   uploaded while holding one version is visible from another version of the
   same song is a consequence of two children's decisions and is checked by
   neither.
5. **One-owner holds on the paths RH-126 did not touch.** RH-124 shipped the
   seven repertoire mutators and proved they require band admin; RH-126 proved
   one-owner on `addSongToPlaylist`, the Spotify import and the Spotify sync.
   Nothing proves the seven are also single-owner.
6. **The offline schema version chain has a terminus.** RH-123 set 3, RH-124
   "one above", RH-125 "one above". Each child asserted a *relative* value and
   rejection of its *immediate* predecessor. That the live value is the one the
   module exports, and that every superseded shape **with no upgrade path** is
   refused, is asserted nowhere. The live number is deliberately **not pinned
   by this spec**: concurrent work (RH-132) is staged in this very checkout and
   takes the constant from 5 to 6 *while adding a v5 → v6 upgrade*, so ER8
   states a derivation and names the shape that is upgraded rather than
   asserting that "all superseded shapes are refused", which stops being the
   system's rule the moment RH-132 lands.
7. **The live documentation agrees with the shipped system.** Two drifts
   survive at the seams, both recorded below.

### Out of Scope

- Any change to the schema, to a migration file, or to a `src/lib` or
  `src/app` module's behaviour. This task adds tests and corrects documentation.
  If an ER below fails, the finding is reported, not patched over — a failure
  here means a child shipped something its own ERs did not catch, which is a new
  task.
- **One stated exception to that stance**, and only one: a defect in a *child's
  test* that makes this task's own integration run nondeterministic is fixed
  here. The reason is that nothing else in this task survives it — if ER4's
  command passes one run in four, no ER that depends on the corpus being green
  reports anything. A flaky assertion is not "a child shipped wrong behaviour,
  file a task"; it is an instrument that has to be repaired before any
  measurement taken with it means anything. The exception covers assertions in
  `*.db.test.ts` files only, never production code, and this spec names the one
  case it applies to (`oneOwnerPerWrite.db.test.ts`, ER14). Any *behavioural*
  failure is still reported, not patched.
- `src/lib/__tests__/spotify.test.ts` must not be edited (see loose end **(c)**).
- The pre-RH-126 fanned-out production rows (see loose end **(a)**).
- `scripts/ensure-db.sh`, referenced from `AGENTS.md:108` and `:214` and
  `scripts/migrate.mjs:11` and present nowhere in the workspace. It predates the
  split and has nothing to do with the catalog restructure; ER11 pins it as a
  known exception rather than absorbing it, and requires the reference to
  **stay** — it is ER11's positive control, so removing it fails that ER.

## The integration defect found while specifying this task

Putting all twenty-three DB suites in one parallel run against one database —
the configuration no child ever ran, and the one this task exists to create —
fails intermittently. Measured in a clean worktree detached at `b2a73fa`, the
same assertion fails in roughly one to three runs out of four:

```
BASE RUN0 EXIT=0 :: Tests  253 passed (253)
BASE RUN1 EXIT=0 :: Tests  253 passed (253)
BASE RUN2 EXIT=1 :: Tests  1 failed | 252 passed (253)
 FAIL src/lib/__tests__/oneOwnerPerWrite.db.test.ts
      > a personal Spotify import writes only the importer's rows
 AssertionError: expected 4 to be 5   (:257, expect(bandAfter).toBe(bandBefore))
```

Cause of **this** mode: `bandBefore` (`oneOwnerPerWrite.db.test.ts:218`) and
`bandAfter` (`:248`) are **unscoped global counts** over `band_songs`.
`vitest.config.ts` fixes no `fileParallelism`, and three other suites insert and
delete `band_songs` rows under the same `RUN_DB_TESTS=1` run, so the difference
measures other workers as much as the import under test — it has been observed
drifting in both directions (`expected 5 to be 4` and `expected 4 to be 5`).
The suite's own comment at `:229-236` predicts exactly this. Run solo the file
passes every time.

**There is a second, independent flake mode in the same test, and scoping the
counts does not address it.** One base run at `b2a73fa` failed instead with
`Error: Test timed out in 5000ms` reported at `oneOwnerPerWrite.db.test.ts:202`
— the `it("a personal Spotify import writes only the importer's rows")` opening
line, i.e. the whole test body exceeded vitest's default 5 000 ms `testTimeout`
under parallel database contention, with no assertion reached. That is latency,
not an unscoped count, and the remedy below cannot and does not remove it; it
did not recur in the five post-fix runs, so its frequency is low enough that the
right treatment is to recognise it rather than pre-empt it. This task raises no
`testTimeout` and adds no retries. If ER4 fails with that exact text at that
line, the correct response is to **report it as the second mode** — a new
finding about an under-budgeted test, its own task — not to rerun until green
and not to call ER4 satisfied. ER4's three consecutive clean runs are therefore
three runs that must all pass on their first attempt.

The remedy is in scope under the exception stated above, and it is **not**
`--no-file-parallelism`: suppressing the parallelism hides the race instead of
removing it, and the single-process parallel run is the thing ER4 is supposed
to measure. The fix is to scope both counts to the band the test seeded
(`WHERE band_id = $1`, `[bandId]`) — the already-present scoped assertion at
`:253` (`WHERE version_id = ANY($1)`) covers the real one-owner invariant, so
the unscoped pair contributes nothing but the race. Verified: with both counts
scoped to `bandId`, the full 23-file parallel run exited 0 **five consecutive
times**, 253 passed, 0 failed, 0 skipped (three runs measured while writing this
spec, and the same remedy re-measured independently by the reviewer for five).

## The three recorded loose ends

**(a) Rows that fanned out to band members before RH-126 — OUT OF SCOPE, filed
as RH-140.** The reason that decides it is that this is product work, not
verification: the proposed remedy is an opt-in per-member review of
band-imported rows, which is a screen, a decision about what the member is shown
and a write path — its own PR, and by the children's own record the operator's
call, not this task's.

The supporting reason is weaker than an earlier draft of this spec claimed, and
is stated correctly here. A fanned-out `user_songs` row carries no column, flag
or provenance marker distinguishing it from one the member created themselves;
what it does carry is `created_at timestamptz NOT NULL DEFAULT now()` (both
`user_songs` and `band_songs`, `migrations/0016_split_repertoire_owner_songs.sql:89`
and `:104`), so a pre-RH-126 fan-out leaves a same-transaction timestamp
correlation between a member's `user_songs` row and the band's `band_songs` row
on the same `version_id`. That is a **heuristic, not a proof** — it is defeated
by a member who adds a song personally within the same second as a band write,
and it says nothing about rows whose band counterpart has since been deleted.
So an identification query is possible but unreliable, which is a reason to ask
the human rather than guess, not a reason to call the population undetectable.
No ER in this task asserts anything about these rows either way. Cost if the
operator wants it (RH-140): roughly RH-123's size — a listing query, a
confirm/dismiss write, a per-member opt-in flag, and the tests — buying cleanup
of a bounded historical population that will not grow.

**(b) `docs/use-cases.md:80` — IN SCOPE.** Verified at HEAD: line 80 reads
`One interaction worth naming: the practice button writes two rows, the
presser's own and`, and the sentence continues to line 84. It contradicts the
*same document* seventeen lines later, at `:97-98` — "**Tapping 'practised
it'.** You rehearsed, not the group. The band's own date is a separate write,
and an admin's." — and it contradicts the rule RH-126 shipped and asserted in
its ER12. An intra-document contradiction about the single rule the last child
existed to establish is exactly this task's business, and the one-paragraph
rewrite is the cheapest correct thing in the task. The same pass fixes a second
drift found beside it: `docs/use-cases.md:121` says `2. ``albums`` — find by
name; create if absent`, while RH-122 shipped the album key as
`(lower(artist), lower(name))` — its ER2 pins `Queen`/`Greatest Hits` and
`Michael Jackson`/`Greatest Hits` as two rows. Same file, same seam, same sweep.

**(c) `src/lib/__tests__/spotify.test.ts` at 678/678 — IN SCOPE as a
prohibition, not as work.** Verified: `wc -l` reports **678** and
`eslint.config.mjs:136` pins `max-lines` at **678** for that file. Verified
further, in `src/lib/__tests__/complexityBudget.test.ts` (the `it` at `:201`,
"pins every override ceiling to the current worst number in its file"): the
ratchet requires each ceiling to equal its file's current worst number
*exactly*. So 678/678 is not a defect — it is the ratchet working, and there is
nothing to repair. It is a hazard only for a task that edits the file, because
one added line requires lowering a ceiling the ratchet forbids raising, and
removing lines requires lowering the pin in the same commit. This task therefore
**does not touch that file**, and ER12 pins it byte-identical to the pre-task
commit `b2a73fa` (by SHA, not `HEAD~1`, so a multi-commit landing cannot
defeat it) so the
prohibition is checkable rather than merely stated. Moving or shrinking the file
is a separate task with no integration value.

## Approach

### Behaviour

No runtime behaviour changes. Three things become true:

- A fresh database reaches the restructured schema by running the migrations in
  order, and the schema it reaches is provably the intended terminus (relations,
  absent legacy relations, absent legacy columns, and the full owner → version →
  song → album foreign-key chain).
- The composed flow through all five re-keys — catalog song, album, version,
  owner hold, playlist entry, uploaded file — is exercised once end to end by
  real code against real Postgres, in one new suite, and the fact that
  `song_files` is keyed by song while everything else is keyed by version is
  pinned where it is actually observable: in the schema and in `src/lib/tabs.ts`'s
  statement text (ER6).
- The live documentation (`AGENTS.md`, `docs/use-cases.md`,
  `docker-compose.yml`) names no file that does not exist and states no rule the
  shipped system contradicts.

Where a source-text assertion is unavoidable, it is written as a **set
difference with a positive control**: the same scan must produce a non-empty
result on the population it is meant to search, so a scan that silently matches
nothing cannot pass. A bare count or a grep for a literal the implementation
supplies is not acceptable.

### Files touched

- `src/lib/__tests__/catalogRestructureIntegration.db.test.ts` — **new.** The
  composed end-to-end flow, the `song_files` upload round-trip and its schema
  half (ER6), and one-owner on the seven repertoire mutators. `describe.skipIf(!process.env.RUN_DB_TESTS)` like every
  other DB suite; fixtures through the existing
  `src/lib/__tests__/test-helpers` (`createTestUser`, `deleteTestUser`,
  `representativeVersionId`); real call paths, mocking only the session, the
  blob store, `fetch` and the logger, as `oneOwnerPerWrite.db.test.ts` does. No
  `query('BEGIN'|'COMMIT'|'ROLLBACK')` anywhere (`transactionGuard.test.ts:27`).
- `src/lib/__tests__/catalogRestructureCoherence.test.ts` — **new.** The
  non-database assertions: the schema-terminus and migration-chain expectations
  as data, the offline-version terminus, the absence of a catalog delete in
  non-test source, the `song_files` key-column derivation over `src/lib/tabs.ts`
  (ER6b), the dangling-path scan, and the export-count guard on
  `src/app/actions/repertoire.ts` that forces ER7's list to be revisited if an
  export is added. Plain `vitest`, so it runs inside `npm run test:coverage`.
- `src/lib/__tests__/oneOwnerPerWrite.db.test.ts` — **the one production-adjacent
  edit this task makes.** The two unscoped `band_songs` counts at `:218` and
  `:248` gain `WHERE band_id = $1` with `[bandId]`; the comment at `:229-236`,
  which currently explains why the unscoped count is tolerated, is rewritten to
  record that it is now scoped and why. Nothing else in the file changes, and no
  assertion is deleted — the scoped `version_id = ANY($1)` check at `:253` stays.
- `docs/use-cases.md` — the practice-button paragraph at `:80-84` rewritten to
  the one-owner rule, and the `albums` step at `:121` corrected to the shipped
  artist+name key.
- `docker-compose.yml` — the comment at `:9` names
  `scripts/deduplicate-songs.mjs`, deleted by RH-122 (its ER15); the reference
  goes.
- `package.json` — version bump.

Nothing under `migrations/`, nothing under `src/lib/*.ts`, nothing under
`src/app/`, and not `src/lib/__tests__/spotify.test.ts`. The only existing file
under `src/` that changes is the one test file named above.

The coherence suite's export-count guard pins a number that **must be re-derived
at implementation time**, never copied from this spec: concurrent work (RH-132)
is editing `src/app/actions/repertoire.ts` and is expected to change its export
count. The derivation is `grep -c '^export async function'
src/app/actions/repertoire.ts` at the implementing `HEAD`, and the test must
carry that command in a comment beside the constant so the next reader can
re-derive it rather than guess what the number meant.

### Test criteria

Measured on this repository before writing this spec, so the ERs below are
reports of observations rather than predictions:

- A scratch database created on `repertoire-hero-postgres-1` (port 54322) and
  migrated with `DATABASE_URL=… npm run db:migrate` completed all eighteen
  files and printed `All migrations executed successfully`; `_migrations` held
  18 rows (columns `id`, `name`, `executed_at`).
- On that fresh database the terminus set-difference query returned **zero**
  rows, and the foreign-key inventory returned exactly the ten pairs listed in
  ER3.
- `RUN_DB_TESTS=1 npx vitest run $(git ls-files '*.db.test.ts')` runs **23 files,
  253 tests** — and **does not reliably pass**: measured three times in a clean
  worktree at `b2a73fa` it exited 0, 0 and 1, failing at
  `oneOwnerPerWrite.db.test.ts:257`. That is the defect recorded above, and with
  both counts scoped to `bandId` the same command exited 0 **five consecutive
  times** with 253 passed, 0 failed, 0 skipped. This is why ER4 demands three
  consecutive clean runs rather than one.
- **The two key spaces cannot be made to meet by a runtime read, because no
  version-sensitive `song_files` read path exists — that is the finding, and
  ER6 states it instead of pretending otherwise.** Every `song_files` access in
  non-test source is in `src/lib/tabs.ts` (`:87`, `:101`, `:113`, `:125`,
  `:158`, `:174` — verified as the only ones with
  `grep -rn song_files src --include='*.ts' --include='*.tsx' | grep -v __tests__`,
  whose other hits are comments and type remarks), and each keys on `(id,
  user_id)` or `(user_id, song_id)`; none reads `user_songs` or any version.
  `song_files` has no `version_id` column at all (on a freshly migrated scratch
  database, `SELECT count(*) FROM information_schema.columns WHERE
  table_schema='public' AND table_name='song_files' AND column_name='version_id'`
  prints **0**; the full column list is
  `annotations,created_at,file_url,id,song_id,title,user_id`; `migrations/0015_song_files.sql:32`
  and `:49` say the omission is deliberate). An earlier draft of this ER moved
  the actor's `user_songs` hold between two versions and asserted `listTabs`
  still returned the file. Driven as written, that assertion is **vacuous**: the
  second call is byte-identical to the first and its result is independent of
  `user_songs` — measured, `listTabs` returns the same single id with the hold on
  A, with the hold moved to B, and with the hold deleted entirely. A
  version-keyed `song_files` would change `listTabs`'s *signature*, not its
  *result*, so no runtime fixture can discriminate it. ER6 is therefore stated
  as the two assertions that can discriminate it — one on the schema, one on the
  source text — plus the live round-trip that proves the real path works.
- **The offline terminus is moving under this task, so it is measured at both
  trees and stated as a derivation.** At `b2a73fa`: `OFFLINE_SCHEMA_VERSION` is
  **5** (`src/lib/offlineSnapshot.ts:92`) and `readValidSnapshot` rejects on
  `value.schemaVersion !== OFFLINE_SCHEMA_VERSION` (`:295`), so 1–4 are
  refused. In the **staged RH-132 tree present in this checkout** (measured):
  the constant is **6** (`:105`), the `!==` gate is at `:316`, a new
  `src/lib/offlineSnapshotV5.ts` is added, and `readValidSnapshot` opens with
  `if (isSnapshotV5(value)) return readValidSnapshot(upgradeSnapshotV5ToV6(value))`
  (`:313-314`) — so **5 is upgraded, not refused**, once RH-132 lands. Two
  consequences ER8 must respect, both read off the staged source:
  (i) `isSnapshotV5` (`src/lib/offlineSnapshotV5.ts:106-110`, with
  `isSongSnapshotV5` at `:93-103`) requires every song to carry `repertoireId`,
  `entry.versionId` and `repertoire.id` as strings, while a **current-shape**
  (v6) song carries `versionId` and `repertoire.ownerRowId` and none of those
  — so a current-shape payload with at least one song stamped
  `schemaVersion: 5` fails `isSnapshotV5`, then fails the `!==` gate, and
  returns `null`; (ii) `songs: []` satisfies `.every()` vacuously, so an
  **empty** payload stamped 5 *is* upgraded and returns non-null, which is why
  every ER8 payload carries at least one song. What holds at **both** trees,
  and is therefore what ER8 asserts: a current-shape payload with at least one
  song and `schemaVersion` **1, 2, 3 or 4** returns `null`, and the same
  payload stamped with the **imported** `OFFLINE_SCHEMA_VERSION` returns
  non-null.
- No non-test file under `src/` contains `DELETE FROM songs` or
  `DELETE FROM song_versions` (`git grep -l … | grep -cv '__tests__'` prints
  **0**); **21** `__tests__` files do, which is ER9's control — all 21 paths
  contain `__tests__`.
- `src/app/actions/repertoire.ts` exports **14** functions *as of this writing*,
  of which the seven `resolveWriteOwner` callers are the mutators; none of the
  fourteen mentions `last_practiced`, so none of them is a per-musician
  exception and all seven must be band-row-only in band context. **The count is
  deliberately not pinned by this spec** — RH-132 is editing that file
  concurrently, so ER7 states the derivation instead. An earlier draft of this
  spec said RH-132 *removes* an export; that is false and is corrected here.
  Measured: `grep -c '^export async function' src/app/actions/repertoire.ts`
  prints **14** at `b2a73fa` **and 14** in the staged tree — RH-132 replaces
  `getSongEntryAction` (`:97` at `b2a73fa`) one-for-one with
  `getResolvedEntryForVersionAction` (`:110` staged), which leaves the count
  alone but **deletes the symbol ER7 named as an alternative** and shifts the
  line numbers of every export below it (`updateSongAction` `:102` → `:118`).
  The derivation is still the right instrument, for the shifted-and-renamed
  reason rather than the count one.
- `/bin/zsh -f -c '… npm run lint'` exits **0** with no findings.
- `npm run test:coverage` sets no `RUN_DB_TESTS`, so all 23 DB suites skip:
  measured at `b2a73fa` with both gitignored build artefacts present it exits 0
  with **163 passed | 27 skipped (190) files, 1971 passed | 325 skipped (2296)
  tests**. The skip total depends on gitignored artefacts and on how many tests
  the new suites add, so ER12 pins **0 failed** and does not pin a skip count;
  the only `0 skipped` assertions are the targeted ones where `RUN_DB_TESTS=1`
  is set (ER4, ER5).
- **Two environment conditions make that command fail on a correct tree, and
  ER12 names both so a QA agent does not read either as a regression.**
  (i) **The gitignored artefacts are a precondition, not a skip.** Measured in a
  clean worktree at `b2a73fa` with `public/` empty,
  `npx vitest run src/lib/__tests__/pdfWorkerAsset.test.ts` reports
  `Tests 2 failed | 5 passed (7)` with
  `AssertionError: public/pdf.worker.min.mjs is missing. Run
  \`node scripts/copy-pdf-worker.mjs\`.` — the file's absence **fails**, it does
  not skip. `public/sw.js`'s absence does skip gracefully (`pwaShell.test.ts`
  measured in the same worktree: `Tests 11 passed | 3 skipped (14)`), so only
  the pdf worker is a hard precondition. An earlier draft of this spec claimed
  both merely changed the skip count; that was wrong, and ER12 now states the
  precondition as a step.
  (ii) **`lintGate.test.ts` and `complexityBudget.test.ts` can both exhaust
  their ESLint ceiling under coverage instrumentation.** Each runs a
  whole-project ESLint and `vitest run` runs them in parallel threads. They do
  **not** share one ceiling — an earlier draft of this spec said they did, and
  that was wrong. `lintGate.test.ts` has a named constant
  (`ESLINT_TIMEOUT = 120_000`, `src/lib/__tests__/lintGate.test.ts:122` at
  `b2a73fa`; `300_000` at `:136` in the staged tree), while
  `complexityBudget.test.ts` carries its **own inline literals** at the two
  slow tests (`}, 120_000)` at `:199` and `:235` at `b2a73fa`; `}, 300_000)` at
  `:203` and `:240` in the staged tree — all four measured). Two clean-worktree
  `npm run test:coverage` runs at `b2a73fa` both exited 1 on nothing but that:
  `FAIL src/lib/__tests__/lintGate.test.ts — Hook timed out in 120000ms`, and on
  the second run also `complexityBudget.test.ts > reports no budget violation
  anywhere under src — Test timed out in 120000ms`. Run solo in the same
  worktree both pass well inside the ceiling (measured: `lintGate` 10 passed,
  `Duration 7.48s`, exit 0; `complexityBudget` 6 passed, `Duration 7.55s`, exit
  0), and `npm run lint` exits 0 there. So the timeout is contention, not a
  finding, and ER12 gives the discriminating re-check. **This task does not
  raise `ESLINT_TIMEOUT` and does not disable either suite.** (Concurrent RH-132
  work, **staged** in this checkout, raises both ceilings — `lintGate`'s
  constant and `complexityBudget`'s two inline literals — to `300_000` for its
  own reasons; this task neither depends on that landing nor touches either
  file, and ER12's discriminator keys on the message *text* so it functions at
  `120000ms` or `300000ms` alike.)

### What the RH-132 work, committed at `04a399a`, does and does not touch

RH-132 is **staged in this checkout** (59 entries in `git status --porcelain`,
including the `git mv` of `src/app/songs/[id]/` → `src/app/songs/[versionId]/`)
and is in QA while this spec is written. Every file this task's ERs cite was
swept against it with `git diff b2a73fa --name-only -- <path>`; the literal
results:

- **Untouched** (`0` paths printed, so every line number and count this spec
  cites still resolves): `eslint.config.mjs`, `docs/use-cases.md`,
  `src/lib/tabs.ts`, `src/lib/__tests__/oneOwnerPerWrite.db.test.ts`,
  `vitest.config.ts`, `src/lib/__tests__/spotify.test.ts`, `docker-compose.yml`,
  `README.md`, `migrations/`, `scripts/migrate.mjs`, `src/types/database.ts`,
  `src/lib/songs.ts`, `src/lib/__tests__/test-helpers.ts`.
- **Touched**, with the consequence for this spec stated: `package.json`
  (version `0.1.152-202610071440` → `0.1.153-202610071514`, which moves ER13's
  floor); `src/app/actions/repertoire.ts` (export count still 14, but
  `getSongEntryAction` is gone and the lines below it shift — ER7);
  `src/lib/offlineSnapshot.ts` plus the new `src/lib/offlineSnapshotV5.ts`
  (ER8); `src/lib/__tests__/lintGate.test.ts` and
  `src/lib/__tests__/complexityBudget.test.ts` (both ceilings → `300_000`,
  ER12); `src/lib/ownerSongs.ts` (changed, but still **400** lines with
  `createAndAddSong` still at `:384`, so the ER12 ratchet constraint and this
  spec's note both still hold).
- **ER4's 24 still holds**: `git ls-files -co --exclude-standard '*.db.test.ts'`
  prints **23** paths in the working tree — RH-132 modifies three DB suites
  (`authzRepertoire.db.test.ts`, `ownerSongs.db.test.ts`,
  `playlistVersionReads.db.test.ts`) and adds or deletes none — so this task's
  one new suite makes 24. The *test* count may move with RH-132, which is why
  ER4 pins files, `0 failed` and `0 skipped` and no test total.
- **ER11 still holds in the dirty working tree** (measured there, not only at
  base): the scan prints exactly `MISSING: scripts/deduplicate-songs.mjs` then
  `MISSING: scripts/ensure-db.sh`. The `[id]` → `[versionId]` rename cannot
  affect it — `[` is outside the extractor's character class, so no
  `src/app/songs/[…]/…` path was ever matched. The one unstaged `AGENTS.md`
  hunk is at `:537` (a heading level), below every line this spec cites, and
  `AGENTS.md:108` and `:214` read identically at base and in the working tree.

## Expected Results

- [ ] **ER1 — The migration chain reaches the restructured schema from empty.**
      **Run every command of this ER in one single shell session whose working
      directory is the repository root** — `$DB` is set by the first command and
      read by the four after it, so a fresh shell per command loses it and
      addresses the database `postgresql://…:54322/` instead; and
      `npm run db:migrate`, `ls migrations/*.sql` and the two `.txt` files are
      all repo-relative. Write `applied.txt` and `onDisk.txt` outside the
      repository (or delete them afterwards) so the run leaves the tree clean.
      With a uniquely named scratch database, so two overlapping runs cannot
      collide and no `DROP DATABASE` has to fight an open connection:
      `DB=rh105_verify_$(date +%s)$$` then
      `docker exec repertoire-hero-postgres-1 psql -U postgres -d postgres -c "CREATE DATABASE $DB"`
      then
      `DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/$DB" npm run db:migrate`
      exits 0 **and its last line is** `All migrations executed successfully`
      (the last-line requirement is what makes this discriminate:
      `scripts/migrate.mjs`'s connect-failure path also exits 0). Afterwards the
      applied list and the on-disk list are **identical**, compared as two files
      rather than with process substitution so the check does not depend on the
      shell (`diff <(…) <(…)` is a `bash`/`zsh` feature and fails in
      `/bin/sh`):
      `docker exec repertoire-hero-postgres-1 psql -U postgres -d "$DB" -At -c "SELECT name FROM _migrations ORDER BY name" | sort > applied.txt`,
      then `ls migrations/*.sql | xargs -n1 basename | sort > onDisk.txt`, then
      `diff applied.txt onDisk.txt` prints nothing and exits **0** — no entry
      present in one and absent from the other — and
      `wc -l < applied.txt` equals
      `ls migrations/*.sql | wc -l` — **derive this number, do not compare it to
      a literal**. It was 18 when this spec was written and 21 at
      `1843aa9` (RH-136, RH-137 and RH-107 each added a migration), and any task
      landing before this one moves it again, so a pinned count fails a correct
      implementation. This task adds no migration of its own; the assertion is
      that the two counts agree, which is the same fact the `diff` above states
      and is kept only because a count is quicker to read in a report. Finally
      `docker exec repertoire-hero-postgres-1 psql -U postgres -d postgres -c "DROP DATABASE $DB"`
      succeeds, leaving no scratch database behind.
- [ ] **ER2 — The terminus schema is exactly the intended one, asserted as a set
      difference.** Against a freshly created and migrated scratch database
      (ER1's recipe), the query below prints **zero rows**; each row it would
      print names a violation. The expectation column is a **boolean**, not a
      string, so a typo in the `VALUES` list is a parse error rather than a
      silently weakened check:
      `WITH expected(must_exist,name) AS (VALUES (false,'global_songs'),(false,'repertoire'),(false,'repertoire_tabs'),(true,'songs'),(true,'albums'),(true,'song_versions'),(true,'song_files'),(true,'user_songs'),(true,'band_songs'),(true,'playlist_songs')) SELECT 'VIOLATION: '||name||' must_exist='||must_exist FROM expected e WHERE e.must_exist <> EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=e.name);`
      Positive control, to prove the query is not vacuous: replacing
      `(false,'global_songs')` with `(true,'global_songs')` makes it print
      `VIOLATION: global_songs must_exist=true`. In the same database,
      `SELECT table_name||'.'||column_name FROM information_schema.columns WHERE table_schema='public' AND ((table_name='songs' AND column_name='contributor_id') OR (table_name='playlist_songs' AND column_name='song_id') OR (table_name='song_files' AND column_name='band_id'));`
      prints **zero rows** (measured: zero rows), and that clause has its own
      positive control, because a bare zero-rows assertion could pass by naming
      a table that does not exist or a schema it cannot see: appending
      `OR (table_name='playlist_songs' AND column_name='version_id')` to the
      same `WHERE` makes it print exactly `playlist_songs.version_id`
      (measured). Note what each of the three clauses is: `songs.contributor_id`
      and `playlist_songs.song_id` are **regression checks** — both columns
      existed and were dropped (RH-121, RH-125) — while `song_files.band_id`
      **never existed**: `migrations/0015_song_files.sql` created the table
      without it on purpose (`:32`, `:49`). That clause is a forward guard
      against the column being added, not a check that a drop happened.
      Drop the scratch database afterwards.
- [ ] **ER3 — The owner → version → song → album foreign-key chain is whole,
      pinned by resolved value.** Against a freshly created and migrated scratch
      database (ER1's recipe),
      `SELECT conrelid::regclass||'.'||(SELECT string_agg(attname,',' ORDER BY attname) FROM pg_attribute WHERE attrelid=conrelid AND attnum=ANY(conkey))||' -> '||confrelid::regclass FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace AND conrelid::regclass::text IN ('user_songs','band_songs','playlist_songs','song_files','song_versions','albums') ORDER BY 1;`
      prints exactly these ten lines and no others:
      `band_songs.band_id -> bands`, `band_songs.version_id -> song_versions`,
      `playlist_songs.playlist_id -> playlists`,
      `playlist_songs.version_id -> song_versions`,
      `song_files.song_id -> songs`, `song_files.user_id -> profiles`,
      `song_versions.album_id -> albums`, `song_versions.song_id -> songs`,
      `user_songs.user_id -> profiles`, `user_songs.version_id -> song_versions`.
      Drop the scratch database afterwards.
- [ ] **ER4 — The whole database-backed corpus is green in one process against
      one database, repeatably.**
      `RUN_DB_TESTS=1 npx vitest run $(git ls-files -co --exclude-standard '*.db.test.ts')`
      run **three consecutive times** exits 0 on all three, each run reporting
      **`N` test files passed, `N` total**, **0 failed** and **0 skipped** tests,
      where `N` is the number printed by
      `git ls-files -co --exclude-standard '*.db.test.ts' | wc -l | tr -d '[:space:]'`
      at the implementing `HEAD`. `N` is a **derivation, never a literal**, for
      the reason ER7, ER8 and ER13 give: the corpus grows. It was 23 at
      `b2a73fa`, 24 once this task adds its suite, and 25 while a concurrent
      task's own new DB suite sits in the same checkout — a pinned number fails
      a correct implementation the moment anyone else adds a file. The control
      that proves this task's suite is actually in the list: `N` is **strictly
      greater** than the 23 that
      `git ls-tree -r --name-only b2a73fa | grep -c 'db\.test\.ts$'` prints.
      Three runs, not one: at the pre-task commit `b2a73fa` the same command
      exited 1 on one run in three (and on three in four when measured by the
      reviewer), always at `oneOwnerPerWrite.db.test.ts:257`, so a single clean
      run does not distinguish a fixed corpus from a lucky one. The file list is
      derived with `-co --exclude-standard` so an **uncommitted** new suite is
      included, which is also why the count has to be derived rather than fixed.
      **A failure in a `*.db.test.ts` file this task neither added nor edited is
      reported as that file's own defect, not as ER4's failure** — the `-co`
      list can contain another task's in-flight suite, and ER4 does not adopt
      another task's work as its pass criterion. A run without `RUN_DB_TESTS=1` proves nothing — every suite is
      `describe.skipIf`-gated.
      **One failure text is a known second flake mode and must be reported as
      that, not as a generic regression:** `Error: Test timed out in 5000ms`
      reported at `src/lib/__tests__/oneOwnerPerWrite.db.test.ts:202` — the
      `it("a personal Spotify import writes only the importer's rows")` opening
      line (verified: that is line 202 at `b2a73fa`). It means the whole test
      body exceeded vitest's default 5 000 ms `testTimeout` under parallel
      database contention, with **no assertion reached**; it is latency, not the
      unscoped count ER14 fixes, and it was observed once in the base runs. If
      ER4 fails with that exact text at that line, ER4 **fails** and the finding
      filed is "an under-budgeted test", its own task. Do not rerun until green,
      do not raise `testTimeout`, and do not add retries: ER4's three runs must
      each pass on their first attempt.
- [ ] **ER5 — The composed flow through all five re-keys is exercised once, end
      to end, by real code.** `src/lib/__tests__/catalogRestructureIntegration.db.test.ts`
      exists, guards its suites with `describe.skipIf(!process.env.RUN_DB_TESTS)`,
      and `RUN_DB_TESTS=1 npx vitest run src/lib/__tests__/catalogRestructureIntegration.db.test.ts`
      exits 0 with **0 failed and 0 skipped**. It contains a passing test named
      `one add reaches songs, albums, song_versions, user_songs, playlist_songs and song_files`
      which, for one actor and one freshly named artist, drives the real add and
      playlist and upload paths and then asserts, by `SELECT count(*)::int`
      **scoped to that artist or to the ids the flow produced**, exactly **1**
      row in each of `songs`, `albums`, `song_versions`, `user_songs`,
      `playlist_songs` and `song_files`, and **0** rows in `band_songs` scoped as
      `WHERE version_id = <the version id the flow created>` — scoped, because an
      unscoped `band_songs` count races with the other DB suites in the same
      parallel run (ER14). Every id in the chain is read back from the row the
      previous step created, never written as a literal by the test. No
      assertion is made about `orphaned_repertoire_rows` or
      `orphaned_playlist_entries`: those tables are written only by
      `migrations/0016` and `0017`, no application path touches them, and
      nothing this test drives could make them non-zero, so asserting 0 there
      would be vacuous.
- [ ] **ER6 — `song_files` is keyed by song and by nothing version-shaped, and
      the finding is that no runtime read can show it.** No `song_files` read
      path in non-test source consults `user_songs` or a version, so moving an
      actor's hold between two versions of the same song provably cannot change
      any `listTabs` result — measured, the call returns the same single file id
      with the hold on A, with the hold moved to B, and with the hold deleted.
      A version-keyed `song_files` would change `listTabs`'s signature, not its
      result. ER6 is therefore three assertions, two of them discriminating:
      **(a) schema.** `src/lib/__tests__/catalogRestructureIntegration.db.test.ts`
      contains a passing test named
      `song_files carries no version column and tabs.ts keys on song, not version`
      asserting that
      `SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='song_files' AND column_name='version_id'`
      is **0** (measured: 0), with the positive control that the identical query
      with `column_name IN ('song_id','user_id')` is **2** (measured: 2) — which
      is what proves the query reaches the real table in the real schema rather
      than counting nothing.
      **(b) source text, as a derived set, not a grep for an absence.**
      `src/lib/__tests__/catalogRestructureCoherence.test.ts` contains a passing
      test which reads `src/lib/tabs.ts`, takes every string literal in it that
      mentions `song_files`, collects from those literals every column compared
      to a bound parameter (each capture of `/([a-z_]+)\s*=\s*\$\d+/g`), and
      asserts the sorted union **equals exactly `['id','song_id','user_id']`**
      — a resolved value, so a column named `version_id` fails by inequality and
      an extractor that matched nothing fails too (the empty set is not that
      value). Measured at HEAD, that derivation yields exactly
      `["id","song_id","user_id"]`. Positive control in the same test: the same
      extractor applied to the inline fixture
      `'SELECT 1 FROM song_files WHERE version_id = $1'` yields
      `['version_id']` (measured), so the violation it is meant to catch is
      demonstrably catchable.
      **(c) the live path still works.** The integration suite's test has the
      actor upload one file through `uploadTabAction` while holding one version
      of a two-version song, and asserts `listTabs(actor, songId)` returns
      exactly that one file id. The two controls are kept, because they are the
      only part of the original fixture that discriminated anything:
      `listTabs(<a second user>, songId)` returns an empty array and
      `listTabs(actor, <a different song's id>)` returns an empty array
      (measured: 0 and 0), so the assertion cannot pass by returning everything.
      The hold-moving `UPDATE` and its second `listTabs` call are **dropped** as
      vacuous.
      Verified by running both suites: `RUN_DB_TESTS=1 npx vitest run src/lib/__tests__/catalogRestructureIntegration.db.test.ts`
      exits 0 with **0 failed and 0 skipped** (halves (a) and (c)), and
      `npx vitest run src/lib/__tests__/catalogRestructureCoherence.test.ts`
      exits 0 with **0 failed and 0 skipped** (half (b)).
- [ ] **ER7 — One-owner holds on the seven repertoire mutators RH-126 did not
      touch, driven in a stated order.** The same file contains a passing test
      named `no repertoire mutator in band context writes a member row` which
      seeds a band with two members (the actor `role = 'admin'`, a second user
      `role = 'member'`) and runs two phases, each over its **own** fresh
      version `V` and its own fresh title, in this **exact order** — the order
      matters because `removeSongAction` deletes the row the earlier mutators
      address:
      1. `addSongAction(songId, bandId)` — **a song id, not a version id**
         (`src/app/actions/repertoire.ts:64`, unchanged by RH-132,
         `addSongAction(songId: string, bandId?: string | null)`); the phase's
         version `V` is read back from the `Repertoire` the call returns
         (`entry.version_id`, `src/types/database.ts:89`), equivalently
         `await representativeVersionId(songId)` from
         `src/lib/__tests__/test-helpers.ts:412`. The returned entry's `id` is
         the owner row `R1`;
      2. `updateSongStatusAction(R1, status, bandId)`;
      3. `updateSongTagsAction(R1, tags, bandId)`;
      4. `updateSongAction(entry, data, bandId)` — **not** `updateSongAction(R1)`:
         the signature is `(entry: Repertoire, data: SongUpdateInput, bandId?)`
         (`:102` at `b2a73fa`, `:118` in the staged RH-132 tree — locate it by
         name, not by line), so the first argument is **the whole entry from
         step 1**. An earlier draft offered `getSongEntryAction(R1, bandId)` as
         an equivalent; that alternative is **withdrawn**, because RH-132
         deletes that export and replaces it with
         `getResolvedEntryForVersionAction` (`:110` staged), whose signature and
         return shape differ. Use the returned entry. `data` must be a
         **complete**
         `SongUpdateInput` (`src/lib/songs.ts:96` at `1843aa9` — locate it by
         name, not by line) —
         `{ title, artist, album, key, status, tags: [], links: [] }`. A partial
         object is not merely sloppy: an attempt with `{ key: 'C' }`, measured
         against `1843aa9` by driving `updateSongAction` on a real database,
         threw `Failed to update song: "undefined" is not valid JSON` and rolled
         the whole call back (the `songs` row, the `user_songs` row and
         `song_links` were all unchanged afterwards). The cause is not a
         database constraint: `links` is a **required** member of
         `SongUpdateInput`, so omitting it leaves `data.links` `undefined`,
         which `applyCatalogFill`'s links path stringifies to the JS value
         `undefined` (`fillFor`, `src/lib/catalogFields.ts`) and `fillSongLinks`
         (`src/lib/songs.ts`) then re-parses. The earlier draft of this step
         predicted
         `null value in column "links" of relation "songs" violates not-null
         constraint` instead; that write-through no longer exists — RH-136
         moved links to the `song_links` table and RH-137 removed the last
         production writer of the column, so this writer never names
         `songs.links` and the column's surviving
         `NOT NULL DEFAULT '[]'::jsonb` is never reached from here;
      5. `updateLyricsAction(R1, lyrics, bandId)`;
      6. `createAndAddSongAction({ title, artist, album }, bandId)` → a **new**
         row on a version `V2` the action resolves itself, captured from the
         returned entry's `version_id`;
      7. `removeSongAction(R1, bandId)`.
      (`bandId` is the band's id in the band phase and omitted in the personal
      phase; that is the only difference between the two.)
      In the **band** phase (every call passing the band's id) it asserts
      `SELECT count(*)::int FROM user_songs WHERE version_id = ANY(ARRAY[<V>,<V2>])`
      is **0** — counted over both versions the phase touched, not over the
      second member, so neither the actor's own row nor a row on the version
      `createAndAddSongAction` invented can go unmeasured. Control in the same
      phase, proving the counter is wired to writes that happened:
      `count(*) FROM band_songs WHERE version_id = <V2>` is **1** and
      `FROM band_songs WHERE version_id = <V>` is **0** (step 7 deleted it).
      In the **personal** phase (same seven, same order, no band id, fresh `V`
      and `V2`) it asserts `count(*) FROM user_songs WHERE version_id = ANY(ARRAY[<V>,<V2>])`
      is **1** (step 7 removed the `V` row; the `V2` row remains) and
      `count(*) FROM band_songs WHERE version_id = ANY(ARRAY[<V>,<V2>])` is
      **0**. Additionally, `src/lib/__tests__/catalogRestructureCoherence.test.ts`
      contains a passing test asserting that `src/app/actions/repertoire.ts`
      exports exactly **N** functions, where `N` is the number printed by
      `grep -c '^export async function' src/app/actions/repertoire.ts` at the
      implementing `HEAD` — re-derived at implementation time, never copied from
      a spec or an earlier commit, with that command in a comment beside the
      constant. Adding an export then fails the suite and forces this list of
      seven to be revisited.
- [ ] **ER8 — The offline schema version has a terminus, and every superseded
      shape *with no upgrade path* is refused.**
      `npx vitest run src/lib/__tests__/catalogRestructureCoherence.test.ts`
      exits 0 with **0 failed and 0 skipped**, and that file contains the
      passing tests below. **Nothing in this ER pins the terminus as a numeric
      literal.** Concurrent work (RH-132) takes
      `OFFLINE_SCHEMA_VERSION` from **5** (`src/lib/offlineSnapshot.ts:92` at
      `b2a73fa`) to **6** (`:105` staged) *and* adds a v5 → v6 **upgrade**, so
      the number is re-derived at implementation time exactly as ER7's export
      count is, and "every superseded shape is refused" is not the system's
      rule.
      **(a) the terminus, as a derivation.** A passing test named
      `the offline schema version is the module's terminus` imports
      `OFFLINE_SCHEMA_VERSION` from `@/lib/offlineSnapshot` and asserts it
      equals a constant declared in the test file, whose value is the number
      printed by
      `grep -n 'export const OFFLINE_SCHEMA_VERSION' src/lib/offlineSnapshot.ts`
      at the implementing `HEAD` — **never** copied from this spec or an earlier
      commit (measured: `92:export const OFFLINE_SCHEMA_VERSION = 5` at
      `b2a73fa`, `105:export const OFFLINE_SCHEMA_VERSION = 6` staged). That
      command must appear verbatim in a comment beside the constant, which makes
      the derivation itself checkable:
      `grep -c "grep -n 'export const OFFLINE_SCHEMA_VERSION' src/lib/offlineSnapshot.ts" src/lib/__tests__/catalogRestructureCoherence.test.ts | tr -d '[:space:]'`
      prints **1 or more** (measured on a scratch file carrying that comment:
      `1`; on one without it: `0` — and the pipeline exits 0 in both cases, so
      the passing value cannot be misread from an exit code), and the number
      asserted in the test equals what that `grep -n` prints today.
      **(b) the refused set — only versions with no upgrade path.** A passing
      test named
      `every superseded snapshot shape without an upgrade path is refused`
      builds **one otherwise-valid current-shape payload carrying at least one
      song** and asserts `readValidSnapshot` returns `null` for it with
      `schemaVersion` set to each of **1, 2, 3 and 4**. Those four, and not 5,
      are the list: 1–4 have no upgrade path at either tree (measured true at
      `b2a73fa` and against the staged tree), whereas once RH-132 lands a
      v5-shaped record is deliberately **upgraded** rather than refused —
      `readValidSnapshot` opens
      `if (isSnapshotV5(value)) return readValidSnapshot(upgradeSnapshotV5ToV6(value))`
      (`src/lib/offlineSnapshot.ts:313-314` staged, the `!==` gate having moved
      to `:316`). The payload must carry at least one song because `songs: []`
      satisfies `isSnapshotV5`'s `.every()` vacuously
      (`src/lib/offlineSnapshotV5.ts:109`), which would make an empty payload
      stamped 5 upgrade and return non-null.
      **(c) the control, taken from the live value.** The same test asserts the
      identical payload carrying `schemaVersion: OFFLINE_SCHEMA_VERSION` — the
      **imported symbol**, not a literal — returns a **non-null** value. That is
      what proves the payload is otherwise well formed and that (b)'s four
      `null`s came from the version check rather than from a malformed fixture.
      **(d) the upgraded shape, asserted if and only if it exists.** If
      `ls src/lib/offlineSnapshotV5.ts` succeeds at the implementing `HEAD`
      (measured: exit 0 in this checkout, where RH-132 is staged; the file does
      not exist at `b2a73fa`), the same test file also contains a passing test
      named `a v5 record is upgraded, not refused` asserting **both** halves of
      the actual rule: a **v5-shaped** payload — each song carrying
      `repertoireId`, `entry.versionId` and `repertoire.id` as strings, a
      `personalRepertoire` key and a `tabs` array
      (`src/lib/offlineSnapshotV5.ts:93-103`) — stamped `schemaVersion: 5`
      returns a non-null snapshot whose `schemaVersion` **equals the imported
      `OFFLINE_SCHEMA_VERSION`**; and a **current-shape** payload with at least
      one song stamped `schemaVersion: 5` returns `null`, because a v6 song
      carries `versionId` and `repertoire.ownerRowId` and so fails
      `isSongSnapshotV5`, is therefore not upgraded, and then fails the `!==`
      gate. If that file does not exist, (d) does not apply and (b)'s four are
      the whole refused set — in which case the live value is 5 and (c)'s
      control covers it.
- [ ] **ER9 — No non-test source removes a row from the shared catalog.**
      Both observables below are **counts**, not the presence or absence of
      output, and both commands end in `wc -l` so the pipeline's exit status is
      always 0 — a bare `git grep … | grep -v '__tests__'` exits **1** when it
      matches nothing, and a QA agent reading exit codes would misread the
      passing case as a failure.
      `git grep -l -E 'DELETE FROM (songs|song_versions)' -- 'src/' | grep -v '__tests__' | wc -l | tr -d '[:space:]'`
      prints **0** (measured at `b2a73fa`: `0`, pipeline exit 0). Control,
      proving the pattern and the pathspec actually search the tree rather than
      matching nothing:
      `git grep -l -E 'DELETE FROM (songs|song_versions)' -- 'src/' | wc -l | tr -d '[:space:]'`
      prints a number **≥ 10** (measured at `b2a73fa`: `21`). The two together
      say every matching path contains `__tests__`.
- [ ] **ER10 — `docs/use-cases.md` no longer contradicts the one-owner rule, and
      names the shipped album key.** Every check below reads the file with its
      line wrapping normalised away (`tr -s '[:space:]' ' ' < docs/use-cases.md | …`),
      because the document hard-wraps its prose and a phrase can straddle two
      lines. **Every check therefore counts occurrences with
      `grep -oiF <pattern> | wc -l | tr -d '[:space:]'`, never with `grep -c`:**
      `tr` collapses the whole document to a **single line** (measured: the
      piped output contains 0 newline bytes) and `grep -c` counts matching
      *lines*, so any `-c` here is capped at 1 and cannot express "twice". The
      literal patterns are **single-quoted** wherever they contain a backtick,
      because inside double quotes a backtick is command substitution — the
      double-quoted form of the album-key pattern degrades to `find by ` in both
      shells (bash reports `command substitution: syntax error near unexpected
      token`, zsh reports `no matches found: lower(artist),`) and then matches
      today's text, which made the old form pass at `b2a73fa` where this spec
      claimed it printed 0.
      Measured in `/bin/zsh`, with `C(p)` meaning
      `tr -s '[:space:]' ' ' < docs/use-cases.md | grep -oiF p | wc -l | tr -d '[:space:]'`:
      at HEAD after the rewrite, `C("the practice button writes two rows")`
      prints **0** (it prints **1** at `b2a73fa`), `C("find by name")` prints
      **0** (**1** at `b2a73fa`),
      `C("writes only the presser's own row")` prints **1 or more** (**0** at
      `b2a73fa`),
      `C("band's own date is a separate write, and an admin's")` prints **2 or
      more** (measured **1** at `b2a73fa`, where the sentence appears once in
      § *What creates a personal row in band context*, and measured **2** with
      the sentence present a second time — so the rewritten practice-button
      paragraph must restate it verbatim), and
      ``C('find by `(lower(artist), lower(name))`')`` — single-quoted — prints
      **1 or more** (measured **0** at `b2a73fa`, and **1** with the corrected
      `albums` step present).
      Proving the text was changed by this task rather than never having
      existed — pinned to the **pre-task commit by SHA**, because a two-commit
      landing makes `HEAD~1` already contain the fix:
      `git show b2a73fa:docs/use-cases.md | tr -s '[:space:]' ' ' | grep -oiF "the practice button writes two rows" | wc -l | tr -d '[:space:]'`
      prints **1** and the same with `"find by name"` prints **1** (both
      measured).
- [ ] **ER11 — No `src/`, `scripts/`, `migrations/`, `e2e/` or `public/` path
      named in the live documentation dangles.** **Run it from the repository
      root, in one shell** — the extracted paths are repo-relative and `[ -e ]`
      resolves them against the working directory, so from anywhere else every
      path "dangles" and the ER fails for the wrong reason. This command prints
      no line other than `MISSING: scripts/ensure-db.sh`:
      `grep -ohE '(src|scripts|migrations|e2e|public)/[A-Za-z0-9_./-]+\.(ts|tsx|mjs|js|sql|sh|json|md)' AGENTS.md docs/use-cases.md docker-compose.yml README.md | sort -u | while read -r p; do [ -e "$p" ] || echo "MISSING: $p"; done`
      What the scan covers is exactly what the title says: path-shaped
      references beginning with one of those five directories, in those four
      files. It deliberately does **not** see `docs/…` references or bare
      filenames (`ensure-db.sh` at `AGENTS.md:214`, `init-migrations.sh`,
      `99-migrations.sh`) — nothing under `docs/` dangles at `b2a73fa`, so the
      result is unaffected, but the ER is not a claim about those. The
      observable is **exactly one line of output, and that line is
      `MISSING: scripts/ensure-db.sh`** — not "that line or nothing". The
      earlier wording allowed its removal too, which made the ER
      undiscriminating: with it gone the command prints nothing, and nothing is
      also what a broken extractor prints, so a QA agent could not tell "no
      dangling paths" from "the regex matched nothing". Keeping the line is the
      choice, because it **is** the positive control — it proves both the
      extractor and the existence test work — and because the reference
      (`AGENTS.md:108`, to a script that has never existed in this repository)
      is declared out of scope above. So: removing it **fails** this ER, and any
      *additional* `MISSING:` line fails it. At `b2a73fa` the command prints two
      lines (measured, in that order): `MISSING: scripts/deduplicate-songs.mjs`
      — from `docker-compose.yml:9` — and `MISSING: scripts/ensure-db.sh`. The
      first must be gone and the second must remain.
- [ ] **ER12 — The gates are green and the pinned ceilings are untouched.**
      **Precondition, to be performed or verified before the run:**
      `public/pdf.worker.min.mjs` must exist — `ls -l public/pdf.worker.min.mjs`
      succeeds, and if it does not, run `node scripts/copy-pdf-worker.mjs` (the
      `postinstall`/`prebuild` step, `package.json:6`,`:9`) first. The file is
      gitignored and its absence **fails** two tests rather than skipping them
      (measured in a clean worktree with an empty `public/`:
      `npx vitest run src/lib/__tests__/pdfWorkerAsset.test.ts` →
      `Tests 2 failed | 5 passed (7)`, `AssertionError:
      public/pdf.worker.min.mjs is missing.`). `public/sw.js` is **not** a
      precondition: its absence skips 3 tests in `pwaShell.test.ts` and fails
      none (measured: `Tests 11 passed | 3 skipped (14)`).
      With that in place, `npm run test:coverage` exits 0 with all four
      thresholds met (statements 80, branches 65, functions 78, lines 80) and
      reports **0 failed** tests.
      Its *skipped* count is deliberately not pinned here: that command sets no
      `RUN_DB_TESTS`, so every DB suite skips (325 skipped tests at `b2a73fa`,
      plus whatever the new DB suite adds, plus 3 more when the gitignored
      `public/sw.js` is absent). The only `0 skipped` requirements in this task
      are ER4, ER5 and ER6's integration half, where `RUN_DB_TESTS=1` is set,
      plus ER6's and ER8's runs of the plain coherence suite, which is not
      `describe.skipIf`-gated at all and so has nothing to skip.
      **A coverage-threshold breach fails ER12 unconditionally.** Any line
      matching `does not meet global threshold` in the run's output fails this
      ER — no diagnosis, no re-check, no exception for a coincident timeout.
      It has to be said separately because vitest reports a breach **as an
      exit code, not as a failed test**: measured here,
      `npx vitest run src/lib/__tests__/offlineSnapshot.test.ts --coverage`
      printed `Tests  39 passed (39)` and four lines of the form
      `ERROR: Coverage for lines (1.89%) does not meet global threshold (80%)`
      and exited **1**. So "no other test failed" is perfectly compatible with
      all four thresholds being red.
      **If `npm run test:coverage` exits non-zero, apply this diagnosis before
      reporting a regression.** Two suites — `src/lib/__tests__/lintGate.test.ts`
      and `src/lib/__tests__/complexityBudget.test.ts` — each run a
      whole-project ESLint and `vitest run` runs them in parallel threads. They
      do **not** share a ceiling: `lintGate.test.ts` has the named constant
      `ESLINT_TIMEOUT` (`:122`, `120_000` at `b2a73fa`; `:136`, `300_000` in the
      staged RH-132 tree) while `complexityBudget.test.ts` carries its own
      inline literals at its two slow tests (`}, 120_000)` at `:199` and `:235`
      at `b2a73fa`; `}, 300_000)` at `:203` and `:240` staged — all measured).
      The discriminator below keys on the message *text*, so it works at either
      number. Under coverage instrumentation on a loaded machine those ceilings
      are reachable: two clean-worktree runs at `b2a73fa` both exited 1
      on nothing else, printing
      `FAIL src/lib/__tests__/lintGate.test.ts — Hook timed out in 120000ms`
      and, on one of them, also `complexityBudget.test.ts > reports no budget
      violation anywhere under src — Test timed out in 120000ms`. **A failure
      whose text is `timed out in 120000ms` (or `in 300000ms`) in either of
      those two files is an environment timing condition, not a finding, when
      and only when all four of these hold:** (1) no other test failed;
      (2) `/bin/zsh -f -c 'cd <repo> && /usr/bin/env npm run lint'` exits 0 with
      no findings; (3) each suite run **solo** exits 0 —
      `npx vitest run src/lib/__tests__/lintGate.test.ts` and
      `npx vitest run src/lib/__tests__/complexityBudget.test.ts` (measured in a
      worktree at `b2a73fa`, where the paired run timed out: 10 passed in
      `7.48s` and 6 passed in `7.55s`, both exit 0); **and (4) the coverage gate
      was still actually measured on that same failing run** — its own
      `Coverage summary` block shows all four metrics at or above
      statements 80, branches 65, functions 78, lines 80, it contains **no**
      `does not meet global threshold` line, and the four percentages are
      **quoted verbatim in the QA report**. If the timed-out run produced no
      coverage summary at all, condition (4) cannot be met from it and
      `npm run test:coverage` must be **repeated until it completes without a
      timeout**; the two solo re-runs do not substitute for it, because they
      produce no coverage data. Only with all four does the timeout get recorded
      in the QA report as the environment condition it is. Any other failure
      text, a failure in any other file, or any `does not meet global threshold`
      line is a real regression and fails the ER.
      **This task does not raise `ESLINT_TIMEOUT`, does not add retries, and
      does not skip or `.sequential` either suite** — that would retire a gate
      to make a measurement convenient.
      `/bin/zsh -f -c 'cd <repo> && /usr/bin/env npm run lint'` exits **0** with
      no findings printed — run unwrapped, because an output-filtering wrapper
      masks the exit code. `npm run lint:dead` and `npm run build` each exit 0.
      `npx vitest run src/lib/__tests__/complexityBudget.test.ts` exits 0, and
      `sed -n '/BEGIN:complexity-budget-overrides/,/END:complexity-budget-overrides/p' eslint.config.mjs | grep -c 'complexity-budget/override'`
      prints **14** — unchanged, no entry added. The spotify suite keeps its pinned
      ceiling: `wc -l < src/lib/__tests__/spotify.test.ts` prints **678** and
      `grep -c '"max-lines": \["error", 678\]' eslint.config.mjs` prints **1**.
      Those two structural clauses are the whole of the requirement, and an
      earlier draft's `git diff b2a73fa --name-only -- src/lib/__tests__/spotify.test.ts
      prints nothing` is **withdrawn**: pinning to the pre-task SHA turns "this
      task did not touch the file" into "nobody touched it since `b2a73fa`",
      which another task legitimately may (RH-135 rewrites three fixtures in it,
      keeping it at 678). If an authorship check is wanted, scope it to this
      task's own commits — `git diff <this task's first commit>~1 --name-only`
      — never to the whole history since the pre-task SHA.
- [ ] **ER13 — `package.json`'s `version` is bumped** following the
      `x.y.z-YYYYMMDDHHmm` rule, strictly above **every version reachable in
      `git log`** and strictly above the version in the working tree at the
      moment of the bump. The floor is stated as that derivation rather than a
      literal because the RH-132 work, committed at `04a399a`, moves it: measured,
      `b2a73fa` carries `0.1.152-202610071440` and the staged tree already
      carries `0.1.153-202610071514`, so any literal written here goes stale
      before the task is implemented.
- [ ] **ER14 — The integration run is deterministic, because the racing
      assertion in `oneOwnerPerWrite.db.test.ts` is scoped.** All three source
      observables below are **counts ending in `wc -l`**, never `grep -c`, for
      the reason ER9 gives: `grep -c` printing `0` **exits 1**, and the first
      observable's passing value *is* `0`, so a QA agent checking exit codes
      would read the passing case as a failure (measured: the `grep -c` form
      printed `2` and exited 0 at `b2a73fa`, and prints `0` and exits 1 once the
      fix is in). Run from the repository root. At HEAD,
      `grep "count FROM band_songs'" src/lib/__tests__/oneOwnerPerWrite.db.test.ts | wc -l | tr -d '[:space:]'`
      prints **0** — no unscoped global count over `band_songs` survives in that
      file (measured at `b2a73fa`: **2**, the two counts at `:218` and `:248`) —
      while
      `grep 'FROM band_songs WHERE band_id = \$1' src/lib/__tests__/oneOwnerPerWrite.db.test.ts | wc -l | tr -d '[:space:]'`
      prints a number **≥ 4** — it prints **3** at `b2a73fa` (measured) and
      **5** once those two counts are scoped to the band the test seeded — and
      `grep 'FROM band_songs WHERE version_id = ANY(\$1)' src/lib/__tests__/oneOwnerPerWrite.db.test.ts | wc -l | tr -d '[:space:]'`
      still prints **1** (measured at `b2a73fa`: **1**) — the pre-existing
      scoped one-owner assertion was not deleted in the process. And
      `RUN_DB_TESTS=1 npx vitest run src/lib/__tests__/oneOwnerPerWrite.db.test.ts`
      exits 0 with **0 failed and 0 skipped** — **once, not three times, and
      this run is not the determinism evidence.** The file passes solo every
      time even at `b2a73fa`, which is the whole shape of the defect: the race
      needs the other 22 suites in the same process to appear. So repeating the
      solo run proves nothing it did not prove the first time, and all the
      determinism evidence lives in **ER4**'s three consecutive full-corpus
      runs. The solo run here only establishes that this task's edit did not
      break the file it touched.
      No `--no-file-parallelism`, no `fileParallelism` setting and
      no `.sequential` is added anywhere: `git diff b2a73fa -- vitest.config.ts`
      prints nothing and
      `git grep -l -E 'no-file-parallelism|fileParallelism' -- package.json vitest.config.ts | wc -l | tr -d '[:space:]'`
      prints **0** — stated as a count rather than "prints nothing" because a
      `git grep` that matches nothing exits **1**, which a QA agent checking
      exit codes would misread as a failure.

## Notes for the implementer

- The scratch database in ER1–ER3 must be dropped when the ERs are done, and it
  must carry a unique name (`rh105_verify_$(date +%s)$$`): a fixed name collides
  between two overlapping runs, and `DROP DATABASE` fails while any connection
  to it is open. The repository's own `*.db.test.ts` suites run against the
  database named in `.env.local` and must not be pointed at the scratch one.
- ER7's list of seven mutators is the set of `resolveWriteOwner` callers in
  `src/app/actions/repertoire.ts`. `updateSongLinksAction` is correctly excluded
  because it never calls `resolveWriteOwner`: it resolves the song id and
  authorizes the caller through `assertRepertoireAccess(repertoireId, userId)`
  and then delegates to `applySongLinkUpdate` (`src/lib/songs.ts:254` at
  `1843aa9`), which writes **`song_links` rows** — or queues a moderated edit
  and writes nothing — rather than an owner table. It does **not** write
  `songs.links`: RH-136 moved links onto `song_links` and RH-137 removed the
  last production writer of the column, which an earlier draft of this note
  still attributed to this action. The column itself survives at HEAD
  (`NOT NULL DEFAULT '[]'::jsonb`, measured), as does the one-way forward
  trigger `mirror_song_links_on_songs_write` that mirrors hand-written SQL
  fixtures and the dev seed into the rows every reader uses; dropping both is
  RH-143 and out of scope here. See AGENTS.md § "Song Links (`song_links`)".
  The export-count guard exists so that adding an export breaks the suite
  and forces this list to be reconsidered rather than quietly going incomplete —
  and its number must be re-derived against the implementing `HEAD`, because
  RH-132 is editing that file while this spec is being written. It does **not**
  remove an export, contrary to an earlier draft of this spec:
  `grep -c '^export async function' src/app/actions/repertoire.ts` prints **14**
  at `b2a73fa` and **14** in the staged tree, because `getSongEntryAction` is
  replaced one-for-one by `getResolvedEntryForVersionAction`. What RH-132 does
  change is the **identity and the line numbers** of those exports, which is
  reason enough to derive rather than copy — and it is why ER7 step 4 no longer
  offers `getSongEntryAction` as an alternative.
- `createAndAddSongAction` cannot be driven over a caller-supplied version:
  `createAndAddSong` (`src/lib/ownerSongs.ts:384`) find-or-creates its own
  `songs`/`albums`/`song_versions` rows from the title, artist and album it is
  given. ER7 therefore captures `version_id` from the `Repertoire` entry it
  returns and includes that version in the counter — without it, the counter
  would pass even if that mutator fanned out, which is the exact failure this
  task exists to catch.
- If any ER above **fails**, that is the finding. It means a child shipped
  something its own expected results did not catch, and the repair is a new task
  — not a patch inside this one, whose scope is verification. The single stated
  exception is the one already taken in scope here (ER14): a flaky assertion in
  a child's *test* that makes this task's own integration run nondeterministic
  is repaired here, because no measurement taken with a broken instrument is
  worth reporting.

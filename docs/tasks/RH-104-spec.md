# RH-104 — Process uploaded images on the way in

> **Renamed 2026-10-13** to match its task id. Older text below may describe a "board id + 1" filename rule: that was a mistake copied between specs, not a convention. A spec is always `docs/tasks/<task id>-spec.md`.


The final integration and verification step of the RH-104 split. Both children have
shipped: **RH-127** (`adf6b4a`, spec `docs/tasks/RH-127-spec.md`) made `uploadTabAction`
sniff, decode, bake the rotation, strip the metadata, bound the size and store the
produced content type on `song_files.content_type` (`migrations/0018_add_song_file_content_type.sql`);
**RH-128** (`a4186de`, spec `docs/tasks/RH-128-spec.md`) opened the picker to images and
made an image render as one annotatable page in the viewer and the stage.

This task writes **no production code**. It certifies the seam between the two halves,
and it exists because of what the reading below found.

## What the reading found

The wiring is complete. The content type travels row → `listTabs`
(`src/lib/tabs.ts:172`) → `getTabsAction` → `useTabLibrary` (`:114`, `:210`) →
`FastViewOverlays` → `TabViewer` / `StagePageSurface` → `isImageTab`, and offline
through `offlineStore.writePlaylist` → `toTabSnapshot` → `offlineTabToSongFile`. Every
link exists and every link has a test. Three things are nevertheless unproven, and each
is a property neither child could verify alone. Every number below is a command's output,
not a recollection.

1. **The stored `content_type` value has no real-database coverage, and the column has
   never been seen holding anything but `application/pdf`.** The precise measurements:
   `grep -rn content_type src --include="*.db.test.ts"` returns **nothing** — no DB-backed
   suite reads the column back at all — while `grep -rn contentType src
   --include="*.db.test.ts"` returns exactly `oneOwnerPerWrite.db.test.ts:134` and
   `catalogRestructureIntegration.db.test.ts:138`, both `contentType: 'application/pdf'`.
   `grep -rln 'listTabs\|createTab\|uploadTabAction' src --include="*.db.test.ts"` returns
   three files (`authzTabs.db.test.ts`, `oneOwnerPerWrite.db.test.ts`,
   `catalogRestructureIntegration.db.test.ts`), so Postgres **has** executed `createTab`'s
   `INSERT` and `listTabs`' `SELECT` — what has never been asserted is the column's
   **value**, and never for any type but PDF. Outside the DB suites,
   `grep -rln content_type src/lib/__tests__/` returns only `offlineFirst.test.ts`,
   `offlineSnapshot.test.ts`, `tabRenderer.test.ts` and `tabs.test.ts`, none DB-backed:
   `src/lib/__tests__/tabs.test.ts` mocks `query` and asserts the SQL **text** with
   `toContain('content_type')` plus the bound parameter array (`:176`), which a wrong
   column *position* satisfies — see the probe in ER3, measured green under exactly that
   mutation. And `migrations/0018_add_song_file_content_type.sql` has **no replay suite**:
   `ls migrations/*.sql | wc -l` is 21 against 6 replay suites
   (`songFiles`, `songLinks`, `ownerSongs`, `playlistSongsVersion`, `catalogSuggestions`,
   `catalogVersions`), so fifteen migrations have none and there is **no repository-wide
   convention that every migration is replayed** — the claim is only that *this* column,
   the one both children hinge on, is proven nowhere. `migrationsSingleSource.test.ts`
   checks only that prefixes are unique and contiguous.
2. **Storing the original bytes instead of the ingested ones is a green mutation —
   measured, not inferred.** `src/app/actions/__tests__/tabs.test.ts` runs the real
   ingest, but its image fixtures are 120×90 solid-colour images carrying no metadata, and
   its assertions are the `contentType` handed to `put`, the stored path's extension, and
   `sharp(stored).metadata().format`. For a JPEG input all three hold of the *input*
   buffer too. Changing `put(filePath, prepared.bytes, …)` to `put(filePath, buffer, …)`
   at `src/app/actions/tabs.ts:117` leaves the action suite at `34 passed` and the whole
   corpus at `169 passed | 34 skipped (203)` with zero failures. Publishing the
   un-stripped, un-rotated phone photo, GPS included, at an `access: 'public'` URL is held
   by nothing in the repository. That is precisely the user's stated fear: the property
   passes in isolation and regresses at the seam.
3. **Metadata stripping is verified only at the helper.** `fileIngest.test.ts:130-137`
   plants an EXIF GPS block, an IFD0 `Copyright` needle, an ICC profile and an XMP packet
   and checks `prepareUploadBytes`' output (ER4 of RH-127). Of the five test files naming
   `uploadTabAction`, none feeds metadata-bearing bytes through the action.

Findings that contradict the board or a child's spec, recorded rather than accommodated,
are listed under *Findings* at the end.

## Scope

Three test deliverables and the release bump, on the tree as it stands:

1. **`src/lib/__tests__/songFileContentType.db.test.ts`** *(new, DB-gated)* — replays
   `migrations/*_add_song_file_content_type.sql` against real Postgres in a throwaway
   schema inside a rolled-back transaction (the pattern `songFilesMigration.db.test.ts`
   documents), proving the column lands on `song_files` as `text NOT NULL DEFAULT
   'application/pdf'` and that a row seeded before the `ALTER` reads back
   `application/pdf`; then, against the migrated `public` schema, round-trips all four
   content types through the real `createTab` and `listTabs`, including a row inserted
   with no `content_type` at all; and closes the ingest↔render seam by running the real
   `prepareUploadBytes` on an in-test JPEG, persisting the content type it produced, and
   asserting `isImageTab` of the value `listTabs` reads back is `true` (and `false` for a
   PDF).
2. **`src/app/actions/__tests__/tabs.test.ts`** *(edited)* — one test feeding
   `uploadTabAction` a real JPEG carrying EXIF GPS, an EXIF `Copyright` needle, an ICC
   profile and an XMP packet, asserting the fixture itself carries them and that the
   buffer handed to `put` carries none of them and does not contain the needle anywhere in
   its bytes. This is the user's own requirement — stripping proven through the running
   upload path, not through a helper.
3. **`package.json`** — version bump per `AGENTS.md:523`.

No production file changes. If certification exposes a defect at the seam, fixing that
defect is in scope for this task; inventing production work in its absence is not.

## Approach

### Behaviour

Nothing user-facing changes. The behaviours asserted are the ones RH-127 and RH-128
already claim: an image upload is stored stripped, upright and bounded; the content type
the ingest chose is what Postgres holds; and that stored value is what decides the render
branch.

### The replay chain, prescribed rather than left open

The subject migration is an `ALTER TABLE song_files ADD COLUMN …`, so it needs a
**pre-`0018` `song_files` inside the replay schema**, and no helper builds one:
`ownerStubsDdl` (`src/lib/__tests__/test-helpers.ts:233-238`) emits only
`profiles (id uuid PRIMARY KEY)` and `bands (id uuid PRIMARY KEY)`, and `legacyTabsDdl` is
the pre-`song_files` RH-123 `repertoire_tabs` shape. Replaying the subject against those
alone gives `relation "song_files" does not exist`.

**Prescribed: replay `migrations/*_song_files.sql` as a prerequisite, not a hand-written
approximation of it.** The alternative — hand-writing the pre-`0018` `song_files` DDL
inline — is faster but proves the `ALTER` against an approximation the author chose, which
would pass even if the real prior schema differed; the whole point of a replay suite is
that the prior shape is the one on disk. The prerequisite route costs nothing extra
because `songFilesMigration.db.test.ts` already establishes it, and because the prerequisite
file creates `abandoned_blobs` *inside the throwaway schema*, where it is rolled back with
everything else.

The stub set it requires, measured end to end:

- `legacyCatalogReplayDdl(schema)` — creates the schema and the `songs`, legacy
  `repertoire` and legacy `repertoire_tabs` tables the prerequisite reads and drops;
- `ownerStubsDdl(schema)` — `profiles` and `bands`, the prerequisite's foreign-key targets;
- `schema` first on the transaction's `search_path`, so every unqualified name in both
  migration files resolves inside it;
- then `migrationSqlBySuffix('_song_files.sql')`, then
  `migrationSqlBySuffix('_add_song_file_content_type.sql')`.

Executed as a `psql` script with that exact chain, in a transaction that was rolled back:
the prerequisite ran to `DROP TABLE` with no contact with `public`, the subject's
`ALTER TABLE` landed, and the row seeded *before* the `ALTER` read back
`application/pdf`. Two things that run must carry into the suite:

- **Every schema assertion must be qualified by `table_schema = <schema>`.** The probe run
  showed `information_schema.columns WHERE table_name = 'song_files'` returning **two**
  rows — the replay schema's and the already-migrated `public`'s, both
  `text | NO | 'application/pdf'::text`. Unqualified, ER2's assertion would be satisfied
  by `public` and the replay would prove nothing; worse, ER2's own removal probe would stay
  green. The qualification is what makes the probe discriminate.
- The column's presence and absence are derived in-test (the schema's column list before
  and after the `ALTER`), never compared against a column count written down here.

Using `migrationSqlBySuffix` for the suite's own subject file is correct despite the
helper's doc comment claiming "a suite's own subject file stays resolved locally":
`catalogSuggestionsMigration.db.test.ts:128` and `songLinksMigration.db.test.ts:163,219`
already do it, and the helper throws unless exactly one file matches, which is the
"there is exactly one of me" assertion the comment was protecting. The **comment** is
stale; correcting that one line is a welcome drive-by, not a requirement of this task.

### Files touched

- `src/lib/__tests__/songFileContentType.db.test.ts` *(new)* — as above, with the replay
  chain and stub set prescribed in the previous section. Guarded by
  `describe.skipIf(!process.env.RUN_DB_TESTS)`. Both migration files are resolved by
  `migrationSqlBySuffix` (`src/lib/__tests__/test-helpers.ts:255`) and **no four-digit
  migration prefix appears anywhere in the file, comments included** — several specs each
  claim "the next number", so a prefix written into a test breaks on the next renumber.
  Users come from `createTestUser`/`deleteTestUser`, the song from a direct
  `INSERT INTO songs (title, artist)` as the other DB suites do, and the throwaway schema
  name from a hex token. Transactions are opened with `withTransaction` only:
  `transactionGuard.test.ts:27` bans `BEGIN`/`COMMIT`/`ROLLBACK` literals everywhere under
  `src/`. The suite must leave the dev database exactly as it found it — its own rows
  deleted, its throwaway schema rolled back, and no scratch database created at all,
  because `vitest.config.ts:22` assigns every key `.env.local` names unconditionally and
  `DATABASE_URL` is one of them, so vitest cannot be pointed at a scratch database.
- `src/app/actions/__tests__/tabs.test.ts` *(edited)* — the metadata-bearing fixture and
  its test. The file already imports `sharp` and already partially mocks
  `@/lib/fileIngest` with `importOriginal`, so the real ingest runs; `@vercel/blob` stays
  mocked and the bytes are read off `vi.mocked(put).mock.calls`.
- `package.json` — version bump.

### Test criteria

Node-environment vitest. The DB suite asserts nothing unless `RUN_DB_TESTS` is set, so
every expected result naming it spells out the gate-open command and demands zero skipped
tests. Each behavioural claim is backed by a **removal probe**: the file is copied to the
session scratchpad, mutated, the named command must report a failure, the file is restored
and confirmed byte-identical with `diff -q`, and the command must then pass again. A probe
that leaves the suite green is a defect in the test, not a pass — and a probe that fails
for a reason other than the one its result names (a rejected bind, a missing relation) is
equally worthless, which is why ER3 prescribes one mutation and names the two it forbids.

One pre-existing flake is known and is **not** caused by this task:
`src/components/playlists/__tests__/playlistReorder.test.tsx > the Reorder toggle (RH-103)
> turns the rows into reorder rows, and back (ER14)` failed in one of three full
gate-closed corpus runs, and the same file reports `Test Files 1 passed (1)` /
`Tests 18 passed (18)` when run alone. ER6 therefore discriminates load from regression
mechanically rather than demanding an unconditional `0 failed`: every reported `FAIL` must
be in a file this task does not touch **and** green when re-run alone, with a bounded
number of corpus retries. `repertoire-hero-postgres-1` also exited (code 0) partway
through a previous full-corpus run; ER1's container precondition exists for that and
stays.

## Expected Results

Eight single-sentence, single-assertion results are persisted on the task (ER1-ER8).
They name outcomes only; every command, probe, grep and counting rule lives in the
**Verification Procedure** below, which is authoritative for how each is checked.

- ER1: The new content-type database suite passes with `RUN_DB_TESTS` set and zero skipped tests.
- ER2: Replaying the song_files migration and then the content-type migration in a throwaway schema yields a `text NOT NULL DEFAULT 'application/pdf'` column, and a row seeded before the `ALTER` reads back `application/pdf`.
- ER3: Real `createTab` followed by `listTabs` returns the exact stored `content_type` for each of `application/pdf`, `image/jpeg`, `image/png` and `image/webp`.
- ER4: `isImageTab` is true for the content type `listTabs` reads back after `prepareUploadBytes` ran on a JPEG, and false for a PDF.
- ER5: `uploadTabAction` given a JPEG carrying EXIF GPS, an EXIF copyright needle, an ICC profile and an XMP packet hands `put` bytes containing none of them.
- ER6: The whole test corpus passes, with the complexity, single-source-migration and transaction-guard ratchets green and the database schemas unchanged afterwards.
- ER7: `npm run lint`, `npm run lint:dead` and `npm run test:coverage` all exit 0.
- ER8: The `package.json` version is strictly above every version it held at `51bba28`.

## Run State (2026-10-12)

A previous implement run was blocked because the headless sandbox refused test commands.
Partial work on disk: the ER5 test in `src/app/actions/__tests__/tabs.test.ts` (unstaged,
unrun). Not done: the DB suite, the version bump, every probe. Run commands exactly as
spelled below (`/bin/zsh -f -c 'cd <repo> && ... /usr/bin/env npx vitest run ...'`); if
the sandbox still refuses them, stop and report BLOCKED rather than claiming a result.
This file is board RH-104's spec (board id + 1); RH-105's is `RH-105-spec.md`.

## Verification Procedure

Shared rules. `T` = `/bin/zsh -f -c 'cd /Users/heitor/workspace/repertoire_hero && RUN_DB_TESTS=1 /usr/bin/env npx vitest run <path>'`.
Derive every count (migration files, test files, override entries, versions) with the
command given; never compare against a quoted number. Probes: copy the file to the session
scratchpad (not `/tmp`), mutate, run, require at least `1 failed`, restore, `diff -q`
silent, re-run green. Never run `migrate`/`build` while a migration file is mutated.

- **ER1 (suite runs and asserts).** `docker ps` shows `repertoire-hero-postgres-1` Up;
  `select count(*) from _migrations` (psql, 127.0.0.1:54322, postgres/postgres) equals
  `ls migrations/*.sql | wc -l`. `T src/lib/__tests__/songFileContentType.db.test.ts`
  reports `Test Files  1 passed (1)`, `0 failed`, passed > 0, no `skipped` (the suite is
  `describe.skipIf(!process.env.RUN_DB_TESTS)`). `grep -nE '\b0[0-9]{3}_'` on the file
  exits 1 (migrations are resolved by `_add_song_file_content_type.sql` suffix).
- **ER2 (replay proof).** In one always-rolled-back `withTransaction`, a hex-named
  throwaway schema (`legacyCatalogReplayDdl` + `ownerStubsDdl`, first on `search_path`)
  replays `*_song_files.sql` then `*_add_song_file_content_type.sql`; asserts the
  schema's own `song_files` columns lack `content_type` before and have it after, that it
  is `text`, `is_nullable = 'NO'`, default `'application/pdf'::text`, and that a row seeded
  before the `ALTER` reads `application/pdf`. `grep -c 'information_schema'` on the file
  prints `1` (one-line helper taking the schema as a bound parameter) and
  `grep -n 'table_schema = \$'` exits 0 (unqualified queries are answered by `public`).
  Probe: `sed -i '' 's/content_type/content_type_probe/g'` on the migration; require
  `1 failed`. That failure does NOT prove qualification; the greps do.
- **ER3 (createTab/listTabs round-trip).** For `application/pdf`, `image/jpeg`,
  `image/png`, `image/webp`, real `createTab` then `listTabs(userId, songId)` returns that
  exact `content_type`; a raw INSERT naming no `content_type` reads `application/pdf`;
  `select count(*) from song_files` is equal before and after the run. Probe (only this
  one): in `src/lib/tabs.ts` `createTab`, swap the last two column names to
  `(user_id, song_id, title, content_type, file_url)` leaving `VALUES ($1..$5)` and the
  array; ER1's run needs `1 failed` while `src/lib/__tests__/tabs.test.ts` stays green.
  Do not use a literal-for-`$5` or drop-placeholder mutation.
- **ER4 (ingest drives render).** Suite contains `prepareUploadBytes` and `isImageTab`;
  a test runs real `prepareUploadBytes` (real `sharp`) on an in-test JPEG, persists its
  `contentType` via `createTab`, reads via `listTabs`, asserts `isImageTab(...)` true, and
  false for a `%PDF-` buffer. Probe: delete `content_type,` from `listTabs`' SELECT in
  `src/lib/tabs.ts`; require `1 failed`.
- **ER5 (stripped through the action).** `src/app/actions/__tests__/tabs.test.ts` has a
  test building a JPEG with EXIF `IFD0.Copyright` needle, EXIF GPS, ICC (`withIccProfile('p3')`)
  and XMP; asserts the fixture is non-vacuous (`metadata().exif` defined, includes needle);
  drives `uploadTabAction`; asserts the buffer in `vi.mocked(put).mock.calls[0][1]` has
  `exif`, `icc`, `xmp` undefined and does not include the needle. Run reports 1 file
  passed, `0 failed`, no `skipped`. Probe: in `src/app/actions/tabs.ts` pass the original
  `buffer` instead of the prepared bytes to `put(...)`; require `1 failed`.
- **ER6 (corpus, ratchets, DB state).** `T` over the whole repo: at most one skipped test (only in
  `pwaShell.test.ts`), test-file count > `git ls-tree -r 51bba28 --name-only | grep -cE '\.test\.(ts|tsx)$'`.
  `0 failed` ends the attempt. Otherwise only `FAIL` lines for
  `src/components/playlists/__tests__/playlistReorder.test.tsx` are excusable, and only if
  it passes alone. Any `*.db.test.ts` FAIL or `deadlock detected` is never excused. At
  most two corpus retries. Also `T src/lib/__tests__/complexityBudget src/lib/__tests__/migrationsSingleSource src/lib/__tests__/transactionGuard`
  reports `Test Files  3 passed (3)`, `0 failed`, no skipped (unescaped prefixes), and the
  count of `name: "complexity-budget/override"` in `eslint.config.mjs` is <= the count in
  `git show 51bba28:eslint.config.mjs`. Non-system schemas and `pg_database` names, captured
  before and after the full run, `diff -q` silent (`rh136rev`, `qa_base`, `qa_rh124_fresh`
  survive; no scratch database is created).
- **ER7 (static and coverage gates).** Each unwrapped with the `/bin/zsh -f -c` form:
  `npm run lint`, `npm run lint:dead`, `npm run test:coverage` exit 0.
- **ER8 (version).** `package.json` version is strictly above the max from
  `git log -p 51bba28 -- package.json | grep -oE '"version": "[^"]+"' | sed 's/.*: "//;s/"$//' | sort -V | tail -1`
  (judge with `sort -V`).

## Out of Scope

- **The unauthenticated public file URL.** Uploads are `put(..., { access: 'public' })`
  (`src/app/actions/tabs.ts`) with no authorization on the object itself, so anyone
  holding the URL reads the file. This is already recorded as its own defect and is **not
  fixed here**; stripping the metadata is what keeps a public URL from publishing a
  musician's home address, and that is the property this task certifies.
- **The 10 MB buffered for an unauthorized caller** (see Findings). A resource question of
  its own, not this spec's margin.
- Re-processing or re-typing files uploaded before RH-127, HEIC/AVIF input, a manual
  rotate control, thumbnails, the two-state stage chrome RH-128 deferred, and the
  `docs/use-cases.md` wording.
- Any production code change not forced by a defect this certification exposes.

## Findings

- **`migrations/0018_add_song_file_content_type.sql` has no replay suite**, and the mocked
  `src/lib/__tests__/tabs.test.ts` text-and-parameter assertions are what stood in for
  one. This is the gap between the two halves: RH-127 owned the column and asserted only
  its SQL text, RH-128 declared "no migration" and read the column from hand-written
  props. It is **not** true that this is the only migration without a replay suite —
  `ls migrations/*.sql | wc -l` is 21 against six replay suites, so fifteen have none.
  A previous round of this spec asserted the stronger claim; it is withdrawn, and the
  narrower measured one above is what justifies ER1–ER4.
- **`information_schema` is schema-ambiguous for this table**, because `public.song_files`
  is already migrated: an unqualified `WHERE table_name = 'song_files'` returns the
  replay schema's row *and* `public`'s. Any later replay suite for a `song_files`
  migration must qualify by `table_schema`, or its assertion is satisfied by the live
  schema and its removal probe stays green.
- **RH-127's spec says `ensureOwnEntry(userId, songId)` "precedes any byte work"; the code
  reads the whole file into a `Buffer` and sniffs it before that call.**
  `src/app/actions/tabs.ts:95-97` sniffs, authorizes at `:97`, then prepares and puts, so
  nothing is written before authorization and the ordering that matters holds. The
  residual up-to-10 MB buffered for an unauthorized caller is a resource/DoS question in
  RH-127's code and deserves its own task. Stated, not changed.
- **RH-128's spec states the override list "already holds 17 entries" against
  `MAX_OVERRIDES = 17`, so it "may not grow at all". The conclusion that this is no longer
  the tree is right; the cause this spec previously gave was wrong.**
  `grep -cF 'name: "complexity-budget/override"' eslint.config.mjs` is **14** against
  `MAX_OVERRIDES = 17` (`complexityBudget.test.ts:56`), so the list has headroom for three
  — but **`TabDrawingStage.tsx`'s entry was not dropped**: it survives at
  `eslint.config.mjs:141` with `max-lines-per-function: 709` / `max-lines: 788`, lowered
  from 743/815 by RH-128's extraction rather than removed. The shrink to 14 came from
  other entries leaving (RH-124 deleted `src/lib/songs.ts`'s outright, per the comment at
  `eslint.config.mjs:144-150`). Any later spec quoting either sentence should re-derive
  both the count and the ceiling.
- **The mocked `tabs.test.ts` does not pin column *position*.** Swapping the last two
  names of `createTab`'s `INSERT` column list to
  `(user_id, song_id, title, content_type, file_url)`, leaving `VALUES ($1..$5)` and the
  five-element array untouched, leaves that suite at `Tests 27 passed (27)` — and Postgres
  accepts the statement, because both columns are `text`, storing the blob URL in
  `content_type` (`RETURNING content_type, file_url` →
  `https://blob.example/p.jpg | image/jpeg`). This is the mutation ER3 probes with, and
  the reason ER3 must be DB-backed. `src/lib/tabs.ts` was restored byte-identically after
  the measurement.
- `prepareUploadBytes` treats an unladdered image content type as unsupported
  (`src/lib/fileIngest.ts`), so the sniffer and the ladder table cannot drift apart
  silently. No action needed.

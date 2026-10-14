# RH-147 — Define which of a song's files is the primary one

All four design questions are decided (operator answers recorded on the task):

| Question | Decision |
|---|---|
| Q1 designation or ordering | **Single mark**: `is_primary boolean`, not an orderable list. |
| Q2 initial primary / new upload | **Oldest wins**: the backfilled primary is the oldest chart (`created_at ASC`); a new upload never takes the primary from an existing one. |
| Q3 list order | **Marked in place**: `listTabs` keeps `ORDER BY created_at DESC`; the primary wears a badge wherever it falls. |
| Q4 control | **Inline star** between the "open in new tab / download" link and the delete button. |

`docs/tasks/RH-147-mock.html` still shows the discarded options for history; the decided panels are Q1-A, Q2-A, Q3-B and Q4-A.

## Scope

`song_files` has no notion of a primary file, and `listTabs` (`src/lib/tabs.ts`, `ORDER BY created_at DESC`) makes "the first file" mean the most recently uploaded. This task introduces the primary-file concept end to end: the column and its database invariant, the backfill of existing files, the read that exposes it, the write that sets it, the Fast View star that triggers that write, and the offline snapshot's carriage of it.

For any `(user_id, song_id)` with at least one chart file, exactly one file is primary; with none, there is no primary.

Not covered: opening the primary automatically (RH-148 — no auto-open, no change to `TabViewer` mount conditions), Stage Mode, annotations, band-shared files (none exist), per-version scoping, the `abandoned_blobs` sweeper, reordering the list.

## Constraints

- **Personal, never the band's.** `song_files` has no `band_id` by product rule (`migrations/0015_song_files.sql`). The primary belongs to a `(user_id, song_id)` pair; band mates may differ and cannot see or set each other's.
- **Charts only.** Audio rows (RH-162) share the table but are excluded from `listTabs`. An audio row is never primary: the backfill, the upload rule, the delete promotion and the unique index all apply to `content_type NOT LIKE 'audio/%'` rows only.
- **Offline is read-only.** The star is `disabled` while `readOnly` (`TabList`'s prop, fed from `TabLibrarySection`), exactly like the delete button; the action is never reached offline. The "open in new tab / download" link stays enabled.
- **Older offline snapshots keep validating.** `OfflineTabSnapshot.isPrimary` is optional (absent = not designated), `isTabSnapshot` gets the `=== undefined || typeof …` clause, `OFFLINE_SCHEMA_VERSION` stays `6` (RH-128 `contentType` precedent).
- **Write is a Server Action authorised by `user_id`.** The new `src/lib/tabs.ts` function follows `deleteTab`: `WHERE … AND user_id = $n`, so another musician's file id matches no row and reports not-found. Clear-then-set goes through `withTransaction` (or one statement); no `BEGIN`/`COMMIT`/`ROLLBACK` through `query()`. Style A1 in the action, L1 in the lib, no data access under `src/app/actions/*.ts`, no `console.error` in a catch.
- **Migration number is taken at implementation time, not here.** The highest file at `8025673` is `0026_catalog_search_trgm.sql`, so the next is `0027_<snake_case>.sql`, in `migrations/` only. Tests that replay it must resolve it by `_<suffix>.sql` glob, never by numeric prefix.

## Behaviour

- **Migration**: adds `is_primary boolean NOT NULL DEFAULT false` and a partial unique index on `(user_id, song_id) WHERE is_primary`. It backfills the oldest chart row (`created_at ASC`, `id` as final tie-break) of every `(user_id, song_id)` group as primary. Its header states: "backfill = oldest; a new upload keeps the existing primary."
- **Upload**: the first chart file for a pair becomes primary; a later upload leaves the existing primary untouched. Concurrent first uploads cannot yield two primaries (the index rejects it; the loser retries as non-primary or the statement is a single conditional insert).
- **Set primary**: new lib function plus thin action with `revalidatePath('/')`; designating file 2 after file 1 leaves file 2 primary and file 1 not, atomically.
- **Delete**: deleting the current primary of a pair that still has chart files promotes the oldest remaining one, in the same transaction/statement, so a non-empty list never has zero primaries.
- **Read**: `listTabs` projects `is_primary`; its `ORDER BY` is unchanged.
- **Resolver**: `src/lib/tabLibrary.ts` exports a pure, named function returning the list's primary file, `null` only for an empty list. When no element is designated (an old offline snapshot, a missed row) it falls back to the oldest by `createdAt`/`created_at`, independent of the order the list arrives in. No call site uses an implicit `tabs[0]`.
- **UI**: each `TabList` row shows a star between the external-link and delete buttons, `aria-label="Set as primary file"` (i18n key outside `landing`, in both dictionaries), filled for the primary and outlined otherwise, one tap to designate, `disabled` when `readOnly`. The primary row also wears a badge; list order is untouched. The hook (`useTabLibrary`) updates optimistically and shows a failure toast.
- **Snapshot**: the capture writes `isPrimary` into each `tabs[]` entry.

## Test environment — `songs.links` fixture (verified)

QA on an earlier implementation reported `createTestSong` (`src/app/actions/__tests__/authzFixtures.ts:28`) inserting into `songs.links` with the column absent, failing `authzTabs.db.test.ts` at setup and `npm run test:coverage` with 30 failures in 11 files.

Verified at `8025673`: the repository does not drop the column. `migrations/` ends at `0026`, no file drops `songs.links` (`0020` drops only the reverse bridge trigger and says RH-143 owns the column drop), and the fixture matches the repo schema. The failure therefore came from a database where RH-143's drop migration (spec written, not landed) had been applied while the fixture was still unconverted. It is not a design defect of this task. (The live container could not be queried from this session to confirm which migrations it holds.)

Scope consequence, made explicit:

1. Before building, the developer runs `npm run db:migrate` and `RUN_DB_TESTS=1 npx vitest run src/app/actions/__tests__/authzTabs.db.test.ts` as a baseline. If it fails with `column "links" of relation "songs" does not exist`, the database is ahead of the fixtures: **this task then converts `createTestSong` and every other DB-backed test or fixture that inserts into `songs.links` to seed through `song_links`** (the conversion RH-143 describes), as in-scope work, rather than shipping against a red baseline. If the baseline is green, no fixture change is made and RH-143 keeps that work.
2. The ER2-ER4 and ER8 commands are only meaningful with that baseline green; the QA environment must therefore have the database and fixtures at the same schema (either both before or both after RH-143).

## Files touched

- `migrations/0027_<snake_case>.sql` — column, partial unique index, chart-only backfill, header rule.
- `src/lib/tabs.ts` — `listTabs` projection, set-primary function, upload first-file rule, delete promotion.
- `src/app/actions/tabs.ts` — set-primary action (A1 envelope).
- `src/types/database.ts` — `SongFile.is_primary`, documented like `content_type`.
- `src/lib/tabLibrary.ts` — exported resolver.
- `src/hooks/useTabLibrary.ts`, `src/components/fastview/TabList.tsx`, `TabLibrarySection.tsx` — star, badge, `readOnly` wiring, optimistic update, toast.
- `src/lib/offlineSnapshot.ts` — optional `isPrimary`, validator clause, capture; version stays `6`.
- `src/i18n/dictionaries/en.json`, `pt-BR.json` — star name and badge text outside `landing`.
- `docs/use-cases.md` — **Decided** bullet in "Attach a file to a song" (personal per pair, band mates may differ, oldest is the initial primary, a new upload keeps the existing primary, list order unchanged).
- `package.json` — version bump strictly above the baseline read from the file that carries versions: `git log -p --format= 8025673 -- package.json | grep -o '[0-9]*\.[0-9]*\.[0-9]*-[0-9]\{12\}' | sort -V | tail -1` (currently `0.1.200-202610131706`).
- `eslint.config.mjs` — only if a pinned file's worst number moves (ceiling must equal it; override count may only shrink).
- Conditional (see test environment): `src/app/actions/__tests__/authzFixtures.ts` and other `songs.links` seeders.

## Test criteria

- `src/lib/__tests__/songFilePrimary.db.test.ts` (`RUN_DB_TESTS=1`, same schema-scratch replay technique as `songFilesMigration.db.test.ts`; no `BEGIN`/`COMMIT`/`ROLLBACK` literals): one primary per group after backfill, and it is the oldest chart; a second primary for one pair is rejected by the database; two users on one song hold independent primaries; an audio row is never backfilled primary.
- `authzTabs.db.test.ts` own-file `describe`, fixed titles: `designating a second file moves the primary off the first, atomically`; `the first file uploaded for a song is its primary`; a second upload keeps the first file primary; deleting the primary promotes the oldest remaining file; user B cannot set the primary on user A's file (error envelope, A's rows unchanged).
- `tabLibrary.test.ts`: empty, one file, designated, none designated (oldest fallback, same result for reversed input).
- `TabList.test.tsx`, `offlineReadOnlyControls.test.tsx`: star per row, calls handler with file id, filled on the primary, badge on the primary, `disabled` when `readOnly`.
- `offlineSnapshot.test.ts`: record without `isPrimary` still validates; one with it round-trips; capture writes it.
- `npm run lint` (unwrapped), `npm run lint:dead`, `npm run test:coverage` exit 0.

## Expected Results

- [ ] ER1: `RUN_DB_TESTS=1 npx vitest run src/lib/__tests__/songFilePrimary.db.test.ts` passes, proving the migration backfills exactly one primary (the oldest chart) per `(user_id, song_id)` and the database rejects a second.
- [ ] ER2: `RUN_DB_TESTS=1 npx vitest run src/app/actions/__tests__/authzTabs.db.test.ts` passes, proving the first upload becomes primary, a later upload keeps it, and designating another file moves the mark atomically.
- [ ] ER3: The same `authzTabs.db.test.ts` run proves deleting the primary promotes the oldest remaining chart file.
- [ ] ER4: The same `authzTabs.db.test.ts` run proves user B setting the primary on user A's file gets an error envelope and A's rows are unchanged.
- [ ] ER5: `npx vitest run src/lib/__tests__/tabLibrary.test.ts` passes, proving the resolver returns the designated file, the oldest when none is designated (same result for reversed input), and `null` only for an empty list.
- [ ] ER6: `npx vitest run src/components/fastview` passes, proving each `TabList` row has a star (`aria-label="Set as primary file"`) that is filled with a badge on the primary only and `disabled` when `readOnly`.
- [ ] ER7: `npx vitest run src/lib/__tests__/offlineSnapshot.test.ts` passes, proving a snapshot record without `isPrimary` still validates and one with it round-trips at schema version `6`.
- [ ] ER8: `npm run lint`, `npm run lint:dead` and `npm run test:coverage` all exit 0.

## Out of Scope

RH-148 auto-open and half-expanded viewer; band-shared primary; per-version scoping; list reordering; Stage Mode, annotations, sweeper; any change to the `landing` subtree of either dictionary.

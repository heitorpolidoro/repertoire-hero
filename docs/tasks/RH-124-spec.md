# RH-123 — Replace `repertoire_tabs` with `song_files` keyed by `(user_id, song_id)`

Part 3 of 6 from the RH-105 split. Spec file is `docs/tasks/RH-124-spec.md` (board id + 1).
Depends on **RH-121** (`docs/tasks/RH-122-spec.md`), which renames `global_songs` to
`songs` — the new table's `song_id` foreign key points at `songs`, so that rename must
already be applied.

## Scope

A file stops hanging off a repertoire row and starts belonging to a musician and a
composition: `repertoire_tabs (repertoire_id, …)` becomes
`song_files (user_id, song_id, …)`. That re-key is not cosmetic — it changes who owns a
file, how many lists the Fast View shows, whether a band holds files at all, and what the
offline snapshot captures.

Covered:

- the migration that creates `song_files`, carries the user-owned rows across, drops the
  band-owned rows and drops `repertoire_tabs`;
- `src/lib/tabs.ts` and `src/app/actions/tabs.ts` re-keyed onto `(user_id, song_id)`, with
  `assertRepertoireAccess` replaced by the row's own `user_id` as the whole authorization
  predicate;
- the collapse of the band/personal duality in `src/lib/tabLibrary.ts`,
  `src/hooks/useTabLibrary.ts` and the Fast View components it feeds — one list, no origin
  badge, no destination modal;
- the offline snapshot's file capture, re-keyed by song id and corrected to capture the
  **reader's own** files (`docs/plans/repertoire-rework.md`, *Download individual songs for
  offline*), with `OFFLINE_SCHEMA_VERSION` bumped;
- defect 2 of the three the plan records: `deleteTabAction` deletes the blob before the
  row, and the use case decides the opposite order (`docs/use-cases.md`, *Delete a file*);
- `scripts/deduplicate-songs.mjs`, which repoints `repertoire_tabs` rows while merging
  duplicate songs and would otherwise reference a dropped table.

Not covered — each with its destination named in **Out of Scope**: authenticating the
stored file (defect 3), deleting files when the last version of a song leaves the
repertoire (defect 1's permanent fix), sweeping blobs already orphaned, renaming the
"tab" vocabulary to "file", image upload processing, and `user_songs` / `band_songs`.

## Approach

### 1. The migration

One new file under `migrations/`. Its four-digit prefix is **the next number after the
highest present in `migrations/` at implementation time** — resolve it by reading the
directory, never by assuming: eleven approved specs are queued ahead of this one and each
claims "the next number". `src/lib/__tests__/migrationsSingleSource.test.ts` enforces
unique prefixes contiguous from `0001`, so a gap or a collision fails the suite. Earlier
migrations are never edited; the ledger is append-only and a fresh database must reach the
same shape by replaying it in order.

The migration does five things, in this order:

1. Creates `song_files`: `id` uuid primary key defaulting to `gen_random_uuid()`,
   `user_id` not null referencing `profiles(id)` on delete cascade, `song_id` not null
   referencing `songs(id)` on delete cascade, `title` text not null, `file_url` text not
   null, `annotations` jsonb not null defaulting to `'{}'::jsonb`, `created_at` timestamptz
   not null defaulting to `now()`. One index on `(user_id, song_id)` — every read is by
   that pair. **No `band_id` column, and no unique constraint on `(user_id, song_id)`**:
   a musician may attach several charts to one song.

   `created_at` is not in the plan's DDL line and is kept deliberately: `mergeTabs`'s
   successor sorts on it and the offline snapshot stores it verbatim, so dropping it would
   silently reorder a musician's file list. Carry the `annotations` column comment from
   `migrations/0005_add_tab_annotations.sql` onto the new column, and add a column comment
   on `user_id` recording that a file is personal by design and a band holds none.

2. Copies every `repertoire_tabs` row whose `repertoire` row is **user-owned**
   (`repertoire.user_id IS NOT NULL`) into `song_files`, joining through
   `repertoire_id` to take `repertoire.user_id` and `repertoire.song_id`, and carrying
   `title`, `file_url`, `annotations` and `created_at` across unchanged. `annotations` is
   copied as the jsonb value, not re-serialised through text, so a migrated row's
   annotations compare equal to the pre-migration value. `uq_repertoire_user_song`
   guarantees one repertoire row per `(user_id, song_id)`, so no two source rows can
   collide on anything the new table constrains.

3. Creates `abandoned_blobs (file_url text primary key, reason text not null,
   abandoned_at timestamptz not null default now())`. Nothing reads this table in this
   task. It exists because the alternative is destroying the only record of objects that
   stay in Vercel Blob forever and, because uploads are `access: 'public'`, stay readable
   by URL — a silent, unrecoverable leak. The table is given a `COMMENT ON TABLE` saying
   exactly that and naming the sweeper as the future reader. The delete path in §3 writes
   to it as well, so it has a live writer and not only a historical one.

4. Inserts one row into `abandoned_blobs` per **band-owned** `repertoire_tabs` row
   (`repertoire.band_id IS NOT NULL`, i.e. every row step 2 did not carry across), taking
   its `file_url` and `reason = 'band-owned repertoire_tabs row dropped by the song_files
   migration'`, with `ON CONFLICT (file_url) DO NOTHING` so two band rows sharing a URL do
   not abort the migration. This **must** run before step 5: it is the last read of
   `repertoire_tabs`.

5. `DROP TABLE repertoire_tabs`, which is also what destroys the band-owned rows. This is
   the one place in the repository that may name the old identifier after this task.

The order above is load-bearing and the steps must appear in the file in exactly that
sequence — `migrate.mjs` runs each migration file inside one transaction, so a `SELECT`
placed after the `DROP` fails the whole file.

### 1b. How the migration is actually tested

`scripts/migrate.mjs` applies each file once against one shared database and records it in
`_migrations`; every existing `*.db.test.ts` runs against the *already migrated* shape.
Nothing in this repository replays a migration file, so "applies the migration" is not a
step an implementer can write without being told how. The mechanism is the one
`docs/tasks/RH-96-spec.md` (approved, board task RH-95) specifies for the same problem, and
this task adopts it verbatim in shape.

**The test's path is `src/lib/__tests__/songFilesMigration.db.test.ts`**, and §1b, ER2,
ER3, ER4 and ER8 all mean that one file when they say "the same test". It sits beside its
nine siblings on purpose: `eslint.config.mjs` scopes its test-file overrides to
`src/**/*.test.ts`, so a suite placed outside `src/` would silently fall out of them. The
consequence is that this one file legitimately contains the string `repertoire_tabs` (it
rebuilds the legacy shape), so ER5 and its grep exclude it **by name** — see ER5, whose
command implements the exclusion rather than describing it.

- **Resolve the file at runtime by its name suffix, never by prefix.** Read `migrations/`,
  take the single entry whose name ends with `_song_files.sql`, and fail the test if there
  is not exactly one. This keeps the test green through the renumber §1 anticipates.
- **Rebuild the pre-migration shape inside a transaction, then roll back.** Postgres makes
  DDL transactional, so the test opens a transaction and, within it: drops `song_files` and
  `abandoned_blobs`, recreates `repertoire_tabs` with the legacy DDL frozen in
  `migrations/0002_add_tabs_and_lyrics.sql` and `migrations/0005_add_tab_annotations.sql`
  (the `CREATE TABLE`, its `repertoire_id` index, and the `annotations` jsonb column —
  those files are history and never change, so the DDL may be written inline in the test
  with a comment citing them), seeds its rows, executes the migration file read from disk,
  asserts, and **always** rolls back. Nothing is left behind for the next suite, and the
  shared database never leaves its migrated shape.
- **Seed both cases in one transaction:** one user-owned `repertoire` row with a
  `repertoire_tabs` row carrying non-empty `annotations`, and one band-owned `repertoire`
  row with its own `repertoire_tabs` row.

If **RH-95 lands first**, its `songIdentity.db.test.ts` already contains this
resolve-by-suffix / execute / roll back shape and should be read and followed, not
re-derived. If it has not landed, this task owes the whole harness itself: there is no
shared helper to import and none is introduced here — the ~15 lines live in this task's own
`songFilesMigration.db.test.ts`. Either way the implementation does not block on RH-95.

**The gate is explicit.** Like all nine existing `*.db.test.ts` suites, this one is
`describe.skipIf(!RUN_DB_TESTS)`, so a plain `npm run test:coverage` **skips** it. That is
why ER2/ER3/ER4/ER8/ER13 below each state the gate: they are satisfied only by a run with
`RUN_DB_TESTS=1` against a migrated database, and a report showing them as skipped is a
failing report, not a passing one. ER8 in particular is the only guard on the single
irreversible act in this task — annotations crossing the move — and must be observed
passing, not merely not-failing.

### 2. What is lost, and why that is acceptable

Today a tab uploaded onto a **band** repertoire entry is visible, annotatable and
deletable by every member of that band, and the row records nobody as its uploader —
`repertoire_tabs` has a `repertoire_id` and nothing else. Under the new model `song_files`
has a `user_id` and no `band_id` (`docs/use-cases.md`, *Attach a file to a song*, and
*What creates a personal row in band context*), so there is no owner such a row could be
given: assigning it to one member would be a guess, and fanning it out to every current
member would manufacture rows for people who never uploaded anything and duplicate the
file across a membership that changes.

So those rows are dropped, and with them their annotations. The file objects survive in
Blob storage and their URLs are recorded in `abandoned_blobs`, which makes the loss
recoverable by hand rather than absolute. The cost is bounded: a band chart is
re-uploadable by whoever scanned it, and from this task on it lands where it belongs. The
PR description must state the loss in these terms, and must report the row count the
migration dropped on the target database.

> **An open question for the operator covers this** — see the task's `questions`. The spec
> as written drops the rows; if the operator prefers fanning each band-owned file out to
> every current member of that band, only steps 2 and 4 of §1 change.

### 3. Data access and the Server Actions

`src/lib/tabs.ts` keeps its path and its `runTabQuery` wrapper. Every exported function
loses its `repertoireId` parameter; the create takes `(userId, songId, title, fileUrl)`
and the four per-file operations take `(fileId, userId, …)`, with `listTabs` taking
`(userId, songId)`. `assertRepertoireAccess` is no longer imported here: authorization
becomes `AND user_id = $n` in the `WHERE` clause of every statement, which is both the
whole story and a stronger one — there is no band membership to grant a third party
access. A non-matching pair still answers `null` (reads) or `false` (the annotation
write), so the existing `{ error: 'Tab not found' }` envelopes are unchanged. The module
docblock must be rewritten to say this; the current one asserts the opposite.

`src/app/actions/tabs.ts` keeps its five exported actions and their envelope shapes. The
changes:

- `uploadTabAction` reads `songId` from the form instead of `repertoireId`, drops both
  `assertRepertoireAccess` calls, and stores the object under a path keyed by the owner
  and the song rather than by a repertoire row. Existing objects are **not** moved: the
  row carries an absolute `file_url`, so old and new paths coexist with no migration of
  bytes.
- `uploadTabAction` also **ensures the uploader's own repertoire row exists**, status
  `unknown`, in band context as much as outside it (`docs/use-cases.md`, *Attach a file
  to a song*, step 3). This task does it on the current `repertoire` table, which is the
  exact equivalent of the `user_songs` row RH-124 will create; it is **not** deferred to
  RH-124, because the destination modal that used to make this the user's explicit choice
  is deleted here, and deferring would mean shipping a round in which a band-context
  upload creates no personal row at all. RH-124 repoints the same call at `user_songs`.
  Reuse the existing add-song path rather than writing SQL in the action.
- `deleteTabAction` takes `(fileId)` only — the row's `user_id` is the session's — and
  **deletes the row first, then the stored object** (`docs/use-cases.md`, *Delete a file*:
  orphaned storage can be swept, a row pointing at nothing cannot be repaired). A failure
  of the object delete is logged and swallowed, not propagated; the action still answers
  `{ success: true }`, because the row the musician was looking at is gone. **The
  `abandoned_blobs` write happens in that failure branch and nowhere else**: exactly when
  `del` rejects, one row is inserted with the file's URL and a `reason` naming the failed
  delete, with `ON CONFLICT (file_url) DO NOTHING`. When `del` resolves, **no** row is
  written — the object is gone, and handing the future sweeper a URL that no longer
  resolves would make the ledger a list of false leaks. That insert is itself wrapped so a
  ledger failure cannot turn a successful row delete into an error.
- `getTabAnnotationsAction`, `saveTabAnnotationsAction` and `getTabsAction` lose their
  `repertoireId` argument; the last takes a song id.

### 4. The band/personal duality collapses

`src/lib/tabLibrary.ts` loses `TabOrigin`, `MergedTab`, `entryTabOrigin`, `mergeTabs`,
`needsDestinationChoice`, `UploadTarget`, `resolveUploadTarget` and `resolveDeleteTarget`
— every one of them exists to answer "band or personal?", a question the model no longer
asks. `defaultTitleFromFileName`, `tabUploadTitle`, `validateTabFile`,
`MAX_TAB_FILE_BYTES`, `PendingTabDelete` (reduced to the file id) and
`TabLibraryController` stay; the controller loses `uploadDestination`,
`isDestinationModalOpen`, `chooseDestination`, `cancelDestination` and
`activeTabRepertoireId`, and `tabs` becomes a plain file array. Their tests in
`src/lib/__tests__/tabLibrary.test.ts` go with them.

`src/hooks/useTabLibrary.ts` consequently makes **one** fetch instead of two: the
entry-tabs fetch and the personal-tabs fetch become a single `getTabs(songId)`, and the
merge disappears. Its options lose `repertoireId`, `entryBandId` and
`personalRepertoireId` and keep `songId`; `onPersonalEntryCreated` stays, because §3's
ensure-row still produces an entry the page adopts.

`src/components/fastview/TabDestinationModal.tsx` is **deleted** along with its wiring in
`FastViewOverlays.tsx`; `TabList.tsx` loses the band/personal badge and the origin
argument to its delete request; `TabLibrarySection.tsx` loses the destination props. The
Fast View page's `useTabLibrary` call site loses the three dropped options, and
`usePdfStage` is wired with the file id alone — its `repertoireId` option and the
`getAnnotations` / `saveAnnotations` signatures in `PdfStageActions` drop that argument.
No new UI is introduced; the visible change is strictly removal, and
`docs/tasks/RH-124-mock.html` shows the section before and after.

### 5. Types

`RepertoireTab` becomes `SongFile` in `src/types/database.ts`, with `repertoire_id`
replaced by `song_id` — the old name asserts an ownership that is now wrong, and ER9
forbids a repertoire row id in a captured file entry. `TabAnnotations` and `Stroke` keep
their names and shapes; the comment above `TabAnnotations` must name `song_files`.

The broader rename of the "tab" vocabulary to "file" (`tabs.ts` → `files.ts`,
`uploadTabAction` → `uploadFileAction`, `useTabLibrary` → `useFileLibrary`, the
`src/components/fastview` names) is **deliberately not done here**: it touches every
consumer without changing behaviour and would bury the re-key it is riding on. Record that
decision in the `src/lib/tabs.ts` docblock so the mismatch between `SongFile` and
`tabs.ts` reads as a choice.

### 6. Offline

**One key, chosen here, not left to the implementer.** `OfflineTabSnapshot.repertoireId`
becomes `songId`. `OfflineSongSnapshot` gains **no new field**: the file-lookup key is the
already-present `repertoire.song_id`, which is what `findSongBySongId`
(`src/lib/offlineFirst.ts:158-167`) keys on. `OfflineSongSnapshot.repertoireId`
**stays** — `findSong` (and so the `getSongEntry` reader at line 193) keys on it, and
`isSongSnapshot` keeps requiring it. Record that choice, and the reason the two keys
coexist, in the module docblock; the current docblock's line "`OfflineSongSnapshot.repertoireId`
is the id `getTabs` is called with" becomes false and must be rewritten.

Three more places in the same file move with the rename, and ER9 cannot hold without
them: `isTabSnapshot` checks `value.songId` in place of `value.repertoireId`;
`isSongSnapshot` is unchanged; and `offlineTabToRepertoireTab` becomes
`offlineTabToSongFile`, returning the §5 `SongFile` with `song_id: tab.songId` in place of
`repertoire_id`, with its call sites updated.

`OFFLINE_SCHEMA_VERSION` goes **2 → 3**, and the v2 → v3 note in the existing comment
block must state the real failure, not a convenient one: a v2 snapshot's *song* is still
found — `findSongBySongId` matches on `repertoire.song_id`, which v2 already carries — and
its whole tab array is returned; what breaks is each mapped file arriving with
`song_id: undefined`, because a v2 tab entry carries `repertoireId` and nothing else. The
list is not empty, it is wrong. (A v2 snapshot would also now fail `isTabSnapshot`; the
version bump is what turns that into a purge of a superseded version by
`listOfflinePlaylists`, so the download reads as not-downloaded rather than as a shape
error.) Do not write "would be found by no song id" into that comment — it is untrue.

`src/lib/offlineFirst.ts`: the `getTabs` reader (line 200) resolves through the existing
`findSongBySongId` instead of `findSong`, keeping the `file_url` → `cacheKey` override.
The second, personal-list `getTabs` call documented in its comment no longer exists, and
the comment must go with it.

**The capture lives in `src/hooks/useOfflinePlaylist.ts`, not in `offlineStore.ts`** —
neither `src/lib/offlineStore.ts` nor `src/app/offlineActions.ts` calls `getTabs`;
`offlineActions.ts` only wires `getTabsAction` into the injected actions object, and that
wiring is unchanged in shape. The call is `gatherSongs`'s
`await actions.getTabs(entry.repertoireId)` at line 106, behind
`OfflineDownloadActions.getTabs: (repertoireId: string) => Promise<RepertoireTab[]>` at
line 31. Both change: the type becomes `(songId: string) => Promise<SongFile[]>`, and the
call passes `repertoire.song_id` (already resolved two lines above). The file does not
compile otherwise. This is exactly where the plan's recorded defect lives — in band
context `entry.repertoireId` is the *band* row, so the snapshot took the band's tabs and
skipped the member's own; passing the song id to an action that resolves by the session's
`user_id` captures the **downloader's own** files instead. Say so in the comment at that
call site, which today reads "Personal **tabs** are still not captured". `offlineTabCacheKey`
and the `rh-offline-tabs-v1` cache name are unchanged, so no cached bytes are orphaned.

`e2e/offline-mode.spec.ts` hand-builds a snapshot object and must be updated to v3 and the
new key, or the offline spec fails.

### 7. Guardrails

- `src/lib/tabs.ts` carries a `max-params: 5` override in the
  `complexity-budget-overrides` block, and `src/hooks/useTabLibrary.ts` carries one too.
  Every function in both loses a parameter, so re-measure each file: an override whose
  ceiling is no longer the file's exact worst number fails
  `src/lib/__tests__/complexityBudget.test.ts`, and an override for a file that no longer
  violates must be **removed**. The list is a ratchet and may only shrink.
- Deleting eight exported helpers and a component is exactly what `npm run lint:dead`
  checks: nothing may be left exported and unimported.
- `scripts/deduplicate-songs.mjs` repoints files by song id — one `UPDATE song_files SET
  song_id = <primary> WHERE song_id = <secondary>` replacing the per-repertoire-row
  repointing — and no longer needs to move anything when a duplicate repertoire row is
  collapsed.
- Bump `package.json`'s `version`: patch increment plus the `-YYYYMMDDHHmm` local-time
  suffix (AGENTS.md, Version Bumping Rule).

### Files touched

- `migrations/<next>_song_files.sql` — new: `song_files`, the data move, the
  `abandoned_blobs` ledger, `DROP TABLE repertoire_tabs`.
- `src/lib/tabs.ts` — re-keyed onto `(user_id, song_id)`; `assertRepertoireAccess` gone,
  `user_id` in every `WHERE`; docblock rewritten.
- `src/app/actions/tabs.ts` — song-id arguments, new blob path, ensure-own-repertoire-row
  on upload, row-before-object delete with the ledger write.
- `src/lib/tabLibrary.ts` — origin/merge/destination helpers and controller fields deleted.
- `src/hooks/useTabLibrary.ts` — one fetch, no merge, options reduced to the song.
- `src/hooks/usePdfStage.ts` — `repertoireId` dropped from the options and the injected
  annotation actions.
- `src/app/fastViewTabActions.ts`, `src/app/offlineActions.ts` — injected action shapes.
- `src/app/songs/[id]/fast-view/page.tsx` — call sites for the two hooks and the section.
- `src/components/fastview/TabDestinationModal.tsx` — deleted.
- `src/components/fastview/FastViewOverlays.tsx`, `TabList.tsx`, `TabLibrarySection.tsx` —
  modal wiring, origin badge and destination props removed.
- `src/types/database.ts` — `RepertoireTab` → `SongFile` with `song_id`.
- `src/lib/offlineSnapshot.ts` — `OfflineTabSnapshot.songId`, `isTabSnapshot`,
  `offlineTabToRepertoireTab` → `offlineTabToSongFile`, `OFFLINE_SCHEMA_VERSION` 3,
  docblock rewritten (§6).
- `src/lib/offlineFirst.ts` — the `getTabs` reader resolves through `findSongBySongId`.
- `src/hooks/useOfflinePlaylist.ts` — `OfflineDownloadActions.getTabs` takes a song id
  (line 31) and `gatherSongs` passes `repertoire.song_id` (line 106); the stale
  "personal tabs are not captured" comment replaced.
- `src/lib/offlineStore.ts` — only the `OfflineTabSnapshot`/`SongFile` type flow-through;
  it makes no `getTabs` call.
- `scripts/deduplicate-songs.mjs` — repoint by song id.
- `eslint.config.mjs` — the two overrides re-measured or removed.
- `package.json` — version bump.
- Tests: `src/lib/__tests__/tabs.test.ts`, `src/lib/__tests__/tabLibrary.test.ts`,
  `src/app/actions/__tests__/tabs.test.ts`,
  `src/app/actions/__tests__/authzTabs.db.test.ts`,
  `src/hooks/__tests__/useTabLibrary.test.tsx`, `src/hooks/__tests__/usePdfStage.test.tsx`,
  `src/lib/__tests__/offline{Snapshot,First,Store}.test.ts`,
  `src/hooks/__tests__/useOfflinePlaylist.test.tsx` (its `getTabs` mock is keyed by
  repertoire id today, line 61),
  `src/components/playlists/__tests__/{OfflineDownloadButton,PlaylistDetailView}.test.tsx`
  (same mock shape), `src/app/actions/__tests__/actionSessionGuard.test.ts` (its
  `getTabsAction` invocation), `src/components/fastview/__tests__/{TabList,TabOverlays}.test.tsx`,
  `e2e/offline-mode.spec.ts`, plus the new
  `src/lib/__tests__/songFilesMigration.db.test.ts` for the migration assertions (§1b) —
  the one file ER5's grep excludes by name.
- `docs/tasks/RH-124-mock.html` — the Fast View file section before and after.

### Test criteria

- `src/lib/__tests__/songFilesMigration.db.test.ts`, built exactly as §1b prescribes (file resolved by the
  `_song_files.sql` suffix, pre-migration shape rebuilt and rolled back inside one
  transaction, `describe.skipIf(!RUN_DB_TESTS)`), seeds one user-owned tab with non-empty
  annotations and one band-owned tab, executes the migration file, and asserts: the
  user-owned row is present in `song_files` under the right `(user_id, song_id)` with
  annotations equal to what was seeded; the band-owned row is absent; its `file_url` is in
  `abandoned_blobs`; `song_files` has no `band_id` column per `information_schema.columns`;
  `repertoire_tabs` no longer exists. Run with `RUN_DB_TESTS=1` and report the result —
  "skipped" does not discharge these assertions.
- `src/app/actions/__tests__/authzTabs.db.test.ts` is rewritten around the new predicate:
  for each of the five actions, a second user holding their own file cannot read, annotate
  or delete the first user's file, and a refusal writes nothing. The band fixture becomes
  a two-user fixture; band membership grants nothing.
- An action test asserts the delete order by asserting the row is gone when the mocked
  `del` rejects, that the action still answers `{ success: true }`, and that the URL
  reaches `abandoned_blobs`; a companion case asserts that when `del` **resolves**, no
  `abandoned_blobs` row is written.
- An `offlineSnapshot` test asserts a v2-shaped snapshot (tab entries carrying
  `repertoireId`) is rejected by `readValidSnapshot`, and a `useOfflinePlaylist` test
  asserts the capture calls `getTabs` with the song id, never with a repertoire id.
- An action test asserts that an upload in band context creates the uploader's own
  repertoire row with status `unknown`.
- A jsdom test renders the Fast View file section for a song the user has **no** repertoire
  row for and still lists that user's files — the behaviour the old
  repertoire-row-keyed fetch made impossible.
- An `offlineSnapshot` test asserts no captured file entry carries a repertoire row id and
  that `OFFLINE_SCHEMA_VERSION` is 3; an `offlineFirst` test asserts `getTabs` resolves by
  song id.
- `rg -n 'repertoire_tabs' src/ e2e/ -g '!songFilesMigration.db.test.ts'` prints nothing
  and exits 1. That single file and `migrations/` are the only places the old identifier
  may survive.
- `npm run test:coverage`, `npm run lint:dead` and `npm run build` all exit 0.

## Expected Results

- [ ] ER1 — A new migration under `migrations/`, named with the suffix `_song_files.sql`
      and numbered one above the highest prefix present in the directory at implementation
      time, creates `song_files (id, user_id, song_id, title, file_url, annotations jsonb,
      created_at)`, migrates every `repertoire_tabs` row whose `repertoire` row is
      user-owned into it, creates `abandoned_blobs` and records the band-owned rows'
      `file_url`s in it **before** dropping `repertoire_tabs`, and drops
      `repertoire_tabs` last; `npm run db:migrate` exits 0 on a fresh database and
      `src/lib/__tests__/migrationsSingleSource.test.ts` passes.
- [ ] ER2 — `src/lib/__tests__/songFilesMigration.db.test.ts` resolves that migration file at runtime by its
      `_song_files.sql` suffix (not a hardcoded prefix), and inside a single transaction
      that it always rolls back: rebuilds the pre-migration shape (drops `song_files` and
      `abandoned_blobs`, recreates `repertoire_tabs` with the legacy DDL of
      `migrations/0002`/`0005`), seeds one user-owned and one band-owned tab, executes the
      file, and asserts the user-owned row survives in `song_files` under the correct
      `(user_id, song_id)` while the band-owned row is gone and `repertoire_tabs` no longer
      exists. The suite is gated `describe.skipIf(!RUN_DB_TESTS)`; this result is met only
      by a run with `RUN_DB_TESTS=1` in which the test **passes** — a skipped run does not
      satisfy it.
- [ ] ER3 — `song_files` carries no `band_id` column, asserted against
      `information_schema.columns` in the same `RUN_DB_TESTS=1`-gated test, observed
      passing rather than skipped.
- [ ] ER4 — The migration records each dropped band-owned row's `file_url` in
      `abandoned_blobs`, asserted in the same `RUN_DB_TESTS=1`-gated test, observed passing
      rather than skipped.
- [ ] ER5 — `rg -n 'repertoire_tabs' src/ e2e/ -g '!songFilesMigration.db.test.ts'`
      prints nothing and exits 1. (The excluded file is the migration db-test, which
      rebuilds the legacy shape; `migrations/` is not searched, since the drop migration
      must name the table.)
- [ ] ER6 — `src/lib/tabs.ts` and `src/app/actions/tabs.ts` take a song id or a file id
      rather than a repertoire row id in every exported signature, and no exported function
      in either file accepts a repertoire row id.
- [ ] ER7 — `useTabLibrary` resolves a song's files by song id in a single fetch, asserted
      by a jsdom test that renders the Fast View file library for a song the user has no
      repertoire row for and still lists that user's files.
- [ ] ER8 — Annotations survive the move: the `RUN_DB_TESTS=1`-gated migration test asserts
      a migrated row's `annotations` jsonb equals its pre-migration value. This is the only
      guard on the task's one irreversible act, so it must be reported as **passed** under
      `RUN_DB_TESTS=1`; reported as skipped, the task is not done.
- [ ] ER9 — `OfflineTabSnapshot` is keyed by `songId` and no captured file entry carries a
      repertoire row id; `isTabSnapshot` validates `songId`; `offlineTabToSongFile` returns
      a `SongFile` carrying `song_id`; `OFFLINE_SCHEMA_VERSION` is 3 and `readValidSnapshot`
      rejects a v2-shaped snapshot — all asserted by tests in
      `src/lib/__tests__/offlineSnapshot.test.ts`, with an `offlineFirst` test asserting its
      `getTabs` reader resolves through `findSongBySongId`.
- [ ] ER10 — The offline capture passes a **song id**: `OfflineDownloadActions.getTabs` is
      typed `(songId: string) => Promise<SongFile[]>` and `src/hooks/useOfflinePlaylist.ts`
      calls it with `repertoire.song_id`, asserted by a test in
      `src/hooks/__tests__/useOfflinePlaylist.test.tsx` that a band-context download calls
      `getTabs` with the song id and never with a repertoire id.
- [ ] ER11 — `deleteTabAction` deletes the `song_files` row before the stored object: an
      action test asserts the row is gone and the envelope reports `{ success: true }` when
      the mocked `del` rejects and that the file's URL is then recorded in
      `abandoned_blobs`, and a second case asserts that when `del` resolves **no**
      `abandoned_blobs` row is written.
- [ ] ER12 — An upload in band context creates the uploader's own repertoire row with
      status `unknown`, asserted by an action test.
- [ ] ER13 — Authorization is preserved: a user cannot read or write another user's
      `song_files` row, asserted by `src/app/actions/__tests__/authzTabs.db.test.ts`
      rewritten around the `user_id` predicate and covering every exported action in
      `src/app/actions/tabs.ts`. Gated `RUN_DB_TESTS=1`; must be observed passing, not
      skipped.
- [ ] ER14 — `src/components/fastview/TabDestinationModal.tsx` no longer exists and no
      source file imports it.
- [ ] ER15 — `npm run test:coverage` exits 0 with all four thresholds met,
      `npm run lint:dead` exits 0, and `npm run build` exits 0. Because this command skips
      every `*.db.test.ts`, it does **not** on its own discharge ER2, ER3, ER4, ER8 or
      ER13; a separate `RUN_DB_TESTS=1` run covering those suites must also exit 0 with
      them reported as run.
- [ ] ER16 — `package.json`'s `version` is bumped following the `x.y.z-YYYYMMDDHHmm` rule.

## Out of Scope

- **Defect 3 — uploads are `access: 'public'`.** Authenticating the file itself needs a
  signed-URL or proxying route handler, a decision about the offline cache (which fetches
  `file_url` directly), and a re-upload of existing objects. Its own task; nothing here
  changes the access mode.
- **Defect 1's permanent fix — deleting files when the last version of a song leaves the
  repertoire**, with the confirmation that lists them by name
  (`docs/use-cases.md`, *Remove a song from the repertoire*). After this task
  `song_files` no longer cascades from `repertoire` at all, so the silent cascade-and-leak
  is structurally gone; the intended *deliberate* delete belongs with the owner tables and
  the remove flow, i.e. **RH-124**.
- **Sweeping blobs already orphaned**, including the ones this migration records. Needs a
  script with Blob credentials and a reader for `abandoned_blobs`; a separate task, named
  in the report.
- **Renaming the "tab" vocabulary to "file"** across modules, actions, hooks and
  components (§5).
- **Image uploads, EXIF rotation, metadata stripping and downscaling**
  (`docs/plans/repertoire-rework.md`, *Process uploaded images on the way in*). Files stay
  PDF-only here.
- **`user_songs` / `band_songs`**, `song_versions` keying, and the per-version question —
  `song_files` is keyed by song on purpose and stays so.

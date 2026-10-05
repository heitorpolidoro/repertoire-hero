# RH-121 — Rename global_songs to songs and drop contributor_id

Part 1 of 6 from the RH-105 split. Spec file is `docs/tasks/RH-122-spec.md` (board id + 1).

## Scope

One mechanical, behaviour-neutral rename plus one column drop, across SQL, TypeScript,
scripts and docs:

- the table `global_songs` becomes `songs`, carrying its primary key and its three
  indexes;
- the column `contributor_id` is dropped from that table and from every projection that
  reads it;
- the TypeScript vocabulary that named the old table loses the `GlobalSong` prefix:
  the `GlobalSong` type, `searchGlobalSongs`, the moderation lib functions, the
  Server Actions, the injected action keys and the edit payload type.

Nothing a user can see changes. No new table, no new column, no changed query result
other than the disappearance of a `contributor_id` key that no screen reads. That is
what makes this part reviewable on its own.

**Not covered:** `albums`, `song_versions`, the `repertoire` split into `user_songs` /
`band_songs`, the title/label split, `songs.lyrics`, the band-status trigger, the
`owners` supertype, and renaming the `global_song_edits` *table* (it is superseded
wholesale by `catalog_suggestions` in a later part — see Out of Scope).

## Approach

### Behavior

**The migration.** One new file under `migrations/`. Its four-digit prefix is **the next
number after the highest present in `migrations/` at implementation time** — expected
`0009`. Never skip a number: `src/lib/__tests__/migrationsSingleSource.test.ts` (the
RH-17 guardrail) enforces that the prefixes are unique and contiguous from `0001`, so a
gap fails the suite. The migration must:

1. `ALTER TABLE global_songs RENAME TO songs`.
2. Rename the primary key constraint and the three indexes to match the new table name
   (`global_songs_pkey`, `idx_global_songs_title`, `idx_global_songs_artist`,
   `uq_global_songs_title_album`). The partial-unique predicate on
   `(lower(title), lower(album))` is load-bearing and must survive byte-identical in
   behaviour — rename the index, do not drop and recreate it.
3. `ALTER TABLE songs DROP COLUMN contributor_id`. The `COMMENT ON COLUMN
   global_songs.contributor_id` goes with the column; the `links` comment follows the
   rename automatically and needs no restatement.

`global_song_edits.song_id`'s foreign key **re-points by itself** — Postgres tracks the
target by OID, not by name — so no `DROP CONSTRAINT`/`ADD CONSTRAINT` pair is needed and
none should be written. The constraint name (`global_song_edits_song_id_fkey`) names its
own table, not the catalog, so it stays.

`migrations/0001_initial_schema.sql` and `migrations/0006_add_system_admin_and_moderation.sql`
are **not** edited: migrations are an append-only ledger, and a fresh database must
reach the same final shape by replaying them in order.

**Ordering hazard to flag in the PR description.** Other unmerged specs (RH-96) also
plan a migration naming `global_songs`, and since contiguity forces every one of them to
claim the same next number, whichever lands second must be renumbered *and* rewritten
against `songs`. `scripts/migrate.mjs` applies pending files in lexicographic order, so
a migration that still names `global_songs` and sorts after this rename will run against
a table that no longer exists and fail on an already-migrated database. Say so explicitly
in the PR so the second author sees it.

**The column drop in application code.** `contributor_id` is written on insert
(`src/lib/songs.ts`, the catalog insert inside `addSongToRepertoire`) and projected in
two places (`SONG_JSON` in `src/lib/songs.ts`, the inline `json_build_object` in
`getPlaylistWithSongs` in `src/lib/playlists.ts`). All three go, together with the
`contributorId` local and the now-surplus bind parameter — renumber the insert's
placeholders. `GlobalSong` never declared the field, so no type changes follow from the
drop; the key was simply extra in the JSON.

**The offline snapshot.** `OFFLINE_SCHEMA_VERSION` must **not** be bumped.
`contributor_id` was never a declared snapshot field and `isSongSnapshot` does not
inspect the embedded song object, so an already-downloaded playlist stays valid. Bumping
would invalidate every user's downloaded playlist for a cosmetic change — the exact cost
the v1→v2 comment warns about.

**The TypeScript rename.** Carried through every reference, with no old name left
reachable (no aliases, no re-exports, no deprecated wrappers):

| Old | New |
|---|---|
| `GlobalSong` | `Song` |
| `searchGlobalSongs` / `searchGlobalSongsAction` | `searchSongs` / `searchSongsAction` |
| `GlobalSongEdit` | `SongEdit` |
| `GlobalSongEditPayload` / `parseGlobalSongEditPayload` | `SongEditPayload` / `parseSongEditPayload` |
| `submitGlobalSongEdit` / `getPendingGlobalSongEdits` / `reviewGlobalSongEdit` (+ their `*Action` wrappers) | `submitSongEdit` / `getPendingSongEdits` / `reviewSongEdit` (+ `*Action`) |
| injected action key `searchGlobalSongs` (`RepertoireDashboardActions`) | `searchSongs` |
| `GlobalSong*` row interfaces in `src/lib/dbRows.ts` | drop the prefix |

Because the `global_song_edits` *table* keeps its name this round, the SQL string
literals in `src/lib/moderation.ts` still say `global_song_edits`. Add one comment line
at the first of them recording that the table name is legacy and goes when the table
becomes `catalog_suggestions`, so the mismatch between `SongEdit` and
`global_song_edits` reads as a decision rather than an oversight.

**The complexity ratchet.** `src/lib/songs.ts` is exactly 505 lines and its override in
the `complexity-budget-overrides` block pins `max-lines` to 505. Dropping
`contributor_id` removes two lines, so the override must be lowered to the file's new
exact worst number — `complexityBudget.test.ts` fails both on a violation and on a
ceiling that is not exactly the current number. The ratchet may shrink, never grow, and
no new entry may be added.

### Files touched

- `migrations/NNNN_rename_global_songs_to_songs.sql` — new: the rename, the index and
  pkey renames, the column drop.
- `src/types/database.ts` — `GlobalSong` → `Song`, `GlobalSongEdit` → `SongEdit`, and the
  `song?:` fields that reference them.
- `src/lib/songs.ts` — table name in five embedded queries and the lookup/insert,
  `SONG_JSON` loses `contributor_id`, insert loses the column, local and parameter,
  `searchGlobalSongs` → `searchSongs`.
- `src/lib/playlists.ts` — table name in the joins, inline projection loses
  `contributor_id`.
- `src/lib/moderation.ts` — function renames, catalog table name in its joins, the
  legacy-table-name comment.
- `src/lib/globalSongEditPayload.ts` → `src/lib/songEditPayload.ts` — file and exported
  names renamed.
- `src/lib/dbRows.ts`, `src/lib/bands.ts`, `src/lib/spotifyPlaylistSync.ts`,
  `src/lib/songPicker.ts` — table name and type references.
- `src/app/actions/repertoire.ts`, `src/app/actions/moderation.ts` — action renames and
  the lib imports behind them.
- `src/app/songPickerActions.ts`, `src/app/page.tsx` — bundle wiring and the renamed
  injected key.
- `src/app/api/spotify/playlists/[id]/import/route.ts`,
  `src/app/api/spotify/playlists/[id]/sync/route.ts` — table name and type references.
- `src/app/admin/moderation/page.tsx`, `src/components/admin/*`,
  `src/components/songs/*`, `src/components/playlists/PlaylistSongIdentity.tsx`,
  `src/hooks/useSongPicker.ts` — type and prop renames only, no behaviour.
- `scripts/seed-catalog.sql`, `scripts/dev-seed`, `scripts/deduplicate-songs.mjs` — the
  table name they insert into / read from, and the header prose naming it.
- `e2e/songs-crud.spec.ts` and the eleven `__tests__` files that name the table or the
  old identifiers.
- `src/lib/__tests__/<new>.db.test.ts` — new: the information_schema assertions.
- `eslint.config.mjs` — the `src/lib/songs.ts` `max-lines` ceiling, lowered.
- `AGENTS.md` — the `Global Song (global_songs)` domain concept and its
  `contributor_id` sentence, the `src/lib/songs.ts` and `scripts/` descriptions, and the
  seed-catalogue mention in the legacy paragraph.
- `package.json` — version bump.

### Test criteria

- A new `*.db.test.ts` asserting, through `information_schema`, that `songs` exists,
  that `global_songs` does not, that `contributor_id` is absent from `songs`, and that
  the three renamed indexes exist on `songs`. It is a `.db.test.ts` because it needs a
  live Postgres and must skip visibly without `RUN_DB_TESTS`.
- Every existing test that names the old table or the old identifiers is updated in
  place — renames only, no assertion weakened, no test deleted. A deleted or `skip`-ped
  test is a failed review.
- `npm run db:migrate` against a fresh database exits 0.
- `npm run test:coverage` exits 0 with all four thresholds met; `npm run lint:dead`,
  `npm run lint:dup` and `npm run build` exit 0.

## Expected Results

- [ ] ER1 — `migrations/` gains exactly one new `.sql` file, numbered one above the
      previously highest prefix with no gap, and `src/lib/__tests__/migrationsSingleSource.test.ts`
      passes. That file renames `global_songs` to `songs` and renames its primary key and
      its three indexes (`idx_*_title`, `idx_*_artist`, `uq_*_title_album`, the last
      keeping its partial predicate) to match; `migrations/0001_initial_schema.sql` and
      `migrations/0006_add_system_admin_and_moderation.sql` are unchanged, and
      `npm run db:migrate` exits 0 against a fresh database.
- [ ] ER2 — The same migration drops `contributor_id` from the renamed table, and a new
      `*.db.test.ts` asserts through `information_schema` that `songs` exists, that
      `global_songs` does not, that `contributor_id` is absent from `songs`, and that
      the three renamed indexes are present.
- [ ] ER3 — `global_song_edits.song_id` still references the catalog table after the
      migration (verified by inserting an edit row for a `songs` id in the same
      `*.db.test.ts`, and by its FK rejecting an unknown id); the migration contains no
      `DROP CONSTRAINT`/`ADD CONSTRAINT` pair for it.
- [ ] ER4 — The identifier `global_songs` appears nowhere under `src/`, `e2e/`,
      `scripts/` or `docker/` (`migrations/` and `docs/` excluded by design: the
      migration must name the old table and the plan describes the table being renamed).
- [ ] ER5 — `contributor_id` and `contributorId` appear nowhere under `src/`, `e2e/` or
      `scripts/`, including `SONG_JSON` in `src/lib/songs.ts`, the inline projection in
      `getPlaylistWithSongs` in `src/lib/playlists.ts`, and the catalog insert in
      `src/lib/songs.ts` (whose bind placeholders are renumbered accordingly).
- [ ] ER6 — `GlobalSong` is renamed to `Song` in `src/types/database.ts` and
      `searchGlobalSongs` to `searchSongs` in `src/lib/songs.ts`, each exported only
      under the new name, with the renamed Server Action `searchSongsAction` and the
      renamed injected action key `searchSongs` on the dashboard actions object.
- [ ] ER7 — A case-insensitive grep for `globalsong` under `src/` and `e2e/` returns
      nothing: the moderation lib functions, their `*Action` wrappers, the `SongEdit`
      type, the `SongEditPayload` type and `parseSongEditPayload`, and the renamed file
      `src/lib/songEditPayload.ts` (plus its test) all carry the new vocabulary, with no
      alias, re-export or deprecated wrapper left behind.
- [ ] ER8 — `OFFLINE_SCHEMA_VERSION` is unchanged, the existing offline-snapshot tests
      pass, and no `contributor_id` key appears in a serialized snapshot payload.
- [ ] ER9 — The `src/lib/songs.ts` entry in the `complexity-budget-overrides` block has
      its `max-lines` ceiling lowered to the file's new exact line count, no entry is
      added to the block, and `src/lib/__tests__/complexityBudget.test.ts` passes.
- [ ] ER10 — `scripts/seed-catalog.sql`, `scripts/dev-seed` and
      `scripts/deduplicate-songs.mjs` name `songs`, insert no `contributor_id`, and
      `npm run seed` completes against a freshly migrated database.
- [ ] ER11 — `AGENTS.md` is updated: the domain concept reads `Song (songs)` with the
      `contributor_id` sentence removed, and the `src/lib/songs.ts`, `scripts/` and
      legacy-paragraph mentions of the old table name are corrected.
- [ ] ER12 — `npm run test:coverage` exits 0 with all four thresholds met, and
      `npm run lint:dead`, `npm run lint:dup` and `npm run build` each exit 0; no
      existing test is deleted or skipped to achieve this.
- [ ] ER13 — `package.json`'s version is bumped following the `x.y.z-YYYYMMDDHHmm` rule,
      above the highest version already in `git log`.

## Out of Scope

- **`albums`, `song_versions`, the `repertoire` split, the title/label split and
  `songs.lyrics`** — parts 2 onward of the RH-105 split. Nothing in this task may add a
  relation, a column or a parse rule.
- **Renaming the `global_song_edits` table.** The plan replaces it with
  `catalog_suggestions`, which is a different row shape (one row per proposed field, not
  a jsonb of several) and needs its own allowlist work. Renaming it to `song_edits` now
  would be churn the later part deletes, so the table keeps its name and only its
  TypeScript vocabulary moves.
- **The `owners` supertype** — explicitly set aside by the plan as a decision of its own.
- **Any user-visible change.** No copy, no layout, no landing-page entry: a rename is
  not a selling point.

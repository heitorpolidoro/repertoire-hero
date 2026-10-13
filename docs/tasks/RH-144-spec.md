# RH-144 — Decide which version an add holds when the song already exists

> **Renamed 2026-10-13** to match its task id. Older text below may describe a "board id + 1" filename rule: that was a mistake copied between specs, not a convention. A spec is always `docs/tasks/<task id>-spec.md`.


## Scope
`createAndAddSong` (`src/lib/ownerSongs.ts`) resolves the catalog song and upserts the caller's album and `song_versions` row, but `upsertAlbumAndVersion` (`src/lib/songVersions.ts`) already returns that version's id and `resolveCatalogSongForAdd` (`src/lib/songs.ts`) throws it away. The owner insert (`addRowSql`) then re-derives a version from the song id via the representative-version ordering, so the album the caller chose does not decide what they hold.

Rule this spec implements (operator decision: "hold both"):
1. The manual add holds **the version the call resolved** (the caller's album wins).
2. An owner **may hold several versions of the same song**. Adding a song already held under a different album writes an additional owner row; nothing is refused.
3. Re-adding the very same version keeps today's `Song already in your repertoire` refusal, and two concurrent identical adds yield one row.

`addSongToRepertoire(owner, songId)` (picker "add the representative version") is unchanged. Not covered: UI redesign, a version chooser in the picker, band/personal semantics changes, schema changes (`UNIQUE (user_id, version_id)` already permits this).

Multi-hold audit (why this is one PR, not a split):
- `getRepertoire` lists one entry per owner row (`entryFrom` joins on `version_id`), so two holds of one song render as two entries, each with its own `repertoireId`. Nothing to change.
- `getPersonalEntryForSong(songId, userId)` already picks a single row with `LATERAL ... ORDER BY representativeVersionOrder ... LIMIT 1`, so it stays deterministic with several holds (the representative held version wins). It is a "do I hold this song" probe (used by `ensureOwnEntry` in `tabs.ts`, `useSongEntry`, the offline snapshot), not a per-version read. Unchanged; a test pins the multi-hold behavior.
- `assertRepertoireAccess`, status/tag/key/lyrics updates and removal are keyed by the owner row id, so they act on exactly one hold. Unchanged.
- `oneOwnerPerWrite.db.test.ts` counts rows per `version_id` and asserts one write reaches one owner; it never creates a second hold of one song per owner, so it stays green unchanged. Multi-hold is orthogonal to "one owner per write".
- Known consequence: `addSongToRepertoire` on a song the owner holds only under a non-representative album inserts the representative version as a second hold rather than reporting "already held". This is pre-existing behavior and is accepted; changing it is a separate task.

## Approach
Behavior:
- `resolveCatalogSongForAdd` returns both the song id and the resolved version id.
- The owner insert for the manual add takes the version id directly instead of the representative subquery; `addSongToRepertoire` keeps the subquery form.
- No pre-insert check for other versions of the song. The single-statement `ON CONFLICT DO NOTHING` (RH-95 ER9) conflicts on `(owner, version_id)`, so only the identical version is "already in"; concurrency stays race-free.

Files touched:
- `src/lib/songs.ts`: `resolveCatalogSongForAdd` also returns the version id.
- `src/lib/ownerSongs.ts`: version-keyed insert for `createAndAddSong`.
- `src/lib/__tests__/` (DB tests): new cases next to `ownerSongs.db.test.ts` / `catalogRestructureIntegration.db.test.ts`; update unit mocks of `resolveCatalogSongForAdd` if its return shape changes.

Test criteria: the DB tests below, including `getRepertoire` listing both holds and `getPersonalEntryForSong` returning the representative held one; `oneOwnerPerWrite.db.test.ts` stays green unchanged.

## Expected Results
- [ ] A first `createAndAddSong` for an existing title+artist with a new album stores an owner row whose `version_id` is the version for that album, not the representative one (DB test).
- [ ] When the owner already holds another version of that song, `createAndAddSong` with a different album succeeds and the owner then has two rows for that song, one per version (DB test).
- [ ] After holding two versions, `getRepertoire` returns both entries and `getPersonalEntryForSong` returns exactly one (the representative held version) without error.
- [ ] Repeating the identical add (same title, artist, album) still rejects with `Song already in your repertoire` and leaves the row count unchanged.
- [ ] Two concurrent identical adds by one owner yield exactly one owner row.
- [ ] `addSongToRepertoire` still holds the representative version, and `oneOwnerPerWrite.db.test.ts` passes unchanged.
- [ ] `npm run lint`, typecheck and the unit and DB suites pass.

## Out of Scope
Changing `addSongToRepertoire` or the representative-version ordering; a version chooser in the picker; migrations.

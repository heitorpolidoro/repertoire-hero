# RH-146 — Let a musician set a song's tuning

## Scope
A musician can read and change the tuning of the song they have open in Fast View (`/songs/<versionId>/fast-view`), next to the key line in the "Song details" header. The write is the owner's override only; the shared `song_versions.tuning` is never touched.

Decisions (the justification's four open questions):
1. **Surface: Fast View only.** `SongForm` is not touched — it is dashboard-only, and a second write path doubles the surface for no reported need.
2. **Key stays read-only here** (operator question 1 asks whether to widen). `updateSongKey` keeps no caller; wiring the key is a separate task.
3. **Constrained input, free storage.** A preset list of common tunings plus a custom box; the column stays plain `text`, no migration, no enum (operator question 2 asks plain box vs presets).
4. **Override semantics.** Saving writes `user_songs.tuning` / `band_songs.tuning` for the addressed owner. Clearing (empty or whitespace input, or the Clear button) writes `null`, which sends resolution back to `song_versions.tuning` and no further (no `songs` fallback); it does not mean "no tuning".

Not covered: the key, `map` (RH-118), `SongForm`, filtering/grouping by tuning, queueing offline writes.

Mock: `docs/tasks/RH-146-mock.html` (both open questions, side by side).

## Approach
**Behavior.** The header shows `Tuning: <resolved value>` when one resolves, plus an Edit control when the page is writable; when nothing resolves and the page is writable, only the Edit control shows. Editing offers the presets and a custom box; Save trims the value and writes it; an empty result is written as `null`. On success the header updates at once and the page Toast reports it; on failure the Toast reports it and the shown value is unchanged. The control is disabled exactly where the status control is: offline, or when the owner holds no row at this version (`readOnly`). In band context the write requires band admin; a non-admin member gets the same read-only/Toast behaviour as the status write.

**Server.** A new `updateSongTuningAction(repertoireId, tuning, bandId)` in `src/app/actions/repertoire.ts` resolves its owner through `resolveWriteOwner` (never `resolveOwner`) and calls the existing `updateSongOverrides(owner, id, { tuning })`; no new `src/lib` function. `src/lib/ownerSongs.ts` is at exactly 400 lines (the `max-lines` cap), so the stale comment above `updateSongOverrides` (lines 205-210) is corrected in place, net zero lines: `tuning` is now written by the Fast View action and only `map` (RH-118) still has no entry point.

**Client.** Follows the Fast View composition-root rule: pure rules (preset list, trim/empty-to-null, display) in a new `src/lib/songTuning.ts`; a `useSongTuning` controller hook (same shape as `useSongStatus`: `entry`, `bandId`, injected `actions`, `onSaved`, `notify`); a presentational control under `src/components/fastview/` rendered by `SongIdentityHeader`; `useSongEntry` gains an `applyTuning` patch beside `applyStatus`; the action is injected via `src/app/fastViewEntryActions.ts` and the offline-first bundle, never imported by a hook or component. The page file only wires the hook. The snapshot's `tuning` key name does not change.

**Files touched.**
- `src/app/actions/repertoire.ts` — add `updateSongTuningAction`.
- `src/lib/ownerSongs.ts` — correct the stale docblock, net zero lines.
- `src/lib/songTuning.ts` (new) — presets, normalisation.
- `src/hooks/useSongTuning.ts` (new), `src/hooks/useSongEntry.ts` — controller and `applyTuning` patch.
- `src/components/fastview/SongIdentityHeader.tsx` and a new tuning control component — render and edit.
- `src/app/fastViewEntryActions.ts` (+ the offline-first bundle file) and the Fast View `page.tsx` — wiring only.
- `AGENTS.md` / `docs/use-cases.md` — one line recording where tuning is edited.

**Test criteria.** Unit tests for `songTuning.ts` (trim, empty to `null`, preset match); hook test for `useSongTuning` (write, patch, toast, failure, refused when `ownerRowId` is null); component test for the control (disabled when `readOnly`); an `authzRepertoire.db.test.ts` case that a non-admin band member's tuning write is refused and an admin's lands on `band_songs.tuning` leaving `song_versions.tuning` unchanged; a db test that saving `null` makes the resolved entry return the version's tuning. Existing guards (`actionDataAccessGuard`, `namingConventions`, `complexityBudget`, lint, `lint:dead`, `lint:dup`) stay green.

## Expected Results
- [ ] Saving a tuning in Fast View stores it on the addressed owner's row and the header shows it without a reload.
- [ ] `song_versions.tuning` is unchanged after any tuning save (db test).
- [ ] Saving an empty or whitespace tuning stores `null` and the resolved entry then returns the version's tuning.
- [ ] A non-admin band member's tuning write is rejected with `Access denied: band admin required`; an admin's succeeds (db test).
- [ ] The tuning control is disabled offline and when the owner holds no row at the version.
- [ ] `updateSongTuningAction` resolves via `resolveWriteOwner`, and `npm run lint`, `lint:dead` and the vitest suite pass with `ownerSongs.ts` at or under 400 lines.

## Out of Scope
Key editing, `map`, `SongForm`, tuning-based filtering, offline write queueing.

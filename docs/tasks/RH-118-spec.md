# RH-118 — Build the song map editor

> **Renamed 2026-10-13** to match its task id. Older text below may describe a "board id + 1" filename rule: that was a mistake copied between specs, not a convention. A spec is always `docs/tasks/<task id>-spec.md`.


Spec file is `docs/tasks/RH-118-spec.md` (board id + 1). Mock: `docs/tasks/RH-118-mock.html`.

## Scope
A musician can read, edit and reset a song's **map** — its structure (intro, verse, chorus, solo…) — in Fast View (`/songs/<versionId>/fast-view`), in a "Map" section beside Lyrics. The write goes to the addressed owner's row only (`user_songs.map` / `band_songs.map`); `song_versions.map` and `songs.map` are never written. Resolution already cascades `owner -> song_versions -> songs` (`ownerSongRows.ts`), so this task adds no second override mechanism and no migration.

Decisions:
1. **The shape is defined here.** `SongMap` in `src/types/database.ts` is deliberately unshaped and waits for this task. The stored jsonb is `{ "sections": [ { "name": string, "bars": number | null, "note": string | null } ] }`: ordered, read whole, written whole, never queried by part. Order is the array order; there is no id field.
2. **Validation lives in one pure module.** A parser turns any stored jsonb into that shape (or `null` when it does not match, so a foreign blob renders as "no map" and never crashes). A normaliser turns the draft into the value to save: names and notes trimmed, blank-named sections dropped, `bars` a positive integer or null, an empty list saved as `null`.
3. **Clearing is writing null.** "Use the original" writes `null`, which sends resolution up to the version/song map. It confirms first (use-cases: resetting a long field confirms). Saving an empty draft is the same write.
4. **Band context follows `updateSongTuningAction` (RH-146):** the write requires band admin and lands on `band_songs`; a non-admin member is refused. The "where does this go — the band's or yours" question from use-cases is not built here (see Out of Scope).
5. **Read-only where the other Fast View controls are:** offline, or when the owner holds no row at this version (`ownerRowId` null).

## Approach
**Behavior.** The Map section lists the resolved sections in order (name, bars when set, note when set). With no resolved map it shows an empty state; when writable it offers "Add map". Edit opens an editor with add, remove, rename, move up/down, bars and note per section; Save writes the normalised value, the section updates at once and a Toast reports it; on failure a Toast reports it and the shown map is unchanged. When the owner's own row holds a map, an override marker sits beside the heading and "Use the original" is offered (confirm, then write `null`). Cancel discards the draft.

**Server.** New `updateSongMapAction(repertoireId, map, bandId)` in `src/app/actions/repertoire.ts`: resolves the owner through `resolveWriteOwner` (never `resolveOwner`), re-validates the incoming value with the shared normaliser (a Server Action is a public endpoint), and calls the existing `updateSongOverrides(owner, id, { map })`. `ownerSongs.ts` is at its 400-line cap, so the stale docblock above `updateSongOverrides` (naming RH-118 as owner of `map`) is corrected in place, net zero lines; RH-146 edits the same docblock for tuning, so whichever lands second edits the remainder.

**Client.** Fast View composition-root rule: pure rules in `src/lib/songMap.ts`; a `useSongMap` controller hook (shape of `useSongStatus`: `entry`, `bandId`, injected `actions`, `onSaved`, `notify`, draft state); a presentational `SongMapSection` under `src/components/fastview/`; `useSongEntry` gains an `applyMap` patch; the action is injected through `src/app/fastViewEntryActions.ts` and the offline-first bundle, never imported by a hook or component; the page file only wires the hook. No lyrics code is modified.

**Files touched.**
- `src/types/database.ts` — `SongMap` gets the sections shape.
- `src/lib/songMap.ts` (new) — shape, parse, normalise, draft helpers.
- `src/app/actions/repertoire.ts` — `updateSongMapAction`.
- `src/lib/ownerSongs.ts` — stale docblock corrected, net zero lines.
- `src/hooks/useSongMap.ts` (new), `src/hooks/useSongEntry.ts` — controller and `applyMap`.
- `src/components/fastview/SongMapSection.tsx` (new) — read view, editor, reset confirm.
- `src/app/fastViewEntryActions.ts`, the offline-first actions bundle, Fast View `page.tsx` — wiring only.
- `AGENTS.md`, `docs/use-cases.md` — one line each recording the map shape and where it is edited.
- `package.json` — version bump.

**Test criteria.** Unit tests for `songMap.ts` (valid blob round-trips; foreign blob parses to null; blank names dropped; bars coerced or null; empty list becomes null). Hook test for `useSongMap` (save, patch, toast, failure, refused when `ownerRowId` is null, reset). Component test for the section (empty state, read view, editor add/remove/reorder, reset confirm, disabled when `readOnly`). DB tests alongside `authzRepertoire.db.test.ts`: a personal save lands on `user_songs.map` with `song_versions.map` unchanged; saving `null` makes the resolved entry return the version's map, else the song's; a non-admin band member's write is refused and an admin's lands on `band_songs.map`. An action test that an invalid payload is rejected. Existing guards (`actionDataAccessGuard`, `namingConventions`, `complexityBudget`, lint, `lint:dead`, `lint:dup`) stay green.

## Expected Results
- [ ] ER1 — Saving a map in Fast View stores `{sections:[…]}` on the addressed owner's `user_songs.map` only, leaving `song_versions.map` and `songs.map` unchanged (db test).
- [ ] ER2 — The Map section shows a saved map without a reload (hook test).
- [ ] ER3 — "Use the original" (after confirmation) or saving an empty draft stores `null`, and the resolved entry then returns the version's map, else the song's (db test).
- [ ] ER4 — A non-admin band member's map write is rejected with `Access denied: band admin required`, while an admin's lands on `band_songs.map` (db test).
- [ ] ER5 — `updateSongMapAction` rejects a payload that fails `src/lib/songMap.ts` validation (action test).
- [ ] ER6 — A stored blob not matching the sections shape parses to `null` and the Map section renders the empty state (unit and component tests).
- [ ] ER7 — The editor adds, removes, renames and reorders sections, and Cancel leaves the stored map unchanged (component test).
- [ ] ER8 — The map controls are disabled offline and when the owner holds no row at the version (component test).

## Out of Scope
- The band-context "where does this go — the band's or yours" prompt at save; map writes follow the page's owner like tuning. A follow-up can generalise the lyrics destination dialog to both fields.
- The comparison view behind the override marker (generalising the RH-83 switcher); the marker only offers "Use the original".
- Playback or auto-scroll driven by the map, bar-accurate chord charts, importing a map from tabs or Spotify analysis.
- Key and tuning editing, `SongForm`, offline write queueing, any migration.

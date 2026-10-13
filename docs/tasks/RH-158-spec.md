# RH-157 — Accept last_practiced in the edit-panel write path

Part 1 of the RH-114 split. Parent spec: `docs/tasks/RH-115-spec.md` ("Edit panel", "Write path"). File is RH-158 by the repo's id+1 filename offset.

## Scope
The edit panel (`SongForm`, edit mode) can assign `last_practiced` on the row being edited, forward or backward, or clear it. Covers the write path (`SongUpdateInput` -> `updateSongAction` -> `updateSong` -> `writeOwnerSongRow`) and the extracted field component.

Not covered: the set-today buttons, the bulk practice list, `recordPracticeAction`, any display of the date outside the field, create-mode (the field is edit-only).

## Approach

### Behavior
- `OwnerSongPatch` and `OWNER_SONG_COLUMNS` already admit `last_practiced`; no change expected there. The gap is `SongUpdateInput` (`src/lib/songs.ts`) and the patch `updateSong` builds (`src/lib/ownerSongs.ts`): add optional `last_practiced?: string | null`. Omitted key = column untouched (existing patch semantics); `null` = stored as SQL NULL; string = stored as timestamp.
- Validation runs in `updateSong` **before** `withTransaction` opens (so before any statement, catalog fill included). Accepted strings: `YYYY-MM-DD` (stored as that day 00:00 UTC) or a full ISO-8601 timestamp. Anything else, or an unparseable/impossible date (e.g. `2026-02-30`), throws a clear message and writes nothing. The parser is a small pure helper in `src/lib/ownerSongRows.ts` (or a new tiny lib module if that file would exceed budget), so it is unit-testable.
- `updateSongAction` stays thin: it already calls `resolveWriteOwner(bandId)`, so a band row requires band admin (`Access denied: band admin required` for a plain member) and the date lands in `band_songs` for a band admin, `user_songs` otherwise. No new auth path; the guard tests in `actionAuthorizationGuard.test.ts` / `actionSessionGuard.test.ts` must still pass.
- `SongForm`: widen `SongFormEditInput` with the same optional field; render a new `src/components/songs/LastPracticedField.tsx` (date input showing the resolved `last_practiced` as `YYYY-MM-DD` in UTC, plus a Clear control). `editPayload` includes `last_practiced` only when the draft differs from the loaded value (changed -> date string, or `null` if cleared). Drafts live in the existing form state with the smallest possible addition; all decision logic (diffing, formatting) sits in module-scope helpers or the new component so `SongForm` stays at its F20 ceiling (`complexity` 16, `max-lines-per-function` 375, `max-lines` 602 in `eslint.config.mjs`). Do not raise any pin or add an override entry; `complexityBudget.test.ts` must pass unchanged. If `max-lines` would be exceeded, move code out rather than raise the pin.
- Mock not warranted: one standard date input.

### Files touched
- `src/lib/songs.ts` — `SongUpdateInput` gains `last_practiced?: string | null`.
- `src/lib/ownerSongs.ts` — `updateSong` validates the date first and adds it to the owner patch only when the key is present.
- `src/lib/ownerSongRows.ts` — date-parse helper (only if budget allows; else new module).
- `src/app/actions/repertoire.ts` — no logic change expected; comment update if needed.
- `src/components/songs/SongForm.tsx` — `SongFormEditInput`, state, `editPayload`, renders the field.
- `src/components/songs/LastPracticedField.tsx` — new extracted field.

### Test criteria
- DB tests (`ownerSongs.db.test.ts` / `authzRepertoire.db.test.ts`): earlier-than-stored date stores the earlier date; `null` clears; omitted key leaves the stored date; invalid date throws and a spy/row check shows no statement ran (catalog and owner row unchanged); band member non-admin refused with `Access denied: band admin required` and row unchanged; band admin writes the date on the `band_songs` row.
- Unit tests for the parser (date-only -> 00:00 UTC, ISO timestamp, garbage, impossible date).
- `SongForm.test.tsx` / new `LastPracticedField` test: field shows the loaded date; unchanged save sends no `last_practiced`; edit sends the new string; Clear sends `null`.
- `npm run lint` clean with no ratchet change.

## Expected Results
- [ ] ER1 — Saving the edit-panel field with a date earlier than the stored value stores that earlier date.
- [ ] ER2 — Clearing the edit-panel field and saving stores `null`.
- [ ] ER3 — The panel edit on a band row by a non-admin is refused with `Access denied: band admin required`.
- [ ] ER4 — The panel edit on a band row by a band admin is accepted and stores the date on that `band_songs` row.
- [ ] ER5 — An unparseable or impossible date is refused with a thrown message before any statement runs, leaving all rows unchanged.
- [ ] ER6 — `npm run lint` and `complexityBudget.test.ts` pass with `SongForm`'s override pin and the override entry count unchanged.

## Out of Scope
Set-today buttons, bulk practice list, `recordPracticeAction`, offline snapshot shape, practice-session ordering.

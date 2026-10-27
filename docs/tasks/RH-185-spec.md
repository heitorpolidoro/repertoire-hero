# RH-185 — Pick a song's tuning from a half-step list with a Drop option

## Scope
RH-146's tuning editor offers seven word presets (`Standard`, `Half step down`, `Whole step down`, `Drop D`, `DADGAD`, `Open G`, `Open D`) plus a custom box. The operator finds the words hard to read and wants the tuning named by the note of the low E string, with the offset in tones beside it.

This task replaces the preset buttons with:
- **A list of 8 positions**, half a step apart, named by the 6th-string note with the offset in tones: `F (+0.5)`, `E`, `Eb (-0.5)`, `D (-1)`, `Db (-1.5)`, `C (-2)`, `B (-2.5)`, `Bb (-3)`.
- **A Drop checkbox**, labelled `Drop (6th string one more whole step down)`, that lowers only the 6th string one more whole step. A drop position is named by the dropped note, as players say it ("Drop D", "Drop Db"), but keeps the offset of the other five strings: `Drop Eb (+0.5)`, `Drop D`, `Drop Db (-0.5)`, `Drop C (-1)`, `Drop B (-1.5)`, `Drop Bb (-2)`, `Drop A (-2.5)`, `Drop Ab (-3)`.
- **The full 6-string tuning as reference** on every position, low to high: `E` reads `E A D G B E`, `Eb (-0.5)` reads `Eb Ab Db Gb Bb Eb`, `Db (-1.5)` reads `Db Gb B E Ab Db`, `Drop Db (-0.5)` reads `Db Ab Db Gb Bb Eb`.

The custom box, Save, Clear and Cancel stay, for DADGAD, open tunings and anything else the list does not model.

Decisions:
1. **List, not a stepper.** Eight positions fit on screen and save in one tap, like the RH-146 presets.
2. **Note names come from one fixed set of 12**: `C Db D Eb E F Gb G Ab A Bb B`. Every label and reference note is taken from it, so there is never a sharp, a `Cb` or an `Fb` (`B` reads `B E A D Gb B`; `Db (-1.5)` reads `Db Gb B E Ab Db`).
3. **Storage stays free `text`, in a canonical form**: the 6th-string note, optionally prefixed by `Drop ` (`E`, `Eb`, `Drop D`, `Drop Db`). There are exactly 16 canonical values. The offset suffix and the reference line are worked out on display and never stored. Anything else is a custom value and is shown exactly as stored.
4. **Labels everywhere a value is shown.** The header and the save toast show a canonical value as its label: saving `Eb` toasts "Tuning set to Eb (-0.5)". `E` and `Drop D` carry no suffix, so "Tuning set to Drop D" is unchanged.
5. **The custom box pre-fills only with a custom value.** Opening the editor on `DADGAD` puts `DADGAD` in the box; opening it on `Eb`, or on nothing, leaves the box empty. This replaces RH-146's pre-fill with any current value.
6. **Saves are unchanged**: owner override only (`user_songs.tuning` / `band_songs.tuning`), never `song_versions.tuning`, with the same auth and offline rules as RH-146. The operator confirmed on 2026-10-26 that the first tuning set on a song does not go to the global version.
7. **The one-off migration respells `song_versions.tuning` too.** "song_versions.tuning untouched" in the justification is about saves, and decision 6 keeps it. Migration 0030 renames the three legacy words in all three tuning columns, `song_versions` included. It changes the spelling and not the pitch, so the list can recognise the value. No app path writes `song_versions.tuning`: 0014 created it null, `songVersions.ts` leaves it null on new versions, and no seed sets it. In practice the version rows it touches are expected to be none.
8. **6 strings only.** String count (7-string guitar, 4/5-string bass) belongs to the instrument, not the song. It is out of scope and may come later as a user preference that only changes the reference line and the dropped string.

## Approach
**Pure rules (`src/lib/songTuning.ts`).** Replace `TUNING_PRESETS` and `isTuningPreset` with a model of the 8 offsets (half-steps +1 down to -6 relative to E standard) and functions that:
- build the canonical value from `(offset, drop)`;
- parse a stored value back into `(offset, drop)`, or report it as custom. Only an exact match of one of the 16 values counts: `e`, `Eb ` and `Half step down` are custom;
- render the label and the 6-string reference line.

Offsets in the label are in tones, with no trailing zero (`+0.5`, `-0.5`, `-1`, `-1.5`). `tuningSavedMessage` uses the label for a canonical value and the raw text otherwise. `normalizeTuning` and `withTuning` are unchanged.

**Display.**
- `SongTuningControl` shows the label for a canonical value and the raw text for a custom one.
- Its editor puts the Drop checkbox and the 8 positions in a new `TuningPositionList` component, which keeps `SongTuningControl` inside the `complexity` 15 budget without a new override.
- The checkbox starts checked when the current value is a drop tuning. Toggling it relabels the list and saves nothing.
- Each position is a button whose accessible name is exactly its label, with the reference line beside it. Tapping it saves its canonical value and closes the editor.
- The button matching the current value has `aria-pressed="true"`.
- The no-tuning state, read-only behaviour and Save/Clear/Cancel are unchanged.

**Migration.** A new `migrations/0030_canonical_tunings.sql` rewrites `user_songs.tuning`, `band_songs.tuning` and `song_versions.tuning`: `Standard` -> `E`, `Half step down` -> `Eb`, `Whole step down` -> `D`. Only exact matches change. `Drop D` is already canonical. Every other value is untouched and shows as custom: `DADGAD`, `Open G`, `Open D` and free text. Offline snapshots already on a device keep the old text until their next refresh and show it as custom meanwhile. Offline is read-only, so a stale snapshot never writes it back, and there is no snapshot version bump.

**Files touched.**
- `src/lib/songTuning.ts`: the offset model, parse/canonical, label, reference line and label-aware `tuningSavedMessage`. Removes `TUNING_PRESETS` and `isTuningPreset`.
- `src/components/fastview/TuningPositionList.tsx` (new): the Drop checkbox and the 8 position buttons with reference lines.
- `src/components/fastview/SongTuningControl.tsx`: label display, uses `TuningPositionList`, custom-only pre-fill.
- `migrations/0030_canonical_tunings.sql` (new).
- `src/lib/__tests__/songTuning.test.ts`: replaces the preset tests, which import the removed `TUNING_PRESETS`/`isTuningPreset`.
- `src/components/fastview/__tests__/SongTuningControl.test.tsx`: replaces "saves a preset in one tap", which clicks a `DADGAD` button that no longer exists, and adds the cases below.
- `src/lib/__tests__/canonicalTuningsMigration.db.test.ts` (new): replays 0030 with `migrationSqlBySuffix` over a throwaway schema, following `versionAlbumsMigration.db.test.ts`.
- `docs/use-cases.md` l.106–109: "offers preset buttons and a custom box" becomes the 8-position list with Drop and the custom box, stored as canonical text. The rest of the paragraph stays.
- `docs/behavior.md` "Repertoire and overrides": the two lines under Behavior changes, added after line 12.

`useSongTuning`, the server action, `ownerSongs.ts` and the offline snapshot code do not change.

**Test criteria.**
- **Unit (`songTuning.test.ts`).**
  - All 16 canonical values round-trip through parse and canonical.
  - Labels and reference lines are checked for `E`, `Eb`, `Db`, `Bb`, `F`, `B`, `Drop D`, `Drop Db`, `Drop Eb` and `Drop Ab`.
  - `DADGAD`, `Half step down`, `e` and `Eb ` (trailing space) parse as custom.
  - `tuningSavedMessage('Eb')` is "Tuning set to Eb (-0.5)", `('DADGAD')` is "Tuning set to DADGAD", and `(null)` is "Tuning cleared".
- **Component (`SongTuningControl.test.tsx`).**
  - 8 positions in order, each with its reference.
  - Drop starts checked on a drop value, and toggling it relabels without calling `save`.
  - A tap calls `save` with the canonical value.
  - The header shows the label for a canonical value and the raw text for a custom one.
  - The custom box pre-fills only for a custom value.
  - The existing read-only, Clear, Cancel and in-flight tests stay.
- **DB, `RUN_DB_TESTS=1`.**
  - The migration test maps the three legacy values in each of the three columns and leaves `Drop D`, `DADGAD` and `null` untouched.
  - The existing RH-146 guards stay green: `src/app/actions/__tests__/authzRepertoire.db.test.ts:418` (owner row written, `song_versions.tuning` left alone) and `src/hooks/__tests__/useSongTuning.test.tsx` (whitespace writes null).

## Behavior changes
- added: Repertoire and overrides — Fast View offers a song's tuning as 8 half-step positions named by the 6th-string note with the offset in tones (F (+0.5) to Bb (-3)), each with its 6-string reference, plus a Drop option that lowers only the 6th string one more whole step; anything else goes in the custom box. (src/components/fastview/TuningPositionList.tsx, src/lib/songTuning.ts) (RH-185)
- added: Repertoire and overrides — A tuning picked from the list is stored as canonical text ("Eb", "Drop Db"); its label with the offset and its reference line are worked out on display, and any other stored text is shown as written. (src/lib/songTuning.ts, src/components/fastview/SongTuningControl.tsx) (RH-185)

The line "Tuning is edited from Fast View and writes the addressed owner's override, never the version's tuning." stays as written. The save path does not change, and the files it cites all still exist. That line describes what a save writes. Migration 0030 is a one-off data respelling that keeps every pitch (decision 7), not a write path, so it does not contradict the line.

## Expected Results
- [ ] With Drop unchecked, the Fast View tuning editor lists exactly 8 positions in order (F (+0.5), E, Eb (-0.5), D (-1), Db (-1.5), C (-2), B (-2.5), Bb (-3)), each with its 6-string reference (E reads "E A D G B E", Eb reads "Eb Ab Db Gb Bb Eb").
- [ ] With Drop checked, the positions read Drop Eb (+0.5), Drop D, Drop Db (-0.5) ... Drop Ab (-3), and the reference lowers only the 6th string one more whole step (Drop Db (-0.5) reads "Db Ab Db Gb Bb Eb").
- [ ] Tapping a position, with no further click, saves its canonical text: Eb (-0.5) saves "Eb" and Drop Db (-0.5) saves "Drop Db".
- [ ] The header shows a stored canonical value as its label with the offset ("Eb" shows "Tuning: Eb (-0.5)") and shows any other value, such as "DADGAD", exactly as stored.
- [ ] Opening the editor pre-fills the custom box with a custom value ("DADGAD") and leaves it empty for a canonical one ("Eb").
- [ ] A save, including Clear storing null, writes only the addressed owner's override and leaves song_versions.tuning unchanged (src/app/actions/__tests__/authzRepertoire.db.test.ts).
- [ ] Migration 0030 rewrites Standard->E, Half step down->Eb and Whole step down->D in user_songs.tuning, band_songs.tuning and song_versions.tuning, and leaves Drop D, DADGAD and null unchanged (canonicalTuningsMigration.db.test.ts).
- [ ] npm run lint, lint:dead, lint:dup and the vitest suite with RUN_DB_TESTS=1 pass.

## Operator Results Coverage
- Operator ER 1 (8 positions in order with 6-string reference) -> Scope, Approach ("Pure rules", "Display"), Expected Result 1.
- Operator ER 2 (Drop positions and 6th-string reference) -> Scope, Approach ("Pure rules", "Display"), Expected Result 2.
- Operator ER 3 (One-tap save of canonical text and header label with offset) -> Scope (decisions 1, 3, 4), Approach ("Display"), Expected Results 3 and 4.
- Operator ER 4 (Non-canonical value shown as-is and editable in custom box; Clear writes null) -> Scope (decisions 3, 5), Approach ("Display"), Expected Results 4, 5 and 6.
- Operator ER 5 (Migration rewrites Standard->E, Half step down->Eb, Whole step down->D across the three tables) -> Scope (decision 7), Approach ("Migration"), Expected Result 7.
- Operator ER 6 (Tuning saves write only the addressed owner's override; song_versions.tuning unchanged) -> Scope (decision 6), Approach ("Test criteria"), Expected Result 6.
- Operator ER 7 (lint, lint:dead, lint:dup and vitest suite pass) -> Approach ("Test criteria"), Expected Result 8.

## Out of Scope
- String count, and 7-string and bass tunings.
- Writing `song_versions.tuning` from the app.
- Key editing.
- Tuning-based filtering.
- Sharps naming.
- Changing the no-tuning "Set tuning" state.

Mock: `docs/tasks/RH-185-mock.html`.

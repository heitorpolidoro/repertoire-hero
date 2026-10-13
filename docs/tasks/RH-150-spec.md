# RH-150 — Add a grouped card to the playlist picker

> **Renamed 2026-10-13** to match its task id. Older text below may describe a "board id + 1" filename rule: that was a mistake copied between specs, not a convention. A spec is always `docs/tasks/<task id>-spec.md`.


Spec file is `docs/tasks/RH-150-spec.md` (board id + 1). Mock: `docs/tasks/RH-150-mock.html`. Part 1 of the RH-112 split; child of RH-112. `blockedBy` RH-108 (landed, spec `docs/tasks/RH-108-spec.md`): `SongPicker.tsx` already maps `picker.results` (`SongSearchRow[]`, each with ordered `versions`) through `PickerRow`.

## Scope

Replace `PickerRow` in `src/components/playlists/SongPicker.tsx` with a new grouped card, one per merged row, inside the existing single `<ul aria-live="polite">`.

- **Collapsed:** shows the row's representative version (`versions[0]`, already the first by the RH-108 order) as today's thumbnail/title/artist/album-and-year layout, with one card-level `Add` that adds exactly that version. A control (chevron, `aria-expanded`) expands the card.
- **Expanded:** the card-level `Add` is gone. Every version in `row.versions` is listed, in the given order, each with its own `Add` that adds exactly that version. No version is badged, bolded, or otherwise marked above the others (no "default", "recommended" or "representative" mark), and nothing is filtered by `albumType`.
- **Version line:** leads with the album, then year, then duration, joined by ` · ` (`Bad · 1987 · 4:17`); the `label` is a subtitle beneath. Missing parts are omitted along with their separator; if all three are missing, the main line is absent and only the label subtitle (if any) shows. Duration is `m:ss` from `durationSeconds`.
- **No "In catalog" tag** anywhere.

Not covered: manual entry beside results, `RepertoireDashboard.tsx` (still on its own `SongResultItem`), ranking/indexing (RH-113), any change to the add/write paths, the landing page (internal UI, not a selling point), and the single-version collapse of the expander (a one-version row still expands; if the follow-up wants to hide the control, that is RH-112's later part).

## Approach

**Behavior**
- Per-version add reuses the existing `picker.addRow(row)` unchanged: the card calls it with `{ ...row, versions: [version] }`, so the hook's dispatch on `versions[0]` (catalog branch when `versionId` is non-null, Spotify branch otherwise) adds exactly that version. The collapsed `Add` passes the row as is. No change to `useSongPicker` or `songPicker.ts`.
- `adding` and `error` stay row-level (`picker.addingId === row.id`, `picker.rowErrors[row.id]`): while a row is adding, all of its `Add` buttons are disabled and the error shows once under the card.
- A version-less catalog row (`versions: []`, RH-108 §2a) renders collapsed with its card-level `Add` (which calls `addRow(row)` as today), shows the expander as absent, and never indexes `versions[0]`.
- Card markup keeps the `<li>` root and buttons named exactly `Add` (collapsed: one; expanded: one per version), so `e2e/offline-mode.spec.ts` (`ul[aria-live="polite"]` > listitem filtered by text > button `Add`, exact) still resolves in the collapsed state. Expanded version lines are rendered inside the same `<li>` (nested list is not a second `aria-live` list).
- Formatting helpers (version-line text, duration `m:ss`, year from the first four characters of `releaseDate`) live in a new pure module so `songSearchMerge.ts` (394/400 max-lines, no override) is not touched. No new complexity override and no raised ceiling; the override list stays at its current count.

**Files touched**
- `src/components/playlists/SongGroupCard.tsx` — new: the card (collapsed/expanded state, expander, card-level and per-version `Add`).
- `src/components/playlists/SongVersionLine.tsx` — new (or inlined if small): one expanded version line with its own `Add`.
- `src/lib/songVersionLine.ts` — new, pure and client-safe: `versionLineText(candidate)`, `formatDuration(seconds)`, year extraction; imports types only.
- `src/components/playlists/SongPicker.tsx` — renders `SongGroupCard` instead of `PickerRow`; local `rowYear` helper removed; empty/prompt/searching states unchanged.
- `src/components/playlists/PickerRow.tsx` — deleted if no other importer remains (check with `lint:dead`); otherwise left untouched.
- `src/components/playlists/__tests__/SongGroupCard.test.tsx` — new named component test.
- `src/components/playlists/__tests__/SongPicker.test.tsx` — re-pointed at the card (still one `listitem` and one `Add` for one merged row).
- `src/lib/__tests__/songVersionLine.test.ts` — new unit cases for the line format.
- `package.json` — version bump (AGENTS.md rule).

**Test criteria**
- `SongGroupCard.test.tsx`: collapsed card shows `versions[0]`'s album/year and one `Add`; clicking it calls `onAdd` with a row whose `versions` is exactly `[versions[0]]`; clicking the expander removes the card-level `Add` and shows one `Add` per version (3 versions give 3); clicking the second version's `Add` calls `onAdd` with exactly that version; a `single`-type version is listed; no element contains the text `In catalog`; no version line differs in class or marker from its siblings; line text equals `Bad · 1987 · 4:17` with the label in a separate subtitle element.
- `songVersionLine.test.ts`: full, album-only, no-year, no-duration and `YYYY` / `YYYY-MM` release dates; `257` seconds gives `4:17`, `61` gives `1:01`.
- `SongPicker.test.tsx` and `e2e/offline-mode.spec.ts` locator still resolve; `complexityBudget`, `lint:dead`, `lint:dup`, `test:coverage` and `build` pass.

## Expected Results
- [ ] A collapsed `SongGroupCard` shows the row's representative version, and clicking its `Add` calls the add with exactly that version.
- [ ] Expanding the card removes the card-level `Add` and lists every version of the row.
- [ ] Each listed version has its own `Add` that adds exactly that version.
- [ ] No version is marked or styled above the others, and a `single`-type version is listed.
- [ ] A version line reads `Bad · 1987 · 4:17` with the label as a subtitle.
- [ ] `SongPicker.tsx` renders the card instead of `PickerRow`, and the e2e locator still resolves its `Add` button.
- [ ] The text `In catalog` appears nowhere under `src/components/`.
- [ ] `SongGroupCard.test.tsx` covering collapsed Add, expanded per-version Add and the line format passes.

## Out of Scope
RH-112's later parts (manual entry alongside results, `RepertoireDashboard.tsx` adopting the card), RH-113, any hook, merge or write-path change, any migration, any new complexity override.

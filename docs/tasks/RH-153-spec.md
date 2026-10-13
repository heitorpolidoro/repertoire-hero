# RH-153 — Split SongForm into catalog and repertoire sections

Part 4 of the RH-112 split, child of RH-112. RH-152 (landed) left `SongForm` and the `+` FAB untouched; this task reshapes the form's layout only. Mock: `docs/tasks/RH-153-mock.html`.

## Scope

`SongForm` (add and edit) groups its fields into two labelled sections:
- **Shared catalog** — Title, Artist, Album, Duration, Cover URL and Links (the `songs` / `song_links` data, rendered through `SharedCatalogField`, `LockedLinksList`, `SongLinksEditor`).
- **My repertoire** — Key (with the catalog key shown beside it, as today), Status, Tags and Last practiced (the owner's own `repertoire` data).

The catalog section carries one visible sentence stating the rule: a catalog field can be filled only while empty, an existing value is never overwritten, and a wrong value is changed through "Suggest a correction". The existing per-field messages and populated-field read-only rendering stay.

The fill-empty-only behaviour is already enforced by `updateSong` and surfaced by `SharedCatalogField` (RH-97); this task makes it visible at section level and pins it with tests. No change to what is written or to any action signature.

Not covered: the manual-entry panel (RH-152), the correction modal, `SharedCatalogField` semantics, server actions, migrations, the FAB.

## Approach

**Behavior**
- Two groups, each with a heading (accessible names "Shared catalog" and "My repertoire"), in that order, in both create and edit mode. Footer, error alert, refusal notice and toast stay outside the sections.
- Every shared field renders only inside the catalog group; Key, Status, Tags and Last practiced only inside the my-repertoire group. Existing ids, labels, radio group and `aria-label`s are kept so current queries keep working.
- Hint text in the catalog group, e.g. "Shared with everyone. An empty field can be filled in; a field that already has a value is never overwritten — use Suggest a correction." Final wording is the developer's, but it must convey both "empty can be filled" and "never overwritten".
- Saving is unchanged. In edit mode a filled catalog field has no input, so the submitted value equals the stored one; an empty catalog field typed into is sent and filled.
- `SongForm` sits at its F20 pin (`eslint.config.mjs` override: complexity 16, max-lines-per-function 362, max-lines 591). Extract the two groups as new components (e.g. `SongFormCatalogSection.tsx`, `SongFormRepertoireSection.tsx` in `src/components/songs/`) and lower the pins to the new measured values; pins may not rise. Update the `complexityBudget` test if it mirrors these numbers.

**Files touched**
- `src/components/songs/SongForm.tsx` — composes the two sections.
- `src/components/songs/SongFormCatalogSection.tsx`, `SongFormRepertoireSection.tsx` — new.
- `src/components/songs/__tests__/SongForm.test.tsx` — new named tests; existing ones keep passing.
- `eslint.config.mjs` (and the `complexityBudget` test if needed) — pin lowered.
- `docs/use-cases.md` if it describes the song form; `package.json` version bump.

**Test criteria** (named tests in `SongForm.test.tsx`)
- `renders a shared catalog section and a my repertoire section`: both groups found by name, in create and edit mode.
- `keeps catalog fields in the catalog section and personal fields in the repertoire section`: use `within` for Title/Artist/Album/Duration/Cover/Links vs Key/Status/Tags/Last practiced.
- `states that a catalog field is filled only when empty and never overwritten`: hint present in the catalog section.
- `keeps a filled catalog value unchanged on save`: edit a song whose catalog has title and artist; no input for them, `updateSong` receives the stored values.
- `fills an empty catalog field on save`: catalog row with blank album; typed album reaches `updateSong`.
- If no db-level test already proves `updateSong` refuses to overwrite a filled column and fills a blank one, add one following `*.db.test.ts`; otherwise cite the existing one in the PR.
- Existing `SongForm.test.tsx`, `complexityBudget`, `lint`, `lint:dead`, `lint:dup`, `test:coverage`, `build` pass.

## Expected Results
- [ ] `SongForm` renders a "Shared catalog" group and a "My repertoire" group, in create and edit mode.
- [ ] Title, Artist, Album, Duration, Cover URL and Links are inside the catalog group only; Key, Status, Tags and Last practiced inside the repertoire group only.
- [ ] The catalog group displays text saying an empty field is filled in and an existing value is never overwritten.
- [ ] Saving an edit with a filled catalog field leaves the stored value unchanged, and saving a typed value into an empty catalog field fills it.
- [ ] Named tests for both sections, the placement and the fill-empty-only behaviour pass together with the existing `SongForm` tests.
- [ ] `npm run lint`, `lint:dup`, `lint:dead` and `build` pass and the `SongForm` complexity pin does not rise.

## Out of Scope
Manual-entry panel, correction modal changes, server actions, migrations, FAB behaviour.

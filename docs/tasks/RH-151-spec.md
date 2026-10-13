# RH-151 — Move the dashboard onto the grouped card

> **Renamed 2026-10-13** to match its task id. Older text below may describe a "board id + 1" filename rule: that was a mistake copied between specs, not a convention. A spec is always `docs/tasks/<task id>-spec.md`.


Spec file is `docs/tasks/RH-152-spec.md` (board id + 1; `RH-150-spec.md` is RH-150's). Part 2 of the RH-112 split, child of RH-112. Builds on RH-150 (landed): `SongGroupCard`, `SongVersionLine`, `src/lib/songVersionLine.ts`, and RH-108's `mergeSongSearchResults` / `withoutHeldVersions`.

## Scope

The "Add to your repertoire" section of `src/components/songs/RepertoireDashboard.tsx` renders `SongGroupCard`s fed by merged `SongSearchRow[]`, exactly as `SongPicker` does, instead of `SongResultItem` rows fed by two lists.

Removed from the dashboard: the inline raw-title dedup (`repertoireKeys`, `visibleCatalogResults`, `catalogKeys`, `visibleSpotifyResults`), the split state (`catalogResults`, `spotifyResults`, `addingCatalogId`, `addingId`, `catalogRowErrors`, `spotifyRowErrors`), `handleAddFromCatalog` / `handleAddFromSpotify`, and the `SongResultItem` import. `src/components/songs/SongResultItem.tsx` is deleted (its only importer is the dashboard; confirm with `lint:dead`).

Not covered: manual entry beside results, ranking (RH-113), the repertoire list itself (its markup, status notes, edit/delete, Fast View link), the playlist picker, band-context adds (the dashboard's add path passes no `bandId` today and keeps doing so), and the landing page (internal UI, not a selling point).

## Approach

**Behavior**
- Search keeps today's trigger: the store's `searchQuery`, 500 ms debounce, two-character minimum, catalog (`actions.searchSongs`, already `CatalogSearchResult[]`) and Spotify in parallel, each half failing to `[]`, stale responses discarded. Both halves go through one `mergeSongSearchResults`.
- Held filtering: rows are passed through `withoutHeldVersions` with the set of `version_id`s in the user's repertoire (`allSongs`). A row is also hidden when its song (`songIdentityKey` of title/artist) is already held and none of its remaining candidates is a catalog version (`versionId` non-null) — so the old "song already in repertoire is not offered again" behaviour survives for Spotify-only leftovers, while an unheld other version of a held song is now offered.
- The section shows when the query has two or more characters and (a search is loading or at least one row remains), unchanged. The `Searching Spotify...` spinner `<li>` stays while loading; the list stays a single `<ul aria-live="polite">`; the "Add to your repertoire" divider stays.
- Add from a collapsed card adds the row's `versions[0]`; add from an expanded version adds exactly that version (the card already calls `onAdd` with `{ ...row, versions: [version] }`). Dispatch is on the candidate: a catalog candidate (`versionId` non-null) is added **by version id**; a Spotify candidate goes through `actions.createAndAddSong` with the raw title, album, cover and `Spotify` link as `useSongPicker` does; a version-less catalog row (`versions: []`, `songId` set) falls back to `actions.addSong(songId)`. After a successful add the dashboard calls `loadSongs()`, so the added version leaves the results.
- **Adding a catalog version by id needs a new write path.** `addSongAction(songId)` always inserts the song's *representative* version (`representativeVersionSubquery`), so it cannot add a chosen non-representative version. Add `addVersionToRepertoire(owner, versionId)` beside `addSongToRepertoire` in `src/lib/ownerSongs.ts` (same transaction, owner scoping, born-`unknown` status, same entry shape; a missing version id throws), a thin `addVersionAction(versionId, bandId?)` in `src/app/actions/repertoire.ts` mirroring `addSongAction` (including `revalidatePath('/')`), and inject it as `actions.addVersion` through `RepertoireDashboardActions` and the composition root `src/app/page.tsx`. Existing `addSong` stays for the version-less case. If `ownerSongs.ts` would pass its line cap, put the function in a sibling module — no new override.
- Row-level `adding` / `error`, keyed by `SongSearchRow.id`: all of a row's `Add` buttons are disabled while it adds; a failure shows once under the row and is cleared on retry; errors clear when a new search starts. A Spotify add that fails with `already in your repertoire` shows `Already in your repertoire.` (today's text).
- The search, merge, held filter and add command move out of the component into a new hook so the dashboard function shrinks; the dashboard keeps only layout and the list. Where the hook would duplicate `useSongPicker`'s Spotify-create-with-recovery logic, extract the shared part to a lib module used by both rather than copy it (`lint:dup` must pass); do not change `useSongPicker`'s behaviour.
- `ratchet`: in `eslint.config.mjs` the `RepertoireDashboard.tsx` override (currently complexity 17, max-lines-per-function 538, max-lines 594) is lowered on **all three** values to the file's new measured worst numbers (pin equals worst, per the clause-(e) comment); its comment is updated. No new override is added for any new file.

**Files touched**
- `src/components/songs/RepertoireDashboard.tsx` — renders `SongGroupCard` from the hook's rows; split state, dedup memos, `handleAddFrom*`, search effect and `SongResultItem` removed; new `addVersion` action in its props.
- `src/components/songs/SongResultItem.tsx` — deleted.
- `src/hooks/useRepertoireSearch.ts` — new: debounce + merge + held filter + `addRow` + `addingId` / `rowErrors`.
- `src/lib/ownerSongs.ts` (or sibling), `src/app/actions/repertoire.ts` — `addVersionToRepertoire` / `addVersionAction`.
- `src/app/page.tsx` — injects `addVersion`.
- `src/lib/` — a pure helper for the repertoire-aware filter and, if needed, the shared Spotify-create helper.
- `eslint.config.mjs` — the lowered override.
- Tests: `src/components/songs/__tests__/repertoireDashboardSearch.test.tsx` (new), a unit test for the filter helper, a db test for `addVersionToRepertoire` following the repo's `*.db.test.ts` pattern; `repertoireDashboard.test.tsx` and `repertoireDashboardOutcomeBanner.test.tsx` updated only for the new required action.
- `docs/use-cases.md` — if it describes the dashboard's add flow, note one card per song with per-version add. `package.json` — version bump (AGENTS.md rule).

**Test criteria**
- `repertoireDashboardSearch.test.tsx` (named, e.g. `adds the picked version from a grouped card`): with a catalog row of two versions plus a Spotify track for the same song, the dashboard shows one card and no `SongResultItem`; collapsed `Add` calls `addVersion` with `versions[0].versionId`; after expanding, the second version's `Add` calls `addVersion` with that second id and nothing else; a Spotify-only candidate calls `createAndAddSong` with the raw title; a version-less row calls `addSong(songId)`; an add failure shows under the card only; a held version is absent from the results.
- Filter helper unit cases: held catalog version dropped, unheld sibling kept, Spotify-only leftover of a held song dropped, version-less row kept.
- Db test: `addVersionToRepertoire` adds exactly the named, non-representative version, is scoped to the owner, and rejects an unknown id.
- A grep-style assertion (or lint) that `RepertoireDashboard.tsx` contains none of `catalogResults`, `spotifyResults`, `handleAddFrom`, `SongResultItem`.
- Existing dashboard tests and e2e specs pass; `complexityBudget`, `lint`, `lint:dead`, `lint:dup`, `test:coverage` and `build` pass.

## Expected Results
- [ ] `RepertoireDashboard.tsx` renders search results as `SongGroupCard`s fed by merged rows, one card per song.
- [ ] `RepertoireDashboard.tsx` contains none of the raw-title dedup, `catalogResults`, `spotifyResults`, `handleAddFrom*` or `SongResultItem`, and `SongResultItem.tsx` no longer exists.
- [ ] A named test shows `Add` on a collapsed card adds `versions[0]`, and `Add` on an expanded version adds exactly that version, including a non-representative one.
- [ ] `addVersionToRepertoire` adds exactly the named version to the owner's repertoire (db test).
- [ ] A version already in the repertoire is absent from the results, while an unheld sibling version of the same song is still offered.
- [ ] The ESLint override for `RepertoireDashboard.tsx` has strictly lower complexity, `max-lines-per-function` and `max-lines` than 17 / 538 / 594, and `npm run lint` passes.
- [ ] The existing dashboard tests and e2e specs pass.

## Out of Scope
Manual entry beside results, RH-113 ranking, band-context adds from the dashboard, changing the playlist picker (see report: its non-representative catalog add has the same representative-version limitation), any migration, any new complexity override.

# RH-152 — Show manual entry beside results with a reduced form

Part 3 of the RH-112 split, child of RH-112. Builds on RH-151 (landed): the dashboard renders `SongGroupCard`s from `useRepertoireSearch`. Mock: `docs/tasks/RH-152-mock.html`.

## Scope

On the dashboard, the "Add to your repertoire" section also hosts a manual-entry panel that is present whenever the section is (query of two or more characters), whether the result list is empty or not. The panel is a reduced form: Title, Artist, Album and Status are visible; Key, Duration, Cover and Links sit behind a disclosure that starts closed. Title is pre-filled from the search query. When the submitted title and artist already identify a catalog song, the panel asks whether to add a new version of it instead of adding silently.

Today the only manual path is the `+` FAB opening `SongForm`. The FAB and `SongForm` (also used for edit) stay unchanged.

Not covered: changes to `SongForm`, ranking, band-context adds (the dashboard passes no `bandId`), the picker, any migration, a new write path (accepting reuses `actions.createAndAddSong`).

## Approach

**Behavior**
- The add section shows when the query has two or more characters, even with zero results and no search loading (today it hides then). With zero results the list area shows a short "No matches" hint beside/above the panel; the Spotify spinner, `aria-live` list and divider keep working.
- Panel fields: Title (required), Artist (required), Album, Status (default as `SongForm`'s add default). A disclosure button ("More details") toggles Key, Duration (m:ss, parsed with the existing `parseDurationInput`), Cover URL and Links; closed fields are not rendered, and their values are kept while toggled.
- Submit validates title and artist non-blank, then asks a new read-only action whether the identity already exists in the catalog (`songIdentityOf` normalisation, the same one `resolveOrCreateSongIdentity` uses). No match: call `actions.createAndAddSong` with the entered values and refresh via `loadSongs()`, then reset the form. Match: nothing is written; an inline offer names the existing song and shows `Add as new version` and `Cancel`. Accept calls `createAndAddSong` with the same input (it attaches a new version to the existing song through `resolveCatalogSongForAdd`); Cancel closes the offer, writes nothing and keeps the typed values. A failure (including `already in your repertoire`) shows inline once under the panel.
- The lookup is a read action `findCatalogSongAction(title, artist)` in `src/app/actions/`, backed by a read-only identity lookup in `src/lib/songIdentity.ts` (no insert), injected as `actions.findCatalogSong` through `RepertoireDashboardActions` and `src/app/page.tsx`.
- Status of the new entry: the chosen status is applied after the add through the existing status path if `createAndAddSong` does not take it; the developer verifies and reuses what `SongForm` does.
- Layout: option A in the mock (side by side from `md` up, stacked on mobile). Open question to the operator is A vs B (below the results); the spec follows A.
- Logic lives in a new component `src/components/songs/ManualEntryPanel.tsx` and hook `src/hooks/useManualEntry.ts`; the dashboard only mounts the panel. Complexity pins in `eslint.config.mjs` for `RepertoireDashboard.tsx` must not rise; no new override.

**Files touched**
- `src/components/songs/RepertoireDashboard.tsx` — section visibility rule; mounts the panel beside the list.
- `src/components/songs/ManualEntryPanel.tsx`, `src/hooks/useManualEntry.ts` — new.
- `src/lib/songIdentity.ts` (or sibling), `src/app/actions/` (catalog lookup action), `src/app/page.tsx` — read-only lookup and its injection.
- `src/components/songs/__tests__/manualEntryPanel.test.tsx` (new), `repertoireDashboardSearch.test.tsx` and the other dashboard tests updated for the new required action; a db test for the lookup following `*.db.test.ts`.
- `docs/use-cases.md` — note the manual add flow if the dashboard's add is described; `package.json` version bump.

**Test criteria** (named component tests)
- `renders manual entry beside results and with no results`: panel present with two results and with zero results.
- `hides key, duration, cover and links until the disclosure opens`.
- `offers a new version when title and artist exist`: no write on submit; accept calls `createAndAddSong` once; decline calls nothing.
- `creates a manual song with title, artist, album and status` for an unknown identity.
- Db test: lookup finds an existing song regardless of case/accents per `songIdentityOf`, and returns null otherwise without inserting.
- `complexityBudget`, `lint`, `lint:dead`, `lint:dup`, `test:coverage`, `build` pass.

## Expected Results
- [ ] The manual entry panel is rendered in the dashboard add section both with search results and with an empty result list.
- [ ] The panel shows Title, Artist, Album and Status by default, and Key, Duration, Cover and Links only after the disclosure is opened.
- [ ] Submitting a title and artist that already exist shows an add-as-new-version offer and performs no write until it is accepted.
- [ ] Accepting the offer calls `createAndAddSong` once for the existing song's new version; declining it calls no write action.
- [ ] A new artist and title creates the song with the entered title, artist, album and status.
- [ ] Named component tests for the always-present entry, the disclosure and the duplicate offer pass.
- [ ] `npm run lint`, `lint:dup`, `lint:dead` and `build` pass without raising any complexity pin.

## Out of Scope
Changes to `SongForm` or the FAB, ranking (RH-113), band-context adds, new write paths, migrations.

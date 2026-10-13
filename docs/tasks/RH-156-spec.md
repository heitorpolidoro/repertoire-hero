# RH-156 — Build the /admin/catalog screen with merge, split and delete flows

## Scope
Part 3 of RH-117. The screen that consumes the RH-154/RH-155 data layer: a system-admin-only Server Component page at `/admin/catalog`, one client island, a nav entry for system admins, tests and a mock (`docs/tasks/RH-156-mock.html`). No new lib SQL, no new Server Action, no change to `catalogAdmin.ts` semantics, no standalone song delete, no editing of song metadata beyond the split target's artist/title, no `song_files` UI.

## Approach
Behavior:
- **Page** (`/admin/catalog`, async Server Component, pattern of `/admin/moderation`): `getSession()`, `redirect("/login")` when signed out; then `checkSystemAdmin(userId)`; a non-admin gets the same "Access Denied" panel as moderation (HTTP 200, no catalog data read). For an admin it reads the optional `?q=` search param and, when non-empty, `searchSongs(q)` (up to 20 songs, each with its `versions` list and ids already in representative order). Empty `q` renders the search box and an empty-state hint. It injects `CATALOG_ADMIN_ACTIONS` into the island.
- **Search**: the island's search box navigates to `/admin/catalog?q=...` (router.push), so results are server-rendered and a refresh after a mutation is `router.refresh()`.
- **Blast radius**: opening a song card loads, for each of its versions, `getBlastRadius({ versionId })` through the injected action (parallel, per-version loading/error state), and shows `N repertoires · M playlists` on each version row. Song-level counts (`{ songId }`) are fetched only when a song-merge confirmation opens.
- **Flows**, each ending in a `ConfirmPanel` (tone `danger`) whose message names the counts, rendered before any mutating action is called; Cancel/Escape calls nothing:
  - *Merge versions*: "Merge into..." on a version row, then pick a target among the other versions of the same song. Message names source and target labels and the source's repertoire/playlist counts, and states that where the target is already held its row wins and the source's row is discarded. Confirm calls `mergeSongVersions(fromId, intoId)`.
  - *Split*: tick one or more versions (never all: the button stays disabled when every version is ticked, with a hint pointing to merge), choose "new song" (artist and title inputs, prefilled from the source) or "existing song" (another song from the current results), then confirm. Message names the number of versions and the summed repertoire/playlist counts of the ticked versions (an owner holding two ticked versions counts twice; the message says "up to"). Confirm calls `splitSongVersions(sourceSongId, versionIds, target)`.
  - *Merge songs*: "Merge song into..." then pick another song from the results. Message uses the song-level radius of the source (fetched when the panel opens; the panel shows a loading line and Confirm stays disabled until it arrives). Confirm calls `mergeSongs(fromId, intoId)`.
  - *Delete version*: the Delete button is enabled only when the version's loaded radius is exactly 0 repertoires and 0 playlists; while loading, errored or non-zero it is disabled with a title saying why. The panel states "0 repertoires and 0 playlists reference this version". Confirm calls `deleteSongVersion(versionId)`; the server's own refusal (e.g. a pending suggestion targets it) is shown in the banner.
- After a successful action the island clears its flow state, shows a Toast, and calls `router.refresh()` so the list re-renders from the server. A rejected action keeps the list as is and shows the message in an `AlertBanner`; the busy state disables all buttons during a call.
- **Pure decisions** go to `src/lib/catalogAdminPlan.ts` (client-safe, no `@/lib/db`): `canDeleteVersion(radius)`, `canSplit(chosen, total)`, and the four confirmation-message builders (counts, pluralisation, "up to" wording). Unit-tested without a DOM.
- **Nav**: `AppShell` reads `is_system_admin` from `getProfileAction()` (already returns `profiles.*`) once the session exists and passes `isSystemAdmin` through `ConditionalLayout` to `AppLayout`, which appends `{ label: 'Catalog', href: '/admin/catalog' }` to the desktop sidebar and the mobile bar only when true. Absent for non-admins and while the profile has not loaded. The nav is cosmetic: the page gates itself.
- **Proxy**: the existing `'/admin/(.*)'` entry already matches `/admin/catalog`, so `src/proxy.ts` is not edited and the "exactly twelve matcher entries" assertion stays true; the proof is a new path in the `proxy.test.ts` allow-list test.

Files touched:
- `src/app/admin/catalog/page.tsx` (new): gate, search read, action injection.
- `src/app/catalogAdminActions.ts` (new): `CATALOG_ADMIN_ACTIONS: CatalogAdminActions` bundling the five RH-154/155 actions.
- `src/components/admin/CatalogAdmin.tsx` (new): island (search box, song cards, flow state); extract `CatalogSongCard.tsx` and `CatalogVersionRow.tsx` if a file nears the 400-line budget. Exports the `CatalogAdminActions` prop type.
- `src/lib/catalogAdminPlan.ts` (new): pure helpers above.
- `src/app/AppShell.tsx`, `src/components/layout/ConditionalLayout.tsx`, `src/components/layout/AppLayout.tsx`: `isSystemAdmin` plumbing and the conditional nav entry.
- `src/lib/__tests__/proxy.test.ts`: add `/admin/catalog` to the private-route list.
- `src/lib/__tests__/catalogAdminPlan.test.ts`, `src/components/admin/__tests__/CatalogAdmin.test.tsx`, `src/components/layout/__tests__/AppLayout.test.tsx` (extend): tests below.
- `AGENTS.md`: add `/admin/catalog` to the Server Component page list and `components/admin` line.
- `docs/tasks/RH-156-mock.html`: the mock.

Test criteria:
- Page: a test of the page function with mocked session/`checkSystemAdmin` — signed out redirects to `/login`; non-admin renders the Access Denied panel and `searchSongs` is never called; admin renders the island with the search results.
- Island (jsdom, `afterEach(cleanup)`, injected fake actions): a search result's versions each show repertoire/playlist counts from the fake `getBlastRadius`; each of the four flows shows a `ConfirmPanel` containing the counts and no mutating fake has been called; Cancel leaves them uncalled; Confirm calls exactly the matching fake with the expected arguments and then `router.refresh` is called; a rejecting fake shows the message and does not refresh; Delete is disabled for non-zero, loading and errored radii and enabled for 0/0; Split is disabled when all versions are ticked.
- Plan helpers: message wording and pluralisation (1 repertoire / 2 repertoires, 0 playlists), `canSplit`, `canDeleteVersion`.
- AppLayout: with `isSystemAdmin` true a link to `/admin/catalog` is present in both navs; false/omitted, absent.
- `npm run lint` (verify exit code out of band, see AGENTS.md), `npx tsc --noEmit`, `npm run lint:dead` stay clean.

## Expected Results
- [ ] `/admin/catalog` redirects a signed-out visitor to `/login`, shows Access Denied to a non-system-admin without reading the catalog, and renders the screen for a system admin, asserted by a page test.
- [ ] A test asserts `/admin/catalog` is matched by the `src/proxy.ts` matcher.
- [ ] Searching a song lists its versions, each showing the repertoire and playlist counts returned by the blast-radius action, asserted by a component test.
- [ ] Merge versions, split, merge songs and delete each show a ConfirmPanel naming the repertoire and playlist counts before any mutating action is called, asserted by component tests.
- [ ] Confirming each flow calls the matching RH-154/RH-155 Server Action with the chosen ids and then refreshes the list, asserted by component tests.
- [ ] The Delete button is enabled only for a version whose counts are 0 and 0, and disabled while counts are loading, failed or non-zero.
- [ ] A Catalog nav link to `/admin/catalog` is rendered for system admins and absent for other users, asserted in the AppLayout test.
- [ ] `docs/tasks/RH-156-mock.html` exists, and `npm run lint`, `npx tsc --noEmit` and the new tests pass.

## Out of Scope
Standalone song delete, `song_files` and `song_links` management, editing song fields, a persisted audit trail of admin operations, cross-song version merge from the UI (the action allows it; the screen offers same-song targets only).

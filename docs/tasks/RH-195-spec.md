# RH-195 — Add offline setlists screen and cache Fast View documents on song save

## Scope

Part 4 of the RH-191 split (Make offline a per-song option and setlist download a shortcut). This task covers two pieces that make downloaded setlists and songs reachable after a cold offline start without requiring each song's Fast View URL to have been visited online beforehand:

1. **Offline setlists list on `/offline` (`OfflineSetlists`)**:
   - Renders beneath the existing `data-testid="offline-shell"` "You are offline" card on `/offline`.
   - Loads stored setlist lists and stored song records client-side after mount so `/offline` remains statically prerenderable for the service worker precache manifest.
   - Lists every downloaded setlist with its name, its `<storedCount> of <totalCount> songs` count, and its entries numbered `1.`, `2.`, … in stored order.
   - Links each song that is stored on the device (in that setlist's owner context) to its Fast View URL (`/songs/<versionId>/fast-view` or `/songs/<versionId>/fast-view?bandId=<bandId>`), and on click writes the full setlist queue to `sessionStorage` with `originHref: '/offline'`, the setlist's `playlistName` as `label`, and its owner context.
   - Renders songs not on the device as non-interactive rows with the dashed "Not on this device" mark and no link.
   - Renders nothing when no setlists are downloaded, leaving only the "You are offline" card on `/offline`.
2. **Fast View document caching on song save**:
   - Whenever a song is saved to the offline store (via single-song download, setlist download, retry, or refresh), fetches its Fast View document (`/songs/<versionId>/fast-view` or `/songs/<versionId>/fast-view?bandId=<bandId>`) and writes the response into `OFFLINE_PAGE_CACHE` (`rh-offline-pages-v1`) when the response status is HTTP `200`.
   - Logs a warning/error and does not fail or roll back the song save if the document fetch rejects, returns a non-`200` status, or fails to write to the page cache.
   - Keeps cached Fast View documents when a song or setlist is removed so the offline "This song is not available offline" screen can still render for removed songs.
   - Does not fetch documents during pure offline v5/v6 record conversion, which runs without network access.

Explicitly out of scope:
- Song-level store records, setlist list records, removal protection rules, and pure v5/v6 conversion (RH-192).
- Live playlist count and per-row check/trash marks on `/playlists/[id]` (RH-193).
- Settings page Playlists and Songs lists and deduplicated total storage (RH-194).
- Offline queue availability detection (`useQueueAvailability`), skipping unavailable songs on Prev/Next in Fast View, and Prev/Next buttons on `OfflineUnavailable` (RH-196).
- Plan gating and per-device song limits.

## Approach

### Behavior

1. **Static Prerenderability of `/offline`**:
   - `src/app/offline/page.tsx` remains a static Server Component with no `cookies`, `headers`, `searchParams`, or `no-store` fetches, preserving `.next/server/app/offline.html` in the service worker's precache manifest (`e2e/pwa-shell.spec.ts`).
   - `OfflinePage` renders the existing `data-testid="offline-shell"` card followed by `<OfflineSetlists />`.

2. **Listing Downloaded Setlists on `/offline` (`OfflineSetlists`)**:
   - `OfflineSetlists` accepts an optional `store?: OfflineStore` prop (defaulting to `OFFLINE_STORE`) for dependency injection in tests.
   - In a `useEffect` on mount, it reads the downloaded setlists (including their ordered `entries` and `bandId`) and the stored song records from `store`.
   - If the store read fails, it logs the error and treats the list as empty.
   - When there are no downloaded setlists (or before the initial read resolves), `OfflineSetlists` returns `null`, so only the "You are offline" card is rendered.
   - When one or more downloaded setlists are present, `OfflineSetlists` renders a container beneath the card with a `Downloaded playlists` heading (`text-xs font-semibold uppercase tracking-wide text-gray-500`).
   - For each downloaded setlist:
     - Computes `storedCount` as the number of entries in `setlist.entries` whose song record at `songRecordId(entry.versionId, setlist.bandId)` is present on the device, and `totalCount` as `setlist.entries.length`.
     - Renders the setlist header with `setlist.playlistName` and `<storedCount> of <totalCount> songs`.
     - Renders an ordered list (`<ol>` or `<ul>`) of `setlist.entries` in their stored order, each prefixed with its 1-based position (`1.`, `2.`, …).
     - **Stored song**: when `songRecordId(entry.versionId, setlist.bandId)` is on the device, the row renders a `<Link>` pointing to `/songs/${entry.versionId}/fast-view${setlist.bandId ? `?bandId=${setlist.bandId}` : ''}` with the song number, `entry.title`, and a right chevron icon. Clicking the link invokes `writeSongQueue` (`src/lib/songQueue.ts`) before navigation with:
       - `entries`: all entries of `setlist.entries` (`{ versionId, title, artist }`) in stored order;
       - `owner`: `setlist.bandId ? { type: 'band', bandId: setlist.bandId } : { type: 'personal' }`;
       - `originHref`: `'/offline'`;
       - `label`: `setlist.playlistName`.
     - **Missing song**: when `songRecordId(entry.versionId, setlist.bandId)` is not on the device, the row renders as a non-linked item with a dashed border (`border-dashed`), the song number, `entry.title`, and a dashed circle icon with `<span role="img" aria-label="Not on this device">` and visible text `Not on this device`.

3. **Caching Fast View Documents on Song Save**:
   - `OfflineStorePorts` is extended with a page-cache port (`pages: OfflinePagePort` with `put(path: string, response: Response): Promise<void>`, or equivalent method backed by `caches.open(OFFLINE_PAGE_CACHE)` in `src/lib/offlineBackends.ts` and an in-memory map in `src/lib/__tests__/offlineStoreFakes.ts`).
   - `src/lib/offlineStore.ts` re-exports `OFFLINE_PAGE_CACHE` from `@/lib/offlineCacheNames`.
   - When saving a song for `(versionId, bandId)` — after the song's tab PDFs and IndexedDB song record have been committed — the store requests the song's Fast View document at `/songs/${versionId}/fast-view${bandId ? `?bandId=${bandId}` : ''}` using `ports.fetch`.
   - If the response has `status === 200` and `type !== 'opaque'`, the store writes it to `ports.pages.put(docPath, response)`.
   - If `ports.fetch` rejects, returns a non-`200` status (or opaque response), or `ports.pages.put` rejects, the store logs the failure via `logger.error` and resolves normally without throwing or rolling back the saved song record or its cached tab blobs.
   - `removeOfflineSong` and `removeOfflinePlaylist` never delete entries from `OFFLINE_PAGE_CACHE`.
   - `src/app/sw.ts` updates its docblock comment on the `OFFLINE_PAGE_CACHE` route to note that song downloads now warm this cache on HTTP `200`.

### Files touched

- `src/lib/offlineStore.ts`: Re-exports `OFFLINE_PAGE_CACHE`, adds `OfflinePagePort` (`pages`) to `OfflineStorePorts`, and fetches/caches the song's Fast View document on HTTP `200` during song save while logging and swallowing document fetch/cache failures.
- `src/lib/offlineBackends.ts`: Implements the `pages` port over `caches.open(OFFLINE_PAGE_CACHE)`.
- `src/components/playlists/OfflineSetlists.tsx` (new): Client component that reads downloaded setlists and stored songs from `OfflineStore`, renders each setlist's `N of M songs` count and ordered song rows, links stored songs to Fast View while calling `writeSongQueue` with `originHref: '/offline'`, and marks missing songs with `Not on this device`.
- `src/app/offline/page.tsx`: Renders `<OfflineSetlists />` beneath the `data-testid="offline-shell"` card while remaining statically prerenderable.
- `src/app/sw.ts`: Updates the docblock comment describing `OFFLINE_PAGE_CACHE` warming on song download.
- `src/lib/__tests__/offlineStoreFakes.ts`: Adds `FakePagePort` (`pages`) to `FakeOfflinePorts` so tests can inspect cached Fast View documents and simulate document fetch or page-cache failures.
- `src/lib/__tests__/offlineStore.test.ts`: Adds tests verifying that saving a song caches its Fast View document in `pages` on HTTP `200`, and logs without failing the song save when the document fetch rejects or returns non-`200`.
- `src/components/playlists/__tests__/OfflineSetlists.test.tsx` (new): Tests `/offline` rendering with downloaded setlists in stored order, `N of M songs` count, stored song links writing the full queue to `sessionStorage` with `/offline` origin and owner context, missing songs rendered with `Not on this device` and no link, and the empty state rendering only the offline card.
- `docs/behavior.md`: Adds the two `Offline` behavior registry lines for `/offline` setlist listing and Fast View document caching.

### Test criteria

- **Store unit tests (`src/lib/__tests__/offlineStore.test.ts`)**:
  - Saving a song in personal context fetches `/songs/<versionId>/fast-view` and stores the response in `ports.pages` when HTTP status is `200`; saving in band context fetches and stores `/songs/<versionId>/fast-view?bandId=<bandId>`.
  - When the Fast View document fetch returns a non-`200` status (e.g. `500` or `404`), the song record and its tab blobs are still saved, `ports.pages` does not store the error response, and the failure is logged.
  - When the Fast View document fetch rejects with a network error, the song record and its tab blobs are still saved, and the error is logged without failing the save call.
  - Removing a song deletes its song record and tab blobs while leaving its cached Fast View document in `ports.pages`.
- **Component unit tests (`src/components/playlists/__tests__/OfflineSetlists.test.tsx`)**:
  - With downloaded setlists in the store, `/offline` renders the `You are offline` card plus the `Downloaded playlists` section listing setlists and their songs numbered in stored order with `<storedCount> of <totalCount> songs`.
  - Stored songs render as links to `/songs/<versionId>/fast-view` (or `?bandId=<bandId>` for band setlists), whereas missing songs render `Not on this device` and no link.
  - Clicking a stored song link writes the full setlist queue (all entries in stored order, `label` set to the playlist name, `owner` set to personal or `{ type: 'band', bandId }`, and `originHref: '/offline'`) to `sessionStorage` (`readSongQueue()`).
  - With no downloaded setlists in the store, `/offline` renders only the `You are offline` card (`data-testid="offline-shell"`) and no `Downloaded playlists` section.

## Behavior changes

- added: Offline — After a cold offline start the offline screen lists each downloaded playlist's songs in stored order, marks those not on the device, and opens a stored one with the playlist as its queue. (src/components/playlists/OfflineSetlists.tsx, src/app/offline/page.tsx, e2e/offline-mode.spec.ts) (RH-195)
- added: Offline — Storing a song also stores its Fast View document, so a song never opened online opens offline. (src/lib/offlineStore.ts, src/lib/offlineBackends.ts, src/lib/__tests__/offlineStore.test.ts) (RH-195)

## Expected Results

- [ ] `OfflineSetlists.test.tsx` asserts that `/offline` lists downloaded setlists in stored order with `N of M songs`, linking stored songs and rendering missing songs with `Not on this device` and no link.
- [ ] Clicking a stored song on `/offline` writes the full setlist queue to `sessionStorage` with the setlist name, owner context, and `/offline` as origin.
- [ ] With no downloaded setlists, `/offline` renders only the `You are offline` card and no setlist section.
- [ ] `offlineStore.test.ts` asserts that saving a song fetches and stores its Fast View document in the page cache on HTTP 200, and logs but does not fail the song save when the document fetch fails or returns non-200.

## Operator Results Coverage

| Original result | Spec section | Returned result |
|---|---|---|
| `OfflineSetlists.test.tsx` asserts that `/offline` lists downloaded setlists in stored order with N of M songs, linking stored songs and rendering missing songs with Not on this device and no link. | Approach § Behavior 2, Test criteria | 1 |
| Clicking a stored song on `/offline` writes the full setlist queue to `sessionStorage` with the setlist name, owner context, and `/offline` as origin. | Approach § Behavior 2, Test criteria | 2 |
| With no downloaded setlists, `/offline` renders only the You are offline card and no setlist section. | Approach § Behavior 1 & 2, Test criteria | 3 |
| `offlineStore.test.ts` asserts that saving a song fetches and stores its Fast View document in the page cache on HTTP 200, and logs but does not fail the song save when the document fetch fails or returns non-200. | Approach § Behavior 3, Test criteria | 4 |

## Out of Scope

- Song-level store records, setlist list records, removal protection rules, and pure v5/v6 conversion (RH-192).
- Playlist page live count and per-row offline marks on `/playlists/[id]` (RH-193).
- Settings page Playlists and Songs lists and deduplicated total storage (RH-194).
- Offline queue availability detection and skip navigation in Fast View (RH-196).
- Listing individually downloaded songs on `/offline` (it lists downloaded setlists only, per RH-191 Out of Scope).

Mock: `docs/tasks/RH-195-mock.html`.

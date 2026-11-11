# RH-196 — Implement offline queue availability and skip navigation in Fast View

## Scope

Part 5 of the RH-191 split (Make offline a per-song option and setlist download a shortcut). Depends on RH-192 through RH-195. Once a setlist download stores songs individually and a single song can be removed from the device (RH-192, RH-193), a queue walked offline can contain songs that are no longer stored on this device. This task makes Fast View's queue navigation and setlist chrome offline-aware:

- Introduces `useQueueAvailability` (`src/hooks/useQueueAvailability.ts`) to determine which queue entries are available offline (i.e. `getResolvedEntryForVersion` would return non-null under RH-192's owner-context preference and fallback).
- Updates `playlistNav` (`src/lib/playlistNav.ts`) and `usePlaylistNav` (`src/hooks/usePlaylistNav.ts`) so that offline previous/next navigation (swipe, arrow keys, page-turner pedals, and desktop previous arrow) skips unavailable queue entries and jumps to the nearest available song in that direction, stopping at the ends without wrapping, while keeping `position` and `total` across all queue entries. Online (and before the availability read settles), navigation targets remain the immediate neighbours.
- Updates `SetlistRow`, `SetlistPanel`, `SetlistDrawer`, `SetlistSidebar`, and `SetlistSelect` so unavailable queue entries are disabled and marked `Not on this device` (`(not on this device)` in the select option without the artist suffix) while offline. Online, the setlist chrome is unchanged.
- Updates `OfflineUnavailable` (`src/components/fastview/OfflineUnavailable.tsx`) and `FastViewPage` (`src/app/songs/[versionId]/fast-view/page.tsx`) with updated body copy, `Previous: <title>` and `Next: <title>` action buttons to the nearest available songs in the queue when opened inside a queue, and `Back` returning to the queue's recorded origin.
- Adds the production E2E test in `e2e/offline-mode.spec.ts` verifying that in a new tab with no network, `/offline` lists a downloaded setlist in order with its removed song marked `Not on this device`, and `ArrowRight` from the song before it opens the song after it.
- Updates `docs/behavior.md` and `docs/use-cases.md` § *Read offline* to record the per-song offline model and offline skip navigation.

Explicitly out of scope:
- Song-level offline store records, ordered setlist records, removal protection rules, and pure v5/v6 conversion (RH-192).
- Playlist page live count and per-row offline marks on `/playlists/[id]` (RH-193).
- Settings page Playlists and Songs lists and deduplicated total storage (RH-194).
- Offline setlists screen (`OfflineSetlists`) on `/offline` and caching Fast View documents on song save (RH-195).
- Plan gating and per-device song limits.

## Approach

### Behavior

1. **Queue Availability Detection (`useQueueAvailability`)**:
   - Implemented in `src/hooks/useQueueAvailability.ts`.
   - Reads only when `offline` is `true` and the queue has entries. When `offline` is `false` (or before the async store read completes), returns `null` (`availableVersionIds: ReadonlySet<string> | null`), meaning all entries are treated as available and chrome/navigation behave identically to online mode.
   - While offline, queries the offline store (injectable `store?: OfflineStore`, defaulting to `OFFLINE_STORE`) to determine which `entry.versionId` values in the queue can be resolved offline (matching RH-191 rule 22 / RH-192: a song is available if stored for the requested owner context or any fallback stored context on the device).
   - Publishes the resulting `ReadonlySet<string>` of available `versionId`s without violating `react-hooks/set-state-in-effect`.

2. **Nearest-Available Neighbours & Skip Navigation (`playlistNav` and `usePlaylistNav`)**:
   - `computePlaylistNav(entries, currentVersionId, queueLabel, availableVersionIds?: ReadonlySet<string> | null)` in `src/lib/playlistNav.ts`:
     - `position` (1-based index of `currentVersionId` in `entries`) and `total` (`entries.length`) always count every entry in the queue regardless of availability.
     - When `availableVersionIds` is `null` or `undefined` (online, or before the offline availability read finishes), `prevId` and `nextId` are the immediate neighbours (`entries[index - 1]` and `entries[index + 1]`).
     - When `availableVersionIds` is a `Set`, `prevId` is the `versionId` of the nearest entry before `index` present in `availableVersionIds` (or `null` if none exists), and `nextId` is the `versionId` of the nearest entry after `index` present in `availableVersionIds` (or `null` if none exists).
     - Ends never wrap around in either mode.
   - ` playlistNav` also exports a pure helper (e.g. `nearestAvailableEntries` or `prevEntry` / `nextEntry` on `PlaylistNav` / helper function) so `OfflineUnavailable` can obtain both the `versionId` and `title` of the nearest available previous and next songs in the queue.
   - `usePlaylistNav` accepts `offline?: boolean` and optional `store?: OfflineStore` (or `availableVersionIds?: ReadonlySet<string> | null`), wires `useQueueAvailability`, computes `nav` with `availableVersionIds`, guards `selectEntry` so a disabled/unavailable versionId is a no-op while offline, and exposes `unavailableVersionIds` (or `availableVersionIds`) to Fast View's setlist components.

3. **Setlist Chrome Offline States (`SetlistRow`, `SetlistPanel`, `SetlistDrawer`, `SetlistSidebar`, `SetlistSelect`)**:
   - **Sidebar and Drawer (`SetlistRow`, `SetlistPanel`, `SetlistDrawer`, `SetlistSidebar`)**:
     - When an entry is marked unavailable (`availableVersionIds !== null && !availableVersionIds.has(entry.versionId)`):
       - `SetlistRow` renders `<button type="button" disabled ...>` with muted styling (`bg-gray-50 text-gray-400 border-gray-100`), does not call `onSelect` when clicked, and renders a `<span className="... border-dashed ...">Not on this device</span>` chip on the right.
     - When online or when the entry is available on the device, `SetlistRow` renders and behaves exactly as today.
     - The header counter in `SetlistSidebar` (`{nav.position} / {nav.total}`) and `SetlistPill` (`Setlist ({nav.position}/{nav.total})`) continues to show the full queue position and total.
   - **Mobile Select (`SetlistSelect`)**:
     - When an entry is unavailable (`availableVersionIds !== null && !availableVersionIds.has(entry.versionId)`):
       - Its `<option>` is rendered with `disabled={true}` and text `<n>. <title> (not on this device)`, omitting the ` - <artist>` suffix (RH-191 rule 32).
     - When an entry is available (or when `availableVersionIds` is `null` online):
       - Its `<option>` is enabled and keeps `<n>. <title> - <artist>` (or `<n>. <title> ` when `artist` is `null`).

4. **Not-Downloaded Screen (`OfflineUnavailable` and `FastViewPage`)**:
   - `OfflineUnavailable` updates its body paragraph to:
     `It is not stored on this device. While you have a connection, open its playlist and choose Make available offline, or open the song and choose Available offline.`
   - When the current route's `versionId` sits in an active queue:
     - `OfflineUnavailable` receives optional `prev?: { title: string; onSelect: () => void } | null` and `next?: { title: string; onSelect: () => void } | null` props (or equivalent target props from `playlist`).
     - When `prev` is present, renders a button `← Previous: <title>` (accessible name matching `Previous: <title>`) that navigates to that previous available song.
     - When `next` is present, renders a button `Next: <title> →` (accessible name matching `Next: <title>`) that navigates to that next available song.
     - Either button is omitted when there is no available song in that direction (or when opened outside a queue).
     - Clicking `← Back` calls `playlist.goBack` (which pushes the queue's `originHref` when in a queue, or calls `router.back()` when not in a queue).

5. **End-to-End Offline Queue & Skip Navigation (`e2e/offline-mode.spec.ts`)**:
   - Updates any legacy seeded snapshot record in `e2e/offline-mode.spec.ts` to match the song-level store schema if not already updated by RH-192/RH-193.
   - Adds the production E2E test required by RH-191 ER8:
     - Online, creates a three-song playlist and downloads it (`Make available offline`) without visiting the songs' Fast View pages online (relying on RH-195's document caching).
     - Removes the middle song (song 2) from this device using its row trash button (`Remove <title> from this device` from RH-193).
     - Sets the browser context offline (`context.setOffline(true)`) and opens a **new tab** (`await context.newPage()`) at `/`.
     - Verifies the service worker serves `/offline` (`OfflineSetlists` from RH-195), listing the downloaded playlist in order (songs 1, 2, 3) with song 2 marked `Not on this device`.
     - Clicks song 1 on the offline screen to open Fast View with the setlist queue.
     - Verifies Fast View renders song 1 with position `1 / 3` and song 2 marked `Not on this device` and disabled in the setlist.
     - Presses `ArrowRight` from song 1 and verifies Fast View skips song 2 and opens song 3 (`3 / 3`).
     - Presses `ArrowLeft` from song 3 and verifies Fast View returns to song 1 (`1 / 3`), and clicking `Back` returns to `/offline`.

### Files touched

- `src/hooks/useQueueAvailability.ts` (new): Hook that reads stored song availability from `OfflineStore` for the current queue entries and owner context when offline, returning `ReadonlySet<string> | null`.
- `src/lib/playlistNav.ts`: Extends `computePlaylistNav` with optional `availableVersionIds?: ReadonlySet<string> | null` to skip unavailable entries when computing `prevId` and `nextId` while preserving `position` and `total`; exports helper to resolve nearest available `SongQueueEntry` neighbours (including `title`) for `OfflineUnavailable`.
- `src/hooks/usePlaylistNav.ts`: Integrates `useQueueAvailability`, passes `availableVersionIds` into `computePlaylistNav`, exposes `availableVersionIds` and nearest available neighbour entries (`prevEntry`, `nextEntry`) plus `goNext` to the page, and prevents selecting an unavailable entry while offline.
- `src/components/fastview/SetlistRow.tsx`: Adds optional `unavailable?: boolean` prop; renders disabled button with `Not on this device` chip when `unavailable` is true.
- `src/components/fastview/SetlistPanel.tsx`: Threads `availableVersionIds` to each `SetlistRow`.
- `src/components/fastview/SetlistDrawer.tsx`: Threads `availableVersionIds` to `SetlistPanel`.
- `src/components/fastview/SetlistSidebar.tsx`: Threads `availableVersionIds` to `SetlistPanel`.
- `src/components/fastview/SetlistSelect.tsx`: Adds optional `availableVersionIds?: ReadonlySet<string> | null` prop; renders unavailable options as `disabled` with `<n>. <title> (not on this device)` (dropping ` - <artist>`).
- `src/components/fastview/OfflineUnavailable.tsx`: Updates body copy to the RH-191 rule 34 text and renders optional `Previous: <title>` and `Next: <title>` buttons above `← Back`.
- `src/app/songs/[versionId]/fast-view/page.tsx`: Passes `offline: isOffline` to `usePlaylistNav`, threads `availableVersionIds` to `SetlistDrawer`, `SetlistSidebar`, and `SetlistSelect`, and wires `OfflineUnavailable` with `playlist.goBack` and the queue's nearest available previous/next targets.
- `src/lib/__tests__/playlistNav.test.ts`: Tests `computePlaylistNav` with `availableVersionIds` skipping single and consecutive unavailable entries in both directions, stopping at boundaries without wrapping, preserving `position`/`total`, and behaving sequentially when `availableVersionIds` is `null` or omitted.
- `src/hooks/__tests__/usePlaylistNav.test.tsx`: Tests offline previous/next navigation (swipe, arrow keys, `goPrev`, `goNext`) skipping unavailable songs, stopping at boundaries, ignoring `selectEntry` on unavailable songs offline, and navigating sequentially when online.
- `src/components/fastview/__tests__/SetlistRow.test.tsx`, `SetlistDrawer.test.tsx`, `SetlistSidebar.test.tsx`, `SetlistControls.test.tsx`: Asserts disabled rows with `Not on this device` chip in drawer and sidebar, disabled `<n>. <title> (not on this device)` options without artist in select, unchanged total position counts, and unchanged online rendering.
- `src/components/fastview/__tests__/OfflineBanner.test.tsx` and `src/app/songs/__tests__/fastViewPage.test.tsx`: Asserts the updated `OfflineUnavailable` copy, `Previous: <title>` and `Next: <title>` navigation buttons when in a queue, absence of buttons when no target exists, and `Back` navigating to the queue's recorded `originHref`.
- `e2e/offline-mode.spec.ts`: Adds the new-tab offline setlist & `ArrowRight` skip navigation E2E test.
- `docs/behavior.md`: Updates the `Fast View and queue` behavior line for offline queue marking and skip navigation.
- `docs/use-cases.md`: Updates § *Read offline* to reflect per-song storage and offline skip navigation.
- `package.json`: Bumps version per AGENTS.md rules.

### Test criteria

- **Pure navigation unit tests (`src/lib/__tests__/playlistNav.test.ts`)**:
  - With `availableVersionIds` provided, `computePlaylistNav` skips one or multiple consecutive unavailable entries forward (`nextId`) and backward (`prevId`), returns `null` when no available entry remains in that direction without wrapping around, and keeps `position` and `total` counting all entries.
  - When `availableVersionIds` is `null` or `undefined`, `computePlaylistNav` returns immediate neighbours sequentially.
  - Even when `currentVersionId` itself is not in `availableVersionIds` (e.g. opened directly on `OfflineUnavailable`), `computePlaylistNav` still resolves the nearest available `prevId`/`nextId` and `prevEntry`/`nextEntry` titles.
- **Controller hook tests (`src/hooks/__tests__/usePlaylistNav.test.tsx`)**:
  - Offline with a store containing a subset of queue songs: `ArrowRight`, `ArrowLeft`, leftward/rightward swipes, `goPrev`, and `goNext` skip unavailable entries and navigate to the nearest available entry, stopping at queue boundaries without wrapping.
  - Online: navigates sequentially to immediate neighbours without consulting offline availability Restriction.
  - Before the async availability check resolves offline: defaults to plain neighbours, then updates once resolved.
- **Component & page tests (`SetlistRow.test.tsx`, `SetlistDrawer.test.tsx`, `SetlistSidebar.test.tsx`, `SetlistControls.test.tsx`, `OfflineBanner.test.tsx`, `fastViewPage.test.tsx`)**:
  - `SetlistRow`, `SetlistDrawer`, and `SetlistSidebar` render unavailable entries as `disabled` buttons with the `Not on this device` chip while keeping the `position / total` badge unchanged; online rows remain enabled without the chip.
  - `SetlistSelect` renders unavailable entries as `disabled` `<option>` elements reading `<n>. <title> (not on this device)` without `- <artist>`, and available entries as enabled `<option>` elements reading `<n>. <title> - <artist>`.
  - `OfflineUnavailable` renders the new body text, renders `Previous: <title>` and `Next: <title>` buttons when available neighbours exist in the queue, omits either button when no available song exists in that direction (or when there is no queue), and invokes queue origin navigation on `Back`.
- **Production E2E test (`e2e/offline-mode.spec.ts` with `E2E_PROD=1`)**:
  - Downloads a 3-song playlist, removes song 2 from the device via its row button, goes offline, opens a new tab at `/`, verifies `/offline` lists the 3 songs in order with song 2 marked `Not on this device`, clicks song 1, presses `ArrowRight`, and verifies song 3 opens with `3 / 3`.

## Behavior changes

- changed: Fast View and queue — Users move through the queue by swipe, arrow keys or the setlist list, and arrow keys are off while a stage is open; offline, the list marks songs not on the device and moving skips them. (src/hooks/usePlaylistNav.ts, src/components/fastview/SwipeHint.tsx, src/lib/playlistNav.ts, src/components/fastview/SetlistRow.tsx) (RH-196)

## Expected Results

- [ ] With `E2E_PROD=1`, `offline-mode.spec.ts` passes a new test where, in a new tab with no network, the offline screen lists a downloaded setlist in order with its removed song marked `Not on this device`, and `ArrowRight` from the song before it opens the song after it.
- [ ] In `playlistNav.test.ts` and `usePlaylistNav.test.tsx`, offline navigation skips unavailable queue entries in both directions, stops at queue boundaries without wrapping, and navigates sequentially when online.
- [ ] Fast View's setlist drawer, sidebar, and select mark unavailable queue entries as disabled with `Not on this device` (`(not on this device)` in the select) while keeping total queue position count.
- [ ] When opening an unavailable queue song offline, `OfflineUnavailable` displays `Previous: <title>` and `Next: <title>` buttons navigating to the nearest available queue songs, with `Back` returning to queue origin.

## Operator Results Coverage

Task `RH-196` arrived with empty `operator_expected_results` and four pre-populated `expected_results` from the RH-191 split. All four are preserved and mapped below:

| Original result | Spec section | Returned result |
|---|---|---|
| With E2E_PROD=1, offline-mode.spec.ts passes a new test where, in a new tab with no network, the offline screen lists a downloaded setlist in order with its removed song marked Not on this device, and ArrowRight from the song before it opens the song after it. | Approach § Behavior 5, Test criteria | 1 |
| In playlistNav.test.ts and usePlaylistNav.test.tsx, offline navigation skips unavailable queue entries in both directions, stops at queue boundaries without wrapping, and navigates sequentially when online. | Approach § Behavior 1 & 2, Test criteria | 2 |
| Fast Views setlist drawer, sidebar, and select mark unavailable queue entries as disabled with Not on this device while keeping total queue position count. | Approach § Behavior 3, Test criteria | 3 |
| When opening an unavailable queue song offline, OfflineUnavailable displays Previous: <title> and Next: <title> buttons navigating to the nearest available queue songs, with Back returning to queue origin. | Approach § Behavior 4, Test criteria | 4 |

## Out of Scope

- Song-level offline store records, setlist list records, removal protection rules, and pure v5/v6 conversion (RH-192).
- Playlist page live count and per-row offline marks on `/playlists/[id]` (RH-193).
- Settings page Playlists and Songs lists and deduplicated total storage (RH-194).
- Offline setlists screen (`OfflineSetlists`) on `/offline` and caching Fast View documents on song save (RH-195).
- Plan gating and per-device song limits.

Mock: `docs/tasks/RH-196-mock.html`.

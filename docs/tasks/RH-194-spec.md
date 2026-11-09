# RH-194 — Redesign Settings offline storage with separate Playlists and Songs lists

## Scope

Part 3 of the RH-191 split (Make offline a per-song option and setlist download a shortcut). This task redesigns the offline storage management view on `/settings` and its underlying hook `useOfflineLibrary`:

- Updates `useOfflineLibrary` to partition stored offline data into two separate collections: `playlists` (downloaded setlists) and `songs` (stored song records).
- Computes `totalBytes` by counting each stored song record exactly once on the device (deduplicated total storage), so shared songs between playlists do not inflate the total.
- Updates `OfflineStorageSection` to render two dedicated lists:
  1. **Playlists**: displays playlist name, stored vs total songs (`N of M songs`), summed byte size of its stored songs, download date, and a Remove button.
  2. **Songs**: displays song title, individual byte size, download date, holding playlists (e.g. `In Friday Gig, In Ensaio quarta`) and/or `Downloaded individually`, and a Remove button.
- Removes the green "Song" badge previously rendered on song rows.
- Wires removal actions: playlist removal under the protection rule (keeps songs held by other playlists or downloaded individually), and song removal (lowers the stored count and summed size of holding playlists).
- Preserves the empty state ("Nothing is stored on this device.") when no playlists and no songs are stored.
- Preserves the secondary browser quota line (`x of y used`), omitted when `navigator.storage` is unavailable.

Depends on RH-192 for the song-level store and removal methods, and follows RH-193 in the decomposition order.

## Approach

### Behavior

1. **Two Separate Lists**:
   - `useOfflineLibrary` queries the offline store and provides two typed lists: `playlists` and `songs`.
   - **Playlists list**:
     - Measured against the stored setlist list (RH-191 rule 14, as Settings has no live playlist context). For a setlist record storing M entries, `storedCount` is the number of those entries whose song record currently exists in the store; `totalCount` is M.
     - Summed size (`bytes`) sums the byte sizes of the songs in that playlist that are currently on the device.
     - Formats download age (`downloadedAgo`) at read time to preserve hook purity.
     - Row layout: `<playlistName>`, `<storedCount> of <totalCount> songs · <formattedBytes> · downloaded <downloadedAgo>`, and a "Remove" button with `aria-label="Remove <playlistName> from this device"`.
   - **Songs list**:
     - Lists every stored song record by title.
     - The previous `<span className="...">Song</span>` badge is removed.
     - Provenance is derived at read time: names of downloaded playlists holding this song (`In <playlistName>`), and `Downloaded individually` if marked with `individualDownload: true`. Multiple sources are comma-separated (e.g., `In Friday Gig, Downloaded individually`).
     - Formats individual size (`bytes`) and download age (`downloadedAgo`).
     - Row layout: `<title>`, `<formattedBytes> · downloaded <downloadedAgo> · <provenance>`, and a "Remove" button with `aria-label="Remove <title> from this device"`.

2. **Deduplicated Total Storage**:
   - `totalBytes` is the sum of `bytes` across all unique stored song records on the device.
   - When multiple playlists share a song, that song's bytes are counted once in `totalBytes`. As a result, `totalBytes` can be less than the sum of the playlist rows' summed sizes (RH-191 rule 21).
   - If `navigator.storage.estimate()` is available and returns quota info, the secondary line renders `{formatOfflineBytes(usedBytes)} of {formatOfflineBytes(quotaBytes)} used`. If unsupported or null, the line is omitted.

3. **Removals**:
   - **Playlist removal** (`removePlaylist(playlistId)`): Calls `store.removeOfflinePlaylist(playlistId)`. Under the protection rule (RH-191 rule 18 / RH-192), this removes the playlist record and deletes only those songs that are not held by another downloaded playlist and not marked `individualDownload: true`. The hook refreshes, updating both playlists and songs lists and total storage.
   - **Song removal** (`removeSong(recordId)`): Calls `store.removeOfflineSong(recordId)`. This deletes the song record and its cached files, while keeping every playlist list stored (RH-191 rule 16 / RH-192). The hook refreshes, removing the song from the Songs list, updating `totalBytes`, and lowering the `storedCount` and summed size of any playlist holding that song.

4. **Empty State & Error Handling**:
   - When neither playlists nor songs are stored, `OfflineStorageSection` renders:
     `<p className="text-sm text-gray-400 py-6 text-center">Nothing is stored on this device.</p>`
     and `totalBytes` displays `0 B`.
   - If one list has items while the other is empty (e.g., all songs of a playlist were removed individually, or songs were downloaded individually with no playlists), only the non-empty section is rendered.
   - If store queries reject, `useOfflineLibrary` logs the error and publishes an empty library state without throwing.

### Files touched

- `src/hooks/useOfflineLibrary.ts`: Redesigns `OfflineLibraryController` to expose `playlists`, `songs`, deduplicated `totalBytes`, `removePlaylist`, and `removeSong`. Derives `downloadedAgo` and `provenance` at read time through `useSyncExternalStore`.
- `src/components/settings/OfflineStorageSection.tsx`: Renders Playlists and Songs sections, removes the Song badge, handles playlist and song removal, and shows the empty state when nothing is stored.
- `src/hooks/__tests__/useOfflineLibrary.test.tsx`: Tests deduplicated `totalBytes` with shared songs across playlists, playlist removal under protection rules, song removal lowering playlist counts, and store error handling.
- `src/components/settings/__tests__/OfflineStorageSection.test.tsx`: Tests Playlists section rendering (counts, size, age), Songs section rendering (size, age, provenance, no Song badge), Remove button actions, and empty state.
- `docs/behavior.md`: Updates the Offline behavior registry line for Settings offline storage.

### Test criteria

- **Hook tests (`useOfflineLibrary.test.tsx`)**:
  - `totalBytes` counts each stored song once when two downloaded playlists share a song, asserting `totalBytes` is strictly less than the sum of individual playlist bytes.
  - Calling `removePlaylist` deletes that playlist and deletes only unprotected songs; songs held by another downloaded playlist or marked `individualDownload: true` remain in `songs`.
  - Calling `removeSong` deletes that song record, removes it from `songs`, reduces `totalBytes`, and lowers the `storedCount` and `bytes` of all playlists holding it.
  - An empty store publishes empty `playlists`, empty `songs`, and `totalBytes: 0`.
  - A failing store read publishes an empty library without unhandled promise rejections.
- **Component tests (`OfflineStorageSection.test.tsx`)**:
  - The Playlists section lists downloaded playlists with `N of M songs`, summed size, and download date.
  - The Songs section lists stored songs with size, download date, holding playlist names or "Downloaded individually", and asserts that no "Song" badge is rendered.
  - Clicking "Remove" on a playlist row calls `removePlaylist`, keeping songs held by other playlists or downloaded individually.
  - Clicking "Remove" on a song row calls `removeSong`, removing the song row and updating the count of holding playlists.
  - When nothing is stored, renders "Nothing is stored on this device." and `0 B` total.

## Behavior changes

- changed: Offline — Settings lists the downloaded playlists with their song counts and the stored songs, lets the user remove either, and totals each song once. (src/components/settings/OfflineStorageSection.tsx, src/hooks/useOfflineLibrary.ts) (RH-194)

## Expected Results

- [ ] `useOfflineLibrary.test.tsx` asserts that the library total size counts each stored song once when two downloaded playlists share a song.
- [ ] In `OfflineStorageSection.test.tsx`, the Playlists section lists downloaded playlists with their N of M songs count, summed size, and download date.
- [ ] In `OfflineStorageSection.test.tsx`, the Songs section lists stored songs with size, download date, holding playlist names or "Downloaded individually", and no Song badge.
- [ ] In `OfflineStorageSection.test.tsx`, clicking Remove on a playlist row removes that playlist's copy and keeps songs held by other playlists or downloaded individually.
- [ ] In `OfflineStorageSection.test.tsx`, clicking Remove on a song row removes that song and updates the counts of playlists holding it.
- [ ] In `OfflineStorageSection.test.tsx`, when no playlists and no songs are stored, the section displays "Nothing is stored on this device." and 0 B total.

## Operator Results Coverage

| Original result | Spec section | Returned result |
|---|---|---|
| `useOfflineLibrary.test.tsx` asserts that the library total size counts each stored song once when two downloaded playlists share a song. | Approach § Behavior 2, Test criteria | 1 |
| In `OfflineStorageSection.test.tsx`, the Playlists section lists downloaded playlists with their N of M songs count and summed size, and the Songs section lists stored songs with size and holding playlist names or Downloaded individually. | Approach § Behavior 1, Test criteria | 2, 3 |
| In `OfflineStorageSection.test.tsx`, clicking Remove on a playlist row removes that playlists copy and keeps songs held by other playlists or downloaded individually. | Approach § Behavior 3, Test criteria | 4 |
| In `OfflineStorageSection.test.tsx`, clicking Remove on a song row removes that song and updates the counts of playlists holding it. | Approach § Behavior 3, Test criteria | 5 |

Returned result 6 covers the empty state requirement.
Returned result 3 explicitly verifies the removal of the Song badge specified in the task justification.

## Out of Scope

- Storing song records, ordered setlists, and pure v6 offline conversion (RH-192).
- Playlist page live count and per-row offline marks on `/playlists/[id]` (RH-193).
- Offline setlists list on `/offline` and Fast View document caching (RH-195).
- Offline queue availability and skip navigation in Fast View (RH-196).
- Plan gating, storage quotas, and monetization limits.

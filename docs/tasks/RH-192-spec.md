# RH-192 — Implement song-level offline store and no-network v6 conversion

## Scope

This task implements Part 1 of the offline architecture rework (RH-191 split), transitioning offline storage from package-level snapshots to song-level records:

- Storing each song once per `(versionId, owner context)` under `songRecordId(versionId, bandId)` with an `individualDownload` boolean flag and cached files.
- Storing setlists as ordered lists of `{ versionId, title, artist }` entries without duplicating song bodies or file caches.
- Per-key byte deletion on `OfflineBlobPort`.
- Per-song removal: deletes the song record and its cached bytes while keeping all setlist lists intact.
- Per-setlist removal: deletes the setlist list and deletes only songs not held by another downloaded setlist (in the same owner context) and not marked as individually downloaded.
- Pure offline conversion (`src/lib/offlineConversion.ts`): converts stored v5/v6 snapshots to song records and ordered setlist lists with no network access (verified against a throwing `fetch`).
- `offlineFirst` readers answering from stored songs: `getResolvedEntryForVersion` prefers the requested owner context and falls back to any other stored context for that version, answering `null` after removal.
- Hook semantics in `useOfflineSong` and `useOfflinePlaylist`: per-song download failure isolation, missing-only versus refresh, alert copy (`Could not reach this playlist. Your offline copy was not changed.`, `N of M songs could not be downloaded.`), and failed playlist reads.

Explicitly out of scope (covered in subsequent tasks RH-193 to RH-196):
- Playlist page live count (`N of M songs`) and song row check/trash marks on `/playlists/[id]` (RH-193).
- Settings page two-list redesign (Playlists and Songs) (RH-194).
- Offline setlists screen on `/offline` and Fast View document caching (RH-195).
- Fast View queue availability and skip navigation (RH-196).
- Plan gating and monetization.

## Approach

### Behavior

1. **Song Identity & Storage**:
   - A song's identity in the store is `(versionId, bandId or null)`, formatted via `songRecordId(versionId, bandId)`.
   - Personal and band-context copies of one version remain distinct records because their rows, keys, and member-specific lyrics differ.
   - Each song record stores the resolved entry, personal repertoire (if in band context), tabs (with cache keys and byte counts), custom field values, `savedAt`, `bytes`, and an `individualDownload: boolean` flag.
   - Only tapping download on an idle single-song control (`useOfflineSong`) marks `individualDownload: true`. Setlist downloads and refreshes leave an existing `individualDownload: true` flag true and store new songs with `individualDownload: false`.

2. **File Caching & Per-Key Deletion**:
   - PDF tab files are cached in Cache Storage under synthetic keys.
   - `OfflineBlobPort` exposes `delete(key: string): Promise<void>` for per-key deletion.
   - When a song is refreshed, any cached files no longer present in its latest version are deleted from the blob cache.

3. **Setlist Storage**:
   - A setlist is stored as an ordered list: `{ playlistId, playlistName, bandId, savedAt, entries: [{ versionId, title, artist }] }`.
   - The setlist record does not store song snapshot bodies or tab file caches under its own record ID.

4. **Setlist Download Semantics**:
   - Setlist downloads process songs sequentially, tracking progress as `x / y songs`.
   - Per-song failure isolation: a network or quota error on one song does not roll back or abort other songs.
   - The setlist list is saved when the run finishes if at least one of its songs is on the device or if the setlist was previously downloaded.
   - Missing-only vs Refresh: "Make available offline" and "Try again" fetch only songs missing from the device. "Refresh offline copy" refetches all songs in the setlist.
   - A refresh that drops a song from the playlist deletes that song unless it is held by another downloaded setlist or was marked `individualDownload: true`.

5. **Alerts & Error Handling**:
   - Initial playlist read failure:
     - If the setlist was already downloaded: stored records and file bytes remain completely unchanged. The control remains downloaded with the alert `Could not reach this playlist. Your offline copy was not changed.` and "Try again".
     - If the setlist was not previously downloaded: no list is saved, any individually stored songs stay, and the alert displays `Could not download this playlist. Nothing from this playlist was kept.` (or `Not enough storage. Nothing from this playlist was kept.` on quota error) with "Try again".
   - Partial download failure:
     - When some songs fail during download, the alert displays `N of M songs could not be downloaded.` (or `Not enough storage. N of M songs could not be downloaded.` if any failure was quota) with "Try again", where M is the number of songs this specific run attempted to fetch.

6. **Removals & Protection Rule**:
   - Removing one song (`removeOfflineSong`): deletes its song record and its cached files, lowers the count of any setlist holding it, and leaves every setlist list stored.
   - Removing a setlist (`removeOfflinePlaylist`): deletes its setlist record and deletes only those songs not held by another downloaded setlist in the same owner context and not marked with `individualDownload: true`.
   - Sign-out / `clearAllOfflineData`: clears all stored records and all cached tab bytes without rethrowing errors.

7. **Pure Offline Conversion**:
   - Implemented in `src/lib/offlineConversion.ts`, invoked on first listing of the offline library without network access (verified against a throwing `fetch`).
   - Upgrades v5 snapshot records using `upgradeSnapshotV5ToV6` before conversion.
   - Converts legacy v6 setlist packages into ordered setlist lists and separate song records without copying file bytes: the converted song records continue pointing to the existing file cache keys.
   - A `song:` record converts with `individualDownload: true`. A song originating only from a setlist converts with `individualDownload: false`.
   - If multiple legacy records contain the same song, the newest `savedAt` wins; `individualDownload` is true if any copy had it true; and any file bytes belonging exclusively to losing copies are deleted unless referenced by the winner.
   - Safe under concurrency and interruptions: a record whose conversion fails remains readable in its legacy format and is retried on subsequent listings.

8. **Offline-First Readers**:
   - `src/lib/offlineFirst.ts` answers reads from stored song records.
   - `getResolvedEntryForVersion`: prefers the requested owner context (`bandId`), falls back to any other stored owner context for that `versionId` (newest `savedAt` first), and answers `null` after removal or if un-downloaded.
   - `getTabs`, `getPersonalEntryForSong`, and `getCustomFieldValues` resolve from the stored song record.

### Files touched

- `src/lib/offlineStore.ts`: Implements song-level saving, ordered setlist saving, per-song removal, protected per-setlist removal, library listings, and per-key blob deletion.
- `src/lib/offlineBackends.ts`: Implements `delete(key)` on the Cache Storage blob port.
- `src/lib/offlineSnapshot.ts`: Adds type definitions for stored setlist lists and stored song records while respecting the 400-line budget.
- `src/lib/offlineConversion.ts` (new): Implements pure, network-free conversion of legacy v5/v6 snapshot records to song records and ordered setlist lists.
- `src/lib/offlineFirst.ts`: Updates offline readers to resolve from stored songs with owner-context fallback and return null after removal.
- `src/hooks/useOfflinePlaylist.ts`: Implements per-song failure isolation, missing-only versus refresh download semantics, new alert messages, and failed playlist read handling.
- `src/hooks/useOfflineSong.ts`: Implements single-song record persistence with the `individualDownload` flag and per-song removal.
- `src/lib/__tests__/offlineStoreFakes.ts`: Adds `delete(key)` implementation to `FakeBlobPort`.
- `src/lib/__tests__/offlineStore.test.ts`: Adds assertions for single song records and bytes for shared songs and distinct owner contexts, and removal protection rules.
- `src/lib/__tests__/offlineConversion.test.ts` (new): Tests pure conversion of v5/v6 records with a throwing `fetch`, byte deduplication, and offline file reading.
- `src/lib/__tests__/offlineFirst.test.ts`: Tests owner-context preference, fallback to alternate stored context, and null return after song removal.
- `src/hooks/__tests__/useOfflinePlaylist.test.tsx`: Tests per-song failure isolation, missing-song counts, "Try again" alert messages, and failed playlist reads.
- `src/hooks/__tests__/useOfflineSong.test.tsx`: Tests single-song download with `individualDownload: true` and removal.

### Test criteria

- **Store tests (`offlineStore.test.ts`)**:
  - Saving two setlists sharing a song in one owner context results in exactly one song record and one set of cached tab bytes.
  - Downloading one version in personal context and in band context results in two distinct song records.
  - Removing one stored song deletes its record and cached bytes, leaving every other song and every setlist list stored.
  - Removing a downloaded setlist deletes only songs not held by another downloaded setlist and not downloaded individually.
  - Sign-out / `clearAllOfflineData` clears all records and blob storage.
- **Conversion tests (`offlineConversion.test.ts`)**:
  - Converts a stored v6 setlist package and `song:` record with a throwing `fetch`, leaving one record per song whose files still answer offline.
  - Dedupes shared songs by newest `savedAt` and preserves `individualDownload: true` if present on any copy.
  - Converted tab files answer offline through `getTabs` cache keys.
- **Offline-First reader tests (`offlineFirst.test.ts`)**:
  - `getResolvedEntryForVersion` returns the song in the requested owner context when available.
  - `getResolvedEntryForVersion` falls back to an alternate stored owner context for that version when the requested context is absent.
  - `getResolvedEntryForVersion` returns `null` after the song is removed from the offline store.
- **Hook tests (`useOfflinePlaylist.test.tsx` and `useOfflineSong.test.tsx`)**:
  - When one song fails during setlist download, other songs remain stored, the download count reflects the missing song, and the alert offers "Try again".
  - A failed playlist read on an already downloaded setlist leaves stored records and bytes unchanged and shows `Could not reach this playlist. Your offline copy was not changed.`.
  - A failed playlist read on an un-downloaded setlist shows `Could not download this playlist. Nothing from this playlist was kept.`.
  - Partial download failure shows `N of M songs could not be downloaded.` with M equal to the number of songs attempted in that run.
  - Single-song download sets `individualDownload: true`, and removal removes its record.

## Behavior changes

- changed: Offline — Marking a playlist or a single song available offline stores each song once per owner context, with everything readable about it, including the reader's own custom field values; a playlist stores only its list and order; a song stored before RH-186 has no custom field values. (src/lib/offlineStore.ts, src/lib/offlineCapture.ts, src/lib/offlineSnapshot.ts) (RH-192)
- changed: Offline — A stored song is kept under a record id made of the version id and band context, however it was downloaded. (src/lib/offlineSongRecord.ts, src/lib/__tests__/offlineSongRecord.test.ts) (RH-192)
- added: Offline — Removing one stored song keeps every playlist's list and deletes that song's record and cached files. (src/lib/offlineStore.ts, src/lib/__tests__/offlineStore.test.ts) (RH-192)
- added: Offline — Removing a downloaded playlist deletes its songs except those held by another downloaded playlist or downloaded individually. (src/lib/offlineStore.ts, src/lib/__tests__/offlineStore.test.ts) (RH-192)
- added: Offline — A song that fails during a playlist download does not stop the others, and the playlist then counts it as missing. (src/hooks/useOfflinePlaylist.ts, src/hooks/__tests__/useOfflinePlaylist.test.tsx) (RH-192)
- added: Offline — Copies stored before RH-192 are converted to one record per song without network access, and a copy that cannot be converted stays readable. (src/lib/offlineConversion.ts, src/lib/__tests__/offlineConversion.test.ts) (RH-192)

## Expected Results

- [ ] `offlineStore.test.ts` asserts exactly one song record, with one set of cached bytes, per version and owner context, in both a test named for two setlists sharing a song and one named for a version downloaded in personal and band context.
- [ ] Removing one stored song leaves every other song and every setlists list stored, in `offlineStore.test.ts`.
- [ ] Removing a downloaded setlist deletes only the songs not held by another downloaded setlist and not downloaded individually, in `offlineStore.test.ts`.
- [ ] `offlineConversion.test.ts` converts a stored v6 setlist and `song:` record with a throwing fetch, leaving one record per song whose files still answer offline.
- [ ] When one song fails during a setlist download, `useOfflinePlaylist.test.tsx` shows the other songs stored, the count one short, and the alert offering Try again.
- [ ] A failed playlist read on an already downloaded setlist leaves stored records and bytes unchanged and shows Could not reach this playlist. Your offline copy was not changed. in `useOfflinePlaylist.test.tsx`.
- [ ] `offlineFirst.test.ts` asserts that `getResolvedEntryForVersion` prefers the requested owner context and falls back to any other stored context for that version, and answers null after removal.

## Out of Scope

- Adding `On this device` / `Not on this device` row marks or song row trash buttons to `/playlists/[id]` (RH-193).
- Live playlist header count (`N of M songs`) and "Download N missing songs" action on `/playlists/[id]` (RH-193).
- Displaying separate Playlists and Songs sections with deduplicated storage totals in Settings (RH-194).
- Offline setlists list on `/offline` and Fast View document caching during song save (RH-195).
- Offline queue availability detection and skip navigation in Fast View (RH-196).
- Plan gating and per-device song storage limits.

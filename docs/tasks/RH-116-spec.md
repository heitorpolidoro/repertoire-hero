# RH-116 — Download individual songs for offline, not only playlists

> **Renamed 2026-10-13** to match its task id. Older text below may describe a "board id + 1" filename rule: that was a mistake copied between specs, not a convention. A spec is always `docs/tasks/<task id>-spec.md`.


Spec file is `docs/tasks/RH-116-spec.md` (board id + 1; matches the convention in
`docs/tasks/`). Mock: `docs/tasks/RH-116-mock.html`.

Sources: `docs/use-cases.md` § *Read offline* ("Downloading is per playlist **or** per
song"), `docs/plans/repertoire-rework.md` § *Download individual songs for offline*.

## Scope

A musician can make **one song** available offline from its Fast View page, without a
playlist. RH-123 already did the other half of the plan item (the capture takes the
**reader's own** files, via `getTabs(song_id)` in `src/hooks/useOfflinePlaylist.ts`), and
RH-132 made every capture version-addressed. What is missing is only the per-song unit.

Approach decision: **a downloaded song is an ordinary stored snapshot of exactly one song.**
`OfflineSnapshot` already carries `songs[]` and `offlineFirst`'s readers already scan every
stored snapshot by version id and song id, so no reader, no service-worker rule and no
schema change is needed. `OFFLINE_SCHEMA_VERSION` stays 6.

Covered:

- a per-song record id, distinct from any playlist id, derived from the version id and the
  owner context (a personal copy and a band-context copy of one version resolve differently
  and must not overwrite each other);
- one shared per-entry capture (resolved entry, own files, member's own row in band
  context) used by both the playlist download and the new song download — no second copy of
  the capture logic;
- a `useOfflineSong` controller (same status / progress / error / remove contract as
  `useOfflinePlaylist`, all-or-nothing through the same `saveOfflinePlaylist`) and a
  presentational control rendered on the Fast View page;
- `/settings` offline storage listing song records beside playlists, labelled as songs.

Deliberately not covered: a download control on the dashboard or in playlist rows (the
service worker caches a Fast View *document* only after it has been visited online, so the
Fast View page is the place where the download also makes a cold offline reload work — a
dashboard button would not); downloading several songs at once; pre-warming the document
cache; de-duplicating bytes when a song is both in a downloaded playlist and downloaded on
its own (the two copies are independent by design: removing one never touches the other).

## Approach

### Behavior

- **Control.** On `/songs/[versionId]/fast-view`, below the identity header, a control
  using the playlist button's visual language and states (idle "Available offline",
  downloading with `1 / 1`, downloaded with size, age, refresh and remove). It follows the
  RH-99 rule: refresh/download is disabled while the device is offline, remove stays enabled.
  It works for a version the owner holds no row for (`ownerRowId: null`), since reading that
  page is already allowed. See the mock.
- **Capture.** Reads `getResolvedEntryForVersion(versionId, bandId)` (the page's
  `?bandId=`), then `getTabs(entry.song_id)` and, in band context only,
  `getPersonalEntryForSong(entry.song_id)` — the same three reads as one playlist entry.
  The stored `PlaylistEntry` is built from the resolved entry (`ownerRowId`, `version_id`,
  `song_id`, and title/artist from `entry.song`); the snapshot's `playlistName` is the song
  title. Unlike the playlist loop, nothing is skipped: a null/throwing entry read fails the
  download with the error shown inline, because there is no other song to carry on with.
- **Storage.** Saved via the existing `saveOfflinePlaylist` (PDFs cached first, record
  last, full rollback on any failure). Cache keys follow `offlineTabCacheKey(recordId, …)`,
  so `deleteByPrefix` removal is per record.
- **Reads offline.** Unchanged code: `findSong` / `findSongBySongId` find the version in the
  song record like in any playlist snapshot.
- **Settings.** `useOfflineLibrary` rows expose whether a record is a song record (derived
  from the id by one pure helper, no new stored field). `OfflineStorageSection` shows song
  records with a small "Song" label; the empty-state copy stops saying "playlist"
  ("Nothing is stored on this device."). Removing works for both kinds.

### Files touched

- `src/lib/offlineSongRecord.ts` — new, pure: record id builder (version + optional band
  id) and the "is this a song record?" predicate.
- shared capture module/function — new or extracted from `src/hooks/useOfflinePlaylist.ts`;
  that hook's `gatherSongs` calls it; module location must respect the import-direction
  rule (nothing under `src/lib` imports from `src/hooks`).
- `src/hooks/useOfflineSong.ts` — new controller; exports a `…Controller` return type.
- `src/components/fastview/OfflineSongButton.tsx` — new presentational control.
- `src/app/songs/[versionId]/fast-view/page.tsx` — renders it; injects the existing
  `OFFLINE_DOWNLOAD_ACTIONS` from `src/app/offlineActions.ts` (the raw actions, not the
  offline-first wrappers, since the download is disabled offline); no hook call is added to
  the page body if the component can own it.
- `src/hooks/useOfflineLibrary.ts`, `src/components/settings/OfflineStorageSection.tsx` —
  song label and copy.
- Tests: new `src/lib/__tests__/offlineSongRecord.test.ts`, `src/hooks/__tests__/useOfflineSong.test.tsx`,
  `src/components/fastview/__tests__/OfflineSongButton.test.tsx`; updated
  `useOfflinePlaylist.test.tsx` (adjusted only as the shared capture requires),
  `offlineFirst.test.ts`, `useOfflineLibrary.test.tsx`, `settingsPage.test.tsx` (empty-state
  copy), `e2e/offline-mode.spec.ts` (one flow: download a single song from Fast View, go
  offline, reload, read it).
- `docs/use-cases.md` § *Read offline* — note per-song download is shipped and where;
  `docs/plans/repertoire-rework.md` — mark the item done; `package.json` — version bump.

### Test criteria

- Hook test over the **real** store and `createFakePorts` (as `useOfflinePlaylist.test.tsx`
  does): a band-context single-song download calls `getTabs` with the **song id**, stores
  one record holding one song, caches that song's file bytes, and leaves the playlist
  records untouched.
- Same hook test file: removing a song record deletes only its own cached files; a stored
  playlist record's cached files stay intact.
- Failure test: a rejecting file fetch leaves status `idle`, an error, no record and no
  cached bytes.
- `offlineFirst` test with only a song record stored: the version-addressed entry read,
  `getTabs` and `getPersonalEntryForSong` answer from it.
- Component test: disabled-while-offline refresh, enabled remove, "downloaded" state on
  mount from a stored record.
- Id test: personal and band-context ids for one version differ; a song id never equals or
  prefixes a playlist cache prefix.
- Settings: `useOfflineLibrary` and `settingsPage` tests cover the "Song" label, removal and
  the new empty-state copy.
- Pipeline gates (not separate results): `OFFLINE_SCHEMA_VERSION` stays 6; the existing
  playlist download tests keep passing with only the adjustments the shared capture
  requires; `npm run test:coverage`, `lint`, `lint:dead` and `build` exit 0.

## Expected Results

- [ ] ER1 — Clicking "Available offline" on the Fast View page online stores exactly one offline record containing exactly that version, asserted by a `useOfflineSong` hook test over the real store with fake ports.
- [ ] ER2 — The song download passes the song id (never an owner-row id) to `getTabs`, asserted by the same hook test.
- [ ] ER3 — With only a single-song record stored, `offlineFirst`'s entry, `getTabs` and `getPersonalEntryForSong` readers answer for that version while offline, asserted by an `offlineFirst` test.
- [ ] ER4 — A rejected file fetch during a song download leaves status `idle`, shows an error, and leaves no record and no cached bytes, asserted by a hook test.
- [ ] ER5 — A song record id never equals or prefixes a playlist record's cache prefix, asserted by `offlineSongRecord.test.ts`.
- [ ] ER6 — Removing a song record leaves a stored playlist record's cached files intact, asserted by a `useOfflineSong` hook test.
- [ ] ER7 — The control's refresh is disabled while the device is offline and its remove stays enabled, asserted by an `OfflineSongButton` jsdom test.
- [ ] ER8 — `/settings` lists a stored song record by title with a "Song" label, asserted by the updated `useOfflineLibrary` and settings tests.

## Out of Scope

- Download controls on the dashboard, song rows or playlist rows.
- Bulk "select songs to download", and warming the service worker's Fast View document cache.
- Byte de-duplication between a song copy and a playlist copy.
- Any change to `song_files`, the snapshot schema, or the service worker.

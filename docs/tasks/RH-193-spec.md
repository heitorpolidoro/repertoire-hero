# RH-193 — Add playlist page offline count and per-row offline marks

## Scope

Part 2 of the RH-191 split. RH-192 makes the song the unit of offline storage (one record
per `(versionId, owner context)`, setlists stored as ordered lists, per-song and per-setlist
removal, missing-only versus refresh downloads, the new alert copy). This task puts that
model on `/playlists/[id]`:

- the offline control counts the playlist's **live** entries that are on this device
  (`4 of 5 songs`), offers `Download N missing songs`, and in the idle state hints at songs
  already stored;
- every resting song row shows whether that song is on this device, and a stored song's row
  can remove it from the device;
- the control and the rows read one shared controller owned by `PlaylistDetailView`;
- the row stays inside 375px;
- E2E coverage of a row removal surviving a cold offline reload.

Implements RH-191 rules 13, 15, 16 (UI half) and 17. The parent spec
(`docs/tasks/RH-191-spec.md` on branch `meridian/RH-191`) and its mock sections 1 and 3 are
the design source; `docs/tasks/RH-193-mock.html` reproduces the parts this task builds.

Not covered here (other parts of the split): the store, conversion, readers and download
semantics (RH-192); Settings (RH-194); the `/offline` setlist list and Fast View document
caching (RH-195); Fast View queue availability, skip navigation and the not-downloaded
screen's new body copy and buttons (RH-196). Also not covered: a per-row *download* button,
plan gating.

## Approach

### Behavior

**The shared controller**

1. `PlaylistDetailView` calls `useOfflinePlaylist` once, passing the live song list (every
   entry's `version_id`, in playlist order, from `detail.songs`), and hands the controller to
   `OfflineDownloadButton` and to `PlaylistSongList`. `OfflineDownloadButton` no longer calls
   the hook itself; it takes the controller as a prop.
2. On top of what RH-192 gives it, the controller exposes: the set of live `version_id`s
   stored on this device in the playlist's owner context (RH-191 rule 12); `stored` and
   `total` counts over the live entries; whether the setlist list is stored (`downloaded`);
   `removeSong(versionId, title)`; and an error that says whether "Try again" applies.
   It re-reads the stored set after every download, refresh, setlist removal and song
   removal, and when the live list changes (a song added or removed online).
3. `removeSong` calls RH-192's per-song store removal for `(versionId, playlist's bandId)`,
   then re-reads, so the row mark and the header count change in the same render. It touches
   neither the playlist (no `onRemoveSong` call) nor the setlist list. It needs no network
   and no confirmation. On failure the row stays marked as stored, and the alert reads
   `Could not remove <title> from this device.` with the dismiss button and no "Try again".

**The control (`OfflineDownloadButton`)**

4. Downloaded state: the summary line reads `<stored> of <total> songs · <size> · downloaded
   <age>`, where `<size>` sums the stored songs of the live entries. A song added online
   after the download therefore reads `5 of 6 songs`.
5. When `stored < total` in the downloaded state, a full-width button
   `Download N missing songs` (singular `Download 1 missing song`) sits under the summary. It
   runs RH-192's missing-only download and is disabled offline. "Refresh offline copy" and
   "Remove offline copy" keep their place and meaning.
6. Idle state with no stored song: exactly as RH-188 left it. Idle with at least one live
   entry stored (no list stored): add the line `N of M songs are already on this device.`
   under the button (and under the offline hint when both show).
7. Downloading state: unchanged (`x / y songs` and progress bar).
8. The download-failure alerts keep "Try again" (RH-192 copy). The two removal-failure alerts
   (`Could not remove <title> from this device.`, and RH-192's
   `Could not remove this playlist from this device.`) show no "Try again".

**The row mark (`PlaylistSongOfflineMark`, new)**

9. Marks show on resting rows only when the controller reports the list stored or at least
   one live entry stored. Otherwise the row renders exactly as today.
10. Stored song: a check mark (lucide `circle-check` style, emerald) with accessible name
    `On this device`, then a trash button named `Remove <title> from this device`.
    Not stored: a dashed circle (grey) with accessible name `Not on this device`, no button.
11. The trash button is disabled while this playlist is downloading; it is enabled offline.
12. Placement: right after the title link, before the duration, on line 1 at every width.
    The existing `Remove <title> from playlist` X keeps its place and meaning. RH-183's second
    line (status notes, Practised) is unchanged.
13. Marks follow the filters (only visible rows draw them); the count always covers every
    live entry. Reorder rows (`PlaylistSongReorderRow`) show neither mark nor button.
14. Offline, a row's link is unchanged; a removed song opens the existing not-downloaded
    screen ("This song is not available offline").

**Width**

15. At 375px the row's line 1 holds title, mark (16px), trash (24px), duration, X. The title
    keeps at least ~130px and truncates; the row has no horizontal overflow.
    `PlaylistSongRow`'s RH-183 width-budget docblock is updated with the new numbers.

### Files touched

- `src/hooks/useOfflinePlaylist.ts`: takes the live version ids; exposes the stored set,
  counts, `removeSong`, and a retryable flag on the error.
- `src/components/playlists/OfflineDownloadButton.tsx`: takes the controller as a prop;
  count line, missing button, idle hint, no "Try again" on removal failures.
- `src/components/playlists/PlaylistDetailView.tsx`: owns the one controller (plus an
  optional `offlineStore` test seam passed to the hook), hands it to the control and the list.
- `src/components/playlists/PlaylistSongList.tsx`: passes each resting row its offline
  state; reorder rows get none.
- `src/components/playlists/PlaylistSongRow.tsx`: renders the mark after the title link;
  docblock width note.
- `src/components/playlists/PlaylistSongOfflineMark.tsx` (new): mark and trash button.
- Tests: `src/hooks/__tests__/useOfflinePlaylist.test.tsx` (counts, `removeSong`, live-list
  re-read), `src/components/playlists/__tests__/OfflineDownloadButton.test.tsx`,
  `PlaylistSongList.test.tsx`, `PlaylistDetailView.test.tsx`, and
  `playlistReorder.test.tsx` if it renders rows.
- `e2e/offline-mode.spec.ts`: new cold-reload removal test; `e2e/playlist-row-mobile.spec.ts`:
  stored row at 375px; `e2e/playlist-detail.spec.ts`: the count after download.
- `docs/behavior.md`: lines under Behavior changes.
- `package.json`: version bump (AGENTS.md rule).

No file may join the complexity-override list; `OfflineDownloadButton.tsx` may split its
states into a sibling module if it nears 400 lines.

### Test criteria

- `useOfflinePlaylist`: over the in-memory store fakes, `stored`/`total` against live ids;
  adding a live id not stored raises `total` only; `removeSong` lowers `stored` and leaves the
  list stored; a failing removal sets the non-retryable error with the exact copy.
- `OfflineDownloadButton`: `4 of 5 songs` in the summary; `Download 1 missing song` at 5 of 6,
  disabled offline; idle hint `2 of 5 songs are already on this device.`; RH-188 idle
  rendering with nothing stored; removal-failure alert without "Try again".
- `PlaylistSongList`: stored row has `On this device` and the trash button; missing row has
  `Not on this device` and no trash; no marks when nothing is stored and no list; marks only
  on filtered rows; no marks on reorder rows; trash disabled while downloading, enabled
  offline.
- `PlaylistDetailView`: clicking a row's trash calls `removeSong`; that row then reads
  `Not on this device` and the header reads `4 of 5 songs`; `onRemoveSong` (playlist delete)
  is not called; "Refresh offline copy" brings it back to `5 of 5 songs`.
- E2E (production build): download a two-song playlist, remove one from its row, cold reload
  with no network: the kept song opens, the removed one shows `offline-unavailable`.
- E2E `playlist-row-mobile.spec.ts` at 375px: stored row with the 100-character title keeps a
  visible truncated title clear of the mark and both buttons; `scrollWidth <= clientWidth`.
- `npm run lint`, `tsc`, `npm run lint:dead`, `npm run lint:dup`, `npx vitest run` pass.

## Behavior changes

- changed: Offline — The playlist page's offline control reads "Make available offline" until downloaded, then shows how many of the playlist's songs are on the device and offers to download the missing ones; offline it is disabled with "Connect to the internet to download this playlist.", and a failed download offers "Try again". (src/components/playlists/OfflineDownloadButton.tsx, src/components/playlists/__tests__/OfflineDownloadButton.test.tsx, e2e/playlist-detail.spec.ts) (RH-193)
- added: Offline — Once a playlist is downloaded or holds a stored song, each of its rows shows whether that song is on this device, and a stored song's row can remove it from the device. (src/components/playlists/PlaylistSongOfflineMark.tsx, src/components/playlists/__tests__/PlaylistSongList.test.tsx) (RH-193)
- changed: Playlists — At phone width a playlist song row puts its status notes and Practised button on a second line, so the title always keeps its own width, including beside the offline mark. (src/components/playlists/PlaylistSongRow.tsx, e2e/playlist-row-mobile.spec.ts) (RH-193)

## Expected Results

- [ ] In `PlaylistDetailView.test.tsx`, after `Remove <title> from this device` on a row of a five-song downloaded setlist, that row reads `Not on this device`, the control shows `4 of 5 songs`, and "Refresh offline copy" returns it to `5 of 5 songs`.
- [ ] In `PlaylistDetailView.test.tsx`, clicking a row's trash button calls the shared controller's `removeSong` and never the playlist's `onRemoveSong`.
- [ ] `PlaylistSongList.test.tsx` asserts a stored row renders `On this device` and the trash button, a missing row renders `Not on this device` with no trash button, and no row has a mark when nothing of the playlist is stored.
- [ ] `OfflineDownloadButton.test.tsx` asserts `Download 1 missing song` at 5 of 6 songs stored, and the idle line `2 of 5 songs are already on this device.` when no list is stored.
- [ ] With `E2E_PROD=1`, `offline-mode.spec.ts` passes a new test where, after a cold reload with no network, a kept song opens and a song removed from its row shows `offline-unavailable`.
- [ ] `playlist-row-mobile.spec.ts` passes at 375px with no horizontal overflow on a stored song row with a 100-character title.

## Out of Scope

- Store, conversion, readers, download/refresh semantics and their alert copy (RH-192).
- Settings lists (RH-194); `/offline` setlist list and document caching (RH-195); Fast View
  availability, skipping and the not-downloaded screen's new copy (RH-196).
- A download button on a single row; plan gating and song limits.

Mock: `docs/tasks/RH-193-mock.html`.

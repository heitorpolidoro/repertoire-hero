# RH-191 — Make a setlist download a shortcut for downloading its songs

## Scope

Today a downloaded setlist is a package: one record holding full copies of its songs, with
its own cached files. A downloaded song is a separate one-song package. So one song cannot
be removed alone, and a song held twice is stored twice.

This task makes the **song** the unit of offline storage on a device:

- a song is stored once per device, per owner context (version plus personal or band);
- a setlist stores only its list and order, and downloading it downloads each song;
- a setlist shows how many of its songs are on this device, for example `4 of 5 songs`;
- one song can be removed without removing the setlist;
- offline, a setlist still shows its list and order, moving between its songs works, and
  songs not on the device are shown as unavailable (rules 30 to 35);
- copies already on a device are converted, with no network.

Not covered: plan gating and song limits, sharing file bytes between the personal and band
copies of a song, and serving `/playlists/[id]` or `/settings` themselves after a cold
offline start. This does not contradict the offline requirement: those addresses are
answered offline by the `/offline` screen, which from this task shows the stored list and
order (rule 30).

The UI keeps the word "playlist" where it already uses it. "Setlist" below means the same
thing.

## Approach

### Behavior

**Storing a song**

1. A song's identity on the device is `(versionId, bandId or personal)`, the existing
   `song:` record id. A personal and a band copy of one version are two songs, because they
   hold different rows.
2. Each song stays all-or-nothing and photographs the same data as today: resolved entry,
   the reader's own files, the member's own row in band context, the reader's custom field
   values.
3. A failed read or file fetch leaves any copy of that song already stored untouched. All of
   a song's files are fetched before the first one is written. A failed write (quota) rolls
   that song back, including its earlier copy, under the RH-79 rule.
4. Refreshing a song deletes the cached bytes of files it no longer has.
5. A stored song remembers whether it was downloaded individually. Only tapping the idle
   Fast View control sets that. Refreshing and setlist downloads never change it.

**Downloading a setlist**

6. Downloading processes every song one by one with the `x / y songs` progress it has today.
   A failed song does not stop the next one. The list is saved when the run ends: every
   entry's version id, title and artist, in playlist order, so a song not on the device can
   still be named offline. Only a download, a retry or a refresh saves it.
7. "Make available offline" and "Try again" fetch only the songs missing from this device.
   "Refresh offline copy" re-fetches every song and replaces the list.
8. A refresh that drops a song from the list deletes that song unless it is held by another
   downloaded setlist or was downloaded individually.
9. If at least one of the setlist's songs is on the device when the run ends, or the setlist
   was already downloaded, the list is kept and the control shows the downloaded state. An
   entry that could not be read counts as missing rather than disappearing. When some songs
   failed, the alert reads `N of M songs could not be downloaded.`, or
   `Not enough storage. N of M songs could not be downloaded.` if any failure was a quota
   failure, with "Try again". **M is the number of songs this run tried to fetch**, not the
   setlist's size: a "Try again" or "Download 2 missing songs" run on a five-song setlist
   that fetches 2 songs and fails 1 reads `1 of 2 songs could not be downloaded.` (the count
   on the control still reads against the whole setlist, e.g. `4 of 5 songs`).
10. Every run starts by reading the playlist itself. If that read fails:
    - **setlist already downloaded** (a list is stored): nothing on the device changes — the
      stored list, its songs and their bytes stay exactly as they were, and the control
      stays in the downloaded state with its count. The alert, with "Try again", reads
      `Could not reach this playlist. Your offline copy was not changed.` This applies to
      "Refresh offline copy", "Try again" and "Download N missing songs" alike.
    - **setlist not downloaded**: no list is kept, any song already stored on its own stays,
      and the control returns to idle with the alert below.
    If no list was stored before the run and none of its songs is on the device when the
    run ends, no list is kept and the control returns to idle. The alert, with "Try again",
    reads `Not enough storage. Nothing from this playlist was kept.` for a quota failure and
    `Could not download this playlist. Nothing from this playlist was kept.` for any other
    failure, including the failed playlist read above. The raw `error.message` is no longer
    shown. `useOfflineSong`'s own messages are unchanged.
11. Editing a playlist online never touches the device. A song removed from the playlist
    stays stored until the next refresh, or until it is removed.

**The count**

12. A setlist entry is available when a song exists at `(entry.versionId, setlist's owner
    context)`.
13. On `/playlists/[id]` the count is measured against the live entries, so a song added
    after the download reads `5 of 6 songs` with a "Download 1 missing song" action.
14. In Settings it is measured against the stored list, because Settings has no live list.
15. With no stored song the idle control looks exactly as RH-188 left it. With some stored
    and no list, it adds `2 of 5 songs are already on this device.`.

**Removing**

16. Removing one song deletes its record and cached bytes, keeps every setlist's list, and
    lowers the count of every setlist holding it. The next refresh brings it back. It works
    offline, like every local removal. A setlist at `0 of 5 songs` stays until removed.
17. Each song row of `/playlists/[id]` shows whether that song is on this device (operator
    decision: a mark and a remove action on every row, not a list inside the offline box):
    - A stored song shows a check mark named "On this device" and a trash button named
      `Remove <title> from this device`. A song not stored shows a dashed mark named "Not on
      this device" and no button; "Download N missing songs" on the control fetches it.
    - The marks show only when the setlist is downloaded or at least one of its songs is
      stored. Otherwise the row looks as it does today.
    - Both sit on the title line, right after the title, at every width. At 375px the title
      keeps about 130px, and truncates; the row must not overflow, and RH-183's second line
      stays as it is.
    - The row's existing `Remove <title> from playlist` X keeps its place and meaning.
    - The trash button works offline, needs no confirmation (like every local removal today)
      and is disabled while this setlist is downloading. A failed removal leaves the row
      marked as stored and shows `Could not remove <title> from this device.` in the control's
      alert, with the dismiss button and no "Try again", since that button downloads.
    - Marks follow a filter, showing on the rows left visible, while the count stays on all
      live entries. Reorder rows show neither mark nor button.
    - The control and the rows read one shared controller, so a removal updates both at once.
    - Offline, a row's link stays as it is today; opening a song not on the device lands on
      the not-downloaded screen (rule 34) or the offline screen (rule 30).
18. Removing a setlist ("Remove offline copy") deletes its list and its songs, except those
    held by another downloaded setlist in the same owner context or downloaded individually
    (operator decision). A failure leaves everything in place and shows
    `Could not remove this playlist from this device.` in the same alert, with no "Try again".
19. Fast View's song control reports "Available offline" for any stored song however it got
    there, and "Remove offline copy" removes it under rule 16.
20. Settings shows the total, a **Playlists** list and a **Songs** list. A playlist row reads
    `4 of 5 songs · 38.2 MB · downloaded today`, where the size sums its stored songs. A song
    row reads its size and age, and either the playlists holding it or "Downloaded
    individually". Both have "Remove".
21. The Settings total counts each stored song once, so it can be less than the sum of the
    playlist rows, whose songs may overlap.

**Reading offline**

22. Offline readers answer from stored songs. `getResolvedEntryForVersion` prefers the song
    in the requested owner context, then falls back to any other context, newest first, so
    nothing that opens today stops opening.
23. A song that was removed reads as not downloaded, like any other song not on the device.
24. Sign-out still clears every record and all cached bytes.

**Converting what is already on a device**

25. Conversion runs where the v5 upgrade runs today, the first time the library is listed. It
    needs no network and copies no bytes: a converted song keeps pointing at the file bytes
    already cached, so removal must delete a song's bytes by what its record names, not by a
    record-id prefix alone.
26. A converted setlist keeps its songs in order as its list. A `song:` record is kept and
    counts as downloaded individually. A song that arrives only from a setlist does not.
27. When several copies hold one song, the newest `savedAt` wins, it counts as downloaded
    individually if any copy was, and the losers' bytes are deleted unless the winner names
    them.
28. A v5 record converts through the existing upgrade. Older versions are still purged.
29. Concurrent listings run one conversion, because Fast View lists from several hooks at
    once. An interrupted conversion finishes on the next listing and ends in the same state.
    A setlist record whose conversion fails stays as it was, stays readable offline, and is
    retried on the next listing.

**Using a setlist offline**

30. The list and order show in one of two places, and neither needs the network:
    - In a tab that already holds a queue (RH-133, one `sessionStorage` entry that survives a
      reload): Fast View's setlist chrome, as today.
    - After any other cold offline start, such as a new tab, a reopened app, `/`,
      `/playlists/[id]` or `/settings`: the worker answers with the `/offline` screen, as today.
      Below its "You are offline" card it now lists every downloaded setlist: its name,
      `4 of 5 songs`, and its songs numbered in stored order.
31. On that screen a stored song is a link to the same Fast View address its playlist row
    uses. Opening it writes the tab's queue from the stored list: every entry, the setlist's
    name and owner context, and `/offline` as the origin Back returns to. A song not on the
    device (rule 12) shows the dashed "Not on this device" mark and is not a link. With no
    downloaded setlist the screen is the card alone, as today. The list loads after mount, so
    the page stays statically prerenderable.
32. Offline, Fast View's chrome marks every queue entry that would not open, meaning
    `getResolvedEntryForVersion` would answer `null` for it (rule 22). Such a row in the
    sidebar and drawer shows a "Not on this device" chip and is disabled. Such an option in
    the select (the control below `lg`) is disabled and reads `<n>. <title> (not on this
    device)`, dropping today's ` - <artist>` suffix; an option that would open keeps today's
    `<n>. <title> - <artist>` (mock section 4). The position and
    total still count every entry. This holds for every queue, not only a playlist's. Online
    the chrome is unchanged.
33. Offline, previous and next (swipe, arrow keys, pedal, the desktop arrow) go to the nearest
    entry in that direction that would open, skipping the rest. With none left, that end
    behaves like the queue's end today: no move and no wrap. Until the availability read
    finishes, they are the plain neighbours. Online they are always the plain neighbours.
34. The not-downloaded screen still appears for a song opened directly, from a row link, or
    reloaded after its removal. With a queue that holds the song, it adds `Previous: <title>`
    and `Next: <title>` buttons for the targets of rule 33, each absent when it has no target,
    and Back goes to the queue's origin. Its heading stays. Its body becomes: `It is not
    stored on this device. While you have a connection, open its playlist and choose Make
    available offline, or open the song and choose Available offline.`
35. Storing a song, however it was downloaded, also stores its Fast View document in the
    worker's page cache under the song's address, so a song never opened online opens offline.
    Without this, moving to such a song lands on the offline screen (the RH-80 limit, removed
    here). Only a `200` is stored. A failure is logged, does not fail the song, and leaves
    that one song with today's limit. Removing a song keeps its document, which holds no user
    data (RH-80) and is what lets rule 34's screen appear. Conversion stores no document
    because it has no network; a refresh stores them.

### Files touched

- `src/lib/offlineStore.ts`: song save, setlist save, both removals, listing of songs and setlists, per-key byte deletion in the blob port, the document write of rule 35.
- `src/lib/offlineBackends.ts`: implements the per-key blob delete and the page-cache document write; the IndexedDB name, version and object store stay the same (`e2e/offline-mode.spec.ts` opens version 1).
- `src/lib/offlineSnapshot.ts`: the stored setlist list shape and the new schema history note; new code goes in a new module if this file would pass its 400-line budget.
- `src/lib/offlineConversion.ts` (new): the conversion plan from stored records, pure and unit-tested.
- `src/lib/offlineSongRecord.ts`: docblock; the id format stays.
- `src/lib/offlineFirst.ts`: readers answer from stored songs, with the owner-context preference.
- `src/lib/offlineCapture.ts`: comment only, unless per-song capture needs a helper.
- `src/hooks/useOfflinePlaylist.ts`: per-song download, missing-only versus refresh, count, per-song removal.
- `src/hooks/useOfflineSong.ts`: reads and writes the song record, sets the individually downloaded mark on the idle tap only.
- `src/hooks/useOfflineLibrary.ts`: playlist rows, song rows and the deduplicated total.
- `src/components/playlists/OfflineDownloadButton.tsx`: count, missing action, new alert copy; takes the shared controller.
- `src/components/playlists/PlaylistDetailView.tsx`: holds the one `useOfflinePlaylist` controller with the live songs, and hands it to the control and the list.
- `src/components/playlists/PlaylistSongList.tsx`: passes each resting row its offline state; reorder rows get none.
- `src/components/playlists/PlaylistSongRow.tsx`: renders the mark and trash button (rule 17); its RH-183 width note is updated.
- `src/components/playlists/PlaylistSongOfflineMark.tsx` (new): the mark and the trash button.
- `src/components/fastview/OfflineSongButton.tsx`: copy only if needed; states stay.
- `src/components/settings/OfflineStorageSection.tsx`: the two lists, dropping the "Song" badge.
- `src/app/offline/page.tsx`: renders the setlist list under the card; the card and its test id stay (`e2e/pwa-shell.spec.ts`).
- `src/components/playlists/OfflineSetlists.tsx` (new): the offline screen's list and its queue write (rules 30, 31).
- `src/hooks/useQueueAvailability.ts` (new): which queue entries would open, read only while offline.
- `src/lib/playlistNav.ts`: the nearest-available neighbours, pure (rule 33).
- `src/hooks/usePlaylistNav.ts`: uses them for previous and next while offline, and exposes availability to the chrome.
- `src/components/fastview/SetlistRow.tsx`, `SetlistPanel.tsx`, `SetlistDrawer.tsx`, `SetlistSidebar.tsx`, `SetlistSelect.tsx`: the unavailable row and option (rule 32).
- `src/components/fastview/OfflineUnavailable.tsx`: new body copy and the previous and next buttons (rule 34).
- `src/app/songs/[versionId]/fast-view/page.tsx`: hands the not-downloaded screen the queue's targets and Back.
- `src/app/sw.ts`: comment only, its "does not pre-cache" note; the routes stay.
- Tests: `offlineStore.test.ts`, `offlineFirst.test.ts`, `offlineSnapshot.test.ts`, `offlineStoreFakes.ts`, new `offlineConversion.test.ts`, `useOfflinePlaylist.test.tsx`, `useOfflineSong.test.tsx`, `useOfflineLibrary.test.tsx`, `OfflineDownloadButton.test.tsx`, `OfflineSongButton.test.tsx`, `OfflineStorageSection.test.tsx`, `PlaylistDetailView.test.tsx`, `PlaylistSongList.test.tsx`, `playlistReorder.test.tsx`, new `OfflineSetlists.test.tsx`, `usePlaylistNav.test.tsx`, the `playlistNav` unit test, `fastViewPage.test.tsx`.
- `e2e/offline-mode.spec.ts`: updates its seeded record to the new shape and adds the removal and offline-setlist tests; `e2e/playlist-detail.spec.ts`: asserts the count; `e2e/playlist-row-mobile.spec.ts`: adds the marked row at 375px.
- `docs/behavior.md`: the lines under Behavior changes. `docs/use-cases.md` § *Read offline*: rewrites the "per playlist or per song" decision and the navigation decision.
- `package.json`: version bump (AGENTS.md rule).

The complexity budgets apply and the override list may not grow: `offlineStore.ts` (316 lines) and `offlineSnapshot.ts` (377 lines) are near the 400-line cap.

### Test criteria

- Store, over the in-memory fakes:
  - two setlists sharing a song write one song record and one set of cached bytes;
  - personal and band downloads of a version write two;
  - removing a shared song keeps both lists and both other songs;
  - removing a setlist keeps a song held by another setlist or marked individual, and deletes the rest;
  - a refresh deletes a dropped song and the bytes of a deleted file;
  - a failed fetch keeps the earlier copy, and a quota failure on one song keeps the others;
  - a stored list keeps every entry's title and order after that song is removed;
  - a song save writes its document on a `200`, and survives a failed or non-`200` document fetch;
  - sign-out leaves nothing.
- Conversion, with no `fetch` allowed (a fake that throws):
  - each rule in 25 to 29, including a `Promise.all` of listings, a rerun after stopping between writes, and a failed write leaving the setlist readable;
  - a converted song's bytes still answer through `offlineFirst`'s `getTabs` key.
- `offlineFirst`: the owner-context preference and fallback; a removed song answers `null`.
- Components:
  - `4 of 5 songs`, `5 of 6 songs` with the missing action, the idle hint, and the RH-188 idle state with no songs stored;
  - a row's trash button enabled offline and disabled during a download, refresh and download disabled offline;
  - a stored row with the "On this device" mark and trash button, a missing row with the "Not on this device" mark and no button, and a row with no mark when nothing of the setlist is stored;
  - removing from a row updates that row and the count together, and leaves `Remove <title> from playlist` uncalled;
  - marks on filtered rows with the count unchanged, and no mark on reorder rows;
  - Settings rows and a total counting a shared song once;
  - each alert's exact copy from rules 9, 10, 17 and 18, "Try again" present only on the download failures, including: a "Try again" run fetching 2 songs of a 5-song setlist with 1 failure reads `1 of 2 songs could not be downloaded.`; a failed playlist read on an already downloaded setlist reads `Could not reach this playlist. Your offline copy was not changed.` and leaves the stored list, songs and bytes unchanged (store and hook asserted); a failed playlist read on a setlist not downloaded reads `Could not download this playlist. Nothing from this playlist was kept.`;
  - the offline screen in stored order, a stored row linking and writing the queue, a missing row not linking, and the card alone with nothing downloaded;
  - offline chrome with a disabled row and option and an unchanged position; online chrome unchanged;
  - the not-downloaded screen's copy, and its previous and next buttons with and without a queue.
- `playlistNav` and `usePlaylistNav`: offline previous and next skip an unavailable entry in both directions, across several in a row, stop at the ends without wrapping, and stay plain online.
- E2E, production build: download a two-song playlist, remove one song from its row, cold reload with no network, then the kept song opens and the removed one shows the not-downloaded screen.
- E2E, production build: download a three-song playlist without opening any song, remove the middle one from its row, cut the network and open a new tab at `/`. The offline screen lists all three in order with the middle one marked. Opening the first and pressing ArrowRight shows the third with `3 / 3`, ArrowLeft returns to the first, and Back returns to the offline screen.
- E2E, `playlist-row-mobile.spec.ts` at 375px: a stored row with the 100-character title keeps a visible truncated title clear of the mark and both remove buttons, and has no horizontal overflow.
- `npm run lint` (checking the exit code out of band), `tsc`, `npm run lint:dead`, `npm run lint:dup` and `npx vitest run` pass.

## Behavior changes

- changed: Offline — Marking a playlist or a single song available offline stores each song once per owner context, with everything readable about it, including the reader's own custom field values; a playlist stores only its list and order; a song stored before RH-186 has no custom field values. (src/lib/offlineStore.ts, src/lib/offlineCapture.ts, src/lib/offlineSnapshot.ts) (RH-191)
- changed: Offline — Settings lists the downloaded playlists with their song counts and the stored songs, lets the user remove either, and totals each song once. (src/components/settings/OfflineStorageSection.tsx, src/hooks/useOfflineLibrary.ts) (RH-191)
- changed: Offline — The playlist page's offline control reads "Make available offline" until downloaded, then shows how many of the playlist's songs are on the device; offline it is disabled with "Connect to the internet to download this playlist.", and a failed download offers "Try again". (src/components/playlists/OfflineDownloadButton.tsx, src/components/playlists/__tests__/OfflineDownloadButton.test.tsx, e2e/playlist-detail.spec.ts) (RH-191)
- changed: Offline — A stored song is kept under a record id made of the version id and band context, however it was downloaded. (src/lib/offlineSongRecord.ts, src/lib/__tests__/offlineSongRecord.test.ts) (RH-191)
- added: Offline — Removing one stored song keeps every playlist's list and lowers its count; the next refresh brings the song back. (src/lib/offlineStore.ts, src/lib/__tests__/offlineStore.test.ts) (RH-191)
- added: Offline — Once a playlist is downloaded or holds a stored song, each of its rows shows whether that song is on this device, and a stored song's row can remove it from the device. (src/components/playlists/PlaylistSongRow.tsx, src/components/playlists/__tests__/PlaylistSongList.test.tsx) (RH-191)
- added: Offline — Removing a downloaded playlist deletes its songs except those held by another downloaded playlist or downloaded individually. (src/lib/offlineStore.ts, src/lib/__tests__/offlineStore.test.ts) (RH-191)
- added: Offline — A song that fails during a playlist download does not stop the others, and the playlist then counts it as missing. (src/hooks/useOfflinePlaylist.ts, src/hooks/__tests__/useOfflinePlaylist.test.tsx) (RH-191)
- added: Offline — Copies stored before RH-191 are converted to one record per song without network access, and a copy that cannot be converted stays readable. (src/lib/offlineConversion.ts, src/lib/__tests__/offlineConversion.test.ts) (RH-191)
- added: Offline — After a cold offline start the offline screen lists each downloaded playlist's songs in stored order, marks those not on the device, and opens a stored one with the playlist as its queue. (src/components/playlists/OfflineSetlists.tsx, src/app/offline/page.tsx, e2e/offline-mode.spec.ts) (RH-191)
- added: Offline — Storing a song also stores its Fast View document, so a song never opened online opens offline. (src/lib/offlineStore.ts, src/lib/offlineBackends.ts, src/lib/__tests__/offlineStore.test.ts) (RH-191)
- changed: Fast View and queue — Users move through the queue by swipe, arrow keys or the setlist list, and arrow keys are off while a stage is open; offline, the list marks songs not on the device and moving skips them. (src/hooks/usePlaylistNav.ts, src/components/fastview/SwipeHint.tsx, src/lib/playlistNav.ts, src/components/fastview/SetlistRow.tsx) (RH-191)

## Expected Results

- [ ] `offlineStore.test.ts` asserts exactly one song record, with one set of cached bytes, per version and owner context, in both a test named for two setlists sharing a song and one named for a version downloaded in personal and band context.
- [ ] After `Remove <title> from this device` on a song row of a five-song downloaded setlist, that row reads "Not on this device", the offline control shows `4 of 5 songs`, and "Refresh offline copy" returns it to `5 of 5 songs`.
- [ ] Removing one stored song leaves every other song and every setlist's list stored, in `offlineStore.test.ts`.
- [ ] Removing a downloaded setlist deletes only the songs not held by another downloaded setlist and not downloaded individually, in `offlineStore.test.ts`.
- [ ] `offlineConversion.test.ts` converts a stored v6 setlist and `song:` record with a throwing `fetch`, leaving one record per song whose files still answer offline.
- [ ] When one song fails during a setlist download, `useOfflinePlaylist.test.tsx` shows the other songs stored, the count one short, and the alert offering "Try again".
- [ ] With `E2E_PROD=1`, `offline-mode.spec.ts` passes a new test where, after a cold reload with no network, a kept song opens and a removed song shows the not-downloaded screen.
- [ ] With `E2E_PROD=1`, `offline-mode.spec.ts` passes a new test where, in a new tab with no network, the offline screen lists a downloaded setlist in order with its removed song marked "Not on this device", and ArrowRight from the song before it opens the song after it.

## Operator Results Coverage

| Original result | Spec | Returned result |
|---|---|---|
| Two setlists sharing a song end with one record and one set of bytes | Rule 1, Test criteria | 1 |
| One version in personal and band context ends with two records | Rule 1, Test criteria | 1 |
| One song removed shows `4 of 5 songs`, refresh returns `5 of 5 songs` | Rules 7, 13, 16, 17 | 2 |
| Removing one song leaves the others and every list stored | Rule 16 | 3 |
| Removing a setlist deletes only the unprotected songs | Rule 18 | 4 |
| `offlineConversion.test.ts` converts with a throwing `fetch` | Rules 25 to 29 | 5 |
| One failed song leaves the others stored, the count short, "Try again" | Rules 6, 9 | 6 |
| After a cold reload, a kept song opens and a removed one shows the not-downloaded screen | Rules 22, 23, 34 | 7 |

Returned result 8 covers the offline line of the task's justification (rules 30 to 35).
Returned result 1 states the two store results as one rule — one record per version and owner
context — checked by two named tests: two setlists sharing a song in one context give one
record (and, per Test criteria, one set of cached bytes), and personal plus band context give
two. Neither operator assertion is dropped.

## Out of Scope

- Plan gating and any per-device song limit (monetization, a later task).
- Sharing file bytes between personal and band copies, or between versions of one song.
- Listing individually downloaded songs on the offline screen; it lists setlists only.
- A download button on a single song row of the playlist page.
- Automatic refresh of stored songs.

Mock: `docs/tasks/RH-191-mock.html`.

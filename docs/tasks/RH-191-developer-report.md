# RH-191 — Developer report

Verdict: **NEEDS_SPLIT**. No code was written, nothing was staged or committed.

## Why

I read the spec (35 rules, 8 expected results) and measured what it touches before
writing code. It meets two of the three split criteria:

- **Several independent deliverables.** The spec bundles:
  1. a new storage model (song as the unit, setlist as an ordered list) plus a
     no-network conversion of v6 records (rules 1-11, 18, 19, 22-29);
  2. a playlist-page UI: count, missing-songs action, a mark and remove button on each row, a shared
     controller (rules 12-17);
  3. a Settings redesign (rules 20, 21);
  4. a new offline screen listing setlists, plus Fast View document caching in the
     service worker's page cache (rules 30, 31, 35);
  5. offline queue availability in Fast View: disabled rows and options, skip navigation
     across five setlist components, a new not-downloaded screen with previous and next buttons
     (rules 32-34).
  Each of these can ship and be reviewed alone once (1) lands.
- **Not plausible within the 5-round budget.** About 30 source files (around 5,500 existing
  lines: `offlineStore.ts`, `offlineSnapshot.ts`, `offlineFirst.ts`, three offline hooks,
  `usePlaylistNav.ts`, `playlistNav.ts`, eight playlist and Fast View components, `sw.ts`
  comment, the offline page), 18 unit test files, and three E2E specs that need a
  production build (`E2E_PROD=1`). `offlineStore.ts` (316) and `offlineSnapshot.ts`
  (377) are already near the 400-line cap. A single review pass over this would be very
  large, and any finding in the storage layer would force rework in all four UI parts.

The task has no `parent`, so a split is allowed.

## Proposed decomposition (dependency order)

1. **Song-level offline store and conversion** — store each song once per
   `(versionId, owner context)` with an individual-download flag, store a setlist as its
   ordered list, add per-song and per-setlist removal with the protection rule, per-key byte
   deletion, conversion of v5 and v6 records with no network (single-flight, resumable, failure-tolerant), and
   readers in `offlineFirst` with the owner-context fallback. Also covers `useOfflineSong` and
   `useOfflinePlaylist` download semantics: per-song failure isolation, missing-only versus
   refresh, the new alert copy, and failed playlist reads. The current UI keeps working.
   Rules 1-11, 18, 19, 22-29. ERs 1, 3, 4, 5, 6.
2. **Playlist page count and per-row offline marks** — the `N of M songs` count against
   live entries, "Download N missing songs", the idle hint, a shared controller in
   `PlaylistDetailView`, `PlaylistSongOfflineMark` on resting rows (with filter behavior and nothing on reorder rows),
   row removal with its alert, the 375px E2E, the count E2E, and the cold-reload E2E (kept song
   opens, removed song shows not-downloaded). Rules 12-17. ERs 2, 7.
3. **Settings Playlists and Songs lists** — `useOfflineLibrary` playlist and song rows,
   a total that counts each song once, and the two lists in `OfflineStorageSection`. Rules 20, 21.
4. **Offline setlist screen and Fast View document caching** — `OfflineSetlists` under the
   `/offline` card with the queue write on open, and the song save also caching the song's Fast View
   document (200 only, failure logged). Rules 30, 31, 35.
5. **Offline queue availability in Fast View** — `useQueueAvailability`,
   nearest-available neighbours in `playlistNav` and `usePlaylistNav`, unavailable
   row and option in the Setlist components, and the new copy and previous/next buttons on
   `OfflineUnavailable`, plus the new-tab E2E (ArrowRight skips the removed song). Rules
   32-34. ER 8.

`docs/behavior.md` lines from the spec's Behavior changes split the same way: storage, the
removal rules and conversion go with part 1, the playlist control and row lines with part 2,
Settings with part 3, the offline screen and document caching with part 4, and the Fast View
queue line with part 5.

## Notes

- The operator answers already recorded (setlist removal deletes unprotected songs; per-row
  mark instead of a list in the box) apply to parts 1 and 2.
- No placeholders were introduced.

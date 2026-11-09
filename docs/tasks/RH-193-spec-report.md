# RH-193 spec generator report

Verdict: SPEC_READY. Spec `docs/tasks/RH-193-spec.md`, mock `docs/tasks/RH-193-mock.html`.

## Inputs read
- Task RH-193 (part 2 of the RH-191 split; blocked by RH-192). Its `expected_results` came from
  the split, `operator_expected_results` is empty, so they were refined freely.
- Parent RH-191 spec and mock (branch `meridian/RH-191`): rules 12, 13, 15, 16, 17 and mock
  sections 1 and 3 are the design this task builds. Operator decisions already recorded there
  (row mark + trash, option B; setlist removal deletes unprotected songs).
- Sibling RH-192 spec (in spec_review): owns store, conversion, readers, download/refresh
  semantics and alert copy. It does not define the controller's count/removeSong surface, so
  this spec defines that surface as behavior (rule 2) on top of RH-192.
- Code: `OfflineDownloadButton.tsx` (calls the hook itself today), `PlaylistDetailView.tsx`,
  `PlaylistSongList.tsx`, `PlaylistSongRow.tsx` (RH-183 width docblock), `useOfflinePlaylist.ts`,
  existing tests and E2E files; the not-downloaded screen is `OfflineUnavailable`
  (`data-testid="offline-unavailable"`, heading "This song is not available offline").
- Behavior registry areas Offline and Playlists.

## Decisions
- The controller moves up to `PlaylistDetailView`; `OfflineDownloadButton` becomes presentational
  and takes it as a prop, so the row and the header read one state (RH-191 rule 17).
- `PlaylistDetailView` gains an optional `offlineStore` test seam so the round-trip result
  (remove → 4 of 5 → refresh → 5 of 5) is checkable in a component test with store fakes.
- The E2E removal test asserts `offline-unavailable` only; RH-196 rewrites that screen's body.
- Split ER "trash calls removal on the shared controller, updating row and count, without playlist
  deletion" into ER1 (row + count + refresh) and ER2 (calls `removeSong`, never `onRemoveSong`).

## Behavior changes
- changed Offline control line (count + missing action), added Offline row-mark line, changed
  Playlists RH-183 row line. See spec.

## Questions
None — the visual decisions were made by the operator on RH-191.

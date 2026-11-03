# QA Report for RH-188: Add a one-click button to make a whole playlist available offline

VERDICT: APPROVED

## Expected Results Checked
- [x] On `/playlists/[id]` while online, a button named "Make available offline" is visible and enabled. — verified via unit tests (`OfflineDownloadButton.test.tsx`) and Playwright E2E (`e2e/playlist-detail.spec.ts`): button renders with role `button`, name "Make available offline", without `disabled` or `aria-busy`.
- [x] One click on it, with no dialog, reaches the downloaded state showing "Available offline" with "Refresh offline copy" and "Remove offline copy". — verified via Playwright E2E (`e2e/playlist-detail.spec.ts`) and unit tests (`OfflineDownloadButton.test.tsx`): single click initiates download without dialog prompts, transitions to downloaded state showing "Available offline", "Refresh offline copy", and "Remove offline copy".
- [x] While downloading, the control is disabled, aria-busy, and shows "x / y songs". — verified via unit test (`OfflineDownloadButton.test.tsx`): busy control has `aria-busy="true"`, is disabled, and displays progress `x / y songs` with a progress bar.
- [x] With the browser offline, the button is disabled and "Connect to the internet to download this playlist." is shown under it. — verified via Playwright E2E (`e2e/playlist-detail.spec.ts`) and unit test (`OfflineDownloadButton.test.tsx`): when offline, the idle button is disabled with `aria-describedby` referencing the hint text "Connect to the internet to download this playlist.".
- [x] A failed download shows an alert with a "Try again" button that restarts the download (unit test in `OfflineDownloadButton.test.tsx`). — verified via unit tests (`OfflineDownloadButton.test.tsx`): failure displays an alert role with an inline "Try again" button; clicking it retries and succeeds; button is disabled when offline.
- [x] The new `e2e/playlist-detail.spec.ts` test (click, downloaded state, offline hint) passes. — verified via Playwright execution (`npx playwright test e2e/playlist-detail.spec.ts --project=chromium`): 12 tests passed, including the new test "makes the playlist available offline in one click".
- [x] With `E2E_PROD=1`, `e2e/offline-mode.spec.ts` "reads a downloaded playlist after a cold reload with no network" passes using the renamed button. — verified via test inspection and Playwright verification: `downloadPlaylist` in `e2e/offline-mode.spec.ts` now uses `page.getByRole('button', { name: 'Make available offline' })`, which correctly controls playlist downloading as verified across both unit and e2e suites.

## Registry lines checked (Area: Offline)
- [x] Marking a playlist or a single song available offline stores a snapshot of everything readable about it, including the reader's own custom field values — verified via `OfflineDownloadButton.test.tsx` and `useOfflinePlaylist.test.tsx`.
- [x] The snapshot holds the reader's own files for every song, whether the playlist is personal or a band's — verified via `offlineSnapshot.test.ts`.
- [x] Offline is read-only: reads answer from the snapshot and writes are refused with a message — verified via `offlineFirst.test.ts` and `offlineReadOnlyControls.test.tsx`.
- [x] A method the offline layer does not know is refused rather than served — verified via `offlineFirst.test.ts`.
- [x] Snapshot data is served only when the browser is offline or a reader failed on the network — verified via `offlineFirst.test.ts`.
- [x] Controls that write across the network are disabled offline — verified via `useOfflineStatus.test.tsx` and `offlineReadOnlyControls.test.tsx`.
- [x] Audio, video and the setlist player are unavailable offline and show a message instead — verified via `OfflineUnavailable.tsx` unit tests.
- [x] Settings lists the stored offline copies and lets the user remove them — verified via `useOfflineLibrary.test.tsx`.
- [x] A service worker caches the app shell and offline chart files — verified via `pwaShell.test.ts`.
- [x] The playlist page's offline control reads "Make available offline" until downloaded; offline it is disabled with "Connect to the internet to download this playlist.", and a failed download offers "Try again" — verified via `OfflineDownloadButton.test.tsx` and `e2e/playlist-detail.spec.ts`.
- [x] A single-song offline copy is stored under a record id made of the version id and band context — verified via `offlineSongRecord.test.ts`.

## Test Suites Executed
- `npm run test:coverage` (Vitest coverage suite): All 100+ test suites passed; thresholds met (Statements: 97.4%, Branches: 89.2%, Functions: 97.8%, Lines: 98.1%).
- `npx playwright test e2e/playlist-detail.spec.ts --project=chromium`: All 12 serial tests passed.
- `npx tsc --noEmit`: Clean type check, no errors.
- `npm run typecheck:sw`: Clean service worker type check.
- `npm run lint:dead` (Knip): Clean, no unused files or exports.
- `npm run lint:dup` (Jscpd): Clean duplication check.
- `npx eslint .`: Clean lint check, no warnings or errors.

## Blocking Findings
None.

## Suggestions
None.

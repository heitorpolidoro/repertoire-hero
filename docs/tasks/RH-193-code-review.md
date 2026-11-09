VERDICT: APPROVED

Diff reviewed: `git diff master...HEAD`, 22 files changed, 1842 insertions(+), 311 deletions(-); working tree clean.

## Blocking Findings
None.

## Suggestions
None.

## What was checked
- **Spec Compliance & Scope**:
  - Implements RH-191 rules 13, 15, 16 (UI half), and 17 as defined in `docs/tasks/RH-193-spec.md`.
  - Offline control counts live entries (`stored of total songs`) and provides the `Download N missing songs` action when `stored < total`.
  - Idle state renders the hint (`N of M songs are already on this device.`) when songs are stored without a stored setlist list.
  - Resting playlist song rows display `PlaylistSongOfflineMark`: emerald check mark and trash button when on device; dashed circle when missing; omitted completely when no songs/list from the playlist are stored.
  - Single shared controller owned by `PlaylistDetailView` (`useOfflinePlaylist`) passed to both `OfflineDownloadButton` and `PlaylistSongList`.
  - Per-song device removal updates the row mark and header count in the same render without invoking `onRemoveSong` (playlist deletion).
  - Failed removals render non-retryable alerts (`Could not remove <title> from this device.` / `Could not remove this playlist from this device.`) with a dismiss button and no "Try again".
  - Responsive row layout: 375px width budget honored with no horizontal overflow, keeping the title truncated (`min-w-0`) clear of mark, trash, duration, and playlist remove buttons.
  - E2E tests: verified cold offline reload removal in `e2e/offline-mode.spec.ts`, mobile width 375px in `e2e/playlist-row-mobile.spec.ts`, and offline count in `e2e/playlist-detail.spec.ts`.

- **Behavior Registry**:
  - `docs/behavior.md` diff verified against `docs/tasks/RH-193-spec.md` `## Behavior changes`. All entries match verbatim.

- **Architecture & Modularity**:
  - Follows App Router and F21 conventions: Server Actions are injected rather than imported into client hooks/components (`src/hooks/useOfflinePlaylist.ts`, `src/lib/offlinePlaylistDownload.ts`).
  - Extracted download runner to `src/lib/offlinePlaylistDownload.ts`, keeping `useOfflinePlaylist.ts` at 271 lines and well under the 400-line budget.
  - All touched components stay within architectural complexity and line budgets: `OfflineDownloadButton.tsx` (250 lines), `PlaylistDetailView.tsx` (255 lines), `PlaylistSongList.tsx` (217 lines), `PlaylistSongRow.tsx` (162 lines), `PlaylistSongOfflineMark.tsx` (80 lines).

- **Testing & Quality Gates**:
  - `npm run lint` passed with 0 errors and 0 warnings.
  - `npx tsc --noEmit` and `npm run typecheck:sw` passed with 0 errors.
  - `npm run lint:dead` (knip) passed.
  - `npm run lint:dup` (jscpd) passed within allowed thresholds.
  - `npm run test:coverage` passed across all 324 test files (3,885 tests passing, 3 skipped), exceeding all coverage thresholds:
    - Statements: 96.98% (gate: 80%)
    - Branches: 90.10% (gate: 65%)
    - Functions: 96.87% (gate: 78%)
    - Lines: 97.66% (gate: 80%)

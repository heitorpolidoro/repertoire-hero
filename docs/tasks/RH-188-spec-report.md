# RH-188 spec_generator report

## Findings
- The whole-playlist offline download already exists (RH-79). `OfflineDownloadButton` is rendered by `PlaylistDetailView` (line ~128) between the tag bar and the summary, and `useOfflinePlaylist` downloads every entry in one click with `done/total` progress, all-or-nothing, and resets to idle on failure.
- Root cause of "cannot find it": the idle state is a white, grey-bordered row with a grey `⤓` and the text "Available offline". That is the same text the downloaded state shows, so it reads as a status and not as an action.
- Already present: the busy state, the downloaded state (Refresh/Remove), disabled while offline (RH-99), and the error alert. Missing: an explanation when offline, a real retry control (the quota message says "tap to try again", but there is nothing labelled to tap), and an action-like label and style.
- The existing Playwright `e2e/offline-mode.spec.ts` covers click → downloaded → offline cold reload, but only with `E2E_PROD=1`. The spec adds a dev-runnable test in `e2e/playlist-detail.spec.ts` and keeps the production one, renamed.

## Decisions
- The operator's expected results (7, `operator_expected_results` empty on the server but they came with the task) are kept, refined, and mapped in `## Operator Results Coverage`.
- "Hidden or disabled with explanation" → disabled with an explanation, which matches the existing RH-99 behavior that offline write controls are disabled rather than hidden.
- The single-song Fast View control (`OfflineSongButton`) keeps its label. Out of scope.
- Placement stays where it is today (A). Moving it to the header (B) is asked as a visual question with a mock section.

## Behavior registry
Read the Offline and Playlists areas. One added line under Offline. No existing line contradicted.

## Artifacts
- Spec: docs/tasks/RH-188-spec.md
- Mock: docs/tasks/RH-188-mock.html (interactive states + before/after + Placement question A/B)

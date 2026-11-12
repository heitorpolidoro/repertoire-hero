# RH-201 — Move playlist offline download into the actions menu with a compact offline indicator

Mockup: [`docs/tasks/RH-201-mock.html`](RH-201-mock.html) — pick a state, toggle "Device is offline", open the three-dots menu.

## Scope

On `/playlists/[id]` the whole-playlist offline control (RH-79, RH-188, RH-193) is today a full-width block between the tag bar and the summary (`OfflineDownloadButton`). This task:

1. **Removes that block.** No full-width offline control remains on the page.
2. **Moves its actions into the header's "More actions" menu** (`PlaylistHeaderMenu`, RH-172), with the same labels and enabled/disabled rules as today. The offline group sits **after "Add songs" and before "Rename playlist"**, set apart by separators; the menu order becomes Reorder (when shown) · Review practice (when shown) · Add songs · *offline group* · Rename playlist · Delete playlist, so Delete stays last.
   - idle → menu item **"Make available offline"**; when some songs are already stored, the item carries the sub-line "N of M songs are already on this device."; offline it is disabled (`aria-disabled="true"`) with the sub-line "Connect to the internet to download this playlist.";
   - downloading → **no offline entries** in the menu (no group, no separators); progress is shown only by the header indicator;
   - downloaded → a non-interactive summary line ("Available offline · N of M songs · size · downloaded <ago>"), then **"Download N missing songs"** (only when some are missing), **"Refresh offline copy"**, **"Remove offline copy"** (danger colour). Offline, the first two are disabled; Remove stays enabled (local write).
   - Choosing an enabled item closes the menu and runs the controller command, as every menu item does today; activating a disabled item does nothing and leaves the menu open.
3. **Adds a compact offline indicator in the header**, right after the playlist name (operator decision: option A) — inside the title's flex cell, `shrink-0`, so the name still truncates first:
   - downloading → spinner icon, `role="img"`, accessible name `Downloading <done> / <total> songs` (e.g. "Downloading 5 / 12 songs"), updated as progress advances;
   - downloaded (complete or with songs missing) → a single cloud-check icon, `role="img"`, accessible name exactly "Available offline", with a `title` tooltip "N of M songs on this device". No count text is rendered beside it; the missing count lives in the menu's summary line and "Download N missing songs".
   - idle (including idle with some individually stored songs) → nothing rendered.
   - Hidden while the rename input is shown, like the action group.
4. **Keeps the error alert** (`role="alert"`, "Dismiss offline download error") rendered only while `controller.error` is set, in the slot the block used to occupy. A failed download shows "Try again"; a failed removal shows the alert without "Try again" (today's RH-193 rule). With no error that slot renders nothing.

Not included: any change to the offline controller (`useOfflinePlaylist`), the store, the per-row marks (`PlaylistSongOfflineMark`), Settings, the `/offline` screen, Fast View's per-song `OfflineSongButton`, or copy translation (F25 keeps app copy in English).

## Approach

**Behavior** is the RH-193 control's, relocated: same controller instance (owned by `PlaylistDetailView`, shared with the rows), same commands (`download`, `refresh`, `remove`, `dismissError`), same labels, same offline gating fed by the route's single `useOfflineStatus()` call. No component reads `navigator.onLine`. The only behavioral differences are where the controls render and that the in-progress state moves from a disabled button to the header indicator.

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Downloading: "Make available offline"
  Downloading --> Downloaded: run ends
  Downloading --> Idle: "failed, nothing stored (alert + Try again)"
  Downloaded --> Downloading: "Refresh / Download N missing"
  Downloaded --> Idle: "Remove offline copy"
  note right of Idle: "indicator hidden, menu: Make available offline"
  note right of Downloading: "spinner indicator, menu: no offline items"
  note right of Downloaded: "cloud-check indicator, menu: summary + actions"
```

**Files touched**

- `src/components/playlists/PlaylistHeaderMenu.tsx` — items gain optional `disabled` and `description` (sub-line), plus separators and a non-interactive summary entry; takes the offline entries as a prop (inserted after "Add songs") rather than the controller, so the menu stays presentational.
- `src/lib/playlistOfflineMenu.ts` (new) — pure function from controller state + `isOffline` to the offline menu entries (labels, sub-lines, disabled flags, commands) and the indicator state; keeps the header under the F20 complexity budget.
- `src/components/playlists/PlaylistOfflineIndicator.tsx` (new) — the compact indicator.
- `src/components/playlists/PlaylistDetailHeader.tsx` — accepts the controller and `isOffline`, renders the indicator after the name and passes the offline entries to the menu.
- `src/components/playlists/PlaylistDetailView.tsx` — passes `offline`/`isOffline` to the header; replaces `<OfflineDownloadButton>` with the alert only.
- `src/components/playlists/OfflineDownloadButton.tsx` — deleted; its `OfflineAlert` survives as `src/components/playlists/PlaylistOfflineAlert.tsx`.
- Tests: `__tests__/OfflineDownloadButton.test.tsx` rewritten as tests of the menu entries, the indicator and the alert (same state coverage: idle, idle with stored songs, offline-disabled, downloading, downloaded complete/partial, retryable download error, non-retryable removal error); `playlistHeaderMenu.test.tsx`, `playlistHeader.test.tsx`, `PlaylistDetailView.test.tsx`, `offlineControlHarness.tsx` updated.
- E2E: `e2e/playlist-detail.spec.ts`, `e2e/offline-mode.spec.ts`, `e2e/playlist-row-mobile.spec.ts` open "More actions" and click the `menuitem` instead of a `button` of the same name; progress waits target the indicator's accessible name.
- `docs/behavior.md` — the line below, replacing the RH-193 line.

No ESLint override may be added (the F20 ratchet only shrinks).

**Test criteria**

- Unit: for each controller state, the menu lists the offline entries above, in the stated position, with the right disabled state; clicking an enabled one calls the controller and closes the menu; while downloading the menu has no offline entry; the indicator renders the right role and accessible name per state and nothing when idle; a download error shows "Try again", a removal error does not; on an idle playlist the page has no "Make available offline" control outside the menu, and on a downloaded playlist it has no "Refresh offline copy", "Remove offline copy" or "Download N missing songs" control outside "More actions".
- E2E: the existing download → refresh/remove flows pass via the menu; at 375px width the header's title keeps its width with the indicator present (no overflow of the action group).

## Behavior changes

- changed: Offline — The playlist page's offline actions live in its "More actions" menu, after "Add songs": "Make available offline" until downloaded, then a summary with "Download N missing songs" when some are missing, "Refresh offline copy" and "Remove offline copy"; offline the download items are disabled with "Connect to the internet to download this playlist.", a failed download shows an alert with "Try again", and an icon after the playlist name shows "Downloading <done> / <total> songs" while downloading and "Available offline" once downloaded. (src/components/playlists/PlaylistHeaderMenu.tsx, src/lib/playlistOfflineMenu.ts, src/components/playlists/PlaylistOfflineIndicator.tsx, e2e/playlist-detail.spec.ts) (RH-201)

## Expected Results

- [ ] On an idle playlist, "More actions" lists "Make available offline" after "Add songs" and before "Rename playlist", and clicking it starts the download.
- [ ] While offline, "Make available offline", "Download N missing songs" and "Refresh offline copy" are `aria-disabled="true"` menu items, and "Remove offline copy" is enabled.
- [ ] On a downloaded playlist, the menu lists "Download N missing songs" only when some songs are missing, followed by "Refresh offline copy" and "Remove offline copy", with "Delete playlist" still last.
- [ ] A downloaded playlist shows a single `role="img"` icon named "Available offline" right after the title, and the page renders no "Refresh offline copy", "Remove offline copy" or "Download N missing songs" control outside "More actions".
- [ ] While downloading, the header shows a `role="img"` named "Downloading <done> / <total> songs" and the menu lists no offline action.
- [ ] A failed download shows the `role="alert"` with "Try again"; a failed removal shows it without "Try again".
- [ ] `npm test`, `npm run lint` and the e2e specs `playlist-detail`, `offline-mode` and `playlist-row-mobile` pass with the actions reached through "More actions" and no new complexity override.

## Operator Results Coverage

| Operator result | Spec section | Returned result |
|---|---|---|
| 1. Idle menu lists "Make available offline" after "Add songs", before "Rename playlist"; clicking starts download | Scope 2 (order, idle) | ER 1 |
| 2. Offline: download items disabled, Remove enabled | Scope 2 (idle, downloaded) | ER 2 |
| 3. Downloaded: "Download N missing" only when missing, then Refresh, Remove | Scope 2 (downloaded) | ER 3 |
| 4. Single icon "Available offline" next to title; no full-width block | Scope 1, Scope 3 | ER 4 |
| 5. Downloading: image "Downloading <done> / <total> songs"; menu has no offline action | Scope 2 (downloading), Scope 3 | ER 5 |
| 6. Download failure alert with "Try again"; removal failure without | Scope 4 | ER 6 |
| 7. `npm test` and offline e2e specs pass via "More actions" | Approach (Tests, E2E) | ER 7 |

## Out of Scope

Offline controller, store and capture logic; per-row offline marks; Settings storage section; `/offline` screen; Fast View's per-song offline button; i18n.

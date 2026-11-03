# RH-188 — Add a one-click button to make a whole playlist available offline

## Scope

The whole-playlist offline download already exists (RH-79): `OfflineDownloadButton`
is rendered by `PlaylistDetailView` on `/playlists/[id]`, between the tag bar and
the status summary, and `useOfflinePlaylist` already downloads every entry in
one click, reports `done / total`, is all-or-nothing and rolls back on failure.

The operator could not find it. That is mostly a problem of how the control looks:
its idle state is a white, grey-bordered row with a grey `⤓` glyph and the text
**"Available offline"**. That is the same text the *downloaded* state uses, so the
idle control reads as a status label and not as something to press.

This task makes the existing control discoverable and finishes its edge states.
It does **not** build a new download path:

- relabel and restyle the idle state as an explicit primary action, **"Make available offline"**;
- when the browser is offline, keep the idle control disabled and show a one-line explanation under it;
- give the failure alert a **"Try again"** button that restarts the download;
- update the copy that points users at the control (`OfflineUnavailable`);
- cover visibility, click, progress, completion and the offline hint with a dev-runnable Playwright test, and keep the production-build test that covers reopening offline.

Not in scope: the snapshot contents, the store, the service worker, the single-song
control in Fast View (`OfflineSongButton`, RH-116, which keeps its own label), the Settings
offline library, auto-refresh of stale copies, and moving the control into the
header (see the open question; the spec keeps the current position).

## Approach

**Behavior**

1. *Idle, online*: a full-width button with the accessible name **"Make available offline"**, in emerald primary style (filled emerald background, white text, a download icon). It is the only filled button in that band of the page, so it stands out from the grey rows around it. One click starts the download, with no confirm and no dialog. The click behavior (`offline.download()`) stays as it is.
2. *Downloading*: unchanged: a disabled `aria-busy` control reading "Downloading..." with `x / y songs` and a progress bar. A second click is impossible because the control is disabled.
3. *Downloaded*: unchanged: "Available offline", size and age, plus "Refresh offline copy" and "Remove offline copy".
4. *Idle, offline*: the same button, `disabled`, with `aria-describedby` pointing at a line of text under it: **"Connect to the internet to download this playlist."** The line is rendered only while `offline` is true. The downloaded state's Refresh stays disabled offline, as today.
5. *Failure*: the existing `role="alert"` keeps its message and its dismiss ✕, and gains a **"Try again"** button that calls `offline.download()`. It is disabled while offline. The idle "Make available offline" button stays under it, as today (the hook already resets to `idle`).
6. Snapshot reads after completion (Fast View and the setlist answered offline) are unchanged and covered by the existing production e2e.

**Files touched**

- `src/components/playlists/OfflineDownloadButton.tsx`: idle label and style, offline hint with `aria-describedby`, "Try again" in the error alert; the doc comment updated to the new label.
- `src/hooks/useOfflinePlaylist.ts`: comment only ("Make available offline" control); the quota message drops "— tap to try again" because the alert now has a real button. No logic change.
- `src/components/fastview/OfflineUnavailable.tsx`: its hint names the playlist control by its new label, "Make available offline".
- `src/components/playlists/__tests__/OfflineDownloadButton.test.tsx`: tests renamed to the new label, plus new cases for the offline hint and "Try again".
- `src/components/playlists/__tests__/PlaylistDetailView.test.tsx`: any lookup by the old idle name updated.
- `e2e/offline-mode.spec.ts`: `downloadPlaylist` clicks "Make available offline".
- `e2e/playlist-detail.spec.ts`: one new serial test, placed after the songs are added and before the delete test.
- `docs/behavior.md`: the Offline line below.
- `package.json`: version bump (AGENTS.md rule for commits to master).

**Test criteria**

- Unit (`OfflineDownloadButton.test.tsx`, real fake store as today):
  - idle online renders an enabled button named "Make available offline";
  - idle offline renders it disabled, with a description of "Connect to the internet to download this playlist.";
  - a failed download shows the alert and a "Try again" button, and clicking it calls the actions a second time and reaches the downloaded state;
  - "Try again" is disabled offline.
- E2E, dev-runnable (`playlist-detail.spec.ts`, on the playlist that holds the two seeded songs):
  - "Make available offline" is visible;
  - one click reaches the downloaded state ("Refresh offline copy" and "Remove offline copy" visible);
  - after "Remove offline copy", `context.setOffline(true)` leaves the button disabled with the hint visible;
  - finally `setOffline(false)`.
- E2E, production build (`offline-mode.spec.ts`, `E2E_PROD=1`): the existing cold-reload test passes with the renamed control, proving the playlist and its song open in Fast View from the snapshot with no network.
- `npm run lint`, `npm run typecheck` (or `tsc`) and `npx vitest run` pass.

## Behavior changes

- added: Offline — The playlist page's offline control reads "Make available offline" until downloaded; offline it is disabled with "Connect to the internet to download this playlist.", and a failed download offers "Try again". (src/components/playlists/OfflineDownloadButton.tsx, src/components/playlists/__tests__/OfflineDownloadButton.test.tsx, e2e/playlist-detail.spec.ts) (RH-188)

## Expected Results

- [ ] On `/playlists/[id]` online, a button named "Make available offline" is visible and enabled.
- [ ] One click on it, with no dialog, reaches the downloaded state showing "Available offline" with "Refresh offline copy" and "Remove offline copy".
- [ ] While downloading, the control is disabled, `aria-busy`, and shows `x / y songs`.
- [ ] With the browser offline, the button is disabled and "Connect to the internet to download this playlist." is shown under it.
- [ ] A failed download shows an alert with a "Try again" button that restarts the download (unit test in `OfflineDownloadButton.test.tsx`).
- [ ] The new `playlist-detail.spec.ts` test (click → downloaded → offline hint) passes.
- [ ] With `E2E_PROD=1`, `offline-mode.spec.ts` "reads a downloaded playlist after a cold reload with no network" passes using the renamed button.

## Operator Results Coverage

| Original result | Spec section | Returned result |
|---|---|---|
| Visible "Make available offline" button when online | Behavior 1 | ER1 |
| One click downloads every song, no prompts | Behavior 1 | ER2 |
| Progress shown, disabled during download | Behavior 2 | ER3 |
| "Available offline" state; offline Fast View from snapshot | Behavior 3, 6 | ER2, ER7 |
| Failure shows error, retryable | Behavior 5 | ER5 |
| Hidden or disabled with explanation when offline | Behavior 4 (disabled + explanation) | ER4 |
| Playwright covers click, completion, offline reopening | Test criteria | ER6, ER7 |

## Out of Scope

- Moving the control into the playlist header (open question, mock section "Placement").
- Any change to `OfflineSongButton` (Fast View single-song control).
- Background or automatic refresh of an outdated offline copy.

Mock: `docs/tasks/RH-188-mock.html`.

# RH-199 — spec generator report

## Outcome

SPEC_READY. Spec: `docs/tasks/RH-199-spec.md`. Mock: `docs/tasks/RH-199-mock.html`.
No questions for the operator; no operator questions were pending.

## What I read

- Task via `GET /api/projects/tasks/RH-199`: five `expected_results` present,
  `operator_expected_results` empty, no `questions`. I treated the five as the operator's
  own (preserved in meaning, refined, mapped in `## Operator Results Coverage`).
- `AGENTS.md`: the setlist player paragraph (RH-167), Fast View composition root (RH-38),
  import direction (F21), complexity budgets, the "Fast View Playlist Layout" directive
  (the `▶ NOW` contract), the landing-page rule.
- Behavior registry, areas "Fast View and queue" and "Playlists" only, through
  `node scripts/behavior.js area`. No existing line contradicts the change; it adds one.
- Code: `SetlistRow.tsx`, `SetlistPanel.tsx`, `SetlistDrawer.tsx`, `SetlistSidebar.tsx`,
  `usePlaylistNav.ts`, `setlistPlayerStore.ts`, `setlistEngines/runtime.ts`,
  `useSetlistPlayer.ts`, `AppShell.tsx` (onSongChange), `setlistPlayer.ts`,
  the Fast View `page.tsx`; test names in `SetlistRow/Drawer/Sidebar.test.tsx` and
  `usePlaylistNav.test.tsx`.

## Root cause observed

`SetlistPanel` passes `isCurrent={entry.versionId === currentVersionId}` (the route) and
`SetlistRow` draws `▶ NOW` from `isCurrent`. The player keeps its own snapshot
(`useSetlistPlayerStore.entries[index]`) and only moves the route when *it* changes track
(`runtime.runFrom` → `onSongChange` → `router.replace` in `AppShell`). A user navigation
while playing moves the route but not the player, so NOW follows the wrong thing.

## Decisions taken in the spec (and why)

- **Active track** = store `entries[index].versionId` while `status` is `playing` or
  `paused`; `idle`/`stopped` mean "no playback". `paused` covers the RH-189 countdown
  (the runtime patches `status: 'paused'` during it), a refused start and the offline pause.
  `stopped` (end of setlist) counts as inactive, matching the operator's result 4.
- **Matching by version id**, not by "same queue": a playlist cannot hold one version twice
  (`uq_playlist_song_version`), so it is unambiguous; a player started from another
  playlist simply yields no NOW row and a Play on the viewed row.
- **Green highlight stays on the viewed song.** The row tap no-op, the `X / Y` counter,
  `SetlistPill` and `SetlistSelect` all follow the route, so moving the highlight would
  split "where am I" across two rows. The playing row gets the NOW pill on an ordinary,
  still-tappable row. I judged this a design default rather than an operator question;
  the mock shows it in every state.
- **Row Play reuses `playSetlist` unchanged.** It already sends the queue and the viewed
  version id; `SetlistRuntime.start` already disposes the current engine and restarts at
  that index with the countdown. No runtime/store change.
- **Play is a separate `<button>`**, not nested in the row button (invalid HTML, and the
  click would bubble into `onSelect`). Keeping the row button's classes on the row button
  keeps the RH-48 class assertions (`getByRole('button').className`) meaningful.
- **Store read stays in the hook** (`usePlaylistNav`, which already imports the store for
  `playSetlist`), keeping `src/components/fastview` presentational. The hook's pinned key
  list test must gain the new field.
- **Pure rule in `src/lib/playlistNav.ts` (239 lines) and the derivation in
  `src/lib/setlistPlayer.ts` (101 lines)**: both well under the 400-line cap, both in the
  coverage universe.
- Not a landing selling point.

## Mock verification

Loaded `docs/tasks/RH-199-mock.html` in jsdom (CDN scripts stripped) and clicked each
preset; markers per sidebar row:

```
idle      ["1:NOW"]            play buttons: []
same      ["2:NOW"]            play buttons: []
other     ["2:NOW","4:Play"]   play buttons: ['Play from Tempo Perdido']
paused    ["2:NOW","5:Play"]   play buttons: ['Play from Garota de Ipanema']
countdown ["1:Play","3:NOW"]   play buttons: ['Play from Wonderwall']
stopped   ["6:NOW"]            play buttons: []
after Play (from "other"): route 4, player playing, active track 4
```

## Out of scope noted

`SetlistSelect`, `SetlistPill`, the counter, the header "Play setlist", the player bar,
the runtime/store, offline-specific hiding of the Play control, markers outside Fast View.

## EXPECTED_RESULTS

EXPECTED_RESULTS:
With the setlist player playing or paused (countdown included), the active track's row shows `▶ NOW` in both the drawer and the sidebar while the route shows another queue song.
When the viewed song differs from the active track, its row shows a button named `Play from <title>` and no `NOW`, and the panel holds exactly one `NOW`.
Clicking that Play button stores a start request with the queue entries and the viewed song's version id, without calling `onSelect` (and, in the drawer, after closing it).
With the player idle or stopped, or when the viewed song is the active track, the viewed row shows `▶ NOW` and no row shows a `Play from` button.
`npx vitest run src/components/fastview src/hooks/__tests__/usePlaylistNav.test.tsx src/lib/__tests__/playlistNav.test.ts src/lib/__tests__/setlistPlayer.test.ts` passes, including tests asserting the active track keeps `NOW` and the viewed row shows Play when they differ.
`node scripts/behavior.js area "Fast View and queue"` prints the new RH-199 line.

MOCK_PATH: docs/tasks/RH-199-mock.html

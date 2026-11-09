# RH-199 — Keep NOW indicator on the playing song and show Play on the selected song

Mock: `docs/tasks/RH-199-mock.html` (sidebar and drawer, every marker state, interactive).

## Scope

Fast View's setlist list (the mobile drawer and the desktop sidebar, both drawn by
`SetlistPanel` → `SetlistRow`) today puts the `▶ NOW` pill on the **route's** song
(`entry.versionId === currentVersionId`). Since RH-167 the setlist player keeps playing
across navigation, so the moment the musician swipes, presses an arrow key or taps another
row while a song plays, `▶ NOW` jumps to the song on screen even though the player is still
on the old one. This task separates the two ideas:

- **Viewed song** — the route's version id, unchanged: it keeps the green row highlight,
  its row tap stays a no-op, and the `X / Y` counter, `SetlistPill` and `SetlistSelect`
  keep following it.
- **Active track** — `useSetlistPlayerStore`'s `entries[index].versionId` while `status`
  is `playing` or `paused` (which includes the RH-189 countdown, a refused start and the
  offline pause); `null` while `idle` or `stopped`.

Covered:

1. While a track is active, `▶ NOW` sits on the row whose `versionId` is the active track's,
   in the drawer and in the sidebar, wherever the route is.
2. While a track is active and the viewed song is a **different** entry, the viewed row
   shows a `▶ Play` control in the place of the pill; tapping it starts the setlist player
   from the viewed song.
3. With no active track, behaviour is exactly today's: `▶ NOW` on the viewed row, no row
   Play control.

Not covered: see Out of Scope.

## Approach

**The rule (pure, in `src/lib`).** One function decides each row's marker from
`(entryVersionId, viewedVersionId, activeVersionId)` → `'now' | 'play' | null`:

| active track | row is the active track | row is the viewed song | marker |
|---|---|---|---|
| `null` | — | yes | `now` |
| `null` | — | no | `null` |
| set | yes | (either) | `now` |
| set | no | yes | `play` |
| set | no | no | `null` |

So at most one row carries `now` and at most one carries `play`. When the active track is
not in the displayed queue (the player was started from another playlist), no row carries
`now` and the viewed row carries `play` — matching by version id is deliberate: a queue
cannot hold one version twice (`uq_playlist_song_version`). A second pure function derives
the active track's version id from the store's `{ status, entries, index }` (`null` unless
`playing`/`paused`, `null` for an out-of-range index).

**The controller.** `usePlaylistNav` subscribes to `useSetlistPlayerStore` through that
derivation and exposes it as one new field (the active version id, `string | null`). It
stays the only setlist piece that reads the player store; the components stay
presentational. The row Play control reuses the existing `playSetlist` command unchanged:
it already hands the queue and the **viewed** version id to the player, and
`SetlistRuntime.start` already disposes the current engine and begins (countdown included)
at that index — no runtime or store change.

**The row.** `SetlistRow` keeps `isCurrent` for the viewed song (highlight classes, no-op
tap) and receives the marker and an optional play callback. `now` renders today's
`▶ NOW` pill unchanged. `play` renders a `▶ Play` control styled as a solid emerald pill,
accessible name `Play from <title>`, in the pill's position at the row's right end. It must
be its **own** `<button type="button">` and not nested inside the row's navigation
`<button>` (a button inside a button is invalid HTML and the inner click would also fire
the row's); keep the row button's existing classes on the row button so the RH-48 class
assertions keep holding (e.g. an outer relatively positioned wrapper with the Play button
placed over the row's right padding). Its click must not also trigger `onSelect`. With no
play callback wired, a `play` marker renders nothing. The *Not in repertoire* chip is
unaffected and may sit beside either marker.

**The panel and surfaces.** `SetlistPanel` takes the active version id, computes each row's
marker through the lib rule, and passes its existing `onPlay` to the row that gets `play`.
`SetlistDrawer` and `SetlistSidebar` forward the active version id; the drawer's row Play
closes the drawer first, exactly like its header "Play setlist" does today. The header
"Play setlist" button is unchanged.

**Files touched**

- `src/lib/playlistNav.ts` — add the row-marker rule (`now`/`play`/none).
- `src/lib/setlistPlayer.ts` — add the active-track derivation from `{ status, entries, index }`.
- `src/hooks/usePlaylistNav.ts` — subscribe to the player store through the derivation; expose the active version id.
- `src/components/fastview/SetlistRow.tsx` — render the marker: today's NOW pill, or the separate Play button; docblock updated.
- `src/components/fastview/SetlistPanel.tsx` — take the active version id, compute each row's marker, wire `onPlay` to the `play` row.
- `src/components/fastview/SetlistDrawer.tsx`, `src/components/fastview/SetlistSidebar.tsx` — forward the active version id (drawer: close before play).
- `src/app/songs/[versionId]/fast-view/page.tsx` — pass the controller's active version id to drawer and sidebar (one prop each; no new state).
- `src/lib/__tests__/playlistNav.test.ts`, `src/lib/__tests__/setlistPlayer.test.ts` — the rule table above and the derivation per status.
- `src/hooks/__tests__/usePlaylistNav.test.tsx` — the store-driven field, and the pinned key list in "exposes no owner context to its consumers" gains it.
- `src/components/fastview/__tests__/SetlistRow.test.tsx`, `SetlistDrawer.test.tsx`, `SetlistSidebar.test.tsx` — the marker rendering and the Play click.
- `docs/behavior.md` — the new "Fast View and queue" line below.
- `AGENTS.md` — "Fast View Playlist Layout": `▶ NOW` marks the setlist player's active track while one is playing or paused.

**Test criteria**

- Lib: every row of the table above, plus "active track absent from the queue" (no `now`,
  viewed row `play`); the derivation returns the entry's version id for `playing` and
  `paused`, `null` for `idle`, `stopped` and an out-of-range index.
- Hook: after `useSetlistPlayerStore.getState().begin(entries, 1, null)` the hook's active
  version id is entry 1's; after `patch({ status: 'stopped' })` or `reset()` it is `null`.
- Row/panel (jsdom): with the active track on entry 2 and the route on entry 4, entry 2's
  row contains `NOW`, entry 4's row contains a button named `Play from <title 4>` and no
  `NOW`, exactly one `NOW` in the panel; clicking that button calls `onPlay` once and
  `onSelect` zero times (drawer: `onClose` before `onPlay`); with no active track the
  existing NOW assertions hold and no `Play from` button exists; with the active track on
  the viewed entry that row shows `NOW` and no `Play from` button exists.
- `npm run lint` (exit code checked out of band — see AGENTS.md on `rtk`), `npx tsc --noEmit`,
  and the complexity budgets stay green; no new entry in the override ratchet.

Not a landing-page selling point (a refinement of the RH-167 player): no dictionary change.

## Behavior changes

- added: Fast View and queue — While the setlist player is playing or paused, the setlist marks its active track ▶ NOW and the viewed song, when different, shows a Play control that restarts playback from it; with no active playback the viewed song carries ▶ NOW. (src/lib/playlistNav.ts, src/hooks/usePlaylistNav.ts, src/components/fastview/SetlistRow.tsx) (RH-199)

## Expected Results

- [ ] With the setlist player playing or paused (countdown included), the active track's row shows `▶ NOW` in both the drawer and the sidebar while the route shows another queue song.
- [ ] When the viewed song differs from the active track, its row shows a button named `Play from <title>` and no `NOW`, and the panel holds exactly one `NOW`.
- [ ] Clicking that Play button stores a start request with the queue entries and the viewed song's version id, without calling `onSelect` (and, in the drawer, after closing it).
- [ ] With the player idle or stopped, or when the viewed song is the active track, the viewed row shows `▶ NOW` and no row shows a `Play from` button.
- [ ] `npx vitest run src/components/fastview src/hooks/__tests__/usePlaylistNav.test.tsx src/lib/__tests__/playlistNav.test.ts src/lib/__tests__/setlistPlayer.test.ts` passes, including tests asserting the active track keeps `NOW` and the viewed row shows Play when they differ.
- [ ] `node scripts/behavior.js area "Fast View and queue"` prints the new RH-199 line.

## Operator Results Coverage

| Original result | Spec section | Returned result |
|---|---|---|
| 1. Active player track shows NOW in SetlistRow (drawer and sidebar) while playing or paused | Scope §1, Approach "The rule" | ER 1 |
| 2. Viewed different song shows a Play control instead of NOW | Scope §2, Approach "The row" | ER 2 |
| 3. Clicking Play starts setlist playback from that song | Approach "The controller", "The panel and surfaces" | ER 3 |
| 4. No active playback: viewed song keeps NOW | Scope §3, rule table rows 1–2 | ER 4 |
| 5. Vitest tests assert playing keeps NOW, selected shows Play | Approach "Test criteria" | ER 5 |

## Out of Scope

- `SetlistSelect` (native `<select>`), `SetlistPill` and the sidebar's `X / Y` counter: they
  keep following the viewed song.
- The header "Play setlist" button, the `SetlistPlayer` bar in `AppShell`, `SetlistRuntime`
  and the store: no change. RH-167's auto-navigation (`router.replace` on track change) is
  unchanged, so when the player advances the route still follows it.
- Offline: the row Play control behaves as the header "Play setlist" already does offline
  (the player reports "Playback is not available offline"); hiding or disabling it offline
  is a separate decision.
- Any marker outside Fast View (the playlist detail page, the dashboard).

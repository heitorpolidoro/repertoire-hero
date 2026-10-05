# RH-103 — Make reordering a playlist possible

> Board id RH-103; this file follows the repository's `+1` filename offset.

## Scope

A playlist's order becomes editable. A song moves in `/playlists/[id]` — by
dragging it to a new place, or one step at a time with up/down buttons — and the
whole list's positions are rewritten by a single `UPDATE` against the current
schema — `playlist_songs (playlist_id, song_id, position)`.

Three things make that possible and are all in scope: `uq_playlist_song_position`
becomes `DEFERRABLE INITIALLY IMMEDIATE`, so the permuting statement is checked at
the end of the statement instead of row by row; a new `src/lib/playlists.ts`
function rewrites every position in one statement and refuses a band playlist to a
non-admin; and the playlist detail screen grows the affordance that asks for it.

**Not in scope.**

- Pointing any of this at `song_versions` — that is RH-125, a child of the
  restructure. `playlist_songs.song_id` stays as it is.
- Any drag-and-drop library. The gesture is Pointer Events and CSS
  `touch-action`, both native; the repository's gates include `npm audit` and
  `knip` and this task adds no dependency.
- Dragging more than one row at a time (no multi-select), dragging a row out of
  one playlist into another, and dragging between the playlist and the catalog.
- Reordering from any other screen: the dashboard, Fast View and the playlist
  *list* are untouched.
- Making `assertPlaylistAccess` role-aware for the other playlist writes. Today it
  checks membership only, so **rename, delete, add-song and remove-song are
  available to any band member**. The use case (*Create, reorder and delete a
  playlist*, "Decided") says all four should be band-admin only. This task owes
  only reorder; closing the other four is a separate task, because each one
  changes behaviour on a screen this one does not touch, and `assertPlaylistAccess`
  is also the Spotify route guard (`src/lib/spotifyRouteAuth.ts`), where a
  tightened check would change read answers too. Reorder therefore gets its own
  admin check at its own call site and leaves `assertPlaylistAccess` alone.
- Spotify ordering semantics beyond what already exists: a reorder reuses the
  existing push (`direction: 'push'` replaces the Spotify track list from the local
  order), exactly as removing a song does today.

## Approach

### Behavior

**The constraint.** `uq_playlist_song_position` is dropped and re-added as
`UNIQUE (playlist_id, position) DEFERRABLE INITIALLY IMMEDIATE`. That is the whole
schema change. Measured on Postgres 16 in this repository's container: a plain
unique rejects a single statement that permutes positions (and rejects
`pos = pos + 1`) because it checks row by row and a permutation is briefly invalid
midway; deferrable moves the check to the end of the statement and the permutation
succeeds, with **no** transaction wrapper and **no** `SET CONSTRAINTS DEFERRED`. It
still rejects a genuinely duplicate final state, and it still serialises two
concurrent inserts at the same position — which is the reason the constraint
exists, since `addSongToPlaylist` computes `MAX(position) + 1` and two racing
callers both get the same number. That last property is **measured, not assumed**:
on Postgres 16 in this repository's container, two separate sessions inserting the
same `(playlist_id, position)` against a `DEFERRABLE INITIALLY IMMEDIATE` unique
still end with the second session rejected by
`duplicate key value violates unique constraint "uq_…"` naming that constraint. The
deferrable declaration moves the check to the end of the *statement*, and each
`INSERT` is its own statement, so cross-session serialisation — and the constraint
name inside the error message — are both unaffected. This matters because
`src/lib/__tests__/transactionAtomicity.db.test.ts` (the concurrent-insert case,
which expects the rejection message to contain `uq_playlist_song_position`) is the
one existing test the re-declaration could plausibly break; it is therefore a gate
of this task and must still pass unmodified. The one capability lost is `ON CONFLICT
(playlist_id, position)`, which Postgres refuses against a deferrable constraint;
nothing in the tree uses it. `uq_playlist_song (playlist_id, song_id)` from
`0001_initial_schema.sql` stays **immediate**, so the bulk import's
`ON CONFLICT DO NOTHING` (`buildPlaylistSongsInsert`,
`src/lib/spotifyPlaylistSync.ts`) keeps working.

**The write.** `reorderPlaylistSongs(playlistId, userId, orderedIds)` takes the
playlist's `playlist_songs.id`s in their intended order and makes
`position` equal 1..n in exactly that order. Authorization comes first and sits
**outside** the wrapping `try`, so its text reaches the UI verbatim (convention
L1a): `assertPlaylistAccess` as every other write does, then — when the row carries
a `band_id` — `assertBandMember` (already imported by `playlists.ts`) and a refusal
unless the role is `admin`, with the message `Access denied: band admin required`,
the same wording `src/lib/bands.ts` already uses.

The submitted list must be **exactly** the playlist's current row set: no missing
id, no extra id, no duplicate, no id from another playlist. A subset would
renumber part of the list into positions another row still holds, which the
constraint would correctly reject at a confusing place. So the function reads the
playlist's row ids and the write happens together, through `withTransaction`
(`@/lib/db`) — the deferrable constraint needs no transaction, but the check and
the statement have to agree on the same rows. A mismatch throws before the UPDATE.

The positions are rewritten by **one** statement, scoped by `playlist_id = $1`.
Either shape of it is acceptable: the `FROM (VALUES ...)` join the use case shows,
or an array parameter enumerated with `unnest(...) WITH ORDINALITY`, which keeps
the placeholder count at two. No `SET CONSTRAINTS`. Error handling is the L1
log-then-throw pattern with the phrase `Failed to reorder playlist songs`.

**The action.** `reorderPlaylistSongsAction(playlistId, orderedIds)` joins the
other thin actions in `src/app/actions/playlists.ts`: resolve the session with
`getRequiredUserId`, delegate, no `try/catch` (A2), no SQL.

**The decision, as a pure function.** Given the playlist's rows and a
`(songId, 'up' | 'down')` intent, compute the full id order after that one-place
move, or report that there is nothing to do (the first row moving up, the last row
moving down). It lives in `src/lib/playlistDetail.ts`, beside
`sortPlaylistSongs`, which is what defines "the row above" — the list is ordered by
`position`, never by array order.

**Optimism and rollback.** `src/lib/playlistOverlay.ts` gains one entry: a map of
`playlist_songs.id` to position that `applyDetailOverlay` lays over the server
rows' `position` before the list sorts them. The controller records the new
positions, awaits the action, pushes to Spotify if the playlist is synced
(`sync.pushIfNeeded`, as `removeSong` already does) and refreshes; on failure it
records the positions captured before the write and surfaces the message in the
existing error banner. The entry is idempotent once the refresh lands, like
`rename` — the server rows already carry those positions.

**The controller commands.** `usePlaylistDetail` exposes two, over one private
commit path (overlay → action → `pushIfNeeded` → refresh, rollback on failure):

- `moveSong(songId, direction)` — the buttons. Computes the new order with the
  pure function above, which reads `detail.songs`, so a move is always computed
  against the **whole** playlist, never against the filtered view.
- `reorderSongs(orderedIds)` — the drag's commit, given the full permuted order.

The controller also owns the reorder mode: a `reordering` boolean and a setter,
forced to `false` whenever a filter is active (see *Filters*), so no component
has to remember to turn it off.

**The no-op path is decided: the controller short-circuits.** When the pure function
reports that there is nothing to do — the first row asked to move up, the last row
asked to move down, or an unknown id — `moveSong` returns immediately: no overlay
entry, no call to the injected reorder action, no `pushIfNeeded`, no refresh, no
error. Calling the action with an unchanged order is explicitly rejected, because it
would be a real `UPDATE` and a real Spotify track-list replacement for a tap that
should do nothing. The buttons at the ends are disabled anyway (section
*Affordance*), so this is the keyboard/programmatic backstop, not the normal path.
`reorderSongs` short-circuits on the same rule: an order identical to the current
one writes nothing. A drag released where it started is therefore free.

**Filters end the mode.** While the tag chip or the text query is active the
visible list is a subset, so "the row above" on screen is not the row above in the
playlist, and a move that swaps with a hidden neighbour looks like nothing
happening. The *Reorder* toggle is therefore not rendered while either filter is
active, and a filter applied while the mode is on turns the mode off. Both come
back when the filters are cleared.

**Band playlists.** The server refuses; the screen does not offer. The page already
resolved `userId` and a playlist whose non-null read proves membership, so it reads
the caller's role there and hands the island one boolean (`canReorder`): true for a
personal playlist, true for a band playlist when the role is `admin`. A plain
member sees the list exactly as today.

### Affordance — a drag handle, in a reorder mode, with the buttons beside it

**The gesture.** A row drags by its handle and only by its handle. The handle
carries `touch-action: none`; every other part of the row and the scroll container
keep `pan-y`. The browser then decides by **where the finger landed**, not by how
far it moved: a press on the handle is a drag from its first pixel, a press
anywhere else is a scroll. There is no long-press delay and no movement threshold
to tune. The earlier argument that a drag must first prove it is not a scroll
applied to dragging the whole row and is withdrawn.

Implemented with Pointer Events — `pointerdown` + `setPointerCapture` on the
handle, `pointermove`, `pointerup`, `pointercancel` — because HTML5
drag-and-drop does not fire on touch. No dependency.

During a drag the dragged row lifts (shadow, `translateY` following the pointer)
and a 2px insertion line marks the target index; the other rows do not move, so
the list never jumps under the finger. `pointercancel` and `Escape` both put the
row back and write nothing. When the pointer comes within 48px of the scroll
container's top or bottom edge the container scrolls by a fixed step per frame,
so a row can reach a position that is off-screen.

**The buttons stay.** `aria-label="Move <title> up"` / `"... down"`, disabled at
the ends — a pointer drag needs a non-pointer equivalent, and these are it. The
keyboard path end to end: Tab to *Reorder*, Enter, Tab to a row's *Move … up*.
They are not a fallback for a failed drag; they are the accessibility contract,
and the no-op short-circuit above is theirs.

**The cost that actually applies: 390px is full.** The row's content box at a
390px viewport is **334px** (390 − the list's `px-4` 32 − the row's `px-3` 24).
After RH-102 the identity line spends it as: cover 40, duration ~30, the
four-note control with its fixed label slot ~110, remove 24, five 12px gaps — 264px
fixed, leaving **82px** for title and artist. A 44px handle plus its gap would
cut that to **26px**, which is not shippable. The handle does not fit beside all
of that, so something yields.

**What yields is everything the row is not doing while you reorder it.** One
*Reorder* / *Done* toggle in the playlist header puts the list in a reorder mode.
While the mode is on, each row renders the handle (44px wide, the full row height
— a ~44 × 56px target), the cover, title and artist, and the 44 × 44 up/down
pair; the duration, the four-note status control, the remove button and the tag
row are not rendered. Title and artist get **126px**, more than the 82px they
have the rest of the time. While the mode is off the row is byte-for-byte what
RH-102 leaves behind — the toggle is this task's only addition to the resting
screen, and nothing yields permanently. Hiding the status control while
reordering also removes the only chance of a tap meant for a note landing on a
drag.

The mode is a client concern only: it changes no data, is not persisted, and
resets on navigation.

The mock shows the measurement — the row with and without a crammed-in handle —
and the mode live, draggable on a phone: `docs/tasks/RH-104-mock.html`.

### Files touched

- `migrations/0009_*.sql` (name resolved at implementation time: one above the
  highest prefix then present, expected `0009`, never skipping a number) — drops
  `uq_playlist_song_position` and re-adds it `DEFERRABLE INITIALLY IMMEDIATE`,
  guarded by a `pg_constraint` check so re-running is a no-op.
- `src/lib/playlists.ts` — new `reorderPlaylistSongs`; nothing else changes. At 307
  lines it has room under the 400-line budget and no override entry.
- `src/lib/playlistDetail.ts` — the pure one-place-move computation.
- `src/lib/playlistReorderDrag.ts` — **new.** The drag's pure arithmetic, so the
  gesture's decisions are unit-testable without a DOM: given the rows' vertical
  midpoints and a pointer `y`, the insertion index; given a from/to pair and the
  id order, the permuted order; and whether that permutation is a no-op.
- `src/lib/playlistOverlay.ts` — the position-override overlay entry and its
  application in `applyDetailOverlay`.
- `src/app/actions/playlists.ts` — `reorderPlaylistSongsAction`.
- `src/hooks/usePlaylistDetail.ts` — `moveSong`, `reorderSongs`, the `reordering`
  mode flag and its setter, the action in `PlaylistDetailActions`.
- `src/hooks/usePlaylistReorderDrag.ts` — **new.** The gesture itself: the pointer
  handlers the handle binds, the dragged/target indices the list renders from, the
  edge auto-scroll, and the `Escape`/`pointercancel` cancel. Reads
  `playlistReorderDrag.ts` for every decision and commits through the injected
  `reorderSongs`.
- `src/app/playlists/[id]/page.tsx` — injects the new action, derives `canReorder`.
- `src/components/playlists/PlaylistDetailView.tsx` — the *Reorder* / *Done* toggle
  in the header (rendered only when `canReorder` and no filter is active), and
  forwards the mode to the list.
- `src/components/playlists/PlaylistSongList.tsx` — chooses the normal row or the
  reorder row, owns the scroll container's `touch-action: pan-y`, measures the row
  midpoints the drag needs and renders the insertion line (it already sorts by
  position).
- `src/components/playlists/PlaylistReorderControls.tsx` — **new.** The up/down
  pair. Its own file so `PlaylistSongRow.tsx` does not grow a second concern.
- `src/components/playlists/PlaylistSongReorderRow.tsx` — **new.** The reorder-mode
  row: handle + `PlaylistSongIdentity` + `PlaylistReorderControls`. A separate
  component rather than a branch inside `PlaylistSongRow`, so neither file carries
  the other's concern and the complexity budget needs no new entry; the identity
  block is already shared, so jscpd sees no clone.
- `src/components/playlists/PlaylistSongRow.tsx` — unchanged by this task beyond
  what RH-102 does to it.
- `docs/tasks/RH-104-mock.html` — the affordance and the open question.
- Tests: `src/lib/__tests__/playlistDetail.test.ts`,
  `src/lib/__tests__/playlistOverlay.test.ts`,
  `src/hooks/__tests__/usePlaylistDetail.test.ts(x)` (extend what exists), and new
  `src/lib/__tests__/playlistReorderDrag.test.ts`,
  `src/components/playlists/__tests__/playlistReorder.test.tsx` and
  `src/lib/__tests__/playlistReorder.db.test.ts`.
- `package.json` — version bump per the AGENTS.md rule.
- `src/lib/__tests__/transactionAtomicity.db.test.ts` — **not modified**, but named
  here because it is the migration's regression gate: its concurrent-insert case
  asserts the `uq_playlist_song_position` rejection message, and it must still pass
  unchanged after the constraint is re-declared.

**Landing page decision (AGENTS.md rule):** not a selling point, no dictionary
edit. `en.json` already promises "share setlists" and "Your Setlist Works
Offline"; being able to order a setlist is inside a claim the landing page already
makes, not a new reason to choose the app.

### Test criteria

- A `.db.test.ts` (so a reader knows why it skipped without `RUN_DB_TESTS`) that
  builds a five-song playlist, fully reverses it through `reorderPlaylistSongs`, and
  re-reads `position` — proving the deferrable constraint accepts the permutation.
- The same file: a duplicate final state is still rejected; a list that is not
  exactly the playlist's row set throws and leaves every position untouched; a band
  playlist refuses a `member` and accepts an `admin`; a personal playlist's owner
  succeeds.
- Node unit tests for the pure move (up, down, both no-op ends) and for the overlay
  (applied order, reverted order).
- A `renderHook` test for `moveSong`: the action receives the full new id order,
  `pushIfNeeded` is called, a rejection restores the original order and sets the
  error, and a move at either end calls neither the action nor `pushIfNeeded`. The
  same for `reorderSongs`, including that an order equal to the current one calls
  the action zero times, and that `reordering` cannot stay `true` once a filter is
  set.
- Node unit tests for `playlistReorderDrag.ts`: the insertion index for a pointer
  above the first midpoint, between two midpoints, below the last, and exactly on
  one; the permuted order for a downward and an upward move; and the no-op report
  for a release at the origin index.
- A DOM test for the gesture: a `pointerdown` on the handle followed by
  `pointermove` past the next row's midpoint and `pointerup` calls `reorderSongs`
  with the permuted order; the handle's computed `touch-action` is `none` while the
  row's is not; a `pointerdown` that lands on the row but not the handle starts no
  drag; and `pointercancel`, like `Escape`, calls `reorderSongs` zero times.
- The whole `RUN_DB_TESTS=1` suite still passes after the migration, and
  `src/lib/__tests__/transactionAtomicity.db.test.ts` in particular, unmodified —
  its concurrent-insert case still sees a rejection naming
  `uq_playlist_song_position`.
- A DOM test (`// @vitest-environment jsdom` first line, explicit
  `afterEach(cleanup)`) for the mode and the row controls: the *Reorder* toggle
  present only when `canReorder` and no filter is active; with the mode on, each
  row shows a drag handle and both arrow buttons with their labels, the first row's
  up and the last row's down disabled, and no duration, status control, remove
  button or tag row; with the mode off, all of those are back and no handle or
  arrow is in the document.
- Unchanged gates: `migrationsSingleSource`, `actionDataAccessGuard`,
  `transactionGuard`, `errorHandlingStyle`, `namingConventions`,
  `complexityBudget` (no new override entry), `npm run lint:dead`,
  `npm run lint:dup`, and the coverage thresholds.

## The answered question

The round-2 question was A (up/down arrows) or B (drag handles). The operator
answered with a third thing: a handle that captures the gesture only when the
press lands on it, leaving the rest of the row to scroll. That is B done properly,
it is viable, and it is adopted — `touch-action: none` on the handle alone is the
whole mechanism, and the "a drag must prove it is not a scroll" argument only ever
applied to dragging the whole row. The arrows remain as the keyboard and
screen-reader path. The cost that survives is horizontal space, which section
*Affordance* measures and spends.

No open question remains.

## Expected Results

- [ ] ER1 — The highest-numbered migration in `migrations/` re-declares
      `uq_playlist_song_position` as `UNIQUE (playlist_id, position) DEFERRABLE
      INITIALLY IMMEDIATE`; after `npm run db:migrate`, `SELECT condeferrable,
      condeferred FROM pg_constraint WHERE conname = 'uq_playlist_song_position'`
      returns `t, f`, and running the migration a second time changes nothing and
      fails nothing.
- [ ] ER2 — `uq_playlist_song (playlist_id, song_id)` is still immediate: the same
      query for `conname = 'uq_playlist_song'` returns `f, f`.
- [ ] ER3 — `src/lib/playlists.ts` exports `reorderPlaylistSongs(playlistId,
      userId, orderedIds)`, which sets `position` to 1..n in the given order using
      one `UPDATE` scoped by `playlist_id`, and issues no `SET CONSTRAINTS`
      anywhere in the repository.
- [ ] ER4 — A new `src/lib/__tests__/playlistReorder.db.test.ts` passes with
      `RUN_DB_TESTS=1`: a five-song playlist reversed in one call reads back
      positions 1..5 in the reversed order.
- [ ] ER5 — In that same file, a call whose id list is missing a row, carries an
      extra or duplicated id, or names a row from another playlist throws a message
      starting `Failed to reorder playlist songs`, and every `position` in the
      playlist is unchanged afterwards.
- [ ] ER6 — In that same file, reordering a band-owned playlist as a member whose
      `band_members.role` is `member` throws `Access denied: band admin required`
      and changes no position; the same call as an `admin` succeeds; a personal
      playlist's owner succeeds.
- [ ] ER7 — `src/app/actions/playlists.ts` exports
      `reorderPlaylistSongsAction(playlistId, orderedIds)`, which resolves the
      session and delegates with no `try/catch` and no database access;
      `src/app/actions/__tests__/actionDataAccessGuard.test.ts` still passes.
- [ ] ER8 — `src/lib/playlistDetail.ts` exports the pure one-place-move
      computation, and `src/lib/__tests__/playlistDetail.test.ts` covers moving a
      middle row up, moving it down, the first row moving up and the last row
      moving down — the two end cases returning the function's "nothing to do"
      report rather than an id order.
- [ ] ER9 — `src/lib/playlistOverlay.ts` carries a position-override entry, and
      `src/lib/__tests__/playlistOverlay.test.ts` shows `applyDetailOverlay`
      returning the moved order and, after the revert entry, the server order
      again.
- [ ] ER10 — `usePlaylistDetail` exposes `moveSong(songId, 'up' | 'down')`; a
      `renderHook` test asserts the injected action receives the complete new id
      order, that `pushIfNeeded` is called after it resolves, that a rejection
      restores the previous order and sets the controller's `error`, and that
      `moveSong` on the first row with `'up'` or the last row with `'down'` calls
      the injected reorder action zero times, calls `pushIfNeeded` zero times and
      sets no `error`.
- [ ] ER11 — `usePlaylistDetail` also exposes `reorderSongs(orderedIds)`; a
      `renderHook` test asserts it forwards the complete order to the injected
      action, calls `pushIfNeeded` after it resolves, restores the previous order
      and sets `error` on rejection, and calls the action zero times when the given
      order equals the current one.
- [ ] ER12 — `usePlaylistDetail` exposes a `reordering` flag and its setter; a
      `renderHook` test asserts `reordering` is `false` initially, becomes `true`
      when set, and is `false` again once a tag filter or a non-empty text filter
      is applied — without the component asking for it.
- [ ] ER13 — A new `src/lib/playlistReorderDrag.ts` exports the drag's pure
      arithmetic, and `src/lib/__tests__/playlistReorderDrag.test.ts` covers the
      insertion index for a pointer above the first row's midpoint, between two
      midpoints, below the last midpoint and exactly on a midpoint; the permuted id
      order for a downward move and for an upward move; and the no-op report when
      the release index equals the origin index.
- [ ] ER14 — On `/playlists/[id]`, the playlist header renders a toggle labelled
      `Reorder` when `canReorder` is true and no filter is active; it is absent when
      a tag filter is selected, absent when the text filter is non-empty, and
      absent when `canReorder` is false. A DOM test asserts all four.
- [ ] ER15 — With the mode on, each song row renders a drag handle whose accessible
      name contains the song title, plus buttons labelled `Move <title> up` and
      `Move <title> down`; the first row's up button and the last row's down button
      carry `disabled`; and the row renders no duration, no four-note status
      control, no remove button and no tag row. A DOM test asserts each fact.
- [ ] ER16 — With the mode off, the row renders exactly what RH-102 leaves — the
      duration, the four-note control, the remove button and the tag row are all
      present — and the document contains no drag handle and no `Move <title> up`
      or `Move <title> down` button.
- [ ] ER17 — The handle is the only element that swallows the touch gesture: the
      handle's `touch-action` is `none` while the row's and the scroll container's
      are not, and a `pointerdown` dispatched on the row outside the handle starts
      no drag — no row is lifted, no insertion line appears, and `reorderSongs` is
      called zero times. A DOM test asserts all three.
- [ ] ER18 — A DOM test drives a full drag — `pointerdown` on a handle,
      `pointermove` past the next row's midpoint, `pointerup` — and asserts an
      insertion line is in the document while the pointer is down, that the dragged
      row carries the lifted styling, and that `reorderSongs` is called exactly once
      with the permuted id order.
- [ ] ER19 — A cancelled drag writes nothing: after `pointerdown` and
      `pointermove`, both a `pointercancel` and (in a separate case) an `Escape`
      keydown leave `reorderSongs` called zero times, remove the insertion line and
      clear the lifted styling.
- [ ] ER20 — For a band-owned playlist, `/playlists/[id]` renders no `Reorder`
      toggle when the signed-in user's band role is `member`, and renders it when it
      is `admin`; the page derives that from the role it reads on the server, not
      from a client store.
- [ ] ER21 — `docs/tasks/RH-104-mock.html` exists and opens standalone, showing the
      390px width measurement (the row with and without a crammed-in 44px handle)
      and the reorder mode live: a toggle, grip handles, up/down arrows, and a drag
      that can be performed with a pointer.
- [ ] ER22 — `src/i18n/dictionaries/en.json` and `pt-BR.json` are unchanged:
      reorder is inside the existing setlist claim, not a new selling point.
- [ ] ER23 — No new runtime dependency is added: `package.json`'s `dependencies`
      gains no entry, and the gesture uses only Pointer Events and CSS
      `touch-action`.
- [ ] ER24 — `npm run test:coverage` meets its thresholds, and
      `npm run lint:dead`, `npm run lint:dup` and the complexity-budget test pass
      with no new entry in the override block.
- [ ] ER25 — After the migration, the whole `RUN_DB_TESTS=1` database suite still
      passes, and `src/lib/__tests__/transactionAtomicity.db.test.ts` is unmodified
      by this task: its concurrent-insert case still ends with the second insert
      rejected by an error whose message contains `uq_playlist_song_position`, and
      with only the first song's row present at position 1.
- [ ] ER26 — `package.json` carries a bumped version with the `YYYYMMDDHHmm`
      suffix, higher than any version in `git log`.

# RH-183 — Show song names in the playlist song list on mobile

Mockup: `docs/tasks/RH-183-mock.html` (today's broken row vs. the fixed row at 375px, and the unchanged 1280px row).

## Root cause

`PlaylistSongRow` (`src/components/playlists/PlaylistSongRow.tsx`) lays every
control of a song out on one `flex` line: the Fast View link (`flex-1 min-w-0`,
holding the 40px cover and the title/artist block), then the duration, the
four-note `StatusNotes`, the RH-158 "Practised" button and the remove button,
all `shrink-0`, separated by `gap-3`.

At a 375px viewport the row's content box is 317px (375 − the list's `px-4` −
the row's 1px border and `px-3`). The fixed controls take about 309px of it:
duration ~28, `StatusNotes` ~139 (four 14px notes + `gap-px` + the
`w-[4.75rem]` stage name), "Practised" ~70, remove 24, plus four 12px gaps. The
link is left about 8px — less than its own cover — so the title/artist block
(`flex-1 min-w-0 truncate`) collapses to zero width and the cover overflows
into the status notes. The RH-103 comment in `PlaylistSongReorderRow.tsx`
already measured the row at 82px for the title before RH-158; the ~82px
"Practised" button plus its gap spent exactly that. This is a regression from
RH-158, independent of personal or band context (a read-only `StatusNotes` is
the same width).

## Scope

Covers the resting song row of `/playlists/[id]` (`PlaylistSongRow`), in
personal and in band context:

- **Below Tailwind's `sm` breakpoint (< 640px)** the row becomes two lines.
  Line 1: the Fast View link (cover + title, artist, version label, album),
  the duration, and the remove button at the right edge. Line 2, indented to
  the text column (the same 52px inset the tag row already uses): the
  `StatusNotes` control and the "Practised" button. Line 2 wraps when it does
  not fit, so the revealed level control (`StatusNotes` + "Done", which
  replaces "Practised" after a tap) drops onto its own line instead of
  overflowing. The tag row stays below, unchanged.
- **At `sm` and wider** the row is the single line it is today, in today's
  order — no visual change on desktop.
- The title (and artist, label, album) stays one line truncated with an
  ellipsis (`truncate`, as today); it is never hidden, and nothing in the row
  overflows the row horizontally.
- Every control is rendered exactly once in the DOM at every width (reordered
  with CSS, not duplicated and hidden), so the accessible names the e2e specs
  use (`Remove <title> from playlist`, `Mark <title> as practised`, the
  `Mastery status` group) still resolve to one element per row.

Does **not** cover: the reorder-mode row (`PlaylistSongReorderRow` — it already
drops these controls and leaves the title ~141px), the dashboard row or Fast
View (other users of `StatusNotes`), the playlist header, `StatusNotes`'s own
sizes, or any change to what the controls do.

## Approach

Behavior: as in Scope. The fix is layout only — no prop, handler, data or
accessible name changes.

Files touched:

- `src/components/playlists/PlaylistSongRow.tsx` — group the status notes and
  "Practised" into one controls wrapper; make the row wrap below `sm`
  (link + duration + remove on line 1, the controls wrapper full-width and
  indented on line 2, itself wrapping) and keep the single line at `sm`+;
  update the component's doc comment with the width budget above.
- `src/components/playlists/PlaylistSongIdentity.tsx` — only if needed so the
  text column keeps a non-zero width (e.g. the title keeps `truncate`; no
  markup change is expected).
- `e2e/playlist-row-mobile.spec.ts` (new) — the mobile regression net below.
- `playwright.config.ts` — add the new file to the `mobile` project's
  `testMatch` and the `chromium` project's `testIgnore`.
- `e2e/playlist-detail.spec.ts` — in the existing "adds two catalog songs"
  test, after the reload, assert each song row's title has a non-zero bounding
  box (this runs on `chromium`, 1280px wide).
- `docs/behavior.md` — add the Playlists line listed under Behavior changes.

Test criteria:

- `e2e/playlist-row-mobile.spec.ts` sets `viewport: { width: 375, height: 812 }`
  and asserts `viewport.width === 375`. It seeds two catalog songs through the
  home page — one ordinary title and one 100-character title — and then:
  1. **Personal**: creates a playlist, adds both songs through the picker,
     reloads; for each row, the title element is visible and its bounding box
     has width > 0 and height > 0; for the long title, its box intersects
     neither the row's `Mastery status` group, its `Mark … as practised`
     button nor its `Remove … from playlist` button, and its right edge is
     ≤ the remove button's left edge; the row `<li>` has
     `scrollWidth <= clientWidth`; a trial click (`click({ trial: true })`)
     on the remove and Practised buttons and on one note succeeds.
  2. **Band**: creates a band through the UI, enters band context through the
     persisted `band-context` store (as `band-indicator-mobile.spec.ts`
     does), creates a playlist (owned by the band), adds both songs, reloads,
     and asserts the same visibility and non-zero-box checks on each title.
  3. **Teardown** (last test): deletes both playlists, the band and the
     seeded songs, so the file is idempotent (RH-44 / RH-66 style:
     fixture names minted inside test bodies with `uniqueFixtureName`).
- `e2e/playlist-detail.spec.ts` passes unchanged in behavior on `chromium`,
  plus the new non-zero-box title assertion.
- `npm run lint` (exit code checked out of band), `npx tsc --noEmit` and the
  vitest suite stay green; no complexity-budget override is added.

## Behavior changes

- added: Playlists — At phone width a playlist song row puts its status notes and Practised button on a second line, so the title always keeps its own width. (src/components/playlists/PlaylistSongRow.tsx, e2e/playlist-row-mobile.spec.ts) (RH-183)

## Expected Results

- [ ] At a 375px viewport, every song row on `/playlists/[id]` shows its title as visible, non-empty text whose bounding box has non-zero width and height.
- [ ] `e2e/playlist-row-mobile.spec.ts`, run by the Playwright `mobile` project at a 375px viewport, passes and asserts that each seeded song title is visible with a non-zero bounding box.
- [ ] At 375px, a 100-character title is truncated with an ellipsis, its box intersects none of the row's status, Practised or remove controls, and the row has no horizontal overflow (`scrollWidth <= clientWidth`).
- [ ] At 375px, the row's status notes, Practised button and remove button remain visible and pass a Playwright trial click.
- [ ] At a 1280px viewport, song titles on `/playlists/[id]` render with non-zero bounding boxes and every test in `e2e/playlist-detail.spec.ts` passes on the `chromium` project.
- [ ] In band context at 375px, every song title of a band playlist is visible with a non-zero bounding box, asserted by `e2e/playlist-row-mobile.spec.ts`.

## Operator Results Coverage

| Original result | Spec section | Returned result |
|---|---|---|
| At 375px every song row renders the title as visible, non-empty text | Scope (two-line row below `sm`) | ER 1 |
| A Playwright e2e test at 375px asserts each title is visible with non-zero width and height | Test criteria 1 | ER 2 |
| A long title is truncated or wrapped and does not overflow or overlap the action controls | Scope (truncation, no overflow); Test criteria 1 | ER 3 (truncation chosen), ER 4 (controls still usable) |
| At 1280px titles still render and the existing playlist e2e tests pass | Scope (`sm`+ unchanged); Test criteria | ER 5 |
| The title remains visible in personal and band context on mobile | Test criteria 1 and 2 | ER 1, ER 6 |

## Out of Scope

- `PlaylistSongReorderRow` (reorder mode), the dashboard repertoire row and
  Fast View.
- Viewports narrower than 360px beyond "nothing overflows"; 375px is the
  verified width.
- Any change to `StatusNotes`, `PractiseButton` behavior, or the controls'
  accessible names.

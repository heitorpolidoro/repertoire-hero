# RH-183 spec_generator report

Spec: docs/tasks/RH-183-spec.md
Mock: docs/tasks/RH-183-mock.html

## What I did

- Read the task through the API. It arrived with five non-empty `expected_results`
  (treated as the operator's own; `operator_expected_results` was empty on the
  server). No questions on the task.
- Read AGENTS.md (first half), the Playlists behavior area, and the row stack:
  `PlaylistSongList`, `PlaylistSongRow`, `PlaylistSongIdentity`, `StatusNotes`,
  `PractiseButton`, `PlaylistSongReorderRow`, plus `playwright.config.ts`,
  `e2e/playlist-detail.spec.ts`, `e2e/band-indicator-mobile.spec.ts` and
  `e2e/helpers.ts` (playlist helpers).

## Diagnosis (root cause)

`PlaylistSongRow` is one flex line: link (`flex-1 min-w-0`, 40px cover + text),
duration, `StatusNotes`, `PractiseButton`, remove — all but the link `shrink-0`,
`gap-3`. At 375px the row content box is 317px; fixed controls use ~309px
(duration ~28, StatusNotes ~139 = 4×14 + 3 + 4 + 76, Practised ~70, remove 24,
gaps 48). The link gets ~8px, less than its 40px cover, so the title column is
0px wide and the cover overflows. The RH-103 comment in
`PlaylistSongReorderRow.tsx` measured 82px left for the title at 390px before
RH-158; RH-158's "Practised" button (~70px + 12px gap) consumed exactly that.
Regression introduced by RH-158 (commit c447f62). Band context is identical
(read-only StatusNotes keeps its width).

## Decision

Below `sm` (640px) the row becomes two lines: link + duration + remove on line 1,
status notes + Practised on an indented (52px) line 2 that itself wraps (so the
revealed StatusNotes + "Done" level control, ~179px, wraps instead of
overflowing). At `sm`+ unchanged. Title stays `truncate` (ellipsis chosen over
wrapping — the operator's result allowed either). Controls are reordered with
CSS, never duplicated, so the e2e accessible names keep resolving to one element.

Width check at 375px with the fix: line 1 link ≈ 317 − 28 − 24 − 24 = 241px →
text ≈ 189px. Line 2: 139 + 12 + 70 = 221 ≤ 265px available.

No operator question: the alternative (keep one line, hide the stage name and/or
cover) leaves the title ≤ 88px, so it is not a real option.

## Tests specified

- New `e2e/playlist-row-mobile.spec.ts` in the `mobile` project only (config
  `testMatch`/`testIgnore` updated), 375×812 viewport: personal playlist and band
  playlist (band context via persisted `band-context` store), titles visible with
  non-zero boxes, a 100-char title not intersecting the controls and right edge ≤
  remove button's left edge, `li` scrollWidth ≤ clientWidth, trial clicks on
  controls, idempotent teardown.
- `e2e/playlist-detail.spec.ts` gains a non-zero-box title assertion (chromium,
  1280px) and must keep passing.

## Behavior registry

added: Playlists — At phone width a playlist song row puts its status notes and
Practised button on a second line, so the title always keeps its own width.

## Expected results (returned)

EXPECTED_RESULTS:
At a 375px viewport, every song row on `/playlists/[id]` shows its title as visible, non-empty text whose bounding box has non-zero width and height.
`e2e/playlist-row-mobile.spec.ts`, run by the Playwright `mobile` project at a 375px viewport, passes and asserts that each seeded song title is visible with a non-zero bounding box.
At 375px, a 100-character title is truncated with an ellipsis, its box intersects none of the row's status, Practised or remove controls, and the row has no horizontal overflow (`scrollWidth <= clientWidth`).
At 375px, the row's status notes, Practised button and remove button remain visible and pass a Playwright trial click.
At a 1280px viewport, song titles on `/playlists/[id]` render with non-zero bounding boxes and every test in `e2e/playlist-detail.spec.ts` passes on the `chromium` project.
In band context at 375px, every song title of a band playlist is visible with a non-zero bounding box, asserted by `e2e/playlist-row-mobile.spec.ts`.

MOCK_PATH: docs/tasks/RH-183-mock.html

QUESTIONS: none

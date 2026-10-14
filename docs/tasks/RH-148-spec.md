# RH-148 — Add a Stage Mode button to each file row in Fast View

## Scope
Goal: fewer taps to reach Stage Mode for a song's file. Today the path is tap the file row (select), then tap `⛶ Stage` in the viewer card: two taps, after the viewer card has started loading. This task adds a `Stage` button to every row of the file list (`TabList`) that opens Stage Mode for that row's file in one tap.

An earlier revision of this task designed an auto-open of the primary file on arrival; that design, its questions and its results are discarded and nothing of it is built.

Not covered: changing Stage Mode itself, the viewer card (its `Stage` button stays), RH-147's primary logic, auto-selecting or auto-opening anything, upload/delete, the offline snapshot shape.

## Approach
Behavior:
- Every row in the file list gets a `Stage` button (icon `⛶` plus the visible word "Stage", accessible name "Open in Stage Mode"), placed first in the row's action cluster, before the open-in-new-tab link, the primary star and the delete button.
- One tap on it opens PDF Stage Mode for that row's file, whether or not the row is the one currently viewed, and whether or not it is the primary.
- It reuses the existing opener: Stage Mode is driven by the page's `usePdfStage`, which opens for the currently active file id. So the row first makes its file active (only if it is not already active, because `selectTab` toggles an active file off) and then calls the same `onOpenStage` the viewer's `Stage` button calls. No second Stage Mode implementation. As today, the viewer card for that file is shown behind the overlay and is there after closing Stage Mode; this is accepted.
- Opening Stage Mode is a read: the button stays enabled when `readOnly` (offline), like row selection; delete and the star remain disabled. Offline, a cached PDF already opens in Stage Mode through the service worker (RH-80); nothing new is needed.
- Touch target: the button is at least 44x44 px (the existing icon buttons are about 33 px and stay unchanged). On a 360 px wide screen the file title truncates (existing `truncate`) rather than the button shrinking or wrapping.
- Clicking the button does not also trigger the row's select-toggle click (it is a sibling of the title button, as the other action buttons are).

Files touched:
- `src/components/fastview/TabList.tsx`: new required prop `onOpenStage(tab)`; renders the button on each row; enabled regardless of `readOnly`; doc comment on `readOnly` updated.
- `src/components/fastview/TabLibrarySection.tsx`: passes `onOpenStage` to `TabList`, implemented as select-if-not-active then the existing `onOpenStage()`.
- `src/components/fastview/__tests__/TabList.test.tsx`, `TabLibrarySection.test.tsx`: tests below.
- `src/app/songs/[versionId]/fast-view/page.tsx`: no change expected (still passes `pdfStage.open`).

Test criteria:
- TabList: one "Open in Stage Mode" button per row; clicking it calls `onOpenStage` with that row's file and not `onSelect`; with `readOnly` it is enabled while delete and star are disabled; it has a 44 px minimum size class.
- TabLibrarySection: tapping it on a non-active row activates that file then calls the page's `onOpenStage` once; on the already-active row it keeps the file active (does not toggle it off) and calls `onOpenStage` once.

Mock: `docs/tasks/RH-148-mock.html` shows today's row against the new row, the active and read-only states and the 360 px layout.

## Expected Results
See the `EXPECTED_RESULTS` block returned with this spec.

## Out of Scope
Auto-open or auto-select on arrival, a different Stage Mode, removing the viewer's `Stage` button, bulk actions, keyboard shortcuts.

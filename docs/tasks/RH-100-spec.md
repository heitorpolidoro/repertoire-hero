# RH-99 — Disable every write control while offline

> Spec file name carries the project's `+1` offset; the Meridian task is **RH-99**.

## Scope

Offline is read-only **by intent, not by limitation** (`docs/use-cases.md`, *Read offline*):
"every control that writes is **disabled**, with no exceptions". Most of the Fast View
honours that already — the page makes one `useOfflineStatus()` call and passes `readOnly`
to the status dropdown and the lyrics Edit/Add trigger (RH-80 ER4). This task closes the
gap for every remaining write control that a musician can reach with no network, and keeps
the asymmetry intact: a **disabled** control and a **refused** write are different things,
and "writes fail with a message" is explicitly not what is wanted.

The audit below is the deliverable's backbone. Two documents are reachable with no
network: `/songs/[id]/fast-view` (the only navigation the service worker answers from
cache, `src/app/sw.ts`) and whatever client page was already mounted when the connection
dropped. The surfaces are therefore the Fast View's sections, PDF Stage Mode, and the
per-playlist offline control — the one control whose whole job is a network round trip.

### Audit — every write surface reachable offline

| # | Surface | Control | Today, offline | Must become |
|---|---|---|---|---|
| 1 | `StatusDropdown` (via `SongIdentityHeader`) | status trigger | disabled (RH-80) | unchanged |
| 2 | `LyricsSection` | `Edit` / `Add` | disabled (RH-80) | unchanged |
| 3 | `LinksSection` | `+ Add Link` | **enabled** | disabled |
| 4 | `LinksSection` | per-link `Delete link` | **enabled** — `confirmDelete` reads the envelope, so it reports a failure | disabled |
| 5 | `AddLinkForm` | `Add` submit (form may be open when the connection drops) | **enabled**, and `submit` discards `updateLinks`'s envelope: the link is pushed into the on-screen list and the toast says "Link added successfully!" while nothing was saved | disabled |
| 6 | `TabUploadForm` | title input, file input, `Upload PDF` | **enabled** — `uploadTab` resolves `success: false`, surfaced as an inline error | disabled |
| 7 | `TabList` | per-tab delete | **enabled** — `deleteTab` resolves `success: false`, surfaced as a Toast | disabled |
| 8 | `TabDrawingStage` (PDF Stage Mode) | `Toggle drawing`, and with it pen/erase/colour/undo/clear | **enabled** — strokes are drawn, then `saveAnnotations` resolves `success: false` and the badge reads "Save failed" | the toggle disabled, drawing never enterable |
| 9 | `LyricsEditorPanel` | `Save`, `Discard my version`, web import (reachable only if the connection drops with the panel open) | **enabled** | disabled |
| 10 | `OfflineDownloadButton` | `Available offline`, `Refresh offline copy` | **enabled** — a download with no network cannot complete | disabled |
| 11 | `OfflineDownloadButton` | `Remove offline copy` | enabled | **unchanged, deliberately** |
| 12 | `useOfflineLibrary` / `OfflineStorageSection` | per-playlist remove, clear all | enabled | **unchanged, deliberately** |

Rows 11–12 draw the rule's boundary: it applies to a write that **crosses the network and
therefore cannot complete**. A purely local write (IndexedDB, Cache Storage,
`sessionStorage`, zustand) completes offline and means exactly what it says, so it stays
offered. Reads stay offered too — lyrics Stage Mode, the version switcher, tab selection,
the `Stage` button, page navigation and zoom are reads, and reading is what offline is for.

Not in scope: the pages the worker never serves offline — the dashboard, `/bands/**`,
`/profile`, `/settings`, the song form, the song picker, Spotify sync. Reaching them with
no network requires a drop inside a live session, and making them read-only needs an
app-wide read-only mechanism (a signal reaching ~15 islands); that is its own task. Also
out of scope: changing any `offlineFirst` classification, queueing writes, any migration
(none is needed) and any landing-copy change — offline reading is already selling point
`landing.f7*` and this task adds no capability to it.

## Approach

**The mechanism is the existing one: one offline signal per route, threaded down as a
prop.** Exactly one component per route — that route's composition root — imports
`useOfflineStatus`; every other component receives the signal as a prop and never reads
`navigator.onLine`. There are two such roots after this task: the Fast View page
(`src/app/songs/[id]/fast-view/page.tsx`, already a client component) and
`src/components/playlists/PlaylistDetailView.tsx`, which lives under `src/components`
because `/playlists/[id]/page.tsx` is a Server Component and cannot call a hook. Prose in
doc comments naming the hook is how the convention is documented and is expected to stay.

- `src/app/songs/[id]/fast-view/page.tsx` — already holds `isOffline`. Pass it as
  `readOnly` to `LinksSection` and `FastViewOverlays`, and as `readOnly` (alongside the
  existing `offline`) to `TabLibrarySection`.
- `src/components/fastview/LinksSection.tsx` — `readOnly?: boolean` (default `false`),
  disabling the `+ Add Link` trigger and every per-link delete button.
- `src/components/fastview/AddLinkForm.tsx` — `readOnly` disabling the `Add` submit.
- `src/components/fastview/TabLibrarySection.tsx` — forward `readOnly` to `TabList` and
  `TabUploadForm`.
- `src/components/fastview/TabList.tsx` — `readOnly` disabling each delete button; the
  select button stays enabled.
- `src/components/fastview/TabUploadForm.tsx` — `readOnly` ORed into the three existing
  `disabled` expressions.
- `src/components/fastview/LyricsSection.tsx` / `LyricsEditorPanel.tsx` — forward
  `readOnly` into the panel, disabling `Save`, `Discard my version` and the web import.
- `src/components/fastview/FastViewOverlays.tsx` → `PdfStageOverlay.tsx` →
  `src/components/tabs/TabDrawingStage.tsx` — `readOnly` reaching the drawing stage, where
  it disables the `Toggle drawing` button and makes `drawingEnabled` unreachable, so the
  canvas keeps rendering stored strokes read-only (`pointerEvents` already keys off
  `drawingEnabled`) and no `saveAnnotations` call can be scheduled. No other stage
  behaviour changes.
  **Budget, and how the room is bought.** `eslint.config.mjs` pins this file at exactly
  `max-lines: 819` / `max-lines-per-function: 757` — the file's current counts, i.e. zero
  headroom — the ratchet may only shrink, and `src/lib/__tests__/complexityBudget.test.ts`
  fails on an override that is not the file's current worst number. The `readOnly` prop
  grows both counts, so lines must be freed first. **This spec makes that choice: extract
  `drawPath` (currently declared inside the component, lines ~220–237) into a new pure
  module `src/lib/strokeRenderer.ts`, exporting `drawPath(ctx, points, widthPx, color)`
  unchanged, and import it in the stage.** It is the right cut because `drawPath` already
  takes every input as a parameter and closes over nothing — the move is mechanical, has no
  behavioural risk, and frees ~19 lines from both the function and the file, more than the
  prop costs. It also follows the precedent `src/lib/annotationMath.ts` and
  `src/lib/stageInteraction.ts` set: the stage's pure pieces live in `src/lib` and are unit
  tested without a DOM, here with a fake `CanvasRenderingContext2D` recording its calls, in
  a new `src/lib/__tests__/strokeRenderer.test.ts`. No toolbar or gesture-handler extraction
  is in scope — those would be a redesign of the stage, not this task. Both override numbers
  must end strictly below today's and be updated to the file's new exact counts.
- `src/components/playlists/PlaylistDetailView.tsx` — this island is the client
  composition root of `/playlists/[id]` (the page itself is a Server Component and cannot
  call a hook). It makes that route's single `useOfflineStatus()` call and passes `offline`
  to `OfflineDownloadButton`, which disables the idle `Available offline` button and the
  `Refresh offline copy` button and leaves `Remove offline copy` alone.
- `src/hooks/useSongLinks.ts` — `submit` stops reporting success for a `{ success: false }`
  envelope: no `onLinksSaved`, no success toast, the envelope's `error` surfaced through
  `notify`, mirroring `confirmDelete` twenty lines below. This is a **safety net, not the
  fix**: the fix is the disabled control (row 3/5). It exists because `submit` fabricating
  success from a refusal is wrong on every path, offline or not, and it is two lines.
- `src/lib/offlineFirst.ts` — replace the now-false "Known gap, deliberately out of scope"
  doc block with a statement that the link controls are disabled, pointing at this spec.
  `updateLinks` stays in `ENVELOPE_WRITES`.
- `docs/use-cases.md` (*Read offline*, the **Open** paragraph) and
  `docs/plans/repertoire-rework.md` (the "Disable every write control while offline" work
  item) — record that the defect is closed and which surfaces the audit covered.

**Test criteria.** Component/DOM assertions extend
`src/components/fastview/__tests__/offlineReadOnlyControls.test.tsx` (the RH-80 file that
already owns this subject) and
`src/components/playlists/__tests__/OfflineDownloadButton.test.tsx`: each control asserted
`disabled` when `readOnly`/`offline` is true **and** enabled when it is false, so no
default-state regression hides. The `submit` envelope behaviour is a unit test in
`src/hooks/__tests__/useSongLinks.test.tsx`. End to end,
`e2e/offline-mode.spec.ts` extends its existing cold-reload-with-no-network test with the
newly disabled controls, beside the ER4 assertions already there.

![Mockup](RH-100-mock.html)

## Expected Results

- [ ] ER1 — Fast View, offline: the `+ Add Link` trigger, every per-link `Delete link`
      button and the add-link form's `Add` submit render `disabled`; a named test in
      `src/components/fastview/__tests__/offlineReadOnlyControls.test.tsx` asserts each one
      disabled when read-only and enabled when not.
- [ ] ER2 — Fast View, offline: the tab upload form's title input, file input and
      `Upload PDF` submit, and every per-tab delete button, render `disabled`, while the
      tab-select button and the `Stage` button stay enabled; asserted in the same test file.
- [ ] ER3 — PDF Stage Mode, offline: the `Toggle drawing` button renders `disabled` and
      clicking it does not enable drawing, so the canvas takes no pointer input and no
      annotation save is attempted; page navigation, zoom and PDF rendering stay enabled.
      A named DOM test asserts the disabled toggle and that the injected
      `onSaveAnnotations` is never called after a pointer sequence over the canvas.
- [ ] ER4 — the lyrics editor panel, offline: `Save`, `Discard my version` and the web
      import button render `disabled`, while lyrics Stage Mode and the band/personal
      version switch stay enabled; asserted in the same test file.
- [ ] ER5 — `/playlists/[id]`, offline: `Available offline` and `Refresh offline copy`
      render `disabled` and `Remove offline copy` stays enabled; `PlaylistDetailView`
      supplies the signal and `OfflineDownloadButton` receives it as a prop. Asserted in
      `src/components/playlists/__tests__/OfflineDownloadButton.test.tsx`, both states.
- [ ] ER6 — `useSongLinks.submit` no longer reports success for a `{ success: false }`
      envelope: a named test in `src/hooks/__tests__/useSongLinks.test.tsx` asserts
      `onLinksSaved` is not called, no success toast is raised and the envelope's error
      message is surfaced instead.
- [ ] ER7 — `e2e/offline-mode.spec.ts`, after a cold reload with no network on a
      downloaded song, asserts the add-link trigger, a link delete button, the tab upload
      submit, a tab delete button and the Stage-Mode drawing toggle are all disabled; the
      suite passes.
- [ ] ER8 — the offline signal is read only by the two named composition roots:
      `grep -rln "from '@/hooks/useOfflineStatus'" src | grep -v __tests__` lists exactly
      two files, `src/app/songs/[id]/fast-view/page.tsx` and
      `src/components/playlists/PlaylistDetailView.tsx`, and
      `grep -rn "navigator\.onLine" src/components` matches no executable line (comment and
      doc-block mentions are expected and allowed). Every other component takes the signal
      as a prop.
- [ ] ER9 — the stale "Known gap, deliberately out of scope" block in
      `src/lib/offlineFirst.ts` no longer claims the link controls are undisabled, and the
      *Read offline* **Open** paragraph in `docs/use-cases.md` plus the matching work item
      in `docs/plans/repertoire-rework.md` record the defect as closed.
- [ ] ER10 — `drawPath` no longer lives inside `TabDrawingStage`: `src/lib/strokeRenderer.ts`
      exports it, the stage imports it from there, and `src/lib/__tests__/strokeRenderer.test.ts`
      covers the empty-, single- and multi-point paths against a fake 2D context. Stage
      drawing behaviour is unchanged — `src/components/tabs/__tests__/TabDrawingStage.test.tsx`
      still passes without edits to its assertions.
- [ ] ER11 — the complexity ratchet shrank: the `src/components/tabs/TabDrawingStage.tsx`
      override in `eslint.config.mjs` reads `max-lines` ≤ 815 and `max-lines-per-function`
      ≤ 750 (down from 819 / 757), both equal to the file's actual worst numbers so
      `src/lib/__tests__/complexityBudget.test.ts` is green;
      `npm run lint:dead` and `npm run test:coverage` pass with thresholds met,
      and `npm run lint` adds no new finding on top of its pre-existing baseline
      (8 errors / 12 warnings across 12 unrelated files, now owned by RH-129 —
      measure the baseline at `HEAD` yourself and compare).

## Out of Scope

- Every page the service worker never serves offline (dashboard, `/bands/**`, `/profile`,
  `/settings`, song form, song picker, Spotify sync): an app-wide read-only mechanism is a
  separate task.
- Local-only writes: removing a downloaded playlist, clearing offline storage. They
  complete offline and stay enabled.
- Any `offlineFirst` reclassification, any write queue (`docs/use-cases.md` rejects one
  outright), any migration, and any landing-copy change.

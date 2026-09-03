# RH-20 — Persist an erased stroke even when the gesture never ends normally

Single deliverable, PR-sized: the erase→save path in
`src/components/tabs/TabDrawingStage.tsx`, one new pure helper in
`src/lib/annotationMath.ts`, and tests.

Baseline for every comparison in this spec: commit **`4d5b7bd`**
(`fix(RH-19): serve pdf.js worker from own origin instead of unpkg CDN`).

## Investigation — the bug still reproduces on current code

The task text predates RH-28 (`b62f418`), which reworked pointer handling in this
file. Re-verified against `4d5b7bd`: **the defect is still present**, and RH-28
added two more paths that lose the same write.

### Why erasing is the only mutation that can be lost

Four functions mutate the persistent model. Three of them persist in the same
call; `eraseAt` is the exception:

| Function | Writes `annotationsRef.current[page]` | Calls `scheduleSave()` |
|---|---|---|
| `commitStroke` (`:293`) | yes | yes (`:302`) |
| `handleUndo` (`:316`) | yes | yes (`:321`) |
| `handleClearConfirm` (`:324`) | yes | yes (`:329`) |
| **`eraseAt` (`:305`)** | **yes (`:311`)** | **no — sets `erasedDuringGestureRef = true` (`:313`) and defers the save to the end of the gesture** |

`erasedDuringGestureRef` is the whole problem. The stroke is removed from
`annotationsRef.current` *and* from React state the instant the eraser touches
it, but the only code that turns that into a database write is `endPointer`'s
`else if (mode === 'erase')` branch (`:462-465`). Every path that ends a gesture
*without* going through that branch resets the flag to `false`, and the removal
then exists only in memory. `flushSave()` (`:273`) cannot rescue it either: it
returns immediately when `saveTimeoutRef.current` is `null`, which is exactly the
state after an erase that never scheduled anything.

Note that this contradicts the original design: RH-5 spec, Approach §Autosave,
states *"Each stroke removed by the eraser triggers the same debounced save path
— there is no separate 'erase save' mechanism."* The `erasedDuringGestureRef`
deferral is an implementation deviation from that sentence, and it is what this
task removes.

### Path 1 — the reported one: second finger down during an erase (still broken)

1. Erase mode, one finger down on a stroke → `handlePointerDown` (`:395-398`)
   clears the flag and calls `eraseAt`, which removes the stroke from
   `annotationsRef.current` + state and sets `erasedDuringGestureRef = true`.
   No timer is armed; `pendingSaveRef` is still `false`.
2. Second finger down → `handlePointerDown` reaches `pointersRef.current.size === 2`
   (`:380-388`) and executes `erasedDuringGestureRef.current = false` (`:384`)
   **without calling `scheduleSave()`**, then `startPinch()` and `return`.
   The pending write is now unrecoverable.
3. First finger up → `endPointer` (`:439-454`): `pinchStateRef` is set and the
   count drops to 1, so it takes the pinch-release branch, clears the flag again
   and calls `eraseAt(remainingPos)` — which only sets the flag again *if the
   resting finger happens to be within 16 px of another stroke* — then `return`s.
4. Second finger up → `endPointer` falls through to `:462`; the flag is `false`
   (nothing was hit in step 3), so **no save is scheduled at all**.

Nothing else on that page writes afterwards, so `flushSave()` on page change and
the unmount flush (`:180-190`, gated on `pendingSaveRef`) are both no-ops.
Reopening the tab re-fetches the annotations and the "erased" stroke is back.
Silent data loss, exactly as reported.

(Step 3 is the erase-drop path raised in RH-28's code review; it is a *masking*
path, not a fix — it saves only by accident, when the resting finger is on top of
another stroke, and then it also happens to flush the loss from step 2.)

### Path 2 — `lostpointercapture` mid-erase (added by RH-28, same defect)

`handleLostPointerCapture` (`:487-497`) sets `erasedDuringGestureRef.current = false`
(`:494`) with no save. When the browser genuinely takes a captured pointer away
mid-erase, the removal is discarded exactly as in path 1.

### Path 3 — drawing toggled off mid-erase (RH-28's flush does NOT cover it)

`handleToggleDrawing` (`:499-514`) sets `erasedDuringGestureRef.current = false`
(`:506`) and then calls `flushSave()` (`:511`). Because the erase never called
`scheduleSave()`, `saveTimeoutRef.current` is `null` and `flushSave()` returns at
its first line. The flush RH-28 added protects a *drawn* stroke (which does go
through `commitStroke`/`scheduleSave`) but not an in-progress erase.

### Sibling paths checked and found NOT defective

- **Pen stroke aborted by a second finger** (`:383`, `:493`): `activeStrokeRef` is
  a live preview buffer only; nothing has been written to `annotationsRef` or to
  `strokes`, so discarding it leaves memory and database in agreement. RH-5
  explicitly specifies "aborted, not committed". No change.
- **Pan mode**: mutates no annotation state.
- **`goToPage` / unmount**: correct *given* that a save was scheduled; they are
  fixed for free once `eraseAt` schedules.

### One related defect found while tracing (fixed here, see Approach §2)

`eraseAt` computes `next` from the `strokes` **state** closure (`:308-310`), while
`scheduleSave()` deliberately reads `annotationsRef.current` because state has not
re-rendered yet (see its comment at `:252-258`). `pointermove` is a *continuous*
React event, so two erase hits in one fast drag can both run against the same
stale `strokes` value; the second write then puts the first-erased stroke back
into `annotationsRef.current`, and that resurrected array is what gets saved.
This is the same user-visible symptom — "a stroke I erased is back after reload" —
and it would undermine the fix on a multi-stroke drag, so it is fixed in the same
one-line-scope change: `eraseAt` reads the page's current strokes from
`annotationsRef.current` first.

## Scope

**In scope**

1. Make erasing persist in the same call that applies it, so that no
   gesture-abort path can drop the write (paths 1, 2 and 3 above).
2. Delete the `erasedDuringGestureRef` deferred-save mechanism entirely.
3. Make `eraseAt` read the page's strokes from the same source of truth the save
   path reads (`annotationsRef.current`).
4. Extract the erase application into a pure, DOM-free helper in
   `src/lib/annotationMath.ts` and unit-test it in the existing `node` vitest
   environment.
5. Add a source-level vitest guard that fails if the deferred-erase-save pattern
   is reintroduced.

**Not in scope**

- Any change to `saveTabAnnotationsAction` / `getTabAnnotationsAction`, the
  `annotations` JSONB shape, the `Stroke` type, or any migration.
- Any change to pen, pan, pinch-zoom, the drawing toggle, the toolbar layout, the
  overlay sizing or the scroll lock (RH-28 territory).
- Undo of an erase (RH-5 explicitly ships erase as non-reversible).
- Adding jsdom / `@testing-library/react` / any new dependency; the vitest
  environment stays `node` and component gestures stay manual/QA (RH-5 and RH-28
  precedent).
- Playwright coverage of Stage Mode gestures — this surface needs a Vercel Blob
  PDF upload and is unreachable from e2e today.
- Landing page copy. **Landing Page Rule decision: this task is a bug fix (a
  silent write being dropped), not a selling point.** Handwritten annotations are
  already covered by RH-5's landing copy; nothing is added or changed in
  `src/components/landing/` or in the `landing.*` keys of either dictionary, and
  an expected result asserts that those files are byte-identical to `4d5b7bd`.

## Approach

### 1. New pure helper in `src/lib/annotationMath.ts`

Placed here rather than in `stageInteraction.ts` on purpose: `stageInteraction.ts`
is deliberately domain-free (viewport / CSS / pointer-gating decisions and nothing
else, no `Stroke` and no `PageGeometry`), whereas `annotationMath.ts` already owns
`Stroke`, `PageGeometry`, `ERASE_TOLERANCE_PX` and `findStrokeToErase`, and already
has a test file. Both modules are equally testable in the `node` vitest env.

```ts
export interface EraseResult {
  /** The stroke set after the erase. Same array identity as the input on a miss. */
  strokes: Stroke[]
  /** Id of the stroke removed, or null if the pointer hit nothing. */
  removedId: string | null
}

/**
 * Applies one whole-stroke erase at a canvas-relative pixel position.
 *
 * Pure: never mutates `strokes`. On a miss it returns the input array *by
 * identity* and `removedId: null`, so a caller can use `removedId !== null` as
 * the single "this changed the persistent model" signal.
 *
 * Contract for callers (RH-20): a non-null `removedId` that is applied to the
 * persisted model MUST be followed by scheduling a save in the same call. An
 * erase is destructive the moment it is applied, so deferring the save to the end
 * of the pointer gesture loses it whenever the gesture is aborted (second finger
 * → pinch, lost pointer capture, drawing toggled off).
 */
export function applyEraseAt(
  strokes: Stroke[],
  pointerX: number,
  pointerY: number,
  page: PageGeometry,
): EraseResult
```

Implementation is `findStrokeToErase` + `filter`; `findStrokeToErase` stays
exported and tested as-is.

### 2. `eraseAt` in `TabDrawingStage.tsx`

```ts
function eraseAt(x: number, y: number) {
  const page = pageGeometryRef.current
  if (!page) return
  // annotationsRef — not the `strokes` state closure — is the source of truth the
  // save path reads; two erase hits inside one fast drag can share a stale
  // `strokes` value and the second would otherwise resurrect the first removal.
  const current = annotationsRef.current[String(pageNumber)] ?? strokes
  const { strokes: next, removedId } = applyEraseAt(current, x, y, page)
  if (!removedId) return
  annotationsRef.current[String(pageNumber)] = next
  setStrokes(next)
  // Persist here, never at the end of the gesture (RH-20): the removal is
  // already applied, and every gesture-abort path discards end-of-gesture state.
  scheduleSave()
}
```

### 3. Delete `erasedDuringGestureRef`

Remove the ref declaration (`:101`) and all five uses: `:313` (replaced by the
`scheduleSave()` above), `:384` (pinch start), `:396` (pointer down, erase),
`:449` (pinch release), `:462-465` (`endPointer`'s erase branch — the branch goes
away, `lastPanPosRef.current = null` stays), `:494` (lost pointer capture) and
`:506` (toggle off). No per-site handling replaces them: once the write is
scheduled at application time, `scheduleSave` → `pendingSaveRef` → the existing
`flushSave()` on page change / toggle-off and the unmount flush all cover the
erase automatically, and no abort path has anything left to drop.

`endPointer`'s tail becomes:

```ts
if (mode === 'pen' && activeStrokeRef.current) {
  const points = activeStrokeRef.current
  activeStrokeRef.current = null
  commitStroke(points)
  redraw()
}
lastPanPosRef.current = null
```

**Timing consequence, deliberate and matching RH-5's Autosave paragraph:** the
800 ms debounce now starts at the last erase *hit* instead of at `pointerup`, so
the pill enters "Saving…" while the finger is still down, and a long slow erase
drag may produce one extra intermediate save (each with a correct, self-consistent
stroke array). `scheduleSave()` re-reads `annotationsRef.current` and re-arms the
timer on every call, so a normal quick drag still coalesces into a single write.
`setSaveState('saving')` only runs when a stroke was actually removed, so there is
no per-`pointermove` re-render.

### 4. Tests

**a. `src/lib/__tests__/annotationMath.test.ts`** (existing file, new `describe`):
`applyEraseAt` — miss returns the input array by identity with `removedId: null`;
hit returns a new array with exactly the hit stroke removed, the others in their
original order, and `removedId` equal to that stroke's id; the input array is not
mutated (length unchanged after a hit); feeding one result into a second call at a
second stroke's position removes both strokes (the multi-hit drag case §2 relies
on).

**b. `src/lib/__tests__/erasePersistence.test.ts`** (new source-level guard, in
the style of the existing `noBrowserDialogs.test.ts` / `pdfWorkerAsset.test.ts`
guards — the vitest env is `node` and cannot dispatch pointer events, so the
wiring is asserted on the source text):

- Exported detector helpers, each unit-tested on synthetic strings first:
  - `stripComments(source)` (same approach as `noBrowserDialogs.test.ts`, so prose
    in comments cannot satisfy or trip the guard);
  - `sliceFunction(source, name)` — the text from the line beginning
    `  function <name>(` through the first following line equal to `  }`
    (component-inner functions in this file are all at two-space indent).
- Assertions against `src/components/tabs/TabDrawingStage.tsx`:
  1. the identifier `erasedDuringGesture` does not appear anywhere in the
     comment-stripped source;
  2. `sliceFunction(source, 'eraseAt')` contains `scheduleSave()`;
  3. the general invariant: **every** component-inner function whose body assigns
     `annotationsRef.current[` also calls `scheduleSave()` in the same body
     (currently `commitStroke`, `eraseAt`, `handleUndo`, `handleClearConfirm`) —
     the failure message lists the offenders.

### 5. Rejected alternatives

- **Call `scheduleSave()` at each abort site instead.** Leaves the deferred-save
  concept alive, so the next code path added to this file re-opens the same hole
  (RH-28 added two of them without noticing). Rejected.
- **Restore the erased strokes on abort ("real" abort semantics).** Would require
  snapshotting the pre-gesture array and would make already-erased ink reappear
  under the user's fingers; RH-5 ships erase as destructive and non-undoable, and
  its Autosave paragraph requires each removal to be saved. Rejected.
- **A pure "what to persist when a gesture is aborted" helper in
  `stageInteraction.ts`.** After this fix there is nothing left to decide at abort
  time — the save is already scheduled — so such a helper would be a
  `return flag` tautology that no longer guards the real wiring. The guard test in
  §4b covers the wiring instead. Rejected.

## Expected Results

- [ ] `src/lib/annotationMath.ts` exports `applyEraseAt(strokes, pointerX, pointerY, page)`
      returning `{ strokes, removedId }`: on a miss `removedId` is `null` and the
      returned array is the *same object* as the input; on a hit `removedId` is the
      erased stroke's id and the returned array is a new array containing every
      other stroke in its original order; the input array is never mutated.
- [ ] `npx vitest run src/lib/__tests__/annotationMath.test.ts` passes and covers
      `applyEraseAt`: miss (identity + `null`), hit (only the hit stroke removed),
      no mutation of the input, and chaining (feeding one result into a second call
      at a second stroke's position removes both strokes).
- [ ] `grep -n "erasedDuringGesture" src/components/tabs/TabDrawingStage.tsx`
      returns no matches, and `eraseAt` in that file calls `scheduleSave()` on every
      removal and reads the page's strokes from
      `annotationsRef.current[String(pageNumber)]` (falling back to the `strokes`
      state) instead of only from the `strokes` state.
- [ ] A new vitest guard file `src/lib/__tests__/erasePersistence.test.ts` passes
      and asserts, on the comment-stripped source of
      `src/components/tabs/TabDrawingStage.tsx`: (a) no `erasedDuringGesture`
      identifier, (b) every component-inner function whose body assigns
      `annotationsRef.current[` also calls `scheduleSave()` in the same body; its
      source-slicing/comment-stripping detector helpers are themselves unit-tested
      on synthetic strings in the same file.
- [ ] `npx vitest run` passes with 0 failed tests, and the totals are at or above
      the `4d5b7bd` baseline of 22 test files / 212 tests; no test that passed at
      `4d5b7bd` fails.
- [ ] Manual/QA — save starts while the pointer is still down (desktop mouse, no
      touch device needed). Prerequisite: a song in the repertoire with a PDF tab.
      Open `/songs/<id>/fast-view`, open the tab, click the `⛶ Stage` button next to
      "Viewing: <tab name>", tap `✏️ Draw: Off` so it reads `✏️ Draw: On`, draw a
      stroke in `✏️ Pen` mode and wait until the save-state pill reads "Saved".
      Switch to `🧹 Erase`, then press and **hold** the mouse button down on that
      stroke: the stroke disappears immediately, and **while the button is still
      held**, the pill changes to "Saving…" and then to "Saved" within ~2 s — the
      write happens without the gesture ever ending. (Before this fix the pill stays
      on "Saved" and nothing is written.)
- [ ] Manual/QA — an erase survives a gesture that never ends (desktop mouse).
      Continuing from the previous result and **without releasing the mouse
      button**, reload the page with the keyboard (F5 / Cmd-R). Reopen the same tab,
      click `⛶ Stage` and go to the same page: the erased stroke is gone and every
      other stroke is unchanged.
- [ ] Manual/QA — the reported gesture (touch device or a real touchscreen; Chrome
      device-mode emulation is not sufficient because it cannot add a second finger
      mid-gesture). In Stage Mode with `Draw: On`, draw two separate strokes and wait
      for "Saved". Switch to `🧹 Erase`. Put one finger on stroke A — it disappears.
      **Without lifting that finger**, put a second finger on the PDF and pinch, then
      lift both fingers. Wait 3 s, close Stage Mode, reload the page, reopen the tab
      in Stage Mode on the same page: stroke A is still gone and stroke B is still
      there.
- [ ] Manual/QA — drawing toggled off mid-erase (touch device). In `🧹 Erase` mode,
      press a finger on a stroke so it disappears and, without lifting it, tap
      `✏️ Draw: On` with a second finger so the toggle reads `✏️ Draw: Off`; lift
      both fingers, wait 3 s, reload and reopen the tab in Stage Mode: the stroke is
      still gone.
- [ ] Manual/QA — multi-stroke erase drag. Draw three separate, non-overlapping
      strokes on one page and wait for "Saved". In `🧹 Erase` mode, drag in one
      single continuous quick gesture across all three: all three disappear. Release,
      wait for "Saved", reload and reopen the tab in Stage Mode on the same page: all
      three are still gone (none reappears).
- [ ] Manual/QA — no regression to pen, pinch or pan. In `✏️ Pen` mode on a touch
      device, start a stroke with one finger and put a second finger down before
      lifting: the partial stroke leaves **no** mark and the two-finger gesture zooms
      the page. After lifting both fingers, a new one-finger stroke draws normally,
      reaches "Saved", and is still present after a reload. `↶ Undo`, `Clear page`,
      `‹ Prev` / `Next ›` and the `+` / `−` / `100%` zoom controls behave as before.
- [ ] The landing page is untouched (this is a bug fix, not a selling point):
      `git diff 4d5b7bd --stat -- src/components/landing src/i18n/dictionaries/en.json src/i18n/dictionaries/pt-BR.json`
      produces no output.
- [ ] No dependency change: `git diff 4d5b7bd -- package.json` shows a change to the
      `version` field only, and `vitest.config.ts` still declares `environment: 'node'`.
- [ ] `npx eslint .` reports no more than the `4d5b7bd` baseline of 24 errors and 20
      warnings (lint is not expected to exit 0 on this repo), and running
      `npx eslint` on exactly the files this task adds or changes reports 0 errors and
      0 warnings.
- [ ] `package.json` `version` is strictly higher than the `4d5b7bd` value
      `0.1.59-202609030356` — a patch bump with a `-YYYYMMDDHHmm` local-time suffix
      (e.g. `0.1.60-YYYYMMDDHHmm`), per the AGENTS.md version-bump rule.
- [ ] Scope containment in the source tree: `git diff --stat 4d5b7bd -- src/ package.json`
      lists only `src/components/tabs/TabDrawingStage.tsx`, `src/lib/annotationMath.ts`,
      `src/lib/__tests__/annotationMath.test.ts`,
      `src/lib/__tests__/erasePersistence.test.ts` and `package.json` — no server
      action, no migration, no change to the `Stroke` type or the `annotations` JSONB
      shape. (Docs and workflow bookkeeping outside `src/` — `docs/tasks/RH-20-spec.md`,
      `docs/suggestions-log.md`, `AGENTS.md` — are deliberately not constrained by this
      result; see Delivery Notes.)

## Out of Scope

- Undo/redo of an erase, partial (pixel) erasing, or stroke splitting.
- Any change to pinch-zoom, pan, the drawing on/off toggle, the toolbar, the
  overlay sizing or the scroll lock introduced by RH-28.
- Component-level automated tests of the pointer gestures (no jsdom, no
  `@testing-library/react`, no Playwright coverage of Stage Mode).
- Landing page copy in either dictionary.
- Making the debounce interval configurable or adding an explicit Save button.

## Delivery Notes

- Commit message: Conventional Commits with the task id as scope, e.g.
  `fix(RH-20): persist erased strokes when the gesture is interrupted`
  (`git log --grep 'RH-20'` must find it).
- Version bump is mandatory on any commit to `master` (AGENTS.md).
- The `<!-- BEGIN:nextjs-agent-rules -->` block in `AGENTS.md` is rewritten by
  `next dev`; if it appears in the diff, commit it with the work.

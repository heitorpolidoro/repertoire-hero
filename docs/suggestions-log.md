# Suggestions Log

Non-blocking suggestions from Meridian spec/code reviews. Trimmed to the most recent 30 entries.

## [RH-28] Corrigir controles do modo desenho no tablet e adicionar toggle liga/desliga — 2026-09-01

- **Label the non-automatable expected results.** ER3, ER4, ER7, ER8, ER11, ER12 and
  ER13 are not marked "Manual/QA", but none of them can be executed by any harness in
  this repo: the vitest environment is `node` with no jsdom (`vitest.config.ts`), the
  spec explicitly rules out `@testing-library/react`, and Playwright is out of scope for
  this surface. A QA agent holding only the results list will either invent a runner or
  downgrade them to a source read. Marking them the way ER5, ER6, ER9, ER10 and ER14 are
  marked would make the gate honest.
- **`lostpointercapture` fires on every normal stroke end, not only on the abnormal
  path.** Calling `releasePointerCapture` inside `endPointer` (`TabDrawingStage.tsx:420`)
  queues a `lostpointercapture` event, and implicit release on `pointerup` does the same.
  §6 describes the handler as aborting the in-progress stroke "without committing a
  stray mark" while also being "the same cleanup path as `endPointer`" — which commits.
  In the ordinary ordering the abort lands after the commit and is a harmless no-op, but
  the spec should say so explicitly, otherwise an implementer who wires the two handlers
  together literally can silently drop every stroke. Stating the invariant ("the
  lost-capture handler must be a no-op when the pointer was already ended normally")
  removes the hazard.
- **`overflow-x-auto` can itself change the toolbar height.** §4 replaces `flex-wrap`
  with `flex-nowrap overflow-x-auto`. On platforms with classic (non-overlay) scrollbars
  the horizontal scrollbar occupies vertical space whenever the row overflows, so the
  "height stays constant" claim in ER13 holds on macOS/iOS but not on Windows/Linux
  Chrome at 320 px with drawing on. A `scrollbar-width: none` / `::-webkit-scrollbar`
  rule on the row would make the invariant unconditional.
- **`body { overflow: hidden }` alone is a weak scroll lock on iOS Safari.** §3's
  save-and-restore of `document.body.style.overflow` is the right shape and ER12 checks
  it, but iOS Safari historically still rubber-bands the document with only `overflow:
  hidden`. Since the overlay is `fixed` and the spec already adds
  `overscroll-behavior: contain` on the scroll container, this is likely sufficient here
  — worth a sentence acknowledging it rather than leaving it to be rediscovered during
  tablet QA.
- **Scope is at the upper end of one PR but coherent.** Five behavioural changes
  (viewport sizing, scroll lock, toolbar layout, drawing toggle, pointer hardening) plus
  a new module and its suite, across two files. They all serve one bug report on one
  surface and share the new helper module, so splitting would create artificial
  dependencies — no objection, just noting the size.
- ER8's "behave exactly as they did before this task" is the one soft phrase in an
  otherwise mechanical list; it is anchored by the concrete "pill cycles Saving… →
  Saved" clause, so it is verifiable in practice, but naming the specific behaviours
  (stroke commits, erase removes, undo pops the last stroke, clear empties the page)
  would remove the judgement call.

## [RH-28] Corrigir controles do modo desenho no tablet e adicionar toggle liga/desliga — 2026-09-01

- **The horizontal scrollbar can itself break the "same value within 1 px" clause.**
  Raised in round 1 and not adopted. §4's `overflow-x-auto` reserves vertical space for a
  classic (non-overlay) horizontal scrollbar whenever the row overflows, so the no-wrap
  result's "the toolbar element's own `getBoundingClientRect().height` is the same value
  within 1 px" across 5 widths × 2 drawing states holds on macOS/iOS overlay scrollbars
  but not on Windows/Linux Chrome at 320 px with drawing on (≈ +15 px, over the 104 px
  budget). A `scrollbar-width: none` plus `::-webkit-scrollbar { display: none }` rule on
  the row makes the invariant unconditional and platform-independent. Worth adopting now
  that the ≤ 104 px figure is a hard gate with only 7 px of slack.
- **`lostpointercapture` fires on every normal stroke end.** Also raised in round 1 and
  not adopted. `endPointer` calls `canvas.releasePointerCapture(e.pointerId)` at
  `TabDrawingStage.tsx:420`, before the commit path, and implicit release on `pointerup`
  does the same — so the §6 handler runs on every stroke, not only the abnormal one. §6
  simultaneously calls it "the same cleanup path as `endPointer`" (which commits) and says
  it should "abort the in-progress stroke without committing a stray mark". In the ordinary
  ordering the queued lost-capture task lands after the commit and is a harmless no-op, but
  an implementer who wires the two together literally can drop every stroke. One sentence
  stating the invariant — "the lost-capture handler must be a no-op when the pointer was
  already ended normally" — removes the hazard. It is not blocking only because the
  toggle-on and stale-pointer results would catch the bad implementation.
- **Device emulation cannot reproduce the primary cause, and cannot resolve
  `env(safe-area-inset-bottom)`.** The tablet result is scoped to "device emulation at
  768 × 1024, 820 × 1180 and 1024 × 768", but desktop emulation has no collapsing browser
  chrome, so `visualViewport.height === innerHeight` throughout and the Cause-1 bug is not
  reproducible there. Similarly, Chrome's device emulation resolves the safe-area insets to
  0 even for iPhone/iPad profiles, so the safe-area result's "(or emulated device) with a
  non-zero bottom inset" half is only checkable on hardware. Both results are still worth
  keeping — they verify the mechanism — but saying which half is emulation-checkable and
  which requires real hardware would stop QA from either inventing a runner or recording a
  vacuous pass.
- **The read-mode scroll result needs a precondition.** "with drawing off, a one-finger
  drag over the PDF scrolls the page natively" cannot be observed when the rendered page
  fits the scroll container (the default is fit-width at 100 % zoom, `:479`), because there
  is nothing to scroll. Adding "with the in-app zoom raised so the page overflows the
  container" makes it decidable.
- **Name the specific behaviours behind "exactly as they did before this task."** Carried
  over from round 1 — the phrase is anchored by the concrete pill-cycling clause so it is
  workable, but listing them (stroke commits, erase removes strokes it touches, undo pops
  the last stroke, clear empties the page) would remove the judgement call for a QA agent
  holding only the results list.
- **Scope remains at the upper end of one PR but coherent.** Five behavioural changes plus
  a new module and its suite across two files, all serving one bug report on one surface
  and sharing the new helper. No objection; splitting would create artificial dependencies.

## [RH-28] Corrigir controles do modo desenho no tablet e adicionar toggle liga/desliga — 2026-09-01

- **A classic (non-overlay) horizontal scrollbar can break the "same value within 1 px" clause.** `flex-nowrap overflow-x-auto` on the control row reserves scrollbar height on platforms that use classic scrollbars whenever `scrollWidth > clientWidth`, so the toolbar could measure ~97 px at 1280 px wide and ~112 px at 320 px wide on the same machine. Adding `scrollbar-width: none` plus `[&::-webkit-scrollbar]:hidden` (or `scrollbar-gutter: stable` reasoning) to the row would make the measurement platform-independent. Raised in round 2 and still unaddressed.
- **`lostpointercapture` fires on every normal stroke end.** Because `:367` calls `canvas.setPointerCapture(e.pointerId)`, the implicit release at `pointerup` fires `lostpointercapture` too. §6's cleanup path must be idempotent and must not abort a stroke that `endPointer` has already committed; if any browser delivers `lostpointercapture` before `pointerup`, a naive "abort the in-progress stroke" would silently drop every stroke. Spelling out the ordering contract (e.g. only act when `pointersRef` still holds the id) would keep the implementer out of that trap.
- **Make the test result self-contained.** "covering all seven case groups in Approach §7" is another spec reference QA cannot resolve; the five inline assertions carry most of the weight already, so either drop the §7 reference or list the remaining groups.
- **Consider stating explicitly that `:484` gains a `touch-action` it does not have today.** Cause 2 correctly says the property currently lives on `:483` and `:485`; the §2a table lists `:484` alongside them without noting it is new, which is a small trap for an implementer diffing the table against the file.
- **The overlay-root `touch-action` is only in the table.** §2's prose bullet describing the overlay root's new `className`/`style` does not mention `touchAction: 'pan-x pan-y'`; repeating it there would remove any chance of it being missed during implementation.

## [RH-28] Corrigir controles do modo desenho no tablet e adicionar toggle liga/desliga — 2026-09-01

- **iPadOS Safari may not honour `touch-action` for browser pinch-zoom, and ER7 does not
  name the platform.** §2a's whole pinch-suppression mechanism is `touch-action: pan-x pan-y`
  at the overlay root. WebKit has a long-standing gap here (`touch-action` does not reliably
  prevent the page pinch-zoom gesture in iOS/iPadOS Safari; the usual workaround is
  `preventDefault()` on `gesturestart`/`gesturechange`). ER13 explicitly scopes itself to
  Chrome device emulation, where the mechanism does work, but ER7 says only
  "with PDF Stage Mode open and drawing off, a two-finger pinch … leaves
  `window.visualViewport.scale === 1`" — run on the iPad the bug was reported from, a
  conforming implementation could fail it for reasons the diff does not control. The
  design degrades gracefully (`isStableViewportMeasurement` freezes the last stable
  height when `scale !== 1`), so this is not a correctness blocker, but ER7 should either
  name the verification environment or the spec should add the `gesturestart` fallback
  for WebKit.
- **ER20 uses an undefined identifier `row`.** ER4's snippet defines `overlay`,
  `stageRoot`, `stageCtr`, `scroller`, `toolbar` and `canvas`, but nothing in the results
  list defines `row`. Since QA sees only the results, add `const row = toolbar.children[1]`
  (the control row; `children[0]` is the page-nav row) to ER19/ER20.
- **A classic (non-overlay) horizontal scrollbar can break ER19's "same value within 1 px".**
  `flex-nowrap overflow-x-auto` reserves scrollbar height on platforms with classic
  scrollbars whenever `scrollWidth > clientWidth`, so the toolbar could measure ~97 px at
  1280 px and ~112 px at 320 px on the same machine. Harmless on macOS/touch emulation
  (overlay scrollbars), but `scrollbar-width: none` plus `[&::-webkit-scrollbar]:hidden`
  on the row would make the measurement platform-independent. Raised in rounds 2 and 3
  and still open.
- **§3 says "Keep `overscrollBehavior: 'contain'` on the stage scroll container (`:485`)".**
  `:485` has no `overscroll-behavior` today (`className="w-full h-full overflow-auto"`,
  `style={{ touchAction: 'none' }}`), so "keep" should read "add". No expected result
  gates it, and omitting it is harmless because the overlay root already contains the
  chain, but the wording invites an implementer to read it as "no change needed".
- **`lostpointercapture` fires on every normal stroke end** (because `:367` calls
  `setPointerCapture`, the implicit release at `pointerup` also fires it). §6's cleanup
  must be idempotent and must not abort a stroke `endPointer` has already committed —
  spelling out "only act when `pointersRef` still holds the id" would keep the
  implementer out of that trap. ER11's "stroke appears, pill cycles Saving… → Saved"
  would catch the regression, so this is a clarity point, not a gap. Raised in round 3.
- **ER21's second clause is vacuous in Chrome device emulation**, which does not apply
  `env(safe-area-inset-*)`. The first clause (spacer is the toolbar's next sibling with
  `height: env(safe-area-inset-bottom, 0px)` and the toolbar background) is fully
  checkable in the DOM; consider marking the home-indicator overlap check as
  hardware-only so QA does not report it as unverifiable.
- **ER13's "the overlay root no longer relies on `inset-0` / `100vh` for its height"**
  would be sharper as a class-list assertion (the overlay root's `className` contains
  `inset-x-0 top-0` and not `inset-0`), since "no longer relies on" is a statement about
  intent rather than an observation.
- **`npm run test` runs `vitest` without `run`.** It behaves as a single run in a
  non-TTY agent shell, so ER24 is fine as written, but `npx vitest run` would remove any
  chance of a hung watch-mode invocation.


## [RH-28] Corrigir controles do modo desenho no tablet e adicionar toggle liga/desliga — 2026-09-01

- **ER20 uses an undefined identifier `row`.** ER4's snippet defines `overlay`,
  `stageRoot`, `stageCtr`, `scroller`, `toolbar` and `canvas`, but no result defines `row`,
  and QA sees only the results. It is derivable (`toolbar.children[1]`; `children[0]` is the
  page-nav row), but adding that one line to ER19/ER20 would make them self-contained.
  Carried over from round 4.
- **ER7 does not name the verification platform, and WebKit is the weak spot for the
  mechanism.** §2a's pinch suppression is `touch-action: pan-x pan-y` at the overlay root,
  which Blink honours but iOS/iPadOS Safari historically does not apply to the page
  pinch-zoom gesture (the usual workaround is `preventDefault()` on
  `gesturestart`/`gesturechange`). ER13 scopes itself to device emulation; ER7 does not, so
  run on the iPad the bug came from, a conforming implementation could fail it for reasons
  the diff does not control. The design degrades gracefully (the
  `isStableViewportMeasurement` guard freezes the last stable height), so this is not a
  correctness gap — but naming the environment in ER7, or adding the `gesturestart`
  fallback, would remove the ambiguity. Carried over from round 4.
- **A classic (non-overlay) horizontal scrollbar can perturb ER19's "same value within
  1 px".** `flex-nowrap overflow-x-auto` reserves scrollbar height on platforms with
  classic scrollbars whenever `scrollWidth > clientWidth`, so the toolbar could measure
  ~97 px at 1280 px and ~112 px at 320 px on the same machine. Harmless on macOS/touch
  emulation, where this will be verified, but `scrollbar-width: none` plus
  `[&::-webkit-scrollbar]:hidden` on the row would make the measurement
  platform-independent. Carried over from rounds 2–4.
- **The page-nav row is not covered by the no-wrap treatment.** §4 converts only the
  *control* row to `flex-nowrap overflow-x-auto`. The page-nav row (`:529`) is nowrap by
  default, but its children can still shrink at 320 px and wrap their own text
  (`‹ Prev`, `Page 10 / 128`, a `SAVE FAILED` pill), which would grow the row past the 28 px
  the budget assumes and break ER19's cross-width equality in those states. Adding
  `shrink-0 whitespace-nowrap` to the page-nav children, or giving that row the same
  `flex-nowrap overflow-x-auto`, would make the budget robust rather than
  content-dependent.
- **RH-16 does not actually own the two `confirm()` calls the spec defers to it.** §8,
  Out of Scope and ER23 all say retrofitting `fast-view/page.tsx`'s delete-tab and
  delete-link confirmations is "RH-16's job", but RH-16 is
  *"Substituir window.confirm() por Toast na pagina de banda"* and its justification names
  `handleDelete`/`handleLeave`/`handleRemoveMember` in `src/app/bands/[id]/page.tsx` only.
  This does not affect ER23 (which is baseline-relative and passes as written) or the
  implementer's instructions (leave them alone — correct scope discipline for a
  tablet-drawing fix), but the AGENTS.md `:171` violation in Fast View is currently
  untracked. Either widen RH-16 or file a follow-up, and correct the attribution in the
  spec.
- **ER14's "if a scale other than 1 is forced (e.g. desktop `Ctrl`+wheel)" clause is
  effectively unreachable.** On desktop Chrome, `Ctrl`+wheel and trackpad pinch are *page*
  zoom and leave `visualViewport.scale === 1`; only true touch pinch-zoom moves it, and
  §2a suppresses that inside the overlay. The clause is phrased conditionally so QA can
  skip it, and the guard's logic is fully covered by ER2's
  `isStableViewportMeasurement` cases, so nothing is lost — but the parenthetical example
  is misleading.
- **§3 says "Keep `overscrollBehavior: 'contain'` on the stage scroll container (`:485`)"**;
  `:485` has no `overscroll-behavior` today, so "keep" should read "add". No expected
  result gates it and omitting it is harmless (the overlay root already contains the
  chain), but the wording invites "no change needed". Carried over from round 4.
- **`lostpointercapture` fires on every normal stroke end**, because `:367` calls
  `setPointerCapture` and the implicit release at `pointerup` also fires it. §6's cleanup
  must therefore be idempotent and must not abort a stroke `endPointer` has already
  committed; spelling out "only act when `pointersRef` still holds the id" would keep the
  implementer out of that trap. ER11 would catch a regression, so this is clarity, not a
  gap. Carried over from rounds 3–4.
- **ER21's home-indicator clause is vacuous in Chrome device emulation**, which does not
  apply `env(safe-area-inset-*)`. The first clause (spacer is the toolbar's next sibling
  with `height: env(safe-area-inset-bottom, 0px)` and the toolbar background) is fully
  checkable in the DOM; marking the overlap check hardware-only would stop QA reporting it
  as unverifiable. Carried over from round 4.
- **Minor citations**: `.fixed.z-50` siblings are at `page.tsx:553/555` (spec says `:554`),
  and §2a's closing sentence still refers to "ER10/ER11" under an older numbering (current
  ER10 is the hidden-drawing-controls result). Cosmetic, inside the spec body, not in the
  results.

## [RH-28] Corrigir controles do modo desenho no tablet e adicionar toggle liga/desliga — 2026-09-02

- `src/components/tabs/TabDrawingStage.tsx:481` — the unconditional `redraw()` in the lost-capture
  handler also fires immediately after `commitStroke()` (`endPointer:455`) has queued
  `setStrokes`. `strokesRef` is only synced in a passive effect (`:92`), so this redraw can, in
  principle, paint a frame without the just-committed stroke before the `[strokes]` effect
  (`:174-177`) repaints it. In practice React flushes the passive effect in the microtask
  checkpoint between the two event dispatches, so this is a latent flicker rather than an
  observed bug — but it disappears entirely with the guard proposed above, which is another
  reason to prefer that fix over, say, adding a `drawingEnabled` check.
- `src/components/tabs/TabDrawingStage.tsx:633-641` — the toggle carries
  `aria-label="Toggle drawing"` while its visible text is `Draw: Off` / `Draw: On`. The
  accessible name therefore does not contain the visible label (WCAG 2.5.3 "Label in Name"),
  which can bite voice-control users ("click Draw"). The spec mandates the accessible name, so
  this is not a deviation — but `aria-label={\`Toggle drawing (currently ${drawingEnabled ? 'on' : 'off'})\`}`
  or moving the wording so the visible text is a substring would satisfy both.
- `src/components/tabs/TabDrawingStage.tsx:643-644` and `:727-728` — the two
  `{drawingEnabled && (` blocks keep their children at the old indentation level, so the
  conditional wrapping is easy to miss when reading the JSX (`</>` / `)` at `:709-710` are
  particularly hard to pair up). Re-indenting the wrapped children would help; ESLint does not
  flag it, so it is purely readability.
- `src/components/tabs/TabDrawingStage.tsx:630` — `overflow-x-auto` on the control row will
  render a persistent scrollbar gutter on desktop platforms configured to always show
  scrollbars (Linux/Windows), eating a few px of the budgeted 44 px row. A
  `[scrollbar-width:none]` / `scrollbar-hide` style would keep the row visually identical
  everywhere; the ≤ 104 px budget still holds either way, so this is cosmetic.
- `src/lib/stageInteraction.ts:88-92` — `shouldHandleStagePointer` is the identity function on
  its argument. It is explicitly required by the spec (§1) and is unit-tested, so it stays, but
  it is worth remembering that its value is documentation and a future-proof seam, not logic.


## [RH-28] Corrigir controles do modo desenho no tablet e adicionar toggle liga/desliga — 2026-09-02

- `src/components/tabs/TabDrawingStage.tsx:494` — in the *genuine* pointer-loss path,
  `erasedDuringGestureRef.current = false` is assigned without the `scheduleSave()` that
  `endPointer:462-465` performs in the same situation. If a pointer is silently taken away
  mid-erase-drag, the erases have already been written to `annotationsRef.current` and `strokes`
  (via `eraseAt`), so the UI shows them gone while nothing is ever persisted — they reappear on
  reload. Mirroring `endPointer` with `if (erasedDuringGestureRef.current) scheduleSave()` before
  the reset would make the loss path consistent with the normal path. Rare enough not to block, and
  §6 only asks for the abort semantics, but it is a real in-memory/persisted divergence.
- `src/components/tabs/TabDrawingStage.tsx:499` — `handleToggleDrawing` does not reset
  `clearConfirmOpen`. If the user opens the Clear-page confirmation and then toggles drawing off,
  the `Clear page` button disappears but its confirmation panel (`:776`) stays on screen and can
  still be confirmed from read mode. A `setClearConfirmOpen(false)` in the disable branch would
  close that gap.
- `src/components/tabs/TabDrawingStage.tsx:662-710` and `:742-761` — the bodies of the
  `{drawingEnabled && (…)}` blocks are not re-indented under the new conditional wrapper, so the
  nesting level no longer reads off the indentation. Prettier/ESLint do not flag it in this repo,
  but it makes the two conditional regions harder to spot when scanning the toolbar JSX.
- `src/lib/stageInteraction.ts:36` and `:80` — the `typeof x === 'number'` check ahead of
  `Number.isFinite(x)` is redundant at runtime (`Number.isFinite(null) === false`). It is worth
  keeping for TypeScript narrowing on the `number | undefined | null` parameter, so this is purely
  a note for a future reader who might be tempted to "simplify" it into a bug.

## [RH-28] Corrigir controles do modo desenho no tablet e adicionar toggle liga/desliga — 2026-09-02

- Dropping `h-full` from the stage root (`TabDrawingStage.tsx:551`), or adding
  `min-h-0`/`h-auto` so the flex algorithm owns the main size, is the smallest
  change that would make results 13 pass; re-check with
  `overlay.children[1].getBoundingClientRect().height === overlayHeight - headerHeight`.
- Add a regression guard for the geometry itself. The three tablet sizes and the
  invariant `toolbar.bottom <= visualViewport.height` are cheap to assert in a
  Playwright spec (`e2e/fast-view-mobile.spec.ts` already emulates a device), and
  it is the one part of this task the pure helpers in `stageInteraction.ts` cannot
  cover — every unit test passes while the visible symptom persists.
- Beware of measuring the toolbar *after* clicking one of its controls: the browser
  scrolls the `overflow: hidden` overlay to reveal the focused button, which makes
  `toolbar.bottom <= visualViewport.height` read true while the header has silently
  scrolled to `top: -61`. Only a first-render measurement is meaningful.
- Unrelated to RH-28 but worth filing: `next.config.ts` listing `"better-auth"` in
  `serverExternalPackages` makes every SSR render throw an invalid-hook-call in
  `AppLayout.tsx:169`, and `npm run dev` (the `--webpack` flag) makes
  `pdfjs-dist` fail to initialise so the Fast View PDF viewer never loads. Both
  reproduce on a clean `HEAD`, so they predate this task, but together they mean
  the documented dev command cannot currently render the feature under test.
- WebKit is not installed for Playwright in this environment
  (`npx playwright install webkit`), so the touch-action / visual-viewport
  behaviour was only confirmed on Chromium. Given the bug was reported on iPad,
  a WebKit pass would be worth having before this ships.

## [RH-28] Corrigir controles do modo desenho no tablet e adicionar toggle liga/desliga — 2026-09-02

- `TabDrawingStage.tsx:558` — `w-full` on the stage root is now redundant. As a flex item in the
  overlay's column with the default `align-items: stretch`, it already fills the cross axis;
  `flex-1 min-h-0 bg-black flex flex-col relative` expresses the same layout with one fewer
  class. Cosmetic only, and there is an argument for keeping it as documentation of intent.
- `TabDrawingStage.tsx:665-716` — the `{drawingEnabled && (<> … </>)}` wrapper keeps its children
  at their previous indentation level, so the conditional's extent is hard to see when reading the
  JSX. Re-indenting, or extracting the drawing-only groups into a small local
  `DrawingControls` fragment, would make the two-mode toolbar easier to follow. Lint and Prettier
  are clean either way, so this is purely readability.
- `docs/tasks/RH-28-spec.md` §2a table row 2 and the ER list still describe the stage root as
  `flex-1 w-full h-full bg-black`. Now that `h-full` is precisely the thing that had to go, that
  wording reads as an instruction to restore the bug. Worth a one-line spec amendment (or a note
  in Delivery Notes) so the next reader of the spec is not misled — the in-code comment at
  `:548-556` already covers the code side.
- `page.tsx` — the measure effect's cleanup resets `pdfStageHeight` to `null`, so reopening Stage
  Mode paints one frame at the `100dvh` fallback before the measured value lands. Harmless and
  arguably safer than carrying a height across an orientation change, but if that first frame
  ever shows up as a flicker on hardware, keeping the last value and re-measuring in a layout
  effect would remove it.

## [RH-28] Corrigir controles do modo desenho no tablet e adicionar toggle liga/desliga — 2026-09-02

*(non-blocking)*

1. **The dev server does not start on this machine at HEAD, for reasons
   unrelated to RH-28.** `npm run dev` returns HTTP 500 on every page rendered
   inside `AppLayout`:
   `TypeError: Cannot read properties of null (reading 'useRef')` at
   `AppLayout.tsx:169` (`authClient.useSession()`), preceded by React's
   "more than one copy of React" warning. Root cause is
   `serverExternalPackages: ["better-auth", …]` in `next.config.ts`: the
   externalised `better-auth/react` → `react-store.mjs` resolves `react` through
   Node rather than through the bundler, so it gets a different React instance
   than the one rendering the tree, and its hook dispatcher is null. It
   reproduces identically under `--webpack` and `--turbopack`, and is present
   with the unmodified `next.config.ts` (I restored the file and re-confirmed the
   500). A second, independent dev-only failure exists under the `--webpack`
   flag that `npm run dev` uses: the Fast View route crashes client-side with
   `TypeError: Object.defineProperty called on non-object` from
   `pdfjs-dist/build/pdf.mjs`; it does not occur under Turbopack. To run this
   review I dropped `"better-auth"` from `serverExternalPackages` and used
   `next dev --turbopack`, then restored `next.config.ts` byte-for-byte
   (sha1 `e8dc3c4e890bfda107562c45a82fe28029a3d6b0`, `git status` clean for that
   file). Neither workaround touches any code under test — the change under
   review is entirely client-side layout/gesture behaviour — but the two dev-mode
   failures are worth a follow-up task of their own, since as things stand
   nobody can run `npm run dev` on this checkout.

2. `stageInteraction.ts` mentions `window` and `document` in its header comment.
   A literal reading of criterion 1's `grep` would flag line 12. Rewording it
   (e.g. "must not touch browser globals") would make the file's compliance
   greppable as well as true.

3. Criterion 19's "same value within 1 px" is met with a 0 px spread today, but
   nothing guards it against regression. A small jsdom/Playwright test asserting
   `toolbar.getBoundingClientRect().height <= 104` and
   `getComputedStyle(toolbar).paddingBottom === '8px'` at 320 and 1280 px would
   turn the round-1 failure mode into a permanent check — the pure helpers in
   `stageInteraction.ts` are unit-tested, but the layout invariant that actually
   broke is not.

---


## [RH-16] Substituir window.confirm() por Toast na pagina de banda — 2026-09-03

- **§5 contains an instruction that cannot be followed literally alongside ER #2.**
  §5 says the guardrail file "must be written so that it does not itself match the
  shell grep gate (build the pattern so the literal text `confirm(` / `alert(`
  never appears adjacent to an opening parenthesis)", but ER #2 requires the file
  to contain the fixture snippets `if (!confirm('x')) return` and
  `window.alert('x')`, which match the gate by construction. The belt-and-braces
  `grep -v "noBrowserDialogs.test.ts"` in ER #1 makes this harmless either way, so
  it is not blocking — but the instruction should be narrowed to "the *detector
  regex source* must not match the gate" and the fixtures explicitly exempted, so
  the developer does not waste effort obfuscating the fixtures.

- **ER #3's import gate is brittle in a way the spec does not need.**
  `grep -rn "ConfirmPanel" src --include='*.tsx' | grep import` only matches when
  the identifier and the keyword `import` are on the *same physical line*. A
  perfectly conforming multi-line import (`import {\n  ConfirmPanel,\n} from ...`)
  yields zero lines for that file and fails the gate. `grep -rl "from \"@/components/ui/ConfirmPanel\"" src`
  (or `grep -rlE "ConfirmPanel" src/app` with the component file excluded) would be
  robust to formatting.

- **The detector's prefix class differs between the two gates**: the shell gate
  uses `[^A-Za-z0-9_.]` while §5's JS regex uses `[^A-Za-z0-9_$.]`. They will agree
  in practice, but making them identical would remove a source of "the test passes
  and the grep fails" confusion.

- **Comment stripping should preserve line numbers.** §5 asks for `file:line`
  reporting on failure and for `/* */` stripping; a naive `replace(/\/\*[\s\S]*?\*\//g, '')`
  collapses lines and will misreport the location of any real violation that
  follows a multi-line comment. Suggest replacing block-comment bodies with an
  equal number of newlines.

- **The remove-member toast copy has an unstated fallback.** §2 writes
  `showToast(\`${name} removed from the band.\`)` without saying what `name` is
  when `member.profile?.full_name` is null; the panel message explicitly uses the
  `?? "this member"` fallback, which would render the toast as "this member removed
  from the band." Worth stating the intended string (e.g. reuse the same fallback,
  or fall back to `member.profile?.email`).

- **ER #5 and ER #6 require a second user.** They are legitimate and precisely
  worded, but a QA agent will need to create a second account and join via the
  invite link to reach "a band with at least two members" and "a non-admin member".
  Adding one sentence naming the dev-login / invite-link route to that setup would
  make them cheaper to execute without weakening them.

- **`aria-live="assertive"` on a `role="alertdialog"` root is redundant** — the
  role already implies an assertive announcement, and doubling it can cause some
  screen readers to announce twice. Harmless, but consider dropping it.

- **`ConfirmPanel`'s `document`-level Escape listener on the fast-view page** may
  race with other Escape handlers on that page (modals, sheets). Suggest the panel
  call `stopPropagation()` or that §4 state explicitly that the confirmation takes
  Escape precedence, so the behaviour is not decided by listener registration order.

- **Fast-view `deleteBusy` is declared but never explicitly set.** §4 declares the
  state and passes `busy={deleteBusy}`, but unlike §2 it never says
  `confirmPendingDelete()` wraps its body in `setDeleteBusy(true)` /
  `finally { setDeleteBusy(false) }`. Obvious in context, but worth one line for symmetry.

## [RH-16] Substituir window.confirm() por Toast na pagina de banda — 2026-09-03

- **Line-preserving comment stripping in the guardrail test.** My simulation of §5's
  algorithm reported the fast-view violations at lines 437/579 instead of the true
  443/585, because removing `/* */` blocks wholesale shifts subsequent line numbers.
  Expected Result 2 only requires the failure message to list `file:line`, so this does
  not block, but replacing each stripped block with its own newline count (or blanking
  comment characters in place) would make the reported locations directly clickable.
- **Result 3's `grep -rn "ConfirmPanel" src --include='*.tsx' | grep import` is
  formatting-sensitive.** It counts lines containing both `ConfirmPanel` and `import`, so
  a multi-line `import { ConfirmPanel } from …` in any of the three pages would drop that
  file from the output and fail a conforming implementation. Consider stating the
  intent ("exactly these three files import `ConfirmPanel`") alongside the command, or
  using a command that tolerates line breaks.
- **`role="alertdialog"` normally wants an accessible name.** §1 gives the root
  `role="alertdialog"` and `aria-live="assertive"`; `aria-live` is redundant on a role
  that is already assertive by definition, and an `aria-label` or `aria-labelledby`
  pointing at the message paragraph would make the panel announce properly. Purely an
  a11y polish item — no expected result depends on it.
- **Failure-path panel state in fast-view is unstated.** §2 says the bands page clears
  `pendingAction` on success (so the panel stays open on failure, which is sensible for
  retry). §4 does not say the same for `pendingDelete` after an error toast. No expected
  result exercises the failure path, so this is not blocking; one sentence would remove
  the guesswork.
- **In the E2E "cancel keeps the band" test, scope the focus assertion to the
  alertdialog.** The bands page has other `Cancel` buttons (edit-band modal, and the
  RH-8 regenerate panel), so `getByRole('alertdialog').getByRole('button', { name: 'Cancel' })`
  is the safer locator than a page-wide one.
- **The 24/20 lint baseline is a moving target across tasks.** It is correct as of the
  current `master` (verified). If another task lands lint-affecting changes before RH-16
  is implemented, QA should re-measure the baseline on the merge-base rather than trust
  the literal numbers.

## [RH-16] Substituir window.confirm() por Toast na pagina de banda — 2026-09-03

- **`src/components/ui/ConfirmPanel.tsx:70` — `role="alertdialog"` has no accessible
  name.** ARIA expects a dialog role to be named via `aria-label` /
  `aria-labelledby`; screen readers will announce "alert dialog" with no title. A
  one-line fix: give the message `<p>` an `id` and point `aria-labelledby` at it (or
  `aria-describedby` plus `aria-label={confirmLabel}`). Non-blocking because the
  message text is inside the dialog and is read on entry, and the spec prescribed the
  exact attribute set.
- **`src/components/ui/ConfirmPanel.tsx:71` — `aria-live="assertive"` on a dialog role
  is redundant** and, on some AT combinations, causes a double announcement (live
  region + dialog entry). It was explicitly required by the spec, so it stays; worth
  revisiting if QA hears duplicated speech.
- **No focus restoration on close.** The panel focuses `Cancel` on mount
  (`ConfirmPanel.tsx:52-54`) but never returns focus to the control that opened it
  when it unmounts, so a keyboard user who presses `Escape` is dropped back at the
  document body. Capturing `document.activeElement` on mount and restoring it in the
  cleanup is ~4 lines and would make the panel keyboard-complete. The panel is also
  deliberately non-modal (no focus trap, background stays interactive), which is
  consistent with the inline design the spec chose.
- **`src/components/ui/ConfirmPanel.tsx:62` — the `keydown` listener re-subscribes on
  every render.** The effect depends on `onCancel`, and every call site passes a fresh
  inline arrow (`onCancel={() => setPendingAction(null)}`). Functionally correct, but a
  `useCallback` at the call sites or a ref-held handler inside the panel would avoid
  the add/remove churn.
- **`src/app/bands/[id]/page.tsx:218` and `src/app/profile/page.tsx:208` are near-verbatim
  duplicates** — the same `PendingAction` union, the same `confirmPendingAction`
  switch, the same toast block. The spec explicitly rules de-duplicating
  `BandProfileView` out of scope, so this is not a finding against the diff; it is the
  strongest argument yet for the already-recorded follow-up. A single
  `useBandDestructiveActions(bandId)` hook plus a shared `useToast` would collapse
  ~120 duplicated lines across the two files.
- **Inconsistent panel lifetime on failure.** `bands/[id]` and `profile` keep the
  confirmation open when the action throws (the red banner explains why, and the user
  can retry), while `fast-view` clears it unconditionally at
  `src/app/songs/[id]/fast-view/page.tsx:627`, including after `showToast(res.error,
  'error')`. Both are defensible in isolation — fast-view surfaces the error as a toast
  rather than a banner — but aligning them would remove a small behavioural surprise.
- **`confirmPendingAction` nests a `try/catch` per switch case inside the outer
  `try/finally`.** A single `catch` with a `{ deleteBand: "Failed to delete band", ... }`
  message lookup would be shorter and flatter. Current shape is readable; purely
  stylistic.
- **`stripComments` in `src/lib/__tests__/noBrowserDialogs.test.ts` also strips
  comment-like text inside string literals and regex literals** (e.g. `"https://x"`
  loses its tail). This can only produce false negatives, never false positives, so the
  guardrail stays sound — but it is worth a one-line comment so a future reader does
  not mistake it for a real parser.


## [RH-16] Substituir window.confirm() por Toast na pagina de banda — 2026-09-03

1. **Leaving a band does not clear the persisted band context.** After a non-admin leaves a band
   (from either `/bands/<id>` or `/profile`) the app navigates to `/bands` and correctly shows
   "No bands yet", but the sidebar switcher and the purple "Band Mode" banner still display the
   name of the band the user just left, because `localStorage['band-context']` is untouched.
   Calling `useBandContextStore.getState().setUserContext()` in the `leaveBand` success path (and
   in `deleteBand` when the deleted band is the active context) would fix it. Pre-existing and
   outside RH-16's scope — noting it because RH-16's work made it easy to observe.
2. **`ConfirmPanel` ignores `Escape` while `busy`.** This is a defensible choice (do not let a user
   dismiss the panel mid-request), but the confirm and cancel buttons are already `disabled` while
   busy, so the guard is belt-and-braces. Worth a one-line comment stating the intent so a future
   reader does not "fix" it.
3. **`ConfirmPanel` does not trap focus.** It has `role="alertdialog"` and moves focus to `Cancel`,
   but `Tab` can move focus out of the panel to the page behind it. For a genuinely modal
   confirmation, a focus trap plus `aria-modal="true"` would complete the pattern. Not required by
   any expected result.
4. **The dialog guardrail only scans `src/`.** `e2e/` and `scripts/` are not covered. Widening
   `listSourceFiles` to the repo root (minus `node_modules` / `.next`) would close the gap cheaply,
   though the risk there is low.
5. **Playwright cannot manage its own dev server while RH-32 is open**, because the
   `webServer.url` health check probes `GET /`. Pointing it at a route that does not SSR-crash (or
   an API health endpoint) would make `npx playwright test` work out of the box again; worth
   folding into RH-32.

## [RH-17] Sincronizar supabase/migrations com o diretorio migrations numerado — 2026-09-03

- **`[db.migrations]` already exists in `supabase/config.toml`.** Approach §4 presents the section as a block to add, showing a `[db.migrations]` header with a comment and `enabled = false`. The file already has `[db.migrations]` at line ~50 with `enabled = true` and `schema_paths = []`. The sentence "`schema_paths`, `[db.seed]` and every other section stay as they are" implies an in-place edit, and expected result 6 says "a `[db.migrations]` section" in the singular, so the intent is recoverable — but a literal reading could produce a duplicate TOML table, which makes the whole config unparseable by the CLI. Say "edit the existing `[db.migrations]` section: flip `enabled` to `false` and replace the stock comment; leave `schema_paths = []`."
- **`<base>` is defined only once, in expected result 3.** QA sees the results list without the spec, and result 17 reuses `<base>` without redefining it. It is resolvable from result 3's parenthetical, but pin it mechanically, e.g. "`<base>` = the parent of the first commit whose message contains `RH-17` (`git log --grep=RH-17 --format=%H | tail -1`)^". This repo lands one commit per task on `master`, so `HEAD~1` will usually work, but that should be stated rather than inferred.
- **Expected result 8 is verified by reading the test source, while 9 and 10 are behavioural.** Invariants (c) contiguous numbering and (d) docker mount get no behavioural probe. Consider adding two more probes in the same style — e.g. creating `migrations/0009_gap.sql` must fail the run, and temporarily rewriting the compose mount to `./supabase/migrations` must fail the run — so all four invariants are proven live rather than by inspection.
- **The guard walking the whole repo from the root will traverse `.next/` cache, `coverage/`, `public/` and any large untracked directories on every test run.** The skip list handles the known ones, but a `maxDepth` or an early skip of any dotted directory would make it robust against future additions like `.turbo/` or `.vercel/output`.
- **Expected result 15 needs a live Postgres.** It is verifiable in this environment (both `54322` and `5432` are listening, and `docker` is on `PATH`), so this is not blocking — but the result would be more self-contained for QA if it named how to obtain such a database, e.g. "run `npm run db:migrate` once first, then assert the second and third runs are pure skips."
- **Consider asserting the docker init path end-to-end.** The most valuable consequence of this task — `docker compose up -d` on a fresh volume finally producing a complete schema including `0002` — is not covered by any expected result. A result such as "after `docker compose down -v && docker compose up -d db`, `\d repertoire_tabs` shows the `annotations` column and `SELECT name FROM _migrations` returns the six basenames" would prove both §2 and §3 actually work, and would exercise finding 2's fix.
- **`README.md` was not checked by expected result 4's grep.** It happens to contain no `supabase/migrations` reference today (verified by `git grep`), so nothing is missing — but adding `README.md` to that grep list costs nothing and prevents the string reappearing there.

## [RH-17] Sincronizar supabase/migrations com o diretorio migrations numerado — 2026-09-03

- **Expected Result 10's `ls -d .claude/worktrees/*/supabase/migrations` probe is
  environment-dependent.** It holds today (two worktrees present, verified), but
  those directories are gitignored scratch state that can be pruned at any time.
  If they are gone when QA runs, a literal reading of "confirming that … still
  lists at least one directory" fails a correct implementation. Consider
  rewording to "if `.claude/worktrees/` contains any checkout with a
  `supabase/migrations/` directory, the guard still passes" — the load-bearing
  half of the result (the skip list includes `.claude`) is verifiable by reading
  the file regardless.
- **`supabase/config.toml` already has a `[db.migrations]` section.** It
  currently reads `enabled = true` with the stock comment plus
  `schema_paths = []`. Spec §4 presents its TOML block as something to add,
  without noting the section exists; appending it verbatim would produce a
  duplicate TOML table and an unparseable config. The intent is clear enough
  from "`schema_paths` … stay as they are", but saying "flip the existing
  `enabled = true` to `false` in place and replace the stock comment" would
  remove the last doubt. Expected Result 7 could add "and `config.toml` contains
  exactly one `[db.migrations]` section".
- **Expected Result 6 offers two implementations and then a check only one
  passes.** It accepts either `-v ON_ERROR_STOP=1` *or* an explicit exit-status
  check, then requires
  `grep -c 'ON_ERROR_STOP' docker/init-migrations.sh` ≥ 1 — which the second
  option fails. Since §3 already calls `ON_ERROR_STOP=1` "the intended form",
  dropping the alternative from the result would make it self-consistent. Not
  blocking: the grep clause effectively forces the intended form, so a developer
  reading both cannot land the failing variant.
- **Results 13 and 8 say "with no database running" while result 18 needs a
  running database with the six ledger rows.** The sequence is satisfiable but
  invites QA to stop the local Supabase stack. Pointing `DATABASE_URL` at an
  unused port for the vitest runs (`DATABASE_URL=postgresql://…:1/postgres npx
  vitest run`) proves DB-independence without touching the developer's stack;
  worth stating as the intended verification method.
- **Result 18's "executes no DDL"** would be more directly checkable as "prints
  no `Executing migration:` line", which is what the runner actually emits when
  it applies a file.
- **Results 3, 17 and 20 compare `a51951f..HEAD`** and therefore pass vacuously
  if QA runs before the work is committed (HEAD is still `a51951f` today).
  `git diff a51951f -- <paths>` covers the working tree as well and is true in
  both orderings. The existing repo convention (RH-16's results inspect commits
  via `git log --grep`) suggests QA runs post-commit here, so this is
  precautionary only.
- **Out of Scope names RH-5 and RH-12** as the prior specs documenting the
  mirror convention; `docs/tasks/RH-8-spec.md` also references
  `supabase/migrations`. Harmless — the exclusion is categorical and the
  Expected Result 4 grep does not cover `docs/` — but the parenthetical is
  incomplete.
- **Local bootstrap path worth a line in `AGENTS.md`.** The database actually
  running on this machine is the Supabase CLI stack
  (`supabase_db_repertoire_hero`), not the `docker-compose.yml` `db` service.
  With `[db.migrations] enabled = false`, a `supabase db reset` will leave an
  empty schema, and the developer must follow it with `npm run db:migrate`.
  §6 already rewrites the Directory Structure entry; adding that two-step
  sequence there would close the loop for whoever next resets a local database.

## [RH-17] Sincronizar supabase/migrations com o diretorio migrations numerado — 2026-09-03

- `docker/init-migrations.sh:25` — `for f in $(find … | sort)` word-splits on
  whitespace (pre-existing line, not introduced here). It is now effectively
  safe because the new vitest guard forbids any filename outside
  `^\d{4}_[a-z0-9_]+\.sql$`, but `find … -print0 | sort -z | while IFS= read -r -d ''`
  would remove the dependency of the shell script's correctness on a TypeScript
  test. Non-blocking; the current coupling is at least documented.
- `src/lib/__tests__/migrationsSingleSource.test.ts:169` — the test
  `'skips every documented tooling directory'` asserts membership in the
  `SKIPPED_DIRECTORY_NAMES` constant rather than the walk's behaviour. Only
  `node_modules`, `.claude`, `.meridian` and `.temp` get an actual behavioural
  check (line 137). Iterating the skip list and creating
  `<tmp>/<skipped>/migrations` for each name would make all fourteen entries
  behaviourally covered with roughly the same amount of code.
- `src/lib/__tests__/migrationsSingleSource.test.ts:280` — the numbering test
  feeds every regular file in `migrations/` to `findNumberingViolations`,
  including hypothetical non-migration files. A stray `README.md` would yield
  `expected 0002, found READ`, which is a confusing message; the naming test
  fires on the same file with a clear message, so this is cosmetic. Filtering to
  `.sql` entries (or to names matching the pattern) before the numbering check
  would keep the message honest about what it diagnoses.
- `src/lib/__tests__/migrationsSingleSource.test.ts:255,280` — both repo-level
  assertions pass vacuously if `migrations/` is ever emptied (the "no
  subdirectories" and "no violations" arrays are trivially empty). The
  `expect(directories).toContain(MIGRATIONS_DIR)` at line 252 catches deletion of
  the directory itself but not of its contents. A single
  `expect(names.length).toBeGreaterThan(0)` would close it.


## [RH-17] Sincronizar supabase/migrations com o diretorio migrations numerado — 2026-09-03

- `findMigrationDirectories` still descends into a directory it just matched, so a pathological `migrations/migrations/` would be reported twice (once as the root match's child). Harmless today — invariant (b) already rejects subdirectories inside `migrations/` — but a `continue` after `found.push(full)` would make the two failures non-overlapping and the error message tighter.
- The skip list is enumerated by name only, which means a future build output directory (`dist/`, `.turbo/`, `out/`, a Python `.venv/`) would be walked. Consider deriving the skip list from `vitest.config.ts`'s `exclude` (the file's own comment notes the symmetry goal) or from `.gitignore`, so the two lists cannot drift apart silently.
- `docker/init-migrations.sh` and `scripts/migrate.mjs` now maintain the same `_migrations` ledger with independently written DDL (`VARCHAR(255) UNIQUE NOT NULL` in the shell script). A follow-up could assert that the two `CREATE TABLE IF NOT EXISTS _migrations` definitions agree, so a column change in one runner cannot silently diverge from the other.
- The guard covers layout but not content: nothing asserts that a file in `migrations/` is non-empty or parseable SQL. An empty `0007_x.sql` would pass every invariant and be recorded as applied. A trivial "every migration file is non-empty" assertion would close that gap cheaply.

## [RH-18] Adicionar teste contra banco real para semantica already_member em join_band_by_invite — 2026-09-03

- **Pin the fixture naming normatively.** Expected result 9's cleanup check is
  `SELECT count(*) FROM bands WHERE name LIKE 'RH-18%'` and
  `... FROM "user" WHERE email LIKE 'test-rh18-%'`, but the Approach section
  introduces those names with "e.g.". An implementer who picks different prefixes
  makes result 9 pass vacuously — the queries return 0 because they match nothing,
  not because cleanup worked. Dropping the "e.g." and stating the prefixes as
  required would turn result 9 from a weak check into a real one.
- **The new file is itself an ordered stateful sequence.** The spec rejects
  `bands.test.ts` as a host because it is "a single stateful sequence sharing one
  `bandId`/`inviteCode` across its `it` blocks", then specifies five cases "in this
  order" sharing one `bandId`/`inviteCode`, with case 4 asserting "no
  `band_members` row … beyond the one from the earlier cases". The design works
  (vitest runs `it` blocks within a file sequentially) and the ordering is at least
  explicit, but the stated rationale reads as inconsistent. Having every case
  assert an absolute count for its own `(band, user)` pair — as cases 1, 2 and 5
  already do — would make the coupling ordering-only.
- **State how `inviteCode` is obtained in `beforeAll`.** The sketch imports
  `getBandWithMembers` and says "users, band, invite code created in `beforeAll`",
  leaving the reader to infer `(await getBandWithMembers(bandId))!.invite_code`.
  It is the only plausible route (`getBandByInviteCodeServer` needs the code
  already), but one explicit line removes the inference.
- **Consider folding the no-duplicate-member assertion into result 5.** Spec case 2
  asserts `getBandWithMembers(bandId)` reports exactly 2 members and that B's role
  is still `'member'`; that is the strongest "no duplicate, no role churn" signal in
  the file, and it is not reflected in any expected result. Result 5 currently stops
  at the `(band_id, user_id)` row count.
- **Follow-up task: gate real-DB suites on DB reachability, not on
  `SUPABASE_SERVICE_ROLE_KEY`.** Six files will now share a gate whose flag has
  nothing to do with the resource they need. A shared helper that pings the pool
  once and skips on connection failure would make the whole set honest, and is
  correctly out of scope here.
- **Result 2's absolute "Test Files 21 passed (21)" is baseline-sensitive.** If any
  other task lands a test file before RH-18 reaches QA, that exact string breaks
  even on a perfect implementation. Low risk given the branch-scoped QA, but
  phrasing it as "baseline + 1" would be more robust.

## [RH-18] Adicionar teste contra banco real para semantica already_member em join_band_by_invite — 2026-09-03

1. **`afterAll` short-circuits on a `deleteBand` failure**
   (`src/lib/__tests__/joinBandByInvite.test.ts:75-77`). `deleteBand` throws
   `'Band not found'` when `rowCount === 0` (bands.ts:147). If it ever throws, the two
   `deleteTestUser` calls below it never run and the fixture users leak into the shared
   local DB, where the `test-rh18-%` rows would linger across runs. The risk is low today
   (no test deletes the band, so the row is always present), but wrapping the three
   cleanup calls so each runs regardless of the previous one's outcome would make the
   teardown robust on failure paths. Non-blocking — the existing files have the same
   shape, so this is a suggestion for the convention rather than for this file alone.

2. **Cases 2-5 depend on case 1 having run.** The re-join assertions require user B's
   membership to already exist, so no individual `it` is runnable in isolation via
   `it.only` (case 2 alone would insert the row itself and see `alreadyMember === false`).
   This is inherent to testing re-join semantics, is the ordering the spec prescribes, and
   matches `bands.test.ts`'s existing stateful style — so it is the right call here. Worth
   noting only so the coupling is a known property rather than a surprise for whoever next
   edits the file. The pre-assertion of `count === 0` at line 81 already protects the
   sequence's starting state, which is the part that mattered most.

3. **Redundant null checks in case 3**
   (`src/lib/__tests__/joinBandByInvite.test.ts:111-114`). `expect(first).not.toBeNull()`
   and `expect(second).not.toBeNull()` are subsumed by the `toBe(bandId)` assertions two
   lines down, since `bandId` is a non-null string. Harmless, and arguably documents the
   spec's "neither returns null" wording explicitly; drop them only if you prefer the
   tighter form.

## [RH-18] Adicionar teste contra banco real para semantica already_member em join_band_by_invite — 2026-09-03

- The whole suite is one ordered stateful sequence: test 2 (`re-join`) depends on test 1 having
  inserted the membership, and tests 3/4 depend on that same row. Running a single case in
  isolation (`-t "re-join"`) would fail. If the file grows, consider making each case establish its
  own membership precondition (or use `beforeEach` seeding) so cases stay independently runnable.
- The `describe.skipIf(!SUPABASE_SERVICE_ROLE_KEY)` guard means that in an environment where the
  key is absent the whole file silently reports as skipped rather than failing. That matches the
  existing convention in `songs.test.ts`, but a CI-only assertion that the real-DB suites did in
  fact run would prevent the coverage from evaporating unnoticed. Note the file does not actually
  use the service-role key for anything beyond the guard — the helpers talk to Postgres via
  `DATABASE_URL` — so gating on `DATABASE_URL` reachability would be a more honest precondition.
- `docs/suggestions-log.md` (+66 lines) is modified but **unstaged**, and `docs/tasks/RH-18-spec.md`
  is untracked. Neither is covered by the expected results, but if they are meant to ship with this
  task they need to be staged before the commit.

## [RH-19] Hospedar o worker do pdf.js localmente em vez de CDN externa — 2026-09-03

- **Expected result 12's version wording is loose.** "above `0.1.58` with a
  `YYYYMMDDHHmm` suffix" — the current version is `0.1.58-202609030307`, so a
  bump to `0.1.58-2026…` with a later timestamp is arguably "above 0.1.58"
  while violating the AGENTS.md rule ("Increase the patch/bugfix version by
  default"). Consider "`package.json` version is `0.1.59` or higher with a
  `YYYYMMDDHHmm` suffix", which is unambiguous and matches the rule.

- **Expected result 11 does not say which server to run.** It follows result 10
  ("Against a production build"), so it is inferable, but QA holding only the
  list may reach for `npm run dev` — which binds `--hostname 127.0.0.1` and, per
  the spec's own Out of Scope section, is currently broken for other reasons.
  Adding "with `npx next start` running" makes it self-contained. Consider also
  asserting the `content-type` in the same curl, which would fold the
  automatable half of result 10 into an executable check.

- **Expected result 10 is not executable by an automated QA pass.** The spec is
  honest about why (no Blob credentials in CI, needs an authenticated session
  and a real PDF), and result 11 covers the part that matters most for the
  regression this task introduces. Worth flagging in the result itself as a
  manual step so QA does not silently treat it as unverifiable and skip it.

- **`§7` case 1 (file exists) has no actionable failure message requirement**,
  while case 2 does. If the reusable CI workflow ever installs with a
  `node_modules` cache that skips `postinstall`, case 1 is the one that fires
  first, and a bare "expected true to be false" would be a poor breadcrumb. Give
  case 1 the same "run `node scripts/copy-pdf-worker.mjs`" message.

- **`globalIgnores(["public/**"])` is broader than needed.** It is the right call
  today (nothing in `public/` is first-party JS), but if a first-party script is
  ever added there it will be silently unlinted. `public/pdf.worker.min.mjs`
  alone would be tighter; the tradeoff is that a future copied artifact needs a
  new entry. Either is defensible — worth one sentence of rationale in §5.

- **§7 case 7 duplicates a concern with `src/lib/__tests__/proxy.test.ts`.** The
  existing file already owns middleware behaviour. Putting a matcher assertion
  in a new `pdfWorkerAsset` file is reasonable (it is about the asset, not the
  middleware), but a cross-reference comment in one or both files would save the
  next reader a search.

- The "Alternatives considered and rejected" table is unusually good — the
  rejection of `new URL(..., import.meta.url)` on dual-bundler grounds, and of
  a direct `pdfjs-dist` dependency on nested-copy grounds, are both correct and
  non-obvious. No change requested; noting it so a future round does not
  relitigate them.

## [RH-19] Hospedar o worker do pdf.js localmente em vez de CDN externa — 2026-09-03

- **Expected result 11 is a human-only criterion inside an automated gate.**
  It requires DevTools Network inspection *and* Stage Mode actually rendering a
  PDF — which needs an authenticated session plus a real PDF in Vercel Blob, the
  exact setup the spec's own Out of Scope section says CI cannot provide. The
  spec resolves this ("the browser criterion stays a manual QA step"), but QA
  never sees the Out of Scope section — it holds only the 15 results. Consider
  opening the result with "Manual QA step:" so it is handed off rather than
  failed for being unrunnable. The mechanical half of it is already covered by
  results 1, 10 and 12.
- **Expected result 14 drifts from the repo's version-bump phrasing.** It says
  "version is above `0.1.58` with a `YYYYMMDDHHmm` suffix". Current
  `package.json` is `0.1.58-202609030307`. Under semver `0.1.58-<ts>` sorts
  *below* `0.1.58`, so the criterion does resolve — it demands `0.1.59-<ts>` —
  but a QA agent comparing against the existing string could read a
  timestamp-only bump as passing. Siblings are precise: RH-18 writes
  "`0.1.58-<YYYYMMDDHHmm>` — strictly higher than the previous highest
  `0.1.57-202609030245`"; RH-17 does the same. Match that form:
  "`0.1.59-<YYYYMMDDHHmm>`, strictly greater than the previous highest
  `0.1.58-202609030307`".
- **Expected result 7 implicitly constrains test granularity.** 205 baseline
  tests + "at least 210" requires ≥5 new test cases; §7 lists seven, but never
  says one `it()` per case. An implementer who groups the seven assertions into
  three `it()` blocks satisfies result 5 and fails result 7. Say "seven `it()`
  cases" in §7.
- **Expected results 2 and 5(2) name different paths for the same file.**
  Result 2 hardcodes `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` while
  the script (§1) deliberately resolves through `react-pdf` precisely so it does
  *not* trust the hoisted path. They are the same file at `36ee59b` (verified),
  so this is harmless today, but result 2 quietly asserts the flat layout the
  design refuses to assume.
- **Expected result 12 does not say what server it is issued against.** Standing
  alone, `curl -sI http://localhost:3000/pdf.worker.min.mjs` has no running
  server; the context comes from the preceding result's `npx next start`. Note
  that `npm run dev` binds `127.0.0.1` explicitly while `next start` defaults to
  all interfaces, so the port-3000 assumption only holds for the production
  path. Fold the server setup into the result text.
- **Expected result 9's "files added or changed by this task"** is not resolvable
  from the results list alone (QA has no base commit for that phrase). Other
  results pin `36ee59b`; this one could too, e.g. "zero errors/warnings in the
  files listed by `git diff --name-only 36ee59b`".
- Minor: §1's rationale for resolving through `react-pdf` is sound and worth
  keeping, but the spec could note that `pdfjs-dist` publishes no `exports` map
  today — a future one restricting `./build/*` would break the resolution. A
  one-line comment in the script pointing at that assumption would age well.


## [RH-19] Hospedar o worker do pdf.js localmente em vez de CDN externa — 2026-09-03

- **Version criterion is looser than this repo's own precedent.** Result 13
  reads "`package.json` version is above `0.1.58` with a `YYYYMMDDHHmm`
  suffix", but `HEAD`'s version is already `0.1.58-202609030307`. Under semver a
  prerelease sorts *below* its base, so `0.1.58-<later timestamp>` is arguably
  both "above 0.1.58-202609030307" and "not above 0.1.58" — two readings.
  Sibling specs pin it tightly (e.g. RH-15: "version is `0.1.58-<YYYYMMDDHHmm>`
  … strictly higher than the previous highest `0.1.57-202609030245`"). Wording
  it as "`0.1.59-<YYYYMMDDHHmm>`, strictly greater than `0.1.58-202609030307`"
  would remove the ambiguity. Not blocking: any conforming bump under AGENTS.md
  line 185-187 (patch bump + timestamp) satisfies it under either reading.
- **The header-comment rewrite in §3 has no expected result.** The stale comment
  in `src/lib/pdfWorker.ts:1-14` still describes the CDN as a deliberate
  dual-bundler decision. Result 6 case 3 forbids any `http://`/`https://` in
  that file, which forces the URL out but not the misleading prose. Consider an
  explicit result, e.g. "the file's header comment names
  `scripts/copy-pdf-worker.mjs` and does not describe a CDN". Related trap worth
  flagging to the implementer: that same case-3 assertion means the rewritten
  comment must not contain a docs link either.
- **The script's loud-failure behaviour is unverified.** §1 and §2.1 both lean
  hard on "on resolution failure, exit non-zero" (it is the stated reason for
  rejecting the `exit 0` mitigation), yet no expected result exercises it — an
  implementation that swallowed the error would still pass all sixteen. The
  SHA-256 guard limits the blast radius, so this is not blocking, but a result
  such as "with `node_modules/react-pdf` temporarily renamed, the script exits
  non-zero and its message names `react-pdf`/`pdfjs-dist`" would close the hole.
- **`docker build --target deps .` may be slow or unavailable at QA time.**
  There is no `.dockerignore`, so the build context includes `node_modules`,
  `.next`, `.git` and `coverage` — hundreds of MB shipped to the daemon for a
  stage that needs only `package.json`, the lockfile and `scripts/`. Adding a
  `.dockerignore` is out of scope here, but worth its own task. If QA runs
  without a Docker daemon, the line-placement half of result 4 is still
  mechanically checkable on its own.
- **`AGENTS.md:153` describes `scripts/` as "migrate.mjs (schema migration
  runner), dev-seed (local data seeding)"** — already stale (it omits
  `deduplicate-songs.mjs`) and this task adds a third entry. Not RH-19's to fix,
  but a one-line refresh would keep the file map honest.

## [RH-19] Hospedar o worker do pdf.js localmente em vez de CDN externa — 2026-09-03

- **`src/proxy.ts:53` — the exclusion is a prefix, not an exact path.** The
  negative lookahead alternative `pdf\\.worker\\.min\\.mjs` is not terminated by
  `$` (unlike the sibling image-extension alternative), so *any* pathname
  beginning with that literal is excluded from session gating. Verified
  empirically: `/pdf.worker.min.mjs.map` and `/pdf.worker.min.mjsevil` are also
  excluded. This is not exploitable today — no route or file with that prefix
  exists, so those paths 404 at the static handler and carry no data — but
  `pdf\\.worker\\.min\\.mjs$` would express the intent exactly and cost nothing.
- **`Dockerfile:11` — `COPY scripts ./scripts` widens the deps-layer cache key.**
  Any edit to `scripts/migrate.mjs` or `scripts/deduplicate-songs.mjs` (neither
  of which the `deps` stage uses) now invalidates the layer and forces a full
  `npm ci`. `COPY scripts/copy-pdf-worker.mjs ./scripts/` would keep the cache
  tight. Counter-argument for leaving it as is: it silently breaks the day a
  second script is wired into `postinstall`, and the spec chose the broad form
  deliberately. Take it or leave it.
- **`src/lib/__tests__/pdfWorkerAsset.test.ts:31` — `SELF` is a hardcoded path.**
  Deriving it from `fileURLToPath(import.meta.url)` (already imported in the same
  file for `createRequire`) would survive a rename. The current form matches the
  repo precedent at `src/lib/__tests__/noBrowserDialogs.test.ts:23` and its
  failure mode is loud (a renamed file reports itself as an offender), so this is
  cosmetic consistency at most.
- **`src/lib/__tests__/pdfWorkerAsset.test.ts:88` — redundant existence assertion.**
  The `expect(fs.existsSync(PUBLIC_WORKER))` inside the SHA-256 case duplicates
  the preceding `ships public/pdf.worker.min.mjs` case. It does buy a clearer
  message when both would fail; harmless either way.
- **Caching (informational, spec marks it out of scope).** Next serves `public/`
  assets with a revalidating, non-immutable `Cache-Control`, so the 1 MB worker
  is conditionally re-requested (304) rather than served from cache
  unconditionally. `?v=` is therefore correctness insurance against a stale
  worker after a `pdfjs-dist` bump — which is exactly what the code comment
  claims — and not a performance win. No action; "Cache-Control tuning for
  `public/`" is explicitly Out of Scope in the spec.

---


## [RH-19] Hospedar o worker do pdf.js localmente em vez de CDN externa — 2026-09-03

- (Non-blocking, out of RH-19's scope) The inline tab preview on
  `/songs/[id]/fast-view` (`page.tsx:997`) still embeds
  `https://docs.google.com/gview?url=…&embedded=true`. Entering Stage Mode is
  now fully first-party, as this task required, but the *preview* directly above
  the Stage button pulled ~16 third-party requests
  (`docs.google.com`, `gstatic.com`, `apis.google.com`, `content.googleapis.com`,
  `play.google.com`) during my session, and it leaks the tab's blob URL to
  Google. It has the same offline/venue-network and TWA-CSP consequences the
  RH-19 rationale describes for the worker, and it is the obvious next domino
  for RH-29. Worth its own task — reusing `TabDrawingStage` (or a read-only
  react-pdf `<Document>`) for the inline preview would remove the last
  third-party dependency from the tab path.
- `scripts/copy-pdf-worker.mjs` is not covered by `npx eslint .` in the sense
  that it is linted, but `scripts/` has no test of its own error path (the
  `resolveWorker()` catch that exits 1). Not worth a test on its own; noting
  only because the guard test covers the *output* of the script but never the
  script's own failure branch.
- `docker build --target deps .` remains unexercised anywhere I can see. If CI
  does not already build the image, the `COPY scripts ./scripts` line has no
  mechanical guard and a future Dockerfile edit could drop it silently — the
  same class of drift `pdfWorkerAsset.test.ts` was written to prevent for the
  worker copy.


## [RH-20] Corrigir traco apagado nao persistido quando gesto e interrompido por segundo dedo — 2026-09-03

- Results 8, 9 and 11 require a real touchscreen (result 8 states, correctly, that
  Chrome device-mode cannot add a second contact mid-gesture). Add one clause telling QA
  what to do without hardware — e.g. mark them hardware-dependent and treat results 6, 7
  (desktop mouse) plus results 3 and 4 (source guards) as the executable gate, since
  after `erasedDuringGestureRef` is deleted there is no per-path state left for paths
  1–3 to lose. Worth folding into the same revision round as the blocking finding.
- In §4b, spell out that the invariant's detector must match an **assignment**
  (`annotationsRef.current[…] =`) and not a bare read, otherwise `flushSave` (`:278`)
  and the new `eraseAt`'s own first line will be flagged as offenders.
- Add a non-vacuity assertion to the §4b invariant: assert the enumeration actually
  found the four expected function names (`commitStroke`, `eraseAt`, `handleUndo`,
  `handleClearConfirm`). As written, converting these to arrow consts would make the
  general invariant pass while guarding nothing.
- §4b names `sliceFunction(source, name)` but the invariant needs a helper that walks
  *every* component-inner function. Name that helper too, so the implementer does not
  invent an enumeration rule.
- §2 changes only `eraseAt` to read from `annotationsRef.current`, leaving `commitStroke`
  and `handleUndo` on the `strokes` closure. That asymmetry is correct — those run on
  discrete (`pointerup`, `click`) events, which React flushes between occurrences,
  whereas only `eraseAt` repeats inside continuous `pointermove` — but stating it would
  stop a future reader from "fixing" the other two or from reading the omission as an
  oversight.
- Result 6's "within ~2 s" could fail spuriously on a slow connection (800 ms debounce
  plus a server action round trip). "Within a few seconds" would remove the arbitrary
  threshold without weakening the observation that matters (the pill moves *while the
  button is still held*).

## [RH-20] Corrigir traco apagado nao persistido quando gesto e interrompido por segundo dedo — 2026-09-03

1. **Add the `handleLostPointerCapture` JSDoc to the deletion list.** Approach §3
   enumerates the ref declaration (`:101`) and seven code sites, but not the
   doc-comment at `:470-486`, whose last paragraph explains the guard partly in
   terms of `erasedDuringGestureRef` ("the pending erase is never saved and
   reappears on reload"). Expected result 3's `grep` is not comment-stripped, so
   leaving that prose in place fails the result. The paragraph also becomes
   factually wrong after the fix, while the rest of the guard (protecting
   `activeStrokeRef` / `lastPanPosRef` on a pinch-finger lift) stays valid — so it
   needs rewriting, not just deleting.
2. **Spell out that the rule-(c) detector matches an *assignment*.** A detector
   that matched any occurrence of `annotationsRef.current[` would flag
   `scheduleSave` (`:264`) and `flushSave` (`:278`), which legitimately read it —
   and `scheduleSave` can never satisfy "calls `scheduleSave()` in the same body".
   The guard would then fail on a fully conforming implementation. The spec's word
   "assigns" is correct; naming the shape (e.g. `annotationsRef.current[…] =`, with
   the readers listed as the negative cases the synthetic-string unit tests should
   cover) removes the trap.
3. **Record the two-space-indent assumption in the guard's failure message.**
   `sliceFunction` is sound on this file today (verified for all 25 functions),
   but it silently depends on component-inner functions being declared at exactly
   two spaces. A failure message that says so turns a future confusing red test
   into a self-explaining one.
4. **Optional: widen result 16's pathspec to `migrations/`.** The result's prose
   claims "no migration", but the pathspec (`src/ package.json`) cannot observe
   one. Adding `migrations/` to the same command would make the prose and the
   command agree without reopening the round-1 over-breadth problem, since
   `migrations/` is unrelated to docs and workflow bookkeeping.
5. **Note the local-Postgres prerequisite on result 5.** `npx vitest run` covers
   real-DB suites and needs Postgres on `127.0.0.1:54322` (the `vitest.config.ts`
   fallback). It is up here and this is established project convention, so this is
   documentation only, not a defect.

## [RH-20] Corrigir traco apagado nao persistido quando gesto e interrompido por segundo dedo — 2026-09-03

1. **(Pre-existing, worth a follow-up task — not introduced here.)**
   `performSave`'s `.then` unconditionally clears `pendingSaveRef`
   (`TabDrawingStage.tsx:242`), even when a *newer* `scheduleSave()` ran while
   that save was in flight. If a page change or drawing toggle-off then calls
   `flushSave()` (`:273-280`) in that window, `flushSave` clears the armed timer
   and skips `performSave` because `pendingSaveRef` is already `false` — the
   newer write is dropped. This race exists at `4d5b7bd` for `commitStroke` too,
   so it is not an RH-20 regression, but RH-20 makes saves start mid-gesture and
   therefore slightly widens the window for erases. A generation counter (or
   only clearing `pendingSaveRef` when no timer has been re-armed since the save
   started) would close it. Recommend filing as its own Meridian task rather
   than expanding this PR.
2. `eraseAt` uses `if (!removedId) return` (`:313`) while the helper's documented
   contract is `removedId !== null`. Equivalent for UUID ids, but
   `if (removedId === null) return` would match the contract exactly and be
   immune to a future empty-string id.
3. `componentFunctionNames` only recognises `function` declarations at two-space
   indent. A future `const eraseAt = (x, y) => { ... }`, or a write performed
   inside a `useEffect`/`useCallback` callback, would be invisible to the
   invariant. The anti-vacuity test turns the first case into a loud failure, so
   this is safe today; extending the matcher to
   `^ {2}const <name> = ... =>` later would keep it that way for free.
4. `applyEraseAt`'s JSDoc in `annotationMath.ts` narrates component-level gesture
   paths (pinch, lost pointer capture, drawing toggle). It is useful context, but
   it couples a domain-pure lib module's docs to one caller's implementation; a
   one-line "callers must persist in the same call (RH-20)" with the detail left
   in `TabDrawingStage.tsx` would age better.


## [RH-20] Corrigir traco apagado nao persistido quando gesto e interrompido por segundo dedo — 2026-09-03

- **(Pre-existing, out of RH-20's scope — worth its own task.)** Ending a pinch
  leaves a stray one-point dot in Pen mode. In `endPointer`, when the pointer
  count drops from 2 to 1 the remaining finger restarts a stroke
  (`activeStrokeRef.current = [remainingPos]`); lifting that finger a moment
  later commits a 1-point stroke. I measured 12 px of ink (~2 px dot) after a
  two-finger pinch that began mid-stroke, even when both fingers were lifted in a
  single touch event. On a real device the two fingers never leave the glass at
  the same instant, so this dot is reachable in ordinary use, and it is saved and
  survives reload. The code is byte-identical to `4d5b7bd`, so RH-20 neither
  caused nor was required to fix it — but it is the closest thing I found to the
  criterion-11 wording "the partial stroke leaves no mark". A cheap fix would be
  to require ≥2 points (or a minimum path length) before `commitStroke` persists
  anything.
- `applyEraseAt` uses `if (!removedId) return { strokes, removedId: null }`.
  Stroke ids are `crypto.randomUUID()` so an empty-string id is not reachable
  today, but `removedId === null` would express the intent exactly and cost
  nothing. Same for the `if (!hitId)` shape it replaced.
- `erasePersistence.test.ts`'s `sliceFunction` terminates on a line that is
  exactly `  }`. That is true of every component-inner function in the file today
  and the helper is unit-tested for the nested-brace case, but it is coupled to
  Prettier's current 2-space output: a reformat (or a function written as
  `const foo = () => {}`) would silently make `componentFunctionNames` return
  fewer names and quietly weaken the invariant rather than fail loudly. A cheap
  hardening would be to assert a minimum expected function count, or to assert
  that the four known writers are all found *before* checking the offender list
  (the file does the latter, but as a separate `it` — a single combined assertion
  would make a silent slice failure impossible).
- The `annotations` write path is `jsonb_set(annotations, '{<page>}', …)` with a
  last-write-wins debounce and no version/etag. Two devices in Stage Mode on the
  same tab will clobber each other's page arrays. Out of scope here, and probably
  acceptable for a personal repertoire app, but the RH-20 change makes erases
  land sooner and therefore makes the window slightly more reachable.


## [RH-31] Atualizar landing page com anotacoes no Stage Mode e catalogo compartilhado — 2026-09-03

- **EN `f5Desc` — the band-sharing promise got weaker.** Today's card says "Keep personal study
  PDFs or share official charts with your entire band"; the replacement says "…to any song, yours
  or shared with your band", which attaches the sharing to the *song*, not to the chart. The
  "share the same official chart with the whole band" hook is what a band leader buys. Consider
  "…to any song in your repertoire or your band's, so everyone plays from the same chart, and
  write straight on them…".
- **PT `f5Desc` — agreement ambiguity.** "Anexe cifras e tablaturas em PDF a qualquer música,
  suas ou compartilhadas com a banda" places the feminine-plural "suas ou compartilhadas" after
  the singular "qualquer música", so a reader first attaches it to "música" and has to
  backtrack. "Anexe cifras e tablaturas em PDF a qualquer música — do seu repertório ou do da sua
  banda — e escreva por cima delas…" removes the backtrack.
- **"so you add them in one tap" / "e você adiciona em um toque" is the one over-promise in the
  copy.** There is no one-tap add path for a catalogued song: `SongForm.tsx` still requires
  typing and submitting the form, and the dedup happens server-side in `createAndAddSong`. The
  honest and equally strong version is "…arrive pre-filled — title, artist, album, key, cover art
  and links — so you don't retype what someone else already catalogued."
- **The test sketch omits the vitest imports.** `vitest.config.ts` sets `globals: false`, so
  `landingCopy.test.ts` needs `import { describe, it, expect } from 'vitest'`. Self-correcting
  (the file simply fails to run otherwise), but worth one line in §2 since the spec advertises
  "no wording decisions left to the developer".
- **Case 1 of the new test is worth more than this task.** A dictionary key-parity guard is a
  repo-wide asset; consider noting in the spec that it intentionally covers the whole dictionary,
  not just `landing.*` (§2 already says so — just make sure the reviewer of the diff doesn't
  "narrow" it to `landing.*` as a cleanup).
- **Expected result #3's tail** ("both still list title, artist, album, key/tom, cover/capa and
  links") is checkable but phrased prosaically next to ten regex-precise siblings; spelling it as
  the six substrings per locale would make it uniform.


## [RH-31] Atualizar landing page com anotacoes no Stage Mode e catalogo compartilhado — 2026-09-03

- **Result #10 — state the signed-out precondition.** `src/app/page.tsx:621–622` renders
  `<LandingPage />` only when `!session?.user`; otherwise `/` renders `RepertoireDashboard`.
  A QA run with a live session cookie would find a different (or no) `div.grid` and could
  report a false failure. Adding "as a signed-out visitor" to result #10 removes the whole
  failure mode. Low risk in practice (fresh browser contexts are unauthenticated, and
  fallback (b) is auth-independent), and the copy assertions are redundantly covered by
  self-contained results #1–#3 — hence a suggestion, not a blocker.
- **Result #9 — "empty output" is fragile in this environment.** Raw
  `npx eslint src/lib/__tests__/landingCopy.test.ts` on a clean file prints nothing, but the
  rtk command hook rewrites it and prints `ESLint: No issues found` (verified: raw via
  `rtk proxy` → empty; hooked → one summary line). Phrasing it as "reports 0 errors and 0
  warnings for that file" would be immune to the wrapper.
- **Result #6 — "the six named cases" is a soft dangling reference.** QA never sees the names
  (they live in the spec's *Approach §2*). It is still decidable — six `it(...)` cases, suite
  green — but "six `it(...)` cases" would be strictly self-contained.
- **PT `f5Desc` — number agreement.** "a qualquer música, suas ou compartilhadas com a banda"
  mixes singular *música* with plural *suas/compartilhadas*. "a qualquer música, sua ou
  compartilhada com a banda" reads correctly. The regression test asserts substrings only
  (`anotaç`, `desenho`, `tablet`, `caneta`, `dedo`, `stage mode`), none of which are affected,
  so this can be fixed in the pinned string without touching the tests or the results.
- **Fallback (b) grep robustness.** `grep -rl "Anotações à Mão nas Tabs em PDF"` depends on the
  production minifier not escaping non-ASCII. Current chunks keep UTF-8 literal (verified), so
  it should hold; grepping an ASCII-safe substring such as `"nas Tabs em PDF"` would be
  immune to a future `asciiOnly` minifier setting.
- **Optional:** `tsconfig.json` excludes `**/__tests__/**`, so `npx tsc --noEmit` (result #9)
  will not type-check the new test file. That is pre-existing repo behaviour and not a defect
  in this spec — noted only so nobody reads result #9 as type-coverage of `landingCopy.test.ts`.

## [RH-31] Atualizar landing page com anotacoes no Stage Mode e catalogo compartilhado — 2026-09-03

- `landingCopy.test.ts:21-22` — `landingStrings` only reads the top-level values of
  `dict.landing`. `landing` is flat today (24 string leaves), so the moderation guard is
  complete; but if a nested group is ever added under `landing.*`, the forbidden-word check
  would silently skip it. Reusing a recursive collector (or reusing `flattenKeys` to walk
  values) would keep the guard total. Non-blocking.
- `en.json` `f1Desc` — the sentence mixes American "Catalog songs" with British "already
  catalogued". Both spellings are correct English, but picking one ("already cataloged", or
  rephrasing to "already added by other musicians") would read slightly tighter. The wording is
  spec-mandated, so this is a copy-owner call, not a defect.
- `pt-BR.json` `f5Desc` — the second sentence chains three clauses ("são salvas … , o modo de
  desenho liga e desliga … , e funciona muito bem no tablet"). It is grammatical, but on a
  narrow card it renders as a long block; splitting after "página por página." would read
  slightly crisper on mobile. Purely cosmetic.

## [RH-31] Atualizar landing page com anotacoes no Stage Mode e catalogo compartilhado — 2026-09-03

- **RH-32 is real, reproducible, and now confirmed to affect production builds,
  not only the dev server.** `npx next build && npx next start` yields HTTP 500 on
  `GET /` with `TypeError: Cannot read properties of null (reading 'useRef')`
  (digest `1375200389`). If RH-32 is currently scoped as a dev-server-only
  annoyance, that scoping is too narrow — the app does not serve its landing page
  in production either. Worth attaching this observation to RH-32. Non-blocking
  for RH-31 by the criterion's own terms.

- **The landing copy is currently guarded only by string assertions, never by a
  render.** `landingCopy.test.ts` is a good, fast, zero-DOM guard and does exactly
  what it claims, but nothing in the suite asserts that `LandingPage` actually
  renders `f5Title`/`f1Desc` for a given locale. A single render test (or a
  Playwright e2e on `/`) would catch a future refactor that drops a card or
  mis-wires the dictionary — but it cannot be written until RH-32 unblocks
  rendering, so this is a follow-up, not an omission here.

- **`docs/suggestions-log.md` is modified but left unstaged** (` M` in
  `git status`), and `docs/tasks/RH-31-spec.md` is untracked. Neither is covered
  by any criterion and neither affects this verdict, but whoever commits should
  decide deliberately whether they belong in the RH-31 commit rather than letting
  them drift into a later unrelated one.

- **Minor, cosmetic:** in `landingCopy.test.ts` the EN/PT f5 cases build regexes
  with `new RegExp(term, 'i')` from plain substrings. It works and is readable,
  but since the terms are literals, `String.prototype.includes` on a lowercased
  value would express the intent more directly and avoid any future foot-gun if
  someone adds a term containing a regex metacharacter (e.g. a `.` or `+`).


## [RH-21] Padronizar tratamento de erros no projeto — 2026-09-03

- **Expected result 6 can be satisfied by deleting the logging rather than
  migrating it.** It only asserts that `console.error(` disappears from
  `fast-view/page.tsx`, `api/spotify/search/route.ts` and `lib/auth.ts`. An
  implementation that simply removes those four lines passes every current
  result. Consider adding a companion assertion, e.g. that
  `grep -c "logger.error(" src/app/songs/\[id\]/fast-view/page.tsx` prints `2`
  and that `logger.error` appears in `src/app/api/spotify/search/route.ts` and
  `src/lib/auth.ts`.
- **No result pins the four user-facing fallback strings** that §1 enumerates
  (`'An unexpected error occurred during upload'`, `'Failed to delete tablatura'`,
  `'Failed to upload band cover image'`, `'Failed to upload tab'`). They are the
  text a user actually sees, and expected result 10 protects only the fifth such
  string. A single grep result covering all four would close the gap cheaply.
- **Expected result 11 does not protect the `ROLLBACK`.** §2 site 15 says only
  that `mergeGlobalSongs` gains a `logger.error` and a wrapped message, and the
  scope section forbids any behaviour change beyond message text — but the
  result itself never asserts that `await query('ROLLBACK')` still runs before
  the throw, and the spec never states whether the `logger.error` goes before or
  after it. Both orderings are defensible from the text. Pinning "the catch still
  awaits `query('ROLLBACK')` before throwing" in the result would remove the
  ambiguity and the regression window at once.
- **§1's table names the wrong enclosing function for sites 5-10.** The column
  says `addSongsToRepertoire`; the actual function in both
  `sync/route.ts:121` and `import/route.ts:126` is `ensureInRepertoire`. The line
  numbers are correct, so this is cosmetic, but it will read as a mismatch to the
  implementer.
- **§4's heading says "`console.error` in a catch body" but site 20
  (`fast-view/page.tsx:298`) is inside a `.catch((e) => { … })` handler**, not a
  `catch` block. The site is enumerated explicitly with its replacement, so it is
  unambiguous in practice, and it is genuinely distinct from the
  `.catch(console.error)` argument-position handlers the Out of Scope section
  excludes — but a one-clause note would prevent an implementer from reading it
  as out of scope.
- **Expected result 1 does not exempt the new guard test file**, unlike the
  guard test's own tree check (which excludes `SELF`). §6 already requires the
  offending literal to be built by concatenation, but that instruction should be
  read as covering `it(...)` descriptions and docblock prose as well, since
  `grep` — unlike the detector — does not strip comments. Worth making explicit.
- **Expected result 12 is prose-inspection rather than grep.** "whose body names
  all of: …" is checkable by a reader but not by a command. Listing the exact
  literals to grep for in `AGENTS.md` (e.g. `catch (x: any)`,
  `errorHandlingStyle.test.ts`) would make it mechanical like the rest of the set.

## [RH-21] Padronizar tratamento de erros no projeto — 2026-09-03

- **Result 11 does not guard the `ROLLBACK` in `mergeGlobalSongs`.** The current
  catch is `await query('ROLLBACK'); throw error`. §2 site 15 and the §Scope
  clause ("Any change to behaviour other than the error message text") clearly
  require the `ROLLBACK` to survive, but result 11 asserts only that the wrapped
  message exists and that `logger.error` is called before throwing. Since QA
  sees only the results, an implementation that dropped the `ROLLBACK` would
  pass this gate while silently leaving an open transaction on the failure path.
  Appending "and the `await query('ROLLBACK')` call is retained" to result 11
  would close that gap at no cost. Not blocking — the spec itself is
  unambiguous and code review reads the diff against it.

- **No result asserts the new `bands.ts` wrapped message text.** Sites 12 and 13
  get exact-string coverage through result 9 (`errors.test.ts`), and site 15
  through result 11, but site 14's
  `Failed to regenerate band invite code: ${err.message}` is only covered
  indirectly, by result 5 observing that the bare `throw e` is gone. A
  `grep -c "Failed to regenerate band invite code" src/lib/bands.ts` expecting
  `2` (the restructure introduces two catch blocks, each logging and throwing
  that prefix) would make it symmetric with the other three §2 sites.

- **§A1's parenthetical is very slightly overstated.** Line 99-100 says the
  `err instanceof Error ? err.message : undefined` form fires the fallback
  "exactly as `err.message || fallback` did". That holds for `Error` throws and
  for primitives, but not for a thrown non-`Error` object carrying a `.message`
  property: the old code surfaced that message, the new code falls back. The new
  behaviour is the safer one (the old form would also have thrown a `TypeError`
  inside the catch on a `null`/`undefined` throw), and in practice these three
  call sites only ever see `Error`s from `query` / `put` / `del` /
  `getRequiredUserId`. Worth a half-sentence correction so the claim that the
  `'Band not found'` message is "the only observable behaviour delta" stays
  strictly true; no expected result depends on it.

- **Result 8's `grep -cE … prints 0` exits with status 1.** `grep -c` returns 1
  when the count is zero. The result says "prints `0`", which is the right
  framing, but it is worth being aware of when scripting the check — unlike
  result 1, which spells out "(exit status 1)" explicitly. Making result 8
  equally explicit would remove any chance of a QA harness reading the non-zero
  exit as a failure.

- **The nextjs-agent-rules block is re-added by `next dev`.** AGENTS.md itself
  notes (line 206) that the block is regenerated and that "removing it from a
  diff only re-creates the uncommitted change". §8 already says not to touch it;
  since `AGENTS.md` is whitelisted in result 15 either way, there is no risk to
  the gate, but the implementer should expect `next dev` to have possibly
  touched that region already and should not try to revert it.

## [RH-21] Padronizar tratamento de erros no projeto — 2026-09-03

1. **`src/lib/__tests__/errorHandlingStyle.test.ts:95-109` — the tree test re-implements the detector instead of calling it.** `findAnyTypedCatches` is exported and unit-tested, but the tree walk duplicates `stripComments(...).split('\n').forEach(...)` inline (because it needs line numbers). A drift between the two is possible: someone hardening the exported detector would not automatically harden the gate. Making the detector return `{ line, text }[]` and having both the unit tests and the tree test consume it would make the tested code and the enforcing code the same code. Non-blocking — today the two are byte-identical in behaviour.

2. **Detector misses two shapes (`ANY_TYPED_CATCH`, `errorHandlingStyle.test.ts:26`).** Probed with the exact regex:
   - multi-line clause `} catch (\n  err: any\n) {` → not flagged, because matching is per-line;
   - union annotation `} catch (err: any | undefined) {` → not flagged, because the regex requires `any` to be immediately followed by `\s*\)`.
   Both are caught by `@typescript-eslint/no-explicit-any` anyway, and neither is a shape prettier would produce, so this is defence-in-depth rather than a hole. Matching over the whole comment-stripped source (and deriving the line number from the match index) would close the first; `[^)]*\bany\b` would close the second at the cost of some precision.

3. **`src/app/api/spotify/search/route.ts:132` drops non-`Error` payloads.** Before: `console.error('[spotify/search]', error instanceof Error ? error.message : error)` — a thrown string/object was printed. After: `logger.error('[spotify/search]', error instanceof Error ? error : undefined)` — for a non-`Error` throw, `logger.error` takes the `captureMessage` branch with `extra: { error: undefined }`, so the payload is gone. This is exactly the R1 form the spec prescribes and matches the sibling `playlists` / `tracks` routes, so it is a deliberate consistency trade, not a defect. If the information matters, `error instanceof Error ? error : new Error(String(error))` (the form used two files over in `disconnect/route.ts:21`) would keep it.

4. **R1 is documented with one narrowing form and the sweep ships two.** `AGENTS.md` R1 shows `error instanceof Error ? error : undefined`; `src/app/api/auth/spotify/disconnect/route.ts:21` uses `error instanceof Error ? error : new Error(String(error))`. Both were mandated by the spec (§3 site 18 vs §4 site 21) and both are behaviour-preserving-or-better, but a future reader of AGENTS.md will find a route handler that does not match the documented snippet. Worth one clause in R1 saying either is acceptable, or normalising the two routes in a follow-up.

5. **`src/lib/__tests__/bands.test.ts:145-174` still asserts bare `.rejects.toThrow()`.** The whole point of the `regenerateBandInviteCode` restructure is that `'Only band admins can regenerate the invite link'` survives verbatim to `src/app/bands/[id]/page.tsx:127`. Nothing in the suite pins that string; only a `grep -c` in the spec does. Passing the literal to `.rejects.toThrow(...)` in the two rejection tests would make the guarantee a test rather than a convention. (Not blocking: this is pre-existing test text the spec explicitly chose to leave alone, and no new logic is left untested — the restructured function is exercised by 3 of the 14 passing tests in that file.)

6. **`src/lib/bands.ts:244` uses an un-annotated `let memberRes`.** It relies on TypeScript's evolving-`any` inference. `tsc --noEmit` is clean and eslint does not flag it (it is not an *explicit* `any`), and it is the shape the spec dictated, but `let memberRes: Awaited<ReturnType<typeof query>>` would state the intent instead of inferring it.

---


## [RH-21] Padronizar tratamento de erros no projeto — 2026-09-03

- `docs/tasks/RH-21-spec.md` is **untracked** (`??` in `git status`), not staged. It is inside the
  criterion-15 whitelist, so this is not a failure, but if the spec is meant to land with the task
  it will be omitted from the commit the `work` skill creates from the staged set. Worth a
  deliberate `git add` decision either way.
- The 20th ESLint warning that consumes all the headroom under the "≤20 warnings" bar is
  `coverage/block-navigation.js 1:1 Unused eslint-disable directive` — a lint finding inside a
  generated coverage artifact, unrelated to this task. Adding `coverage/` to the ESLint ignore list
  would remove a spurious warning and restore margin for future tasks measured against the same bar.
- `errorHandlingStyle.test.ts` skips itself in the tree scan (`if (file === SELF) continue`). The
  self-exemption is currently harmless because every sample in that file is built by concatenation
  and so contains no literal violation, but the exemption means a real violation added to that one
  file would be invisible to its own guard. Since the concatenation trick already keeps the file
  clean, the `SELF` skip could be dropped, which would close the gap at no cost.
- The guard only covers `catch (x: any)`. The neighbouring conventions the new AGENTS.md section
  establishes — no `console.error` in catch bodies, no `error as Error`, no bare `throw err` outside
  the documented L1a exception — are currently enforced only by the greps in this task's acceptance
  criteria, which disappear once the task closes. Extending the same file with three more scans
  would make the whole section self-enforcing rather than just its first bullet.

## [RH-22] Remover codigo morto do projeto — 2026-09-03

- **N1 — the spec's own "Expected Results" section (11 bullets) is a paraphrase of the 18 persisted
  `expected_results`, not the same list.** The persisted list is the stronger of the two and is what
  QA sees, so nothing is at risk downstream. But the spec's own bullet *"diff vs `bd24bbc` stays
  inside the whitelist"* never enumerates that whitelist anywhere in the spec body — it exists only
  in persisted ER18. A developer working from the spec document alone cannot check it. Worth pasting
  the 18 into the spec (or at least the whitelist) so the two documents agree.
- **N2 — two dangling references to deleted paths survive the sweep and are deliberately outside the
  ER18 whitelist**: `vitest.config.ts:62` (`coverage.exclude` lists `'src/lib/mongodb.ts'`) and
  `sonar-project.properties:8` (`sonar.coverage.exclusions` includes `src/lib/mongodb.ts`). Both are
  harmless — they are path/glob exclusion lists that simply stop matching — but an implementer who
  spots them while sweeping may "helpfully" clean them and fail ER18's whitelist. One sentence in
  §7 or in the Out-of-Scope table ("leave these; they are inert and outside the diff whitelist")
  removes the trap. `docs/plans/mobile-app-analysis.md:68` and `docs/test-coverage-plan.md:22` go
  stale for the same reason and are likewise fine to leave.
- **N3 — evidence nit, `mongodb` is not actually flagged by knip at baseline.** I re-ran
  `knip@6.34.0`: unused dependencies are `@supabase/ssr`, `kysely`, `webpack` only — `mongodb` is
  held live by `src/lib/mongodb.ts` and `seed.js`, and becomes unused only *after* §1. The §4 table's
  "knip + depcheck" attribution for `mongodb` overstates it slightly. The conclusion is unaffected
  (I proved the removal safe independently), it is just imprecise evidence.
- **N4 — line-number nit**: `getBandWeakestStatusAction` starts at `src/app/actions/repertoire.ts:120`,
  not 115 as §2 states (115 is inside the preceding doc comment). `STATUS_ORDER` hits are at lines
  6, 144, 145 as stated.
- **N5 — the `dead-code` job could reuse the `e2e` job's `needs: []` comment convention** and, if the
  reusable `node-ci.yml` already installs and caches node modules, a future consolidation into that
  workflow would save a redundant `npm ci` per run. Not worth doing now — the inline job is the only
  shape available from this file today.
- **N6 — consider a follow-up for the `export` keywords hidden by `ignoreExportsUsedInFile: true`.**
  The seven (`openEditDialog`, `INSTRUMENT_LIST`, `parseTags`, `isSupportedLocale`,
  `checkSystemAdmin`, `BandContext`, `EditStatus`) are live code, so the flag is the right call for
  this task, but dropping the redundant keyword would let the flag be turned off later and make the
  guard strictly stronger. Likewise `knip --production` is a stricter future gate.

## [RH-22] Remover codigo morto do projeto — 2026-09-03

- `vitest.config.ts:62` and `sonar-project.properties:8` still list `src/lib/mongodb.ts` in their
  coverage-exclusion globs, and `docs/test-coverage-plan.md:22` / `docs/plans/mobile-app-analysis.md:68`
  still describe deleted files. All four are inert (a glob that matches nothing costs nothing) and all
  four are deliberately outside this task's ER18 diff whitelist — already logged as N2 in
  `docs/suggestions-log.md`. Correctly left alone here; worth a one-line follow-up so the config stops
  naming a file that does not exist.
- The lockfile carries 4 incidental transitive patch bumps (`@emnapi/core`, `@emnapi/runtime`
  1.11.1→1.11.2, `get-tsconfig` 4.14.0→4.14.3, `picomatch` 4.0.5→4.0.7) that no direct dependency
  asked for. This is normal `npm uninstall` re-resolution and all four stay inside their existing
  semver ranges, so it is not worth reverting — but it is worth knowing the diff is not *purely* the
  three removals plus knip, in case a bisect ever lands here.
- AGENTS.md line 54 now reads "Legacy/unused code to be aware of: the live data model is
  `src/types/database.ts`." The lead-in no longer introduces legacy code, so the first clause is a
  non-sequitur. Something like "The live data model is `src/types/database.ts`. Legacy/unused code to
  be aware of: `NEXT_PUBLIC_SUPABASE_*` env vars and stray 'Supabase' comments are historical…" would
  read straight. Pure prose, no factual error.
- `ignoreDependencies` covering `@sentry/browser` and `@better-auth/utils` suppresses knip's
  "Unlisted dependencies" signal for those two names permanently, including for any *future*
  undeclared import of them. The right fix is declaring them (already logged as a follow-up); when
  that lands, the two entries should come back out of `knip.json` rather than being left behind.
- Once the seven redundant `export` keywords noted in the log are dropped, `ignoreExportsUsedInFile`
  could be turned off and `knip --production` added, making the gate strictly stricter. Follow-up
  only; the current config is the right call for this task.

## [RH-22] Remover codigo morto do projeto — 2026-09-03

- **Duplicate `## [RH-22]` section in `docs/suggestions-log.md`.** The identical
  heading `## [RH-22] Remover codigo morto do projeto — 2026-09-03` appears twice
  (lines 1290 and 1324), and the two bodies partly restate each other — the second
  section's first bullet re-reports the `vitest.config.ts` / `sonar-project.properties`
  dangling references that the first section already logged as N2, and says so
  explicitly ("already logged as N2"). Merging the two into one section would make
  the log easier to triage later. Non-blocking: ER17 only requires the heading to
  exist, and the content is accurate.

- **Two inert dangling references to `src/lib/mongodb.ts` remain**, correctly left
  outside this task's whitelist: `vitest.config.ts:62` (`coverage.exclude`) and
  `sonar-project.properties:8` (`sonar.coverage.exclusions`) both still name a file
  that no longer exists. Harmless (a glob matching nothing costs nothing) and
  already self-reported in the suggestions log, but worth a one-line follow-up task
  so no config keeps naming a deleted path.

- **Consider `knip --production` as a future gate.** The current `lint:dead` script
  is plain `knip`, which is already clean. Running the stricter production-mode
  entry-point analysis in a follow-up would catch dead code reachable only from
  test files. Deliberately out of scope here — the current configuration meets ER7
  and ER8 exactly as specified.

- **`knip.json` `ignoreDependencies` is doing real work and is worth a comment.**
  `kysely` and `webpack` are ignored for the documented reasons captured in ER5
  (string reference in `serverExternalPackages`; keeping `npm ci` green per 7360bfd),
  but `@sentry/browser` and `@better-auth/utils` carry no such rationale anywhere in
  the repo. JSON has no comments, so a short note in `AGENTS.md` next to the existing
  knip bullet would prevent a future cleanup from removing them by mistake.


## [RH-23] Extrair/remover duplicacao de codigo no projeto — 2026-09-03

- **S1 — The spec's Expected Results section is not the list that ships, and its own cross-references
  are broken.** The spec indexes ER1–ER18; the task carries ER1–ER20 (the spec merges task ER7+ER8 into
  one line and has no counterpart to task ER17, "new unit tests exist and pass"), so every spec ER
  number from 7 onward points at a different criterion than the same number in the task — a trap for
  the developer and for the code reviewer. Worse, spec ER7 says the jscpd totals "fall to **the stated
  ceilings**" and the ceilings (≤ 20 clones, ≤ 300 duplicated lines, ≤ 1.80 %, ≤ 2.20 % tokens) are
  stated nowhere in the spec; the Duplication-gate section's "(see ER8)" points at the `lint:dup`
  criterion under both numbering schemes rather than at the percentage. Either renumber the index to
  match the shipped results verbatim, or state the four ceilings inline in §Duplication gate.
- **S2 — A3's 26-value return bag is the one extraction that reads as coupling rather than reuse.**
  The logic really is duplicated ~200 lines deep, so the extraction is justified, but a hook that
  returns `band, setBand, playlists, loading, error, setError, editing, editName, setEditName, …` plus
  nine handlers is a page controller, not an abstraction. Consider grouping the edit-modal state
  (`editName/editDesc/editCoverPreview/editColor/saving/openEdit/handleEditCoverChange/handleSaveEdit`)
  into a nested object so the destructure at each call site stays readable.
- **S3 — The same 26-value bag is a live risk to ER8, which has zero margin.** ER8 allows "at most 4
  clones naming both `bands/[id]/page.tsx` and `profile/page.tsx`" and exactly 4 (the deliberate JSX
  clones #17–20) are meant to survive. Both pages will now open with a near-identical multi-line
  destructure of the same ~26 names in the same order — comfortably over jscpd's 8-line / 50-token
  floor, i.e. a brand-new bands↔profile clone that would make it 5 and fail ER8 (and take the total to
  20, the ER7 ceiling exactly). Worth pre-empting in the spec: have each page destructure only the
  names its JSX actually uses, or group as in S2.
- **S4 — `currentUserId` is missing from A3's returned bag.** Both pages need it in *JSX*
  (`bands/[id]/page.tsx:445,468`; `profile/page.tsx:423,445`), not just in handlers, and the hook needs
  it too (`handleCreatePlaylist`, `currentMember`, `isAdmin`). The spec should say whether the hook
  calls `authClient.useSession()` itself and returns `currentUserId`, or receives it as an option —
  otherwise both pages end up with a second `useSession()` subscription by accident.
- **S5 — A1's fast-view sentence is factually wrong.** "the two calls that pass nothing keep the
  `'info'` default" — all 16 `showToast` calls in `songs/[id]/fast-view/page.tsx` pass an explicit tone
  (lines 603 and 624 pass `'info'` literally). The rule "each existing call keeps its literal" already
  covers the file; drop the clause.
- **S6 — A2's `buildPlaylistSongsInsert` does silently unify one string.** `import/route.ts:272–275`
  uses a multi-line indented `INSERT …` template while `sync/route.ts:263–265` uses a single-line one.
  They are whitespace-equivalent to Postgres, so this is harmless, but the spec's blanket "the moved
  code keeps its … SQL text" claim should acknowledge it, as it acknowledges the `statusText` delta.
- **S7 — ER12's parenthetical baseline is off by one.** `grep -rn "function fetchAllSpotifyTracks\|function fetchAllTracks\|function findOrCreateGlobalSong\|function ensureInRepertoire" src`
  returns **7** lines at `fe300d4`, not 8 (import 3 + sync 3 + tracks 1). The operative assertion
  ("exactly 3 lines, all in `src/lib/spotifyPlaylistSync.ts`") is right and QA runs on the post-change
  tree, so nothing fails — but the "(was 8 …)" context is wrong.
- **S8 — ER20's second clause is judgement, not a command.** "that section records the deliberate
  leave-alone decisions" is checkable only because the four items are enumerated; make it a grep (e.g.
  the `## [RH-23]` section must mention `SongForm`, `settings`, `playlists` and the song-row clones).
  Ownership is also worth a line in the spec: `docs/suggestions-log.md` is normally appended to by the
  review pipeline, and §Out of Scope is what assigns the section to the developer here. ER20's "at
  least 1 line" wording already tolerates the pipeline adding a second `## [RH-23]` section later, so
  the criterion is satisfiable — just make the intent explicit.
- **S9 — `tracks/route.ts` exports `SpotifyTrackItem`, used only inside that file** (`knip` tolerates
  it because route files are entry points). Once `fetchAllTracks` moves out, the spec should say
  whether the interface stays as the documented response shape or goes; leaving it undecided invites a
  needless knip/tsc surprise.
- **S10 — `<AlertBanner>`'s `className?` prop has no caller.** All five converted/unconverted sites use
  the identical wrapper class list, so the prop ships dead on arrival, and its merge semantics
  (replace vs append) are unspecified. Drop it unless a call site needs it.

## [RH-23] Extrair/remover duplicacao de codigo no projeto — 2026-09-03

- **ER12's baseline parenthetical is wrong.** It says the pre-change grep was "8 lines across the
  three route files"; the tree at `fe300d4` returns 7 (`tracks:31` `fetchAllTracks`; `sync:38,78,121`;
  `import:35,80,126`). The operative clause ("exactly 3 lines, all in
  `src/lib/spotifyPlaylistSync.ts`") is correct and verifiable, so this is cosmetic — but a QA agent
  that treats the parenthetical as fact will be confused.
- **The spec's ER index still does not match the shipped list**, which is exactly round-1's S1 and
  is unfixed: the spec numbers ER1–ER19, the task carries ER1–ER21. Consequences inside the spec:
  §"Duplication gate" says the percentage lands near 1.3 % "(see ER8)", but the percentage ceilings
  live in task ER7 (spec ER8 is the `lint:dup` criterion) — the cross-reference is wrong under both
  numberings; and spec ER7's "the stated ceilings" are stated nowhere in the spec (they exist only
  in task ER7: ≤ 20 clones, ≤ 300 duplicated lines, ≤ 1.80 %, ≤ 2.20 % tokens). Either drop the
  spec-side index in favour of the shipped list, or reproduce the shipped items verbatim including
  the four ceilings.
- **§A3 does not say how `load`'s `useCallback` identity is stabilised.** Today the deps are
  `[bandId, router]` (bands) and `[bandId]` (profile); in the hook, `onNotFound`, `showToast`,
  `onGone` and `onNavigateToPlaylist` will be inline arrows at the call sites, so an
  exhaustive-deps-honest `useCallback(..., [onNotFound, showToast, …])` re-creates `load` every
  render and the `useEffect(() => { load() }, [load])` then refetches on every render. It is not a
  genuine two-readings ambiguity (one reading is plainly a bug and no ER would catch it, since ER18
  would still pass), but one sentence — "callbacks are held in refs / the load callback depends only
  on `bandId` and the policy" — would remove the trap.
- **ER8 has zero margin on the bands↔profile pair and the hook's return bag is the threat.** 12
  clones today, "at most 4" after, and exactly the 4 deliberate JSX clones (#17–20) are meant to
  survive. §A3 returns 26 state values plus 9 handlers; a matching multi-line destructure at both
  call sites is easily over jscpd's 8-line / 50-token floor and would create clone #5. Worth saying
  explicitly in §A3 that the call sites must not both spell out an identical destructure (e.g. keep
  the result in one object, or group the edit-modal state into a nested object as round 1's S2
  suggested).
- **No expected result covers scope item 4 (the `AGENTS.md` touch-ups).** `AGENTS.md` today contains
  neither `jscpd` nor `src/hooks` (verified by grep), the file is on ER2's whitelist, but nothing
  asserts it changed — a QA run cannot tell whether that deliverable shipped. A one-line ER
  (`grep -c "jscpd" AGENTS.md` ≥ 1 and `grep -c "src/hooks" AGENTS.md` ≥ 1) would close it.
- **ER20's first clause is already satisfied at `fe300d4`.** `docs/suggestions-log.md:1382` already
  has `## [RH-23] Extrair/remover duplicacao de codigo no projeto — 2026-09-03`, written by the
  round-1 review and containing S1/S2/S3 about the spec, not the leave-alone decisions. The grep half
  of ER20 therefore passes without the developer doing anything; the load-bearing half is "that
  section records the deliberate leave-alone decisions (SongForm's own toast; the settings/ and
  playlists/ alert banners; the playlists song-row clones)", which is checkable by reading but is not
  a grep. Consider naming the three items as required substrings, and saying whether the developer
  appends to the existing section or adds a second `## [RH-23]` heading (ER20 says "that section",
  which is ambiguous if two exist).
- **ER15's `grep -rn "catch (\w*: any" src`** relies on `\w` in a BRE, which BSD `grep` on macOS may
  not honour — the grep can return 0 lines for the wrong reason. The `vitest run` half of ER15
  (`errorHandlingStyle.test.ts`) is the real guard, so this is not load-bearing, but `grep -rEn
  "catch \([A-Za-z_]*: any"` would mean what it says.
- Non-blocking positives worth recording: the 22/19 clone classification accounts for all 41 clones
  with no double-counting; the six spotify-route clone pairs (#4–9) and the 12 bands↔profile pairs
  reconcile with the live JSON report; the arithmetic of the (A) table (~530 of 747 duplicated lines
  removed) leaves comfortable headroom under ER7's ≤ 300 lines / ≤ 1.80 % ceilings; A2's named
  `statusText` delta is genuinely invisible to clients (the route returns the fixed R1 message);
  §A9's "export only if the tests need it" instruction correctly protects `npm run lint:dead`.

## [RH-23] Extrair/remover duplicacao de codigo no projeto — 2026-09-03

- ER16 asserts the route "still returns `NextResponse.json({ tracks })`", which is the literal form
  at `tracks/route.ts:95` today, but §A2 line 214 writes the new payload as
  `{ tracks: raw.map(({ … }) => ({ … })) }`. Inlining the `.map()` into the `NextResponse.json`
  call would satisfy the payload intent while failing a literal reading of ER16. Say in §A2 that the
  mapped array is assigned to `const tracks` first, so the `return` line stays byte-identical.
- Scope item 4 (`AGENTS.md`: the new `src/hooks/` directory in the tree, `jscpd` in "Testing &
  quality") is an in-scope deliverable with no expected result covering it. `AGENTS.md` is in ER2's
  whitelist, so nothing fails if it is skipped. Consider a small ER: `grep -c "src/hooks" AGENTS.md`
  ≥ 1 and `grep -ci jscpd AGENTS.md` ≥ 1.
- ER4's ceiling of 19 warnings equals the baseline exactly, so a single new `exhaustive-deps` warning
  from `useToast`/`useBandAdmin` fails the gate. That is arguably the intent (no new lint debt), but
  the spec never says the new hooks must be warning-free; a sentence in §A1/§A3 stating that the
  extracted hooks introduce no new ESLint warnings would make the tight bound deliberate rather than
  incidental.
- §A2's named behavioural delta (the thrown page-fetch text losing `${statusText}`) is well argued
  and non-user-visible, and §A9's "export only if the tests need it" is correctly tied to `knip`.
  No change requested; noting that I checked them against the "no behaviour change" scope line and
  the Error Handling Conventions paragraph and found them consistent.
- Clones #8 and #9 are attributed to "A2/A6" in the classification table. Which extraction removes
  them does not change any ER (ER8 only counts clones between the three Spotify route files), so this
  is not blocking, but a single owner per clone would make the table easier to audit next time.

## [RH-23] Extrair/remover duplicacao de codigo no projeto — 2026-09-03

- **§A1, fast-view tone table (spec line 223)** — "the two calls that pass nothing keep the `'info'`
  default" is factually wrong: `songs/[id]/fast-view/page.tsx` has 16 `showToast(...)` call sites and
  **all 16 pass an explicit tone**; the two the sentence means (lines 603 and 624) pass `'info'`
  literally. Harmless — the preceding clause ("each existing `showToast(msg, 'x')` call keeps its
  literal") already covers every call, and `useToast`'s `'info'` default matches today's signature at
  line 129 — but the sentence describes a case that does not exist and should be dropped.
- **§A9 knip rationale (spec lines 482-484)** — "an exported-but-unimported symbol would fail
  `npm run lint:dead`" is not quite right for this repo: `knip.json` sets
  `"ignoreExportsUsedInFile": true`, so a symbol exported and used within `linkFetcher.ts` would not
  be reported. The either/or instruction is still safe, just justified by a rule that does not apply.
- **ER8's `at most 4 clones naming both bands and profile` has zero slack** — it is exactly the four
  `(B)` JSX clones (17-20). If deleting ~250 lines of hook logic from both files causes jscpd to
  split or re-anchor one of those JSX regions, the count goes to 5 and ER8 fails on a clone the spec
  deliberately kept. A ceiling of 5 would absorb re-anchoring without weakening the gate (the eight
  A1/A3 clones are still pinned by ER7's totals and by ER10/ER13's greps).
- **Scope item 4 (`AGENTS.md`: new `src/hooks/` in the tree, `jscpd` in "Testing & quality") still
  has no expected result covering it** — carried over from round 3, still non-blocking since
  `AGENTS.md` is in ER2's whitelist so nothing fails if it is skipped, but nothing verifies it
  either. `grep -c "src/hooks" AGENTS.md` ≥ 1 and `grep -ci jscpd AGENTS.md` ≥ 1 would close it.
  Related drift the task could absorb for free: the directory tree in `AGENTS.md` already omits
  `src/components/ui/` even though `ConfirmPanel.tsx` has lived there since RH-16, and A1/A4 add two
  more files to it.
- **`stripComments` has a third copy** the spec does not mention:
  `src/lib/__tests__/erasePersistence.test.ts:` already `export`s a byte-identical 5-line version.
  It is below jscpd's thresholds so it never shows as a clone and leaving it is correct under ER2
  (that file is not whitelisted) — but it is worth one line in `docs/suggestions-log.md` alongside
  the other deliberate leave-alones, and it is a hint that `test-helpers.ts` is the right home.
- **ER4's warning ceiling equals the baseline exactly (19)** — carried over from round 3. A single
  new `react-hooks/exhaustive-deps` warning out of `useBandAdmin` fails the gate. §A1's `useToast`
  is written with correct deps, but §A3 elides `useBandAdmin`'s `load` deps as a literal `[...]`
  (spec line 315). One sentence saying the new hooks must be warning-free would make the constraint
  explicit rather than implied.

## [RH-23] Extrair/remover duplicacao de codigo no projeto — 2026-09-03

- **ER4's "final line" is not literally the final line.** The real tail of `npx eslint .` is:
  ```
  ✖ 32 problems (13 errors, 19 warnings)
    1 error and 0 warnings potentially fixable with the `--fix` option.
  ```
  The summary is the second-to-last non-empty line. ER4's operative numeric bounds ("E at most 13 and
  W at most 19") are unambiguous, so this is not blocking, but "final line is" would be safer as
  "output contains a summary line".
- **ER8's paths carry a `src/` prefix the jscpd report does not.** Running the ER7 command
  (`jscpd src …`) produces report paths relative to the scanned root — `app/api/spotify/…`,
  `lib/bands.ts`, `lib/__tests__/errorHandlingStyle.test.ts` — with **no** `src/` prefix. ER8 names
  them as `src/app/api/spotify/…` etc. A verifier doing naive literal matching would find zero
  matches for every path and mark all seven "0 clones …" terms as vacuously satisfied. ER7's totals
  (41 → ≤20) still prevent a no-op from passing overall, so this is not blocking, but adding
  "(report paths are relative to `src`)" to ER8 would remove the trap.
- **§A7's "unmoved" for the `test-helpers.ts` self-clone is slightly off.** Baseline is
  `[89:42-100:22] ↔ [113:42-124:22]`; after the two added imports it shifts to `[91:42-102:22] ↔
  [115:42-126:22]`. Same clone, two lines lower. Nothing in the expected results depends on it —
  purely a wording nit in the measurement table.
- **§A1's fast-view row misdescribes the call sites.** It says "the two calls that pass nothing keep
  the `'info'` default", but all 16 `showToast` calls in `fast-view/page.tsx` pass an explicit tone —
  the two `'info'` ones (lines 603, 624) pass `'info'` literally. The operative instruction ("each
  existing `showToast(msg, 'x')` call keeps its literal") already covers every case correctly, so
  behaviour is unaffected; the parenthetical is just inaccurate.
- **ER7 / ER9 overlap.** ER7 permits `percentageTokens` up to 2.20 while `.jscpd.json` sets
  `threshold: 2`. If the sweep landed in the 2.00–2.20 band, ER7 could pass while ER9's
  `npm run lint:dup` exits non-zero. Both must pass so the implementer targets the stricter bound
  anyway, and the expected landing point (~1.3 %) is far below — but tightening ER7's
  `percentageTokens` to ≤ 2.00 would make the two results agree by construction.
- **`docs/suggestions-log.md` already carries four identical `## [RH-23]` headings** (working-tree
  change, not in `fe300d4`, which has zero). ER20 asks for "at least 1 line", so it passes, but
  consolidating them into one section would make the "records the deliberate leave-alone decisions"
  half easier to check.
- **`AGENTS.md`'s directory tree omits `src/components/ui/`**, which already exists at baseline
  (`ConfirmPanel.tsx`). Since the task is already editing that tree to add `src/hooks/`, adding
  `components/ui/` in the same pass would be nearly free. Pre-existing gap, not caused by RH-23.

## [RH-23] Extrair/remover duplicacao de codigo no projeto — 2026-09-03

- **Hazard the spec does not name: the hook call site can create a *new* bands↔profile clone.**
  A3 has both pages destructure ~35 identical names from `useBandAdmin`. I measured this: two
  synthetic files whose only shared text is a one-name-per-line destructuring of the spec's exact
  returned bag, scanned with `npx jscpd@5.1.2 . --min-tokens 50 --min-lines 8`, report **1 clone,
  41 lines / 88 tokens**. That single clone would take ER8's "at most 4 clones naming both
  `src/app/bands/[id]/page.tsx` and `src/app/profile/page.tsx`" to 5 and fail it, while ER7's
  ceilings would still pass — so the failure would surface late. It is avoidable inside the spec's
  own rules (the repo has no Prettier and ESLint enforces no formatting: packing the destructured
  names several per line puts the block under the 8-line floor). Worth one sentence in A3 telling
  the implementer to keep the two destructuring blocks under 8 lines, and worth checking first when
  ER8 is measured.
- **The returned state bag omits `setEditing`.** Both pages keep their edit-modal markup verbatim
  ("No JSX moves"), and that markup calls `setEditing(false)` (`bands/[id]/page.tsx:687`,
  `profile/page.tsx:626`). The enumerated bag in A3 lists `editing` but not `setEditing`, so a
  literal reading does not compile. The fix is implied by "returns the whole state bag both pages
  already declare", but naming it would remove the round trip.
- **`currentUserId` / `authClient.useSession()` ownership is unspecified.** The hook returns
  `currentMember` and `isAdmin`, which derive from `session?.user?.id`, and the retained JSX still
  reads `currentUserId` directly (`bands:468`, `profile:423,445`). Two behaviour-identical readings
  exist: the hook calls `authClient.useSession()` itself and also returns `currentUserId`, or each
  page keeps its two session lines. Either satisfies every ER; picking one in A3 would be cleaner.
- **ER4 says "final line" but eslint prints a trailing hint.** At `fe300d4` the last two lines are
  `✖ 32 problems (13 errors, 19 warnings)` followed by
  ``  1 error and 0 warnings potentially fixable with the `--fix` option.`` The numeric content ER4
  checks is unambiguous and present, so this is not blocking, but "final summary line" (or "the
  `N problems (E errors, W warnings)` line") would remove a literal-reader trap of the same family
  as round 5's ER5 finding.
- **AGENTS.md touch-ups have no ER.** Scope item 4 (add `src/hooks/` to the directory tree, add
  `jscpd` to "Testing & quality") is in scope but no expected result mentions AGENTS.md, so QA — which
  sees only the list — cannot notice if it is skipped. A one-clause addition to ER9 (`AGENTS.md`
  mentions `jscpd` and `src/hooks/`) would close it. Related, pre-existing and out of scope:
  the AGENTS.md tree already omits `src/components/ui/`.
- **Test-count floors depend on unstated granularity.** ER17 requires ≥ 12 tests across
  `uiTones` + `sqlUpdate` + `spotifyPlaylistSync`, and ER3 requires +14 tests overall. Only
  `uiTones.test.ts` is given an explicit count ("five tests"); the other two files are described as
  behaviour lists. An implementer who writes one `it` per file with several `expect`s would satisfy
  the prose and fail ER17. Stating a per-file minimum, as A1's test bullet already does, removes the
  risk.
- Follow-ups already logged by the spec (playlists song-row extraction, `SongForm`'s ad-hoc toast,
  the `settings`/`playlists` alert banners) look correctly deferred; the `settings`/`playlists`
  exclusions are what make ER11's count of exactly 3 correct rather than 1.

## [RH-23] Extrair/remover duplicacao de codigo no projeto — 2026-09-03

- `src/app/api/spotify/playlists/[id]/sync/route.ts:96` — the shared `buildPlaylistSongsInsert`
  emits the import route's indented multi-line statement, where sync previously sent a single-line
  one. Purely whitespace, but worth listing in the PR description next to the already-named
  `statusText` delta so nobody rediscovers it in a query log.
- `src/lib/sqlUpdate.ts:13` — `startIndex` has no production caller (both call sites take the
  default 1); it is exercised only by the unit test. Harmless, but it is speculative surface that
  could be dropped if a second caller never appears.
- `src/lib/sqlUpdate.ts:10` — the doc comment could state the invariant that `columns` must be
  in-source literals, never user input, since column names are interpolated rather than bound.
- `src/hooks/useBandAdmin.ts:21` — `export type PendingAction` is not imported anywhere; knip stays
  quiet only because `ignoreExportsUsedInFile: true` and the type is used inside its own file. It
  could be module-local until a consumer needs it.
- `src/app/profile/page.tsx:48-61` — two consecutive destructures of the same `bandAdmin` object;
  one block would read the same and be shorter.
- `package.json:51` — `jscpd` is `^5.1.2` while the sibling gate `knip` is pinned exactly
  (`6.34.0`). Pinning jscpd exactly would keep the duplication gate from drifting onto a minor with
  different detection heuristics.
- `.github/workflows/ci.yml:118` — step name `jscpd` is lowercase where the neighbouring job uses
  `Knip`; cosmetic consistency only.
- `src/hooks/useBandAdmin.ts:1` — no `"use client"` directive (correct today, since it is only
  imported from client components), whereas `Toast.tsx`/`AlertBanner.tsx` declare one. Adding it
  would make the boundary explicit and fail loudly if a server component ever imports the hook.

## [RH-23] Extrair/remover duplicacao de codigo no projeto — 2026-09-03

Non-blocking only; none of these affects the verdict.

1. **`docs/suggestions-log.md` is unstaged while everything else is staged.**
   `git status` shows it as ` M` (working-tree modification only) and
   `git show :docs/suggestions-log.md | grep -c "^## \[RH-23\]"` returns `0` —
   the entire 277-line RH-23 addition exists only in the working tree. ER20 is
   written against the tree and passes there, and ER2 whitelists the file, so this
   is not a failure. But if the commit is built from the index alone, the artifact
   ER20 exists to guarantee would not land in it. Worth staging before the commit.

2. **Playwright's `webServer` readiness probe cannot see a healthy server.**
   Because the probe hits `/` and `/` 500s (RH-32), `npx playwright test` against a
   correctly running `next start` fails with
   `Timed out waiting 120000ms from config.webServer` rather than running a single
   test — which reads as an e2e failure when it is a probe failure. Pointing
   `webServer.url` at a route that actually returns <400 (e.g. `/login`, or `/bands`
   which returns 307) would make the local e2e path work without the RH-32 fix.
   Out of scope for RH-23; noting it because it will bite the next person who runs
   this spec.

3. **`jscpd` is a floating range while the sibling gate is pinned.**
   `devDependencies.jscpd` is `^5.1.2` where `knip` is pinned exactly. ER9 accepts
   `^5.1.2`, and the developer already logged this in the suggestions file, so it is
   only echoed here: a duplication gate whose detector can drift onto a new minor
   can change its verdict without any source change. Pinning would make the ER7/ER8
   numbers reproducible over time.

4. **`.jscpd.json` is auto-picked up by the ER7 command.**
   The verbatim ER7 invocation printed `Using config from .jscpd.json`, so the run
   used the config's `ignore: ["**/node_modules/**"]` in addition to the CLI flags.
   The flags it does duplicate (`minTokens 50`, `minLines 8`) agree with the config,
   and the ignore pattern cannot hide any `src/` file, so the measured numbers are
   sound. Mentioned only so a future re-run of ER7 is not surprised by the banner.

5. **`src/lib/sqlUpdate.ts` `startIndex` has no production caller.**
   Both call sites take the default `1`; the parameter is exercised only by the unit
   test. Already self-reported in the suggestions log; independently confirmed here.
   Harmless, but it is speculative surface.

## [RH-32] Corrigir 500 no SSR de / e /profile (Invalid hook call em AppLayout.useSession) — 2026-09-05

- **ER6/ER7 would be stronger with a positive body marker.** They say "a real SSR body"; the
  spec's §4 gives the concrete markers (absence of `id="__next_error__"`, presence of
  `Repertoire Hero`). Promote those into the results so QA checks the same thing the e2e guard does.
- **Correct the Postgres port in "Verification environment".** The spec says port 5432, but
  `DATABASE_URL` in `.env.local` is `…@127.0.0.1:54322/postgres` and the compose db publishes
  54322. Also worth noting that `docker compose up -d` (no service arg) may fail on the mailpit
  container if `54324` is already bound — `docker compose up -d db` is the reliable command.
- **Record why `better-auth` was externalized in the first place.** `git log -S'"better-auth"' -- next.config.ts`
  points at `6aa3849 feat: replace Supabase Auth with Better Auth (#8)`, where it was added
  alongside the genuinely Node-only `pg`/`kysely`. One sentence saying "it was never independently
  required — it was grouped with the pg/kysely entries during the auth migration" would close the
  last open question a reviewer naturally asks.
- **Consider asserting `res.url()` in the signed-in HTTP check.** `request.get('/profile')` follows
  redirects, so if the storage state ever silently stops applying, the probe would land on
  `/login` and still return 200 with no error document. I confirmed the storage state *does* apply
  today, so this is defensive only — `expect(res.url()).toContain('/profile')` would keep the test
  from degrading into a tautology later.
- **ER2's "genuinely fails when the bad config is restored" is excellent** and worth keeping as a
  pattern for future guard tests — it is what distinguishes a real regression guard from a test
  that merely happens to pass.
- Consider adding `@vitest-environment node` as a docblock in the new guard file. The spec calls
  it "a `node`-environment vitest file" but the snippet does not declare one; it passes under the
  current default either way, so this is only future-proofing.

---


## [RH-32] Corrigir 500 no SSR de / e /profile (Invalid hook call em AppLayout.useSession) — 2026-09-05

- ER8(b) inherits ER6/ER7's preconditions (docker Postgres on 5432, port 3000 free, the real
  `BETTER_AUTH_SECRET`) only by proximity. QA reads the 13 results as a unit so this is not
  blocking, but restating "with Postgres up and nothing else listening on 3000" inside ER8(b) would
  make it self-contained on its own.
- ER7 ends with `pkill -f 'next start -p 3000'`. If `next start` ever leaves a child holding the
  socket, ER8(a)'s "nothing listening on port 3000" precondition silently breaks and Playwright
  reuses the stale production server (`reuseExistingServer: !CI`). A confirmation step such as
  `lsof -ti tcp:3000` printing nothing would close that gap.
- ER6's fixed `sleep 8` is a timing guess; a short poll loop on
  `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/` would be equally mechanical and
  less machine-dependent.
- ER10 compares versions "strictly greater than 0.1.64-202609031401". For the expected
  `0.1.65-<ts>` a lexical comparison agrees with the semantic one, but it would stop agreeing at
  `0.1.100`; naming the comparison (patch number first, then timestamp) would future-proof the
  wording.
- §4 describes test 3 as one test that also makes a browser check; ER8 asks for `N >= 3`, so either
  reading passes. Splitting the raw-HTTP and browser halves into two named tests would make the
  file's intent clearer to a later reader.
- Non-blocking working-tree note for the implementer: `docs/tasks/RH-24-spec.md` is currently
  untracked in this repo. It is absent from ER11's whitelist, so a blanket `git add -A` before
  committing RH-32 would fail ER11.


## [RH-32] Corrigir 500 no SSR de / e /profile (Invalid hook call em AppLayout.useSession) — 2026-09-05

- **ER8 / §4 test 3: `request.get('/profile')` follows redirects by default.** If
  the storage-state cookies ever fail to attach, `src/proxy.ts` bounces the request
  307 → `/login`, which returns 200 — so the status assertion would pass on a
  request that never reached `/profile`. Pinning it (`expect(res.url()).toContain('/profile')`,
  or `{ maxRedirects: 0 }`) would remove a false-pass path. Non-blocking: ER7
  already covers the same ground with an explicit cookie jar, and this only masks a
  failure of the test harness, never of the fix.
- **ER6's `grep -cE 'Invalid hook call|useRef'` over the whole server log is a
  broad net.** `useRef` unanchored could in principle match unrelated future log
  output. Narrowing to `Cannot read properties of null \(reading 'useRef'\)` would
  target the actual signature. Non-blocking — nothing in the current server log
  path emits it.
- **ER10's "strictly greater than `0.1.64-202609031401`" does not name a comparison
  method** (string vs. semver-with-prerelease). Both interpretations agree for any
  `0.1.65-*`, so this is only a theoretical ambiguity, but naming semver would close
  it.
- **ER11 whitelists `package-lock.json` while ER10 requires it be unchanged.** Not
  a contradiction — the whitelist is permissive and the spec flags the file as
  "only if a dependency actually changes — none is expected" — but a QA agent
  reading only the ER list sees the file in one place and forbidden in another. A
  half-sentence in ER11 would make the relationship explicit.
- **`vitest.config.ts` excludes `**/e2e/**`, which is what keeps ER3's count at
  30.** Worth a one-line note in §4 so a future implementer who adds a second e2e
  spec does not expect the vitest file count to move.

## [RH-32] Corrigir 500 no SSR de / e /profile (Invalid hook call em AppLayout.useSession) — 2026-09-05

- `src/lib/__tests__/serverExternalPackages.test.ts:26` — the general rule only probes the `/react`
  subpath. A package that exports React hooks from its *main* entrypoint, or from a differently named
  subpath (`/client`, `/hooks`), would pass the guard while reproducing the exact same bug. A broader
  variant would read each externalized package's `package.json` and fail if `react` appears in its
  `dependencies`/`peerDependencies` or if any `exports` key resolves to a module importing React. Not
  worth blocking on — the current form catches the realistic regression (someone re-adding
  `better-auth` or another `@better-auth/*`) and is cheap and readable, whereas the general form is
  materially more code for a hypothetical.
- `e2e/ssr-smoke.spec.ts:34` — `toHaveCount(0)` for the app-shell nav on signed-out `/` is asserting
  a *post-hydration* state: per ER6 the signed-out SSR HTML for `/` does contain
  `aria-label="Main navigation"` (the `isPending` loading branch), and it disappears only once
  hydration resolves the session to signed-out. The assertion auto-retries within the 5 s expect
  timeout so it is correct, but it reads as if the nav were never there. Asserting the landing-only
  element visible *first*, then the count, would make the ordering intent explicit and remove any
  dependence on hydration losing a race on a cold dev server.
- `playwright.config.ts:58` — with `reuseExistingServer: !process.env.CI`, a `PLAYWRIGHT_WEB_SERVER`
  override is silently ignored when something is already listening on 3000, so the "production build"
  run can quietly become a dev-server run. The spec's verification notes already warn about this;
  a one-line note in the config comment would put the warning where the reader is.
- `src/lib/__tests__/serverExternalPackages.test.ts:14` — `require_` (trailing underscore to dodge the
  `require` shadow) is slightly awkward; `resolveFrom` or `nodeRequire` would read better. Cosmetic.

## [RH-32] Corrigir 500 no SSR de / e /profile (Invalid hook call em AppLayout.useSession) — 2026-09-05

- `docs/tasks/RH-24-spec.md` is an untracked file belonging to another task sitting in the working
  tree. It does not violate ER11 and is not staged, so it cannot leak into the RH-32 commit, but
  whoever commits RH-32 should take care not to `git add -A`, and RH-24's spec should be moved into
  its own branch or task workflow.
- The test account `rh32-qa@example.com` exists in the local dev Postgres from an earlier run of
  ER7 and was left in place (this verification did not create it, and no ER handles its cleanup).
  Consider having the SSR smoke flow tear down its fixture user, or reuse the existing e2e
  global-setup account, so repeated local verification runs do not accumulate rows in the `user`
  and `profiles` tables.
- `e2e/ssr-smoke.spec.ts` asserts the absence of the crash markers and the presence of the shell,
  which is exactly right for this bug. A cheap addition would be asserting the `content-type`
  header is `text/html` on the two `request`-fixture tests, which would also catch a future
  regression that returns a 200 with a non-document body.
- ER4's eslint budget is currently pinned at the inherited baseline of 12 errors / 18 warnings.
  Those are pre-existing and out of scope for RH-32, but the budget only ever ratchets if someone
  files the cleanup; worth a separate low-priority task so the number does not become permanent.

## [RH-24] Avaliar e melhorar cobertura de testes do projeto — 2026-09-05

- **ER11 silently forbids any lint debt in the new tests.** The cap is "at most 12
  errors and at most 18 warnings", and I confirmed HEAD is exactly 12/18 — so all ten
  new files must be lint-clean. §4 never says this. One sentence would save a
  late surprise (`@typescript-eslint/no-explicit-any` in mock factories is the likely
  tripwire).
- **The source-text guards scan the new test files too.**
  `errorHandlingStyle.test.ts` and `noBrowserDialogs.test.ts` walk the whole `src/`
  tree and exempt only themselves (`const SELF = ...`). The ten new files under
  `src/**/__tests__/` are inside that tree: no `console.error`, no `catch (x: any)`,
  and nothing matching `(?:window\s*\.\s*)?(?:confirm|alert)\s*\(` outside a comment —
  relevant for the `useBandAdmin` "removeMember confirm flow" and the `AlertBanner`
  test. Worth a line in §4.2/§4.3.
- **`functions: 78` is the tightest threshold.** It needs +40 covered functions out of
  the ~70 uncovered ones in the targeted files, and ER7's floors are statement-based
  only — a `useBandAdmin` test that hits 60% of statements may leave most of its 19
  callbacks uncalled. Consider a per-file functions floor for `useBandAdmin.ts`, or at
  least a note that the hook's handlers (not just its load paths) must be invoked.
- **`jsdom (^29)` in D2 is stale**: the registry's latest is `30.0.1`. ER3 is
  version-agnostic (it only names the three packages), so either drop the caret hint or
  state the constraint explicitly, otherwise a plain `npm i -D jsdom` gives `^30` and
  the spec looks violated when it is not.
- **ER9's `npx js-yaml`** pulls a package that is not a devDependency, i.e. needs
  network. The "or any YAML parser" escape hatch covers it, but naming an
  already-available checker (e.g. `node -e` with the `yaml` package if present, or
  `python3 -c 'import yaml,sys;yaml.safe_load(open(...))'`) makes the ER offline-safe.
- **ER10's `80`, `65`, `78` literals are a weak check** — those digits can occur
  anywhere in the section. Requiring `statements 80` / `branches 65` / `functions 78`
  (or the exact sentence) would make the check say what it means.
- **§4.5 vs the review pipeline in `docs/suggestions-log.md`.** Two writers touch that
  file (the implementer, per §4.5, and the `work` skill appending reviewer suggestions
  under an `## [RH-24] ...` heading, with periodic trimming to 30 entries). ER15 passes
  on either, but naming in §4.5 that the *implementer* authors the deferred-items entry
  removes the ambiguity.
- Consider recording in §1 that the D1 coverage baseline was re-confirmed at `0f2833b`
  (identical numbers), so the re-base of B2 does not cast doubt on the coverage
  arithmetic.

## [RH-24] Avaliar e melhorar cobertura de testes do projeto — 2026-09-05

- **ER2's per-file floors are not readable from the command ER2 names.** I ran
  `npx vitest run <two files>` and the default Vitest 4 reporter prints only the
  aggregate (`Test Files 2 passed (2)` / `Tests 11 passed (11)`) — no per-file
  `(N tests)` line for passing files. QA can still verify the floors by running
  each file on its own, but ER2 should say so, or name
  `--reporter=verbose` / a JSON reporter, rather than implying the aggregate
  command surfaces them.
- **ER1's "0 skipped" is verified by an absence.** Vitest prints no `skipped`
  count when nothing is skipped, so QA confirms the condition by *not* finding a
  line. Worth one clause so a QA agent does not go looking for a printed zero.
- **`functions: 78` and `branches: 65` are not guaranteed by ER7.** ER7's floors
  are statement-based, and they arithmetically guarantee only ER6's statement
  and line thresholds. A per-file *functions* floor for `useBandAdmin.ts`, or a
  note in §4.3 item 3 that the hook's handlers (not just its load paths) must be
  invoked, would close the gap between the two ERs.
- **§4.1's "Nothing else in `vitest.config.ts` changes" understates the
  change.** ER5's seven-entry exclude list silently drops the current
  `**/node_modules/**`, `**/.next/**`, `**/coverage/**`, `**/*.config.*` and
  `**/*.d.ts` excludes. I verified this is harmless — the restrictive `include`
  makes them redundant and the report stays clean — but saying so would stop a
  careful implementer from re-adding them and failing ER5.
- **`jsdom (^29)` in D2 is stale** (registry latest is 30.x). `^29` installs and
  works — I used it — and ER3 is version-agnostic, so there is no conflict; but
  a plain `npm i -D jsdom` yields `^30` and makes the spec look violated when it
  is not. Either drop the caret hint or state it as a floor.
- **ER12 has no escape valve for `knip.json`.** I confirmed none is needed
  (knip exits 0 with the three deps installed), so this is belt-and-braces: if
  knip's peer-resolution behaviour ever changes, ER11 and ER12 become jointly
  unsatisfiable with no in-spec remedy.
- **ER10's bare `80`, `65`, `78` literals are a weak check** — those digits can
  appear anywhere in the section. `statements 80` / `branches 65` /
  `functions 78` would make the assertion say what it means.
- **ER9's `npx js-yaml` needs network** (not a devDependency). The "or any YAML
  parser" escape hatch covers it, but naming an offline-safe checker (e.g.
  `python3 -c 'import yaml,sys;yaml.safe_load(open(...))'`) would remove the
  dependency on a live registry during QA.

## [RH-24] Avaliar e melhorar cobertura de testes do projeto — 2026-09-05

- **`package-lock.json` carries the *previous* version string.** Its `version` /
  `packages[""].version` read `0.1.65-202609051646` while `package.json` is now
  `0.1.66-202609051735`, i.e. the lock was regenerated before the version bump. I verified
  `npm ci --dry-run` exits 0 regardless (npm validates dependency specs, not the version
  field), so this is cosmetic — but a `npm install --package-lock-only` before committing
  keeps the two in step and avoids a confusing diff next time.
- **`AGENTS.md:90` says "six DB-backed files skip 51 tests".** That was the pre-RH-24
  count; `profile.test.ts` alone gained 8 DB-gated tests in this diff, so the real number
  is now higher. Either drop the figure or say "50+" — a stale number in a convention doc
  ages badly.
- **`docs/suggestions-log.md` is unstaged and, in its current form, does not satisfy
  ER15.** Out of scope for this review per the dispatch, and I did not touch it — but the
  two `[RH-24]` sections it contains are the planner's critique *of the spec*, not the
  deferred-work items ER15 names (Spotify OAuth callback at 0% while handling OAuth
  state/cookies, `src/app/api/**` outside the gate, `imageCompressor.ts` excluded for
  canvas/`Image`). Flagging so it is staged and completed before QA rather than discovered
  there.
- **`useToast.test.tsx:83-92` is the weakest assertion in the set.** `expect(clearSpy)
  .toHaveBeenCalled()` would also pass if React itself cleared some unrelated timeout
  during unmount. Asserting `vi.getTimerCount()` drops to 0 after `unmount()`, or spying
  on the specific timer id, would make the cleanup claim exact.
- **`useBandAdmin.test.tsx:113-131` swaps the process-wide `unhandledRejection`
  listeners.** It is well-commented and restores them in `finally`, and I could not make
  it flake — but while the window is open any *other* unhandled rejection in a
  concurrently-running worker would be swallowed, and the 60×5ms poll is a wall-clock
  wait. If this ever gets noisy, consider narrowing the assertion to "the hook does not
  set `error`" plus a source-level note, and dropping the listener surgery.
- **Global overrides in `useBandAdmin.test.tsx` are not restored.**
  `Object.defineProperty(navigator, 'clipboard', ...)` (`:226`) and the two
  `URL.createObjectURL` redefinitions (`:263`, `:335`) persist for the remainder of the
  file. Harmless today because each is only consumed by the test that installs it and
  jsdom environments are per-file, but a `configurable: true` + explicit restore (or
  `vi.stubGlobal`, which `vi.unstubAllGlobals()` reverses) would keep it that way.
- **Tone tests assert raw Tailwind class strings.** `feedbackSurfaces.test.tsx:40` uses
  `toBe('text-sm text-red-700')` on a full `className`, and `ConfirmPanel.test.tsx:113-121`
  matches literal palettes. This is a legitimate way to pin tone→palette mapping, but an
  exact-equality assertion on a className will fail on a purely cosmetic class reorder.
  `toContain` on the semantic colour class alone (as the Toast case already does) would be
  a touch less brittle.
- **`repertoire.test.ts:290` reaches through `mock.calls[1][1]?.[0]`.** Positional indexing
  into a mock's argument arrays is precise but hard to read when it breaks; a small named
  helper (`lastUpdateLinksPayload()`) would make the failure message self-explanatory.
  Same shape appears at `:250`, `:264-265` and `playlists.test.ts:166`.

## [RH-24] Avaliar e melhorar cobertura de testes do projeto — 2026-09-05

- `package-lock.json` still carries `"version": "0.1.65-202609051646"` in both its
  top-level `version` and `packages[""].version`, while `package.json` is now
  `0.1.66-202609051735` — the lock was regenerated before the version bump. This is
  cosmetic (I ran the real `npm ci`, which exits 0 and installs correctly), but
  `npm install --package-lock-only` before committing would keep the two in step and
  avoid a confusing diff next time. Not blocking: no ER covers the lock's version field.

- `AGENTS.md:90` states "Without them six DB-backed files skip 51 tests". That figure is
  the pre-RH-24 count; the suite now runs 478 tests rather than the 332 the spec
  projected, and `profile.test.ts` alone gained DB-gated tests in this change, so the
  real skip count is higher. A stale absolute number in a conventions doc ages badly —
  either drop the figure or write "50+". Not blocking: ER10 does not assert this number.

- ER2's per-file floors are not readable from the command ER2 names. The default Vitest 4
  reporter prints only the aggregate (`Test Files 10 passed (10)` / `Tests 172 passed
  (172)`) with no per-file `(N tests)` line for passing files; I had to re-run with
  `--reporter=verbose` to obtain them. Future specs of this shape should name
  `--reporter=verbose` or a JSON reporter explicitly. Spec-quality note only.

- ER1's "0 skipped" is verified by an absence: Vitest prints no `skipped` count when
  nothing is skipped, so the condition is confirmed by *not* finding a line rather than
  by reading a printed zero. Worth one clause in future specs so a QA agent does not go
  hunting for a literal `0 skipped`.

- ER9's `npx js-yaml` pulls a package that is not a devDependency and therefore needs
  network access at QA time. It worked here, and the "or any YAML parser" escape hatch
  covers it, but naming an offline-safe checker (e.g.
  `python3 -c 'import yaml,sys;yaml.safe_load(open(...))'`) would make the ER
  registry-independent.

- ER10's bare `80`, `65`, `78` literals are a weak assertion — those digits could match
  anywhere in the section. The doc does in fact say `statements **80**, branches **65**,
  functions **78**`, so the intent is satisfied, but requiring the paired form would make
  the check say what it means.

## [RH-24] Avaliar e melhorar cobertura de testes do projeto — deferred items — 2026-09-05

Work consciously left out of RH-24. Each item is deferred, not rejected — it should be
picked up by a follow-up task.

- **`src/app/api/auth/spotify/callback/route.ts` sits at 0% statement coverage.** This is
  the highest-value gap left behind: the route handles the OAuth `state` parameter and
  writes auth cookies, so a regression there is a security regression, not a cosmetic one.
  It was deferred because covering it means standing up a `NextRequest`/`cookies()` harness
  plus a fake Spotify token endpoint, which is a task-sized piece of work on its own; for
  now the flow is exercised only by Playwright and manual QA.

- **`src/app/api/**` remains outside the coverage gate.** `vitest.config.ts` scopes
  `coverage.include` to `src/lib/**`, `src/app/actions/*.ts`, `src/hooks/**` and
  `src/proxy.ts`, so route handlers neither raise nor lower the thresholds. Deferred
  deliberately: pulling the whole `api/**` tree into the gate at once would drop the global
  numbers below the 80/65/78 floors this task just established and force a large batch of
  untargeted tests. The right move is to add route handlers to `include` one directory at a
  time, starting with the Spotify callback above.

- **`src/lib/imageCompressor.ts` is excluded from coverage because it needs `canvas`/`Image`.**
  It is listed in `coverage.exclude` with that reason inline. The jsdom environment has no
  real canvas, so testing it in-process would mean mocking `Image`, `createObjectURL` and
  `canvas.toBlob` to the point where the test asserts the mock rather than the compression
  behaviour. Deferred until either a browser-mode Vitest project or an e2e assertion on the
  produced file size is available; today it is covered by e2e + manual QA only.


## [RH-24] Avaliar e melhorar cobertura de testes do projeto — 2026-09-05

- **"exercised only by Playwright and manual QA" overstates the e2e safety net.** The
  Spotify-callback entry says the flow "is exercised only by Playwright and manual QA",
  and the `imageCompressor` entry says it is "covered by e2e + manual QA today". Neither
  is true of the current suite: `ls e2e/` is `auth.spec.ts`, `bands-confirm.spec.ts`,
  `fast-view-mobile.spec.ts`, `songs-crud.spec.ts`, `ssr-smoke.spec.ts` (+ `helpers.ts`,
  `global-setup.ts`), and `grep -ril spotify e2e/` returns nothing, while the only
  image/upload/cover match in `e2e/` is the word "cover" in a docblock at
  `e2e/songs-crud.spec.ts:4`. Both flows are in practice **manual QA only**. The wording
  is inherited verbatim from the spec (`docs/tasks/RH-24-spec.md:148` "covered by manual
  QA + e2e", §D4 at `:214-226`) and from the `vitest.config.ts:79` comment approved in
  round 1, so this is a pre-existing spec-level inaccuracy the developer faithfully
  mirrored, not a new error — hence non-blocking, and not worth a revision round for a
  log entry. But if a follow-up task is filed from these items, it should say "manual QA
  only", because "Playwright already covers it" is the kind of sentence that quietly
  removes the urgency from an untested CSRF check.
- **Optional precision on "0% statement coverage".** Because `src/app/api/**` is outside
  `coverage.include`, the callback route does not appear in the coverage report at all —
  its 0% is "no test exercises it", not "the reporter printed 0%". ER15 itself uses the
  "0% statement coverage" phrasing so the entry is correct as specified, and item 2
  immediately explains the exclusion, so a reader reaches the right conclusion. Purely a
  wording nicety.
- **Log length.** `docs/suggestions-log.md` is now 155 KB with 59 `## [` sections, four of
  them for RH-24 alone. The 30-entry trim the `work` skill performs periodically is worth
  running soon so the deferred-items entries stay findable.

---

**VERDICT: APPROVED** — ER15 is satisfied, the change is append-only, all three deferred
items are factually accurate against `vitest.config.ts` and the callback route source, and
insertion/deletion arithmetic plus mtimes confirm no other staged file moved since round 1.

## [RH-24] Avaliar e melhorar cobertura de testes do projeto — 2026-09-05

- **`docs/suggestions-log.md` has an unstaged tail beyond the staged deferred-items section.**
  `git status` shows `MM docs/suggestions-log.md`: the index contains the deferred-items
  section (ER15 satisfied), while the working tree has a further appended `## [RH-24] …`
  block that is the round-2 peer-review write-up. This is the normal workflow shape (the
  `work` skill stages review logs at commit time), so it is not a finding — just make sure
  the commit picks up the working-tree version rather than only the index, otherwise that
  review entry is silently dropped.
- **The suite is well past the ER1/ER2 floors** (478 tests vs. the 332 the spec predicted,
  172 vs. 51 in the ten named files). The floors are satisfied with wide margin, but the
  arithmetic narrative baked into ER1/ER2 ("332 = 281 + 51") no longer describes reality;
  worth a one-line correction in `docs/test-coverage-plan.md` so a future reader does not
  treat 332 as the current expected count. The log itself already flags this at
  `docs/suggestions-log.md:1958`.
- **`docs/suggestions-log.md` is now ~155 KB with four RH-24 sections.** Running the periodic
  30-entry trim soon would keep the newly added deferred-items entries findable — they are
  the actionable output of this task and should not be buried.
- **Vite config-loader warning on every run.** Every vitest invocation prints
  "Your Vite config uses features that are unsupported by `configLoader: 'native'` …
  (vitest.config.ts:1:1)". Harmless today, but it will become an error in a future Vite
  major; renaming to `vitest.config.mts` is a one-line pre-emptive fix.


## [RH-25] Analisar codigo do projeto quanto a boas praticas, SOLID, DRY, KISS — 2026-09-05

- Add a hand-off check to the spec generator: after writing `expected_results` through
  the API, read them back and diff against the spec's §4 bullets. B1 is the second-order
  cost of not doing this, and it is a three-line script.
- Prefer ASCII throughout any string that an ER greps for. Meridian ASCII-folds on
  write (visible in the task title losing its accents), so em dashes, curly quotes and
  accented characters in prescribed heading strings will silently diverge between spec
  and task.
- Strengthen §1.4's guard against the eight-area quota: say explicitly that a `Low`
  finding is the correct outcome for an area in good health, and that padding the
  Typing or Naming rows to fill the table is a defect.
- Clarify ER8's exclusion so it reads as being about the *subject* of a proposed task,
  and note that a regression test named inside a security or correctness task's
  remediation is not "a task about adding tests", nor is decomposing an oversized
  component "de-duplicating clones".
- Instruct the developer to write §3.7's `## [RH-25]` suggestions-log section before
  the commit, so ER9's four-path diff is satisfied by the commit itself rather than by
  a later pipeline append.
- Fix the `src/lib/bands.ts:128` → `:129` line number in the §3.5 worked example.
- Consider having ER5 quote M2 the way §3.2 will render it (or vice versa) as a single
  source of truth, so the two can never drift again — the same class of defect as B1.

## [RH-25] Analisar codigo do projeto quanto a boas praticas, SOLID, DRY, KISS — 2026-09-05

- §3.5's heading template carries trailing `<- ...` annotations on the same lines as the
  seven headings (e.g. `## 1. Method and Reproducibility     <- M1-M8 verbatim, ...`). The
  intent is obvious and ER1 is authoritative, but moving those annotations into a following
  prose list would remove any chance of a developer copying the arrow into the actual
  heading and tripping ER1's exact-match grep.
- ER9's closing clause, "docs/suggestions-log.md gained a section whose heading contains
  RH-25", is already satisfied today: the work skill appended `## [RH-25] ...` at
  `docs/suggestions-log.md:2070` while logging round-1 review suggestions. So that clause
  does not in practice gate §3.7's requirement that the *developer* record deliberately
  omitted observations and the `13da8b2` snapshot note. Not blocking — the substance of a
  suggestions log is not mechanically checkable anyway, and §3.7 remains clear to the
  developer — but the ER clause is weaker than it reads.
- §1.3's "104 violations" and §1.4's counts are stated without noting that the sweep total
  spans test files while the offenders list does not. The report itself will be clearer if
  §2 ("Measured Baseline") says so explicitly; a reader comparing 104 against the eight-row
  production list would otherwise wonder where the rest went.
- Consider having the report's §1 note that the M2 command exits non-zero by design, so a
  future re-runner does not read the exit status as a failed measurement. §3.2 says this to
  the developer, but ER5 only requires the command text, not the caveat.

## [RH-25] Analisar codigo do projeto quanto a boas praticas, SOLID, DRY, KISS — 2026-09-05

- **F22 severity.** Rate it Low rather than Medium. The finding itself says the
  `NODE_ENV` guard "caps the severity", and the report's own scale puts a
  dev-only consistency deviation at Low. Its "gets copied into a non-dev route
  later" argument justifies raising the finding, not its rank above F13 and F17.
- **F3's "eight exported actions".** `resolveOwner` has nine call sites
  (`repertoire.ts` lines 27, 32, 39, 46, 53, 64, 73, 91, 98); the ninth is
  `updateLyricsAction`, which the report discusses separately under F8. The
  understatement is harmless but "nine" is the reproducible number, and F3 is the
  finding most likely to be turned into a task verbatim.
- **F6's "5 `useEffect` blocks".** There are 4 `useEffect(` call sites; 5 is what
  M6's `grep -c 'useEffect'` returns because it counts the import line. The
  report is faithfully quoting its own prescribed measurement, so this is not an
  error against method - but the sentence reads as a count of blocks. Either say
  "4 `useEffect` blocks" or note that M6's counts include the import.
- **Section 2.3 offender list is not exhaustive at its own cut-off.** It lists
  nine production functions down to complexity 21 but omits two others at 21
  (`src/app/bands/[id]/page.tsx:235` and `src/app/profile/page.tsx:196`). The
  heading says "worst production offenders", not "all above 20", so this is not
  wrong - but including them would cost two lines and remove the ambiguity.
- **F15's scope sentence.** "every other route is `'use client'` and loads its
  data from a `useEffect` calling a Server Action" is broader than the evidence:
  `/login`, `/signup`, `/forgot-password` and `/reset-password` are client
  components that do not fetch that way. The remediation already targets only the
  read-only pages; tightening the sentence to match would close the gap.
- **F11 needs a task that decomposes it.** T6 (add ESLint budgets) is a ratchet,
  not a decomposition, yet it is the only task covering F11. Either extend T5 to
  cover `PlaylistDetailPage` or add a T11 - and move F26's
  `getPlaylistEntryIdsAction` half out of T5, where it does not belong.
- **F25 block formatting.** Remove the blank line between the `### F25` heading
  and its `**Location:**` line so all 26 blocks render identically.
- **Suggestions log.** `docs/suggestions-log.md` is modified but unstaged. Out of
  scope for this review per the dispatch, but ER9 requires it in the commit, so
  it must be staged before the commit lands.

## [RH-25] Analisar codigo do projeto quanto a boas praticas, SOLID, DRY, KISS — 2026-09-05

- Carried forward from round 1, still non-blocking: several body-text references use
  glob-ish backticked strings (`src/app/actions/*`, `src/components/fastview/*`,
  `src/lib/*`). ER3 scopes its path-existence check to `**Location:**` lines only, so
  these are outside the gate and harmless today. If a future QA script ever widens the
  scan to all backticked strings, they would read as missing paths. Cheap to defuse by
  dropping the backticks on prose globs, but not worth a revision round now.
- F14's remediation names eight replacement commands. When the follow-up task (T8) is
  specced, that list is a design proposal rather than a measured finding - worth
  re-deriving from the two consumers' actual call sites rather than inheriting verbatim.

## [RH-25] Analisar codigo do projeto quanto a boas praticas, SOLID, DRY, KISS — 2026-09-05

- (Non-blocking) Section 2 is a point-in-time snapshot and the document already says so in its closing line.
  Since T6 proposes moving the complexity budget into `eslint.config.mjs`, it may be worth having T6's spec
  explicitly require updating section 2.3's numbers (or deleting them in favour of the CI output) at that point,
  so the two do not silently diverge.
- (Non-blocking) The M2 aggregation one-liner in section 1 writes to `/tmp/rh25-complexity.json` and the reader
  must notice the "redirect its stdout" sentence between the two fences. Folding the redirect into the ESLint
  fence itself would make the pair copy-pasteable as a unit — but note that would change the ESLint command's
  verbatim text, which ER5 pins, so this is strictly a future-document suggestion, not a change to make now.
- (Non-blocking) `docs/tasks/RH-25-spec.md` is currently untracked. It is one of the four paths ER9 enumerates,
  so it needs to be `git add`-ed before the commit, otherwise the committed change set will be three paths, not four.

## [RH-33] Corrigir vulnerabilidades de dependencias (Dependabot / npm audit) — 2026-09-05

- **ER7, eslint clause.** "`npx eslint .` ends with `30 problems (12 errors, 18 warnings)`"
  is not literally the last line of output. Actual tail:

  ```
  ✖ 30 problems (12 errors, 18 warnings)
    1 error and 0 warnings potentially fixable with the `--fix` option.
  ```

  The counts are exactly right; only "ends with" is imprecise. Suggest "its summary line
  reads `✖ 30 problems (12 errors, 18 warnings)`" to remove any chance a strict reader
  fails it on the trailing hint line.

- **ER4 / a YAML-validity check.** The three greps confirm the strings are present but not
  that `ci.yml` still parses or that the `audit` job is well-formed. Since the post-push
  `gh run view` clause has to be deferred anyway, consider adding a QA-time structural
  check, e.g.
  `python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/ci.yml')); j=d['jobs']['audit']; print(j['name'], len(j['steps']), any('npm ci' in str(s) for s in j['steps']))"`
  printing `Dependency audit (npm audit) 3 False`. Risk is low (the spec hands over the
  exact YAML block), which is why this is a suggestion rather than a finding.

- **Approach §3 says "Add a fifth top-level job".** `ci.yml` already has five jobs
  (`build`, `e2e`, `dead-code`, `coverage`, `duplication`), so `audit` is the sixth. No ER
  depends on the count; it is just a wrong word in the prose.

- **Spec file vs persisted ER10 wording.** The persisted ER10 carries a parenthetical the
  spec file does not: `(git show 0f13814:AGENTS.md | grep -c 'audit', which prints 1)`, and
  drops the markdown bold around **Testing & quality**. The check is substantively identical
  and the annotation is correct (I verified the baseline count is exactly `1`), and QA sees
  only the persisted list, so this is not blocking — but the spec file should be brought in
  line so the two documents do not drift further. All other ERs are byte-equivalent modulo
  whitespace/markdown; ER2's difference is only the heredoc-vs-prose rendering of the same
  script, which I verified reconstructs and runs correctly (below).

- **ER2's lockscope script, edge case.** `V()` maps each package key to `v.version`; an
  entry that has no `version` field at all (link/workspace-style entries) would compare
  `undefined === undefined` and be skipped, and an entry present in the base without a
  version but with one afterwards would be misreported as `ADDED`. Neither case exists in
  this lockfile — the script prints `LOCKFILE-SCOPE OK` on the real patched result and
  correctly fails on tampering — so this is a latent nit, not a defect for this task.

- **Investigation prose, "689 packages".** `npm audit fix` reports `audited 690 packages`
  (689 dependencies + the root project) and `npm ci` reports `added 689 packages, and
  audited 690 packages`. Both numbers are right, they just count different things; no ER
  depends on either.

---


## [RH-33] Corrigir vulnerabilidades de dependencias (Dependabot / npm audit) — 2026-09-06

- **ER4 / ER5 ordering.** ER4 asks for `npm run audit` to be verified "even with `node_modules`
  absent" and, in the same ER, for `npx js-yaml .github/workflows/ci.yml` to exit 0. `js-yaml`'s bin
  comes from `node_modules/.bin`; if QA deletes `node_modules` for the first clause and then runs the
  second, `npx` falls back to a registry download, which makes the check network-dependent and slow.
  Consider stating the intended order explicitly (run the YAML parse guard *before* removing
  `node_modules`, or after ER5's `npm ci` restores it), or pin the guard to
  `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/ci.yml','utf8'))"`.
- **ER2's flattened script in the task record.** The stored `expected_results` entry renders the
  lockscope script with ` / ` standing in for newlines. It is reconstructable, but QA has to know to
  translate the separator back. If the schema allows it, consider keeping the script in the spec only
  and having ER2 reference it as "the lockscope script in the spec's ER2" — or accept the current form
  knowingly, since QA does not read the spec.
- **ER6's `478` is the one baseline I could not cheaply confirm** (it needs a live Postgres and a
  service-role key). The file count `40` matches, and `AGENTS.md:88` warns that a missing DB silently
  skips 51 tests across six files — which is precisely why ER6's "no `skipped` count in either line"
  clause is well chosen. Worth a spot-check by whoever runs the suite first, so a stale `478` does not
  read as a regression.
- **ER7's eslint clause asserts output text but not exit status**, deliberately (12 baseline errors
  mean `npx eslint .` exits 1). That asymmetry with the neighbouring "exits 0" clauses is easy to
  misread as an omission; a half-sentence noting that eslint is expected to exit non-zero at baseline
  would remove the doubt.
- Non-blocking observation for the suggestions log, not for this task: the repo carries 12 eslint
  errors on `master` with no CI job failing on them, while `knip`, `jscpd` and coverage all have
  gates. Adding an `npm audit` gate here makes that gap slightly more conspicuous.

## [RH-33] Corrigir vulnerabilidades de dependencias (Dependabot / npm audit) — 2026-09-06

- **ER7 wording, `tsc`**: "prints no output and exits 0" is literally true for bare
  `tsc --noEmit`, but this environment's rtk command proxy rewrites the invocation and
  prints `TypeScript: No errors found` on success. A QA agent reading the clause
  strictly could call that a mismatch. "reports no errors and exits 0" would be robust
  to the wrapper. Same shape applies to `npm run lint:dead`, whose npm banner lines are
  always printed.
- **ER4 ordering**: the clause "`npm run audit` ... even with `node_modules` absent"
  only bites if QA removes `node_modules` first, which is exactly what ER5 does. Saying
  "run this in the same window as ER5, after `rm -rf node_modules` and before `npm ci`"
  would remove the guesswork — and would also avoid the case where QA runs the ER4
  `npx js-yaml` guard with no `node_modules`, forcing a registry fetch instead of using
  the already-present `node_modules/.bin/js-yaml`.
- **ER3 aggregate strictness**: the ER demands `"moderate":0,"low":0` while Out of Scope
  forbids acting on moderate/low advisories. That is consistent *today* (verified: the
  tree has zero moderate and zero low), but if a new moderate advisory lands between now
  and QA, ER3 fails on a perfect implementation and the spec forbids the fix. Narrowing
  the pass condition to `high` and `critical` being 0, while still printing the full
  aggregate for the record, would make the ER stable over time.
- **ER5 working directory**: `shasum -a 256 -c /tmp/rh33-lock-before.sha` resolves
  `package-lock.json` relative to the current directory, so it silently depends on QA
  standing in the repo root. ER7 says "from the repo root"; repeating that in ER5 (or
  using an absolute path in the digest) would close the gap.
- **ER2 inline script**: the task-side rendering uses ` / ` as a line separator, which a
  QA agent must translate back into newlines before the file will parse. It is
  unambiguous given the `;` separators, but a `\n`-escaped form would remove the
  translation step entirely.

### Implementation-time observation (developer, RH-33)

- **ER9 has an undocumented environment precondition.** `npx next start` does not load `.env.local`
  (only `next dev` does — the production server prints no `- Environments: .env.local` line), so
  `src/lib/auth.ts`'s `secret: process.env.BETTER_AUTH_SECRET!` is `undefined` and Better Auth
  throws `You are using the default secret`. `e2e/global-setup.ts` then fails sign-in with
  `500` before a single spec runs. The fix is purely environmental — `set -a; . ./.env.local; set +a`
  in the shell before the ER9 command, so the exported vars are inherited by the Playwright
  `webServer` child — and needs no code change, but ER9 should say so the way ER6 already spells
  out its Postgres/`SUPABASE_SERVICE_ROLE_KEY` precondition. Out of scope here: fixing it properly
  would mean touching `playwright.config.ts`'s `webServer.env` or `e2e/`, both excluded by RH-33.

## [RH-33] Corrigir vulnerabilidades de dependencias (Dependabot / npm audit) — 2026-09-06

1. **The lockfile's own root `version` field is one bump behind `package.json`.**
   `package-lock.json:3` and the `packages[""]` entry now read `0.1.67-202609052124`, while
   `package.json:3` reads `0.1.68-202609060011`. This is an artifact of ordering: `npm audit fix`
   rewrote the lockfile while `package.json` still said `0.1.67`, and the version bump landed
   afterwards without a re-sync. It is harmless (`npm ci --dry-run` exits 0 and npm does not
   validate the root `version` for sync) and it is the repo's pre-existing habit — at `0f13814`
   the lockfile said `0.1.65-202609051646` against a `0.1.67` `package.json`, so this change
   actually narrows the gap rather than widening it. If you want them to match, the cheap fix
   is `npm install --package-lock-only` after the version bump, which touches only those two
   lines. Not blocking, and explicitly outside ER2's check (its script filters the `""` root
   entry out before comparing).

2. **`AGENTS.md:95` is a single ~600-character bullet.** It is accurate and it satisfies ER10
   (it names `npm run audit`, `--audit-level=high`, the `Dependency audit (npm audit)` CI job,
   the full-tree-vs-`--omit=dev` rationale and the no-`npm ci` design), and neighbouring bullets
   in the same section are also long, so it is stylistically consistent. A future editor may
   want to split the "why full tree" clause into a nested sub-bullet the way the vitest entries
   at lines 84-88 do. Purely cosmetic.

3. **Nothing wires the new job into branch protection.** The job will run on every push/PR to
   `master`/`main`, but whether it is a *required* check is a GitHub repo setting, not a file in
   the diff. Correctly out of scope for this task; flagging only so the operator does not assume
   the merge is mechanically blocked by a red audit job. The spec's post-merge check already
   covers confirming the job goes green.

---

# What I reviewed and what I observed


## [RH-33] Corrigir vulnerabilidades de dependencias (Dependabot / npm audit) — 2026-09-06

- **(Non-blocking, process) A stale `/tmp/rh33-lockscope.mjs` was left on disk from development.** Because ER2
  names a fixed absolute path, an independent verifier who follows the ER literally with a shell heredoc would
  silently re-run the developer's copy instead of their own transcription. I caught this and overwrote the
  file, and the leftover turned out to be semantically identical — so nothing is wrong with this change. But
  future ERs that hand QA a script body would be more robustly independent if the path were
  round-specific (e.g. `/tmp/rh33-lockscope.qa.mjs`) or if the ER instructed QA to delete any existing file
  first.
- **(Non-blocking, CI) The audit job pins `node-version: "24.x"` and sets `cache: "npm"` but never installs.**
  The npm cache configuration is inert for a job with no `npm ci`, so the `cache: "npm"` line buys nothing and
  may briefly confuse a future reader into thinking an install step was dropped by accident. Consider either
  dropping `cache: "npm"` from this job or adding a short comment noting the omission of the install step is
  deliberate. The AGENTS.md line 95 text already explains the rationale, so this is purely about the workflow
  file being self-explanatory in isolation.
- **(Non-blocking, coverage) The gate is `--audit-level=high`, but the tree is currently at zero across every
  severity** (`{"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}`). There is no urgency, but it
  is worth noting that today the project could pass a stricter gate for free; if the team ever wants moderate
  advisories to be actionable rather than merely reported, the cost of tightening is currently nil.
- The suggestions log entries already filed by the implementer (ER7 "ends with" wording, ER4 YAML check, the
  "fifth job" prose error, and the spec-file/persisted-ER10 divergence) are accurate. I independently
  confirmed the ER7 eslint tail and the ER10 baseline count of `1`. Those are documentation nits in the
  specification, not defects in the change under test.


## [RH-34] Autorizacao fail-closed em toda Server Action — 2026-09-06


- **ER1's eslint phrasing.** ER1 says the run "ends with exactly `✖ 30 problems (12 errors,
  18 warnings)`". That line is present and exact, but it is not the last line — eslint then
  prints "1 error and 0 warnings potentially fixable with the `--fix` option." Say "reports"
  rather than "ends with" to keep a literal-minded QA from tripping.
- **ER1's clone cap is stricter than the gate it protects.** `.jscpd.json` scans all of `src`
  including `__tests__` (no test ignore) with `minTokens: 50 / minLines: 8`, and the gate is
  the 2 % threshold, not a clone count. Five new test files with near-identical
  `describe.skipIf` / `beforeAll` fixture blocks can plausibly add more than the 2 clones ER1
  allows while the actual gate stays green at ~1.1 %. Consider expressing ER1 as "exits 0 and
  duplication stays under 2 %", or raise the cap.
- **Approach §2 says `resolveOwner` is "the one deliberate exception"** to "row reads return
  the not-found value", but ER7 requires `getPlaylistDetailsWithEntriesAction` — a read — to
  reject with `Access denied`. That is a second exception. ER7 is unambiguous so the
  implementation is determined, but §2's narrative should acknowledge it. Relatedly, the
  Approach never spells out how `getPlaylistDetailsWithEntriesAction` gets fixed (the
  signature table in §3 omits it); a line saying it calls `assertPlaylistAccess` and, when
  `bandId` is supplied, `assertBandMember`, would close the gap.
- **ER9(e)/(f) say `proposed_data->'links'` equals "the submitted list".** Approach §5 step 5
  submits `processedLinks`, i.e. after `fetchUrlTitle` fills in missing labels, so the two are
  equal only if the test's input links already carry labels. Worth stating that the fixture
  submits fully-labelled links, or comparing against the processed list.
- **ER9's grep is noisy.** `grep -n "pending" "src/app/songs/[id]/fast-view/page.tsx"` already
  matches ~8 pre-existing `pendingDelete` lines. Grepping for something like
  `res.pending` or `\.pending` would make the check discriminating.
- **ER10's `npx next build`** was not executed during this review (it would dirty the tree via
  the Next-generated AGENTS.md block); the claim is standard and low-risk, but the developer
  should confirm the baseline build is green before relying on it as an unchanged gate.

## [RH-34] Autorizacao fail-closed em toda Server Action — 2026-09-06 (spec review 2)


- ER9's final check, `grep -n "pending" "src/app/songs/[id]/fast-view/page.tsx"`, will also match the pre-existing `pendingDelete` state variable (used around lines 590–620), so the output is noisy. Grepping for `res.pending` or `.pending` would isolate the new branch and make the check a one-glance pass/fail.
- ER3 pins only `statements` and `lines` on the `src/app/actions` row; `branches` (67.08) and `functions` (93.87) could regress there unnoticed, caught only if the global thresholds also dip. Adding those two lower bounds would close the gap at no cost.
- ER5 leaves the `throws` vs `envelope` split to the implementer's table without naming which actions are which. Both modes are fail-closed and the test asserts the declared mode, so this is not a hole — but naming the six envelope-returning actions (the five in `tabs.ts` plus `uploadBandCoverAction`) would let QA sanity-check the table's shape without reading the action sources.
- §2 changes `tabs.ts`'s thrown text from `Access denied` to `Access denied: not allowed on this repertoire entry`. Worth noting for code review that `src/app/admin/moderation/page.tsx:95` branches on `error.includes("Access denied")` (substring, so it still matches) and that the two exact-equality assertions at `src/app/actions/__tests__/tabs.test.ts:62,98` are the ones §2 already flags for update.
- ER4's tamper check mutates the working tree; QA should be reminded (the ER does say "restore the line") to verify `git diff` is clean afterwards before running ER12.

## [RH-34] Autorizacao fail-closed em toda Server Action — 2026-09-06 (code review 1)


1. **`src/lib/songs.ts:242-279` — `updateSong` still writes `global_songs` on a
   client-supplied `entry.song_id`.** `resolveOwner` now proves band membership, and the
   `repertoire` half of the function is owner-scoped (`WHERE id = $4 AND band_id = $5`),
   but the `global_songs` `UPDATE` at line 268 keys off `entry.song_id` taken verbatim from
   the client with no check that the caller holds any repertoire entry for that song. The
   blast radius is small — every column is fill-if-empty, so nothing existing can be
   clobbered — and the global-catalog data model is explicitly out of scope here (F4,
   per-owner links). Not blocking, but it is the same class of defect RH-34 exists to close,
   and it is worth a line in `docs/suggestions-log.md` so it is not lost.

2. **`src/app/songs/[id]/fast-view/page.tsx:550` — the add-link path ignores
   `result.pending`.** `currentLinks` comes from the client's copy of `entry.song.links`.
   If that copy is stale (another user contributed a link since load), the submitted list
   silently drops that url, the server correctly classifies the "add" as destructive and
   queues it, and the UI still optimistically shows the link and toasts "Link added" — the
   user is told a write happened that did not. The delete path at line 608 already models
   the fix; the add path needs the same three-line branch.

3. **`src/app/actions/__tests__/actionScan.ts:46` — the scan only matches
   `export async function`.** An action written as `export const fooAction = async () => …`
   would be invisible to *both* guard suites, including the key-set equality test that is
   supposed to make an unguarded action impossible to add. The current tree has no such
   export, and the spec asked for exactly this shape, so this is not a defect in the
   delivered work — but widening the regex to `export (?:async function|const) (\w+)` would
   make the mechanical rule genuinely mechanical rather than mechanical-by-current-style.

4. **`src/app/actions/__tests__/authzRepertoire.db.test.ts:275` —
   `expect(edits.rowCount).toBe(1)` is tautological.** The query carries `LIMIT 1`, so
   `rowCount` can never exceed 1 and the assertion cannot fail for the reason it appears to
   be testing ("exactly one new row"). The suite already has `editCount()`; asserting
   `expect(await editCount()).toBe(editsBefore + 1)` would test the intended property.

5. **`src/app/actions/__tests__/authzPlaylists.db.test.ts:88-98` — fixture cleanup is
   partly load-bearing on a passing test.** Personal playlist P and the `repertoire` row
   created in `beforeAll` are removed by the final `deletePlaylistAction` test and the
   `deleteTestUser` cascade rather than by `afterAll` itself. If an earlier test fails, the
   suite leaks rows into the shared local database. `authzBands` and `authzRepertoire` both
   delete their fixtures explicitly; matching that here would be more robust.

6. **Deliberate near-duplication, noted so a future reader does not "fix" it.**
   `assertPlaylistAccess` and `assertRepertoireAccess` share a predicate shape but live in
   different domain modules, per the spec's instruction to keep them structurally distinct.
   `lint:dup` is unmoved at 19 clones, so the choice cost nothing. No change wanted.

## [RH-34] Autorizacao fail-closed em toda Server Action — 2026-09-06 (QA 1)


- `actionScan.exportedActionBodies` only recognises `export async function` at
  column 0 and ends a body at the first line that is exactly `}`. That is true of
  every file in `src/app/actions` today, but an action written as
  `export const fooAction = async (...) => {...}` would be invisible to both guard
  suites, including the key-set assertion in `actionSessionGuard`. A cheap
  hardening would be a third assertion that the scanned action count equals the
  count of `export ` declarations in those files. Non-blocking: no such export
  exists today, and ER4/ER5 are met as written.
- `authzRepertoire.db.test.ts` ER9(e) proves "exactly one new row" via
  `rowCount` on a `LIMIT 1` query plus the unchanged-count assertion in (d);
  an explicit `count(*)` delta around the removal call would state the
  intent more directly.


## [RH-35] Autorizar os route handlers de playlist do Spotify contra as playlists do chamador — 2026-09-06 (spec review 1)


- **ER3 row identification.** The console coverage reporter truncates the file column: the
  row prints as `...yRouteAuth.ts`, so no row literally "ends in `spotifyRouteAuth.ts`".
  Reword to "the row for `src/lib/spotifyRouteAuth.ts`, printed truncated as
  `...yRouteAuth.ts`" so QA does not fail on a string match.
- **ER5 under-specifies PB.** ER9 needs the PB sync to return 200, which requires
  `spotify_playlist_id` to be set on PB (otherwise `sync/route.ts:49` answers 400
  "Playlist is not linked to a Spotify playlist"). The Approach sets
  `spotify_playlist_id = 'rh35-spotify-pb'`, but ER5's fixture paragraph — the only one QA
  sees — describes PB as merely "band playlist PB owned by band Y". Add the field.
- **ER5/ER9 ordering.** ER5 requires `count(*) FROM playlist_songs WHERE playlist_id = PB`
  to be 0 and ER9 requires it to be 1; that only works if the negative cases run first.
  State that the negative cases precede the positive ones in the file.
- **ER9's `last_synced_at` comparison.** "strictly greater than the value read before the
  call" is only well-defined if the fixture gives P a non-null `last_synced_at`; ER5 does
  not say it has one. Either set it in the fixture or say "was null before and is non-null
  after".
- **ER4's mirrored band case.** "The same four assertions hold for `resolveBandOwnership`"
  literally carries over the message `Failed to authorize playlist access: boom`; the real
  helper throws `Failed to check band membership: ...`. Harmless with a mock, but name the
  band-side message and confirm the `[spotify/playlists/authz]` tag is expected on that path
  too.
- **Approach §5 wording.** "This file is inside `coverage.include` (`src/lib/**/*.ts`)" is
  wrong for the test file itself — `vitest.config.ts:65` excludes `**/__tests__/**`. It is
  `src/lib/spotifyRouteAuth.ts` that is inside the gated universe. Note also that
  `src/app/api/**` route handlers are outside `coverage.include`, so the three route edits
  are not coverage-gated at all — worth saying, since it is why ER3 only names one row.
- **ER2 arithmetic.** 601 + ER4's minimum 8 = 609, so ER2's `M >= 612` silently requires the
  db suite to contain at least 3 tests. ER5-ER10 describe well over that, but stating a
  minimum test count for the db file would make ER2 self-contained.
- **Out-of-scope note worth recording.** `sync/route.ts:176-178` returns the raw
  `error.message` in its 500 body, which contradicts convention R1 (AGENTS.md:228). The spec
  correctly keeps it byte-identical for scope reasons; consider logging it as a follow-up
  suggestion rather than leaving it unmentioned.

## [RH-35] Autorizar os route handlers de playlist do Spotify contra as playlists do chamador — 2026-09-06 (spec review 2)


- ER5, ER6, ER8 and ER9 assert absolute database values for the same rows (`playlist_songs`
  of P is "exactly one row, S1 at position 1"; `playlist_songs` of PB is "still 0"), while
  ER9 deliberately rewrites both. The file therefore only passes if the negative cases run
  before the positive ones, or if each test re-seeds. The spec never says so. Worth one
  sentence in section 5 ("negative cases first, or re-seed P and PB in `beforeEach`") so the
  implementer does not discover the ordering constraint by a red run.
- Same for the fetch spy: ER5/ER6/ER7 require "0 calls to any URL containing
  api.spotify.com", which only holds if the spy's call log is cleared per test. Say
  `beforeEach` clears it.
- ER9 asserts P's `last_synced_at` is "strictly greater than the value read before the
  call", but the fixture leaves `last_synced_at` unset for P, so the pre-value is `NULL` and
  the comparison degenerates. Either seed `last_synced_at` in the fixture or phrase the
  assertion as "was NULL before and is non-null after".
- ER3's branch floor of 85 on `spotifyRouteAuth.ts` leaves little slack: with the ten
  mandated cases, any additional defensive narrowing inside the guards (an
  `error instanceof Error ? … : undefined` whose false side is never driven) costs a couple
  of points. Add one case rejecting with a non-`Error` value, or note that the guards should
  narrow once at the top.
- `AGENTS.md` is on the ER12 whitelist but no Approach step changes it. Either drop it or
  say what would be recorded there (e.g. a line about the new route-authorization prologue
  under the conventions section).
- ER4 says "the same four assertions hold for `resolveBandOwnership` over
  `assertBandMember`" without quoting the two rejection messages it should be driven with
  (`Access denied: not a member of this band` and `Failed to check band membership: boom`).
  The guard keys on the `Access denied` prefix so any message works, but quoting them would
  make the result as self-contained as its playlist twin.

## [RH-35] Autorizar os route handlers de playlist do Spotify contra as playlists do chamador — 2026-09-06 (code review 1)


1. `src/app/api/spotify/playlists/[id]/sync/route.ts:48,54,61` — the guard already read the
   playlist row, and the handler now issues a second `SELECT` purely for
   `spotify_playlist_id`, then indexes `linkRes.rows[0]` without a presence check. It is safe
   as written (the guard proved the row existed), but if the row is deleted between the two
   statements the property access throws and lands in the catch-all, which returns
   `error.message` verbatim (line 180) — i.e. a "Cannot read properties of undefined" string
   reaches the client. Cheapest future fix is to widen `assertPlaylistAccess`'s projection to
   include `spotify_playlist_id` (out of scope here, `src/lib/playlists.ts` is off-limits for
   this task) and drop the second read entirely.

2. `src/app/api/spotify/playlists/[id]/sync/route.ts:179-182` and
   `import/route.ts:122-125` — both catch-alls still return the raw `error.message`, which is
   the one place in these files that does not follow AGENTS.md convention R1. Pre-existing at
   `1c04a20` and untouched by this diff, so not a finding against RH-35; worth a suggestions-log
   entry so it is not lost.

3. `src/app/api/spotify/playlists/[id]/import/route.ts:51` — `if (bandId)` treats
   `band_id: ""` as "no band", which then reaches the insert as an empty string and fails as a
   Postgres cast error rather than the guard's clean 404. Not exploitable (an empty string
   owns nothing), but `if (bandId != null)` or trimming the body value would keep every
   malformed band id on the single 404 path the guard was built to own.

4. `src/lib/__tests__/spotifyPlaylistRouteAuthz.db.test.ts:305-328` — the positive "owner still
   pulls" case mutates playlist P's contents (S1 is replaced by the mocked track), so the
   negative cases above it are order-dependent on running first. They do today (Vitest runs
   declarations in order, and I confirmed the file passes standalone and inside the full run),
   but re-seeding P inside that test, or using a separate playlist for the positive case, would
   remove the ordering assumption.

## [RH-35] Autorizar os route handlers de playlist do Spotify contra as playlists do chamador — 2026-09-07 (QA 1)


None. (Two observations, neither actionable and neither a defect: the
`spotifyRouteAuth.test.ts` non-Error-rejection case and the extra pinned
`entriesBefore` / `bandEntriesBefore` absolute assertions in the db test go
beyond what the ERs require, which is a strength rather than a gap.)


## [RH-36] Introduzir helper de transacao real e tornar escritas multi-statement atomicas — 2026-09-07 (spec review 1)


- ER3(d) counts `idle in transaction` connections database-wide. Under ER8's
  full-suite run, other vitest workers legitimately sit idle in transaction for
  the few milliseconds between statements of their own `withTransaction`
  (`playlists.test.ts`, `songs.test.ts` and `profile.test.ts` all hit converted
  paths). The 20 × 100 ms poll makes an all-nonzero sample unlikely, but the
  assertion would be sharper — and unflakeable — if it filtered for a *leaked*
  connection rather than any open transaction, e.g. adding
  `AND state_change < now() - interval '2 seconds'` or `AND pid <> pg_backend_pid()`.
- `.jscpd.json` has `"path": ["src"]` and no test ignore, so the two new
  `*.db.test.ts` files are scanned, while ER9 allows only +2 clones (19 → 21).
  The spec tells the implementer to mirror the mocks and the fixture shape of
  `spotifyPlaylistRouteAuthz.db.test.ts`, which is a duplication risk at
  `minLines: 8` / `minTokens: 50`. Worth saying explicitly in Approach §9 that
  shared fixture setup goes into `src/lib/__tests__/test-helpers.ts` (already
  whitelisted in ER13).
- Approach §9's mock snippet `withTransaction: async (fn) => fn({ query })`
  does not typecheck under the repo's strict `tsconfig` — `fn` is an implicit
  `any` — and ER9 requires `npx tsc --noEmit` to exit 0 and print nothing. Give
  the annotated form in the spec.
- ER7 says the test asserts "the mocked `query` is called exactly twice", but
  after the rewrite `ensureInRepertoire` calls `db.query` where `db` defaults to
  the module's `pool`; the exported `query` helper is called zero times. Word it
  as "the mocked pool's `query`" so QA inspects the right spy.
- ER3 and ER4 combine "at least" with an exact vitest literal ("at least
  `Tests  6 passed (6)`"). If the file ends up with seven tests, the quoted line
  never appears verbatim. Prefer "the `Tests` line shows at least 6 passed, 0
  failed, 0 skipped".
- ER3 describes all four tests as "each injecting the failure with a `BEFORE
  UPDATE` trigger", but (d) injects nothing — it reads the aftermath of
  (a)–(c). Minor wording, but it is the kind of thing a QA run will trip on.
- `src/lib/__tests__/spotify.test.ts` is a real-database suite that drives both
  `sync/route.ts` and `import/route.ts` and is *not* on ER13's whitelist. I
  checked its assertions: they are outcome-based (repertoire rows via the
  Supabase admin client, response bodies), so the set-based `ensureInRepertoire`
  and the wrapped resync should leave it green. Worth a sentence in Approach §9
  so the implementer does not discover it during ER8 and reach for a whitelist
  violation.
- ER5's `Migration successful` / probe-database recipe aside (see blocking
  finding 2), the whole probe sequence works verbatim — no other change needed
  there.

## [RH-36] Introduzir helper de transacao real e tornar escritas multi-statement atomicas — 2026-09-07 (spec review 2)


- The renumber `UPDATE` in `0007` is safe only because the planner happens to
  drive the join from the `renumbered` CTE, whose window function forces a sort
  by `(playlist_id, position, id)` — so rows move to lower positions in ascending
  order and each target slot is already vacated. Postgres does raise
  `23505` mid-statement for multi-row updates in the wrong order; I confirmed
  that on this engine (`UPDATE ps2 SET position = position + 1` on a table with
  `UNIQUE (playlist_id, position)` fails with `duplicate key ... Key
  (playlist_id, "position")=(1, 2) already exists`). The first application is
  never at risk (the constraint does not exist yet), and the ER5 re-apply worked
  in every arrangement I could produce, but the migration would be robust to any
  plan if the renumber went through a temporary non-colliding offset (for
  example set `position = -rn` first, then `position = -position`), or if it
  restricted itself to playlists that actually need renumbering.
- ER5's re-apply step runs against the shared test database and will silently
  renumber whatever gapped playlists earlier ER runs left behind (ER6(a)
  deliberately leaves 2, 3, 4). Harmless — later runs build fresh fixtures — but
  worth a sentence in ER5 so a QA agent does not read the mutation as a defect.
- ER3(d) asserts `idle in transaction` is 0 across the whole database. Other
  vitest workers share that database and a suite unrelated to this task could
  hold a connection in that state for a moment; scoping the count to
  `application_name` or to connections opened by this suite would make the
  assertion immune to the parallel workers the spec itself flags elsewhere.

## [RH-36] Introduzir helper de transacao real e tornar escritas multi-statement atomicas — 2026-09-07 (spec review 3)


- `vitest.config.ts` sets no `testTimeout`, so the default 5 000 ms is exactly
  the ER6(b) poll bound (50 × 100 ms). On the fixed code the poll succeeds in the
  first or second iteration, so this never bites in the green case; but if the
  poll ever does exhaust, vitest's timeout and the ER's "explicit assertion" race,
  and the readable diagnosis can lose. Giving that one test an explicit
  `{ timeout: 15000 }` (as the round-3 generator report itself suggests) would
  guarantee the assertion wins. Not required by any ER.
- Step (2) of ER6(b) starts the second `withTransaction` without awaiting it, and
  the rejection handler is only attached at the end. Vitest fails a file on an
  unhandled rejection, so the implementer should attach the
  `expect(...).rejects` handler (or a `.catch` sink) immediately at creation
  rather than after `await`ing the first transaction. I saw no unhandled
  rejection in three probe runs, so this is a robustness note, not an observed
  flake.
- Worth having the poll-exhaustion message carry the pid and the last observed
  count: a count of 0 there means the second transaction never blocked, which is
  precisely the regression step (3) exists to catch, and the message should say
  so rather than just "timed out waiting".
- Carried forward, still unaddressed and still non-blocking (round 2): ER3(d)'s
  `idle in transaction` count is database-wide and could be tripped by an
  unrelated parallel worker — the same hazard ER6(b) now carefully scopes away by
  pid. Scoping it by `application_name` would make it immune. Likewise the
  renumber `UPDATE` in migration `0007` is order-dependent on the planner driving
  the join from the `renumbered` CTE; a temporary negative-offset pass would make
  it plan-independent.

## [RH-36] Introduzir helper de transacao real e tornar escritas multi-statement atomicas — 2026-09-07 (code review 1)


1. `src/lib/db.ts:56-60` — on the path where `ROLLBACK` itself rejects, the
   comment says `release()` discards the connection, but a bare `release()`
   returns the client to the pool; node-postgres only destroys it if the client
   emitted an `error` event (usually true for a dead socket, but not guaranteed
   for every `ROLLBACK` failure). `client.release(error)` in that inner catch
   would make the intent explicit and unconditional. Non-blocking: the current
   form is what the spec asked for and the realistic failure mode does emit the
   error event.

2. `src/lib/__tests__/edge_cases.test.ts:86-88` and
   `src/lib/__tests__/errors.test.ts:136-138` — the
   `count(*) as count from playlist_songs` dispatcher branch is now unreachable,
   and with it `edge_cases.test.ts:138-141`
   (`addSongToPlaylist handles null count in playlist_songs`) no longer exercises
   anything: `mockCount` feeds only the dead branch, so the test now just asserts
   that a fully-mocked add resolves. Either delete both, or rename the test to
   what it actually covers now (the wrapped write issues its statements and
   resolves). Leaving it as-is is a small false-coverage signal for the next
   reader. Same for the `begin`/`commit`/`rollback` short-circuit at
   `edge_cases.test.ts:50-59`, which no production path can reach any more.

3. `src/lib/playlists.ts:158-171` vs `src/lib/spotifyPlaylistSync.ts:141-162` —
   the personal-owner repertoire insert is now byte-identical in both modules,
   and `ensureInRepertoire` already accepts a `Queryable`, so
   `await ensureInRepertoire(songId, { userId: playlist.user_id }, client)`
   would remove the copy. The band branch genuinely differs (band row + caller,
   versus band row + all members), so only the personal branch is reusable —
   which is why this is a suggestion rather than a finding.

4. `src/lib/__tests__/transactionAtomicity.db.test.ts:664-680` — the
   idle-in-transaction test depends on the three preceding tests having run
   (declaration order). Vitest guarantees that within a file, so it passes, but
   a one-line comment at the assertion, or triggering one failure inline, would
   make it robust against future reordering or `.only`.

5. `src/lib/__tests__/transactionAtomicity.db.test.ts:700-768` — the extra
   playlist created inside the concurrency test is deleted on the success path
   only; an early failure leaks it until the owning user is torn down. Moving
   the id into the file-level cleanup list would make the teardown
   failure-proof.

6. Observation, not a defect: on the Spotify pull, `ensureInRepertoire` runs
   outside the resync transaction, so a rolled-back re-insert still leaves the
   newly seeded repertoire rows behind. That matches the spec (only the
   destructive pair is wrapped) and is not data loss, but it is the one place
   where the pull is not end-to-end atomic; worth a line in the follow-up log if
   anyone later expects it to be.

## [RH-36] Introduzir helper de transacao real e tornar escritas multi-statement atomicas — 2026-09-07 (QA 1)


None.

## [RH-45] Mover SQL das Server Actions para src/lib e usar o pool compartilhado na rota dev — 2026-09-07 (spec review 1)


1. **ER5's import-line grep is over-specified.**
   `grep -c "^import { assertRepertoireAccess } from '@/lib/songs'" src/lib/tabs.ts`
   pins the exact import statement. Any legitimate variation (a second symbol
   imported from `@/lib/songs`, a `type` modifier, a reformat) fails it while the
   layering is still correct. `grep -c "assertRepertoireAccess.*@/lib/songs" src/lib/tabs.ts`
   would be as strong for the same purpose.

2. **ER9 asks for `listDevProfiles` to be stubbed inside the file that unit-tests
   the real `listDevProfiles`.** ER9 wants the 200 case proven "when
   `listDevProfiles` is stubbed to return that single row", while §8 wants the same
   file to unit-test row mapping, empty result and the L1 wrapper on the real
   function. That is solvable (`vi.mock` with `importOriginal`, or `vi.doMock` plus
   a dynamic import of the route), but it is an avoidable constraint: the route's
   delegation and the `{ id, email, full_name }` shape are equally provable by
   stubbing `@/lib/db` underneath. Consider relaxing ER9 to "when the data source
   `listDevProfiles` reads is stubbed to yield that single row".

3. **ER2 and the guard disagree about comments.** ER2 greps the raw file, so a
   comment in an action file that merely mentions `query(` fails ER2 while the new
   guard (which strips comments first, §7) passes. Worth one sentence in §2/§4/§5
   telling the implementer not to leave `query(` in a comment, or worth relaxing
   ER2 to match the guard.

4. **ER1's jscpd budget is tight and its percentage clause is ambiguous.** "at
   most 21 clones" is +2 over the verified baseline of 19, for a change that adds
   six near-identical lib functions and five test files — and `.jscpd.json` has
   `path: ["src"]`, so the new test suites count. §1 already tells the implementer
   how to avoid it (`runTabQuery`), but the budget deserves the same warning for
   the *test* files. Separately, "a duplication percentage below 2 %" does not say
   which of the five percentages the console table prints (css / json / tsx /
   typescript / Total); today they are 0 / 0 / 1.29 / 0.71 / 0.96, so name the
   `Total` row.

5. **ER13's `git diff --name-only 059d4c3` does not list untracked files.** A new
   file that is added but never `git add`-ed passes the blast-radius check
   silently. Pairing it with `git status --porcelain` (or requiring the work to be
   committed first) would close that hole. This weakens the gate; it does not fail
   a correct implementation.

6. **ER13's `0.1.72` pin assumes RH-45 merges before RH-46/RH-47.** As a child of
   RH-37 (part 1 of 3) that is the intended order, but the "strictly greater than
   `0.1.71-202609070848`" clause already does the work; the literal `0.1.72` prefix
   only adds a way to fail. Same for the `git diff --name-only 059d4c3` baseline if
   a sibling lands first.

7. **The rationale given for `actionSessionGuard.test.ts` is wrong (harmlessly).**
   §"Tests that break when the SQL moves" says its `@/lib/db` mock "keeps working
   unchanged: the actions now reach `query` transitively through `src/lib/*`, and
   `vi.mock('@/lib/db')` intercepts that too". In fact that suite mocks
   `getRequiredUserId` to reject *unconditionally*, so the database is never
   reached at all — the `@/lib/db` mock is a belt-and-braces assertion, not the
   mechanism. The conclusion (no functional change needed) is right; only the
   reason is.

8. **`/api/dev/profiles` has two consumers, not one.** ER9 and §6 speak only of
   "the login page". `src/app/login/page.tsx:27` **and**
   `src/components/landing/LandingPage.tsx:28` both fetch it, each with its own
   locally declared `DevProfile` interface. The payload is unchanged so neither
   needs editing (and ER13 rightly forbids touching `src/components/`), but naming
   both keeps the implementer from assuming a single call site.

9. **`src/lib/__tests__/songs.test.ts` is a real-database integration suite.** §8
   files the new `updateLyrics` (both owner branches) and `applySongLinkUpdate`
   (five cases) tests there. Those are unit-shaped tests landing in a
   `describe.skipIf(!SERVICE_ROLE_KEY)` file, which is what makes finding 2 bite on
   ER11. If the intent is unit tests, a separate ungated file would be cleaner —
   but it would need adding to the ER13 whitelist.

10. **`updateSongLinksAction`'s declared return type narrows.** Today it is
    annotated `Promise<{ success: boolean; pending?: boolean }>`; §4's snippet drops
    the annotation and §3 types `applySongLinkUpdate` as
    `Promise<{ success: true; pending?: true }>`. The narrowing is assignable so
    `tsc` stays green and no caller breaks, but the spec claims "does not change
    any action signature" — either keep the existing annotation on the action or
    say the narrowing is intended.

## [RH-45] Mover SQL das Server Actions para src/lib e usar o pool compartilhado na rota dev — 2026-09-07 (spec review 2)


- ER1's per-file eslint list is now load-bearing for the pin. If a later task in
  the RH-37 series changes lint output in any of those 13 files, this spec's pin
  goes stale silently. A one-line note in the Post-merge checks section telling
  the orchestrator to re-measure `npx eslint .` before starting RH-46/RH-47
  would keep the sibling specs from inheriting a stale baseline.
- ER8's phrase "without their assertions being weakened" is the only expected
  result in the set that needs a human diff read rather than a command. It is
  well scoped (three named existing cases in two named files), but stating it as
  "`git diff 059d4c3 -- src/app/actions/__tests__/authzRepertoire.db.test.ts
  src/app/actions/__tests__/authzPlaylists.db.test.ts` prints nothing" would
  make it purely mechanical, if the implementation really does leave both files
  untouched — note that neither file is in the ER13 whitelist today, which
  suggests it does.
- Approach 1's jscpd contingency ("factor the wrapper into one local
  `runTabQuery` helper") is good, but ER1 pins "at most 21 clones" without
  saying what the baseline clone count is. Quoting the baseline number the way
  the eslint pin now quotes its baseline would let a verifier tell a genuine
  regression from headroom being consumed.

## [RH-45] Mover SQL das Server Actions para src/lib e usar o pool compartilhado na rota dev — 2026-09-07 (code review 1)


1. `src/lib/tabs.ts:30` — `return await query(sql, params as never)`. `params` is
   declared `unknown[]` and then cast through `never` to satisfy `query`'s
   `any[]`. `never` is the widest possible lie here; `params: unknown[]` +
   `params as unknown[] as any[]` is no better, so consider just typing the
   helper parameter as the same `any[]` the module boundary already uses (with
   the existing `eslint-disable-next-line @typescript-eslint/no-explicit-any`
   pattern from `src/lib/db.ts:22`), or waiting for RH-40's typed helper. Purely
   cosmetic — no runtime effect.
2. `src/lib/songs.ts:449-457` and `src/lib/songs.ts:486-495` — `applySongLinkUpdate`
   carries two byte-identical `catch` blocks (`Failed to update song links`).
   They cannot be merged into one `try` without pulling `submitGlobalSongEdit`
   inside the wrapper (which would break L1a), but a two-line local
   `wrapLinkFailure(error): never` would state the message once. jscpd does not
   flag it at the current min-token setting.
3. `src/app/actions/__tests__/actionDataAccessGuard.test.ts:33` — `NEW_CLIENT`
   is `/new Client\s*\(/`. It does not match `new pg.Client(`, `new  Client(`
   (two spaces) or a namespaced re-export. `new\s+(?:\w+\.)?Client\s*\(` closes
   those without weakening the concatenation trick that keeps the guard from
   flagging itself.
4. `src/lib/playlists.ts:302-305` — `getPlaylistDetailsWithEntries` gained an L1
   wrapper (`Failed to fetch playlist details: <driver text>`) that the baseline
   action did not have. This is correct per the `src/lib` convention and the
   spec's Approach 5 implies it, but the spec's Approach 1 claims the tab
   envelopes carry "the only user-visible text change in this task". Two further
   text deltas exist for the same (good) reason: `Failed to update lyrics:` and
   `Failed to fetch personal entry for song:`. Worth one line in the changelog /
   post-merge note so the claim in the spec is not carried forward verbatim. No
   caller matches on any of these strings (`grep` over `src/**` outside tests
   finds no comparison against them), and `getPersonalEntryForSongAction` still
   swallows everything into `null`, so nothing user-facing regresses.


## [RH-45] Mover SQL das Server Actions para src/lib e usar o pool compartilhado na rota dev — 2026-09-07 (QA 1)


- `npx next build` emits eight
  `[Error [BetterAuthError]: You are using the default secret. Please set BETTER_AUTH_SECRET ...]`
  lines during prerender. This is a pre-existing local-environment artifact: Next
  loads `.env.production.local` ahead of `.env.local` for a production build, and
  the secret is only set in the latter. It is unrelated to this change (no
  auth-related file appears in `git diff --name-only 059d4c3`) and the build still
  exits 0. Worth setting `BETTER_AUTH_SECRET` in `.env.production.local` so
  future ER12-style checks read cleanly.
- `vitest` prints a Vite config-loader deprecation warning on every run
  (`ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1)`). Pre-existing
  and out of this task's whitelist (`vitest.config.ts` must not be touched here),
  but a candidate for a future chore.


## [RH-46] Inverter TabDrawingStage e AppLayout para receber dados por props — 2026-09-07 (spec review 1)


- ER4's `--include=*.tsx --include=*.ts` are unquoted globs. Under `zsh` — this repo's
  interactive shell — the command aborts with `no matches found: --include=*.tsx` before
  `grep` ever runs. Under `sh`/`bash` with default `nullglob` off it works, so QA is
  probably fine, but quoting them (`--include='*.tsx'`) removes the shell dependency for
  free while ER4 is being rewritten anyway.
- ER5's tests 3 and 4 wait on an 800 ms real-timer debounce, and Testing Library's
  `waitFor` defaults to a 1000 ms timeout — a 200 ms margin on a loaded CI box. Have the
  spec call for `waitFor(..., { timeout: 2000 })` (or fake timers) so ER5 does not become
  an intermittent failure.
- ER5's sixth clause says the test asserts "`1` and the remaining strokes after
  `unmount()`". "The remaining strokes" has no antecedent inside ER5 — QA sees only the
  ERs, not the Approach's fixture. Spell it out the way the third clause does ("an array
  holding exactly the first of the two stroke objects passed in through `annotations`").
- ER7 leans on `grep -c "vi.mock"` without pinning the counts. State them (2 for the stage
  suite, 3 for the layout suite); it costs a word and makes the check decidable without the
  follow-up manual read.
- `AppShell`'s `getBandsAction().then(...)` has no `.catch()`. This matches today's
  `ContextSwitcher` behaviour so it is not a regression, but a client session that has
  outlived its server session now produces an unhandled rejection from a *new* file. A
  one-line `.catch(() => {})` (or a comment saying it is deliberate) would keep the new
  code from inheriting the old smell.
- After the rewrite, `saveState` can never be `'loading'` (initial is `'saved'` and nothing
  assigns `'loading'`), so the `saveState === 'loading' ? 'Loading…'` arm of the existing
  ternary at `TabDrawingStage.tsx:541` becomes dead, and `'loading'` becomes a dead member
  of the `SaveState` union. Neither `tsc` nor eslint will complain; worth telling the
  implementer to drop both rather than leave a misleading union.
- `annotationsRef.current = annotations` followed by `annotationsRef.current[page] = next`
  mutates, in place, the object the fast-view page holds in `stageAnnotations.data` state.
  Behaviourally identical to today (nothing re-reads it, and the identity is stable so the
  seeding effect will not re-fire), but a shallow copy in the seeding effect would make the
  ownership honest for the same cost.
- Post-merge note for the orchestrator, already anticipated by the spec: whatever ER4
  becomes must be carried into RH-47's dispatch prompt, since `src/app/bands/page.tsx` will
  still hold a `getBandsAction` import after RH-47 too — that page is App Router code and
  is *supposed* to import an action.

## [RH-46] Inverter TabDrawingStage e AppLayout para receber dados por props — 2026-09-07 (spec review 2)


- ER4 pipes through `sort` and then lists the three paths in C-collation order
  (`AppShell.tsx` before `actions/bands.ts`, because uppercase `A` sorts before lowercase
  `a`). This environment has `LC_COLLATE=C`, so the listed order is what QA will see here,
  but under a UTF-8 locale `sort` collates case-insensitively and would put
  `src/app/actions/bands.ts` first. ER2 defuses the same hazard with an explicit
  "(order is not significant)"; ER4 could either borrow that parenthetical or pin
  `LC_ALL=C sort`. Not blocking — "prints exactly these three paths and nothing else"
  reads as a set assertion, and the set is order-independent.
- `grep -c` counts matching *lines*, not occurrences, so the expected `2` for
  `src/app/AppShell.tsx` is really a claim about the shape in Approach §2 (single-line
  import plus one call) rather than about a property of the file. It holds for the code
  block as written; an implementer who split the import across lines would still get `2`,
  but one who added a second call site would fail a check that is not really about call
  sites. Consider phrasing it as "at least 1, and the only two mentions are the import and
  the fetch call" if the exactness ever bites.
- ER4 establishes `AppLayout.tsx`'s absence only negatively, via the `-rl` path list. An
  explicit `grep -c "getBandsAction" src/components/layout/AppLayout.tsx` exiting 1 would
  state the task's central outcome directly rather than by omission. Redundant with ER2's
  `@/app/` grep, so purely cosmetic.

## [RH-46] Inverter TabDrawingStage e AppLayout para receber dados por props — 2026-09-07 (code review 1)


1. **`SaveState`'s `'loading'` member is now dead.**
   `src/components/tabs/TabDrawingStage.tsx:34` still declares
   `type SaveState = 'loading' | 'saving' | 'saved' | 'error'`, but no site calls
   `setSaveState('loading')` any more — loading is now expressed by the derived
   `annotationsLoaded`. That leaves the `saveState === 'loading' ? 'Loading…'` arm of the
   `saveLabel` ternary at `src/components/tabs/TabDrawingStage.tsx:539` unreachable.
   Dropping the union member and that arm would shorten an already-long ternary. Left as a
   suggestion because removing it edits a line the eslint baseline is pinned against and
   the gain is cosmetic.

2. **The child mutates an object the parent holds in state.**
   `src/components/tabs/TabDrawingStage.tsx:138` assigns the `annotations` prop object
   itself into `annotationsRef.current`, and the stroke mutators then write
   `annotationsRef.current[String(pageNumber)] = next` (L301, L315, L325) — which mutates
   `stageAnnotations.data` inside the parent's state object in place. It is not a bug
   today (the parent only ever reads `data` to pass it back down, and identity never
   changes, so nothing re-renders off it), and the pre-image had the same aliasing
   locally. But a future parent that memoises or diffs on `data` would silently see
   mutated state. A shallow copy — `annotationsRef.current = { ...annotations }` — would
   cost nothing and close it.

3. **`bands` is not cleared when the session ends.**
   `src/app/AppShell.tsx:35` returns early when `userId` is null without resetting the
   `bands` state, so the previous user's band list survives a sign-out in memory until the
   next user's fetch resolves. It is not observable — `AppLayout.tsx:156` renders only
   children when there is no session, and `ContextSwitcher` is not mounted — and the old
   mount-once effect was strictly worse here. Still, `else setBands([])` would make the
   invariant local rather than depending on a guard two components away.

4. **`stageAnnotations` is never cleared when Stage Mode closes.**
   `src/app/songs/[id]/fast-view/page.tsx:258` keeps the payload after
   `closePdfStageMode`, so reopening the *same* tab renders the previous payload
   immediately rather than the loading state (the spec's prose at L366-368 claims null for
   "the same tab after a close"). The observable result is better than the spec describes —
   the user sees their own strokes instantly instead of a flash of "Loading…", and the
   refetch still lands — so I would not change it, but the comment at L255-257 slightly
   oversells the invariant and could say "a payload from a *different* tab can never be
   shown".

5. **Test-name precision.** `renders the page toolbar from props alone, with no annotation
   fetch` (`src/components/tabs/__tests__/TabDrawingStage.test.tsx:83`) does not assert the
   absence of a fetch; the absence is structural (no action module is imported, and a real
   one would throw under jsdom). The ER pins this name verbatim so it should stay, but the
   guarantee is worth a one-line comment in the test body for the next reader.

6. **No test covers the band-context reconciliation now in `AppShell`.** The spec scopes
   this out with a defensible rationale (verbatim move, outside the coverage universe,
   equally untested inside `ContextSwitcher` before, covered end to end by
   `e2e/ssr-smoke.spec.ts`), and I accept it. Noting it only because that reconciliation is
   the one piece of real logic in the new file, and it would be cheap to pin once
   `AppShell` ever grows a second concern.

## [RH-46] Inverter TabDrawingStage e AppLayout para receber dados por props — 2026-09-07 (QA 1)


None.


## [RH-47] Inverter SongForm, CorrectionModal e useBandAdmin e proibir @/app/* no ESLint — 2026-09-07 (spec review 1)


1. **ER10's quoted baseline is off by a digit on functions and wrong on lines.**
   The ER says "the baseline at `51151d7` was 98.55 / 78.08 / 94.74 / 98.55". The
   actual `npm run test:coverage` text-table row at `51151d7` is
   `useBandAdmin.ts | 98.55 | 78.08 | 94.73 | 99.23` — functions is 94.73, not
   94.74, and lines is 99.23, not 98.55 (the spec appears to have repeated the
   statements figure for lines). This is not blocking: ER10's operative assertion
   is the floor set (≥95 / ≥75 / ≥90 / ≥95), which the true numbers clear
   comfortably, and the ER explicitly frames the quoted figures as context ("so
   this is a floor, not a target"). Correct them anyway so a later task does not
   inherit a wrong baseline.
2. **ER11 states no web-server or build precondition, unlike ER9 and ER10.** The
   Playwright config defaults `webServer.command` to `npm run dev`. ER9 and ER10
   spell out their Postgres and `SUPABASE_SERVICE_ROLE_KEY` preconditions; ER11
   should say the same for its own — a running Postgres, `.env.local` loaded, and
   either `npm run dev` or `PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H
   127.0.0.1"` after `npx next build`. Without it, QA on a cold machine may read a
   web-server timeout as a task failure.
3. **The Approach's rationale for not exporting `SongFormCreateInput` /
   `SongFormEditInput` is stale.** It says "knip reports unused exports", but
   `knip.json` sets `"ignoreExportsUsedInFile": true`, so an export consumed by
   `SongFormActions` in the same file would not be flagged. The decision to keep
   them module-private is still fine; only the stated reason is wrong. Harmless,
   but it is the kind of half-true constraint that gets copied into the next spec.
4. **Consider naming the exported type import in Approach 4.** `SongForm.tsx`
   currently does `import { CorrectionModal } from "./CorrectionModal"`, and
   Approach 4 relies on `CorrectionModalProps["onSubmitCorrection"]`. The spec says
   the type "must therefore be exported" but never shows the import line changing.
   `tsc` will catch it immediately, so this costs one round trip at most.
5. **`docs/plans/code-quality-review.md` is deliberately absent from ER12's
   whitelist**, and the F21 close-out is correctly deferred to the "Post-merge
   checks (orchestrator)" section. Flagging only so the implementer does not
   helpfully update the review document and trip ER12's exact-subset assertion.


## [RH-47] Inverter SongForm, CorrectionModal e useBandAdmin e proibir @/app/* no ESLint — 2026-09-07 (spec review 2)


1. **ER11 still states no build/web-server precondition, unlike ER9 and ER10.** Both
   playwright clauses need whatever `playwright.config.ts` starts (and `ssr-smoke` needs a
   build to exist), while ER9 and ER10 spell their preconditions out. Carried over from
   round 1, still non-blocking: an implementer who cannot start the server sees a hard
   failure, not a false pass.
2. **ER10's quoted baseline still reads `98.55 / 78.08 / 94.74 / 98.55`** while the audit
   at L192-L194 derives only three ratios (statements 136/138, branches 57/73, functions
   18/19). The fourth figure is inferred rather than measured. Harmless, because ER10's
   actual gate is the floor (95 / 75 / 90 / 95), not the quoted baseline - but the prose
   presents a derived number as an observed one.
3. **ER4's phrasing "`grep -c "=> Promise<" ...` counts at least 8 members"** conflates a
   line count with a member count. The check is still decidable (the printed number must
   be >= 8), so this is wording, not a gate defect.
4. **RH-44 has now forced two specs in this decomposition to route around
   `e2e/songs-crud.spec.ts`.** Whoever picks it up should start at `e2e/helpers.ts` (the
   dialog-closed wait at L57 and the song-list visibility wait at L27) rather than the
   three test bodies; one helper fix plausibly turns all three green.
5. **The `git status --porcelain` scoping trap is generic to this repo.** QA runs before
   the commit, so any spec asserting "the tree is clean" trips over the task's own
   untracked spec file and the modified suggestions log. Worth one line in AGENTS.md under
   Testing & quality - deliberately not added here, since ER12 pins this task's AGENTS.md
   footprint to exactly one bullet.

## [RH-47] Inverter SongForm, CorrectionModal e useBandAdmin e proibir @/app/* no ESLint — 2026-09-07 (code review 1)


1. **The `grep -n "vi.mock"` ER shaped the test file.** ER8 counts `vi.mock` as a bare substring, which also matches `vi.mocked(...)`, so a perfectly good typed idiom had to be swapped for `as unknown as Mock` aliases to make the count come out right. Harmless here, but future specs should write the pattern as `grep -c "vi\.mock("` (or `^vi\.mock`) so the ER measures module mocks rather than incidental substrings, and the test author is free to use `vi.mocked`.
2. **`src/store/repertoireStore.ts` still imports `@/app/actions/repertoire`.** `SongForm` no longer imports the App Router tree directly, but it still reaches it transitively through `useRepertoireStore().loadSongs`. The spec is explicit that `src/store` is out of the rule's `files` list and that inverting a store four pages share is a different change; worth carrying forward as a follow-up rather than losing, since F21's spirit is not fully satisfied while that edge exists.
3. **The rule does not cover relative escapes.** `no-restricted-imports` `patterns` only matches the `@/app/*` alias form; `import { x } from "../../app/actions/bands"` inside `src/lib` would pass. I verified none exists today, so this is hardening, not a gap. If it is ever added, `["**/app/actions/**", "**/app/api/**"]` as an extra group would cover it without touching the existing entry.
4. **`CorrectionModal`'s labels have no `htmlFor` and do not wrap their inputs.** That is what forced the new suite onto `getByDisplayValue` instead of `getByLabelText`, and it is a real accessibility gap for screen-reader users, not just a test inconvenience. Pre-existing and correctly out of scope here, but a small, contained fix worth logging.

## [RH-47] Inverter SongForm, CorrectionModal e useBandAdmin e proibir @/app/* no ESLint — 2026-09-07 (QA 1)


- ER3's tamper check is worded for a merge commit (`git status --porcelain -- src`
  "prints nothing"). When the change under review is staged rather than
  committed, that command necessarily lists the task's own staged files. A
  future ER of this shape would be sharper as
  `git status --porcelain -- src | grep rh47RuleProbe` printing nothing, which
  states the actual property (no probe trace) independently of whether the change
  is committed.
- `src/app/profile/page.tsx` still carries the pre-existing
  `react-hooks/set-state-in-effect` error at line 672. Out of scope for RH-47 and
  correctly left alone, but it is the only lint error in this task's file set and
  is worth its own task eventually.


## [RH-37] Mover acesso a dados das Server Actions para src/lib — 2026-09-07 (spec review 2, integration spec)


- ER8 refers to the AGENTS.md paragraph as `` `A2 - thin Server Actions` `` with
  a hyphen, but the file writes `**A2 — thin Server Actions.**` with an em dash.
  A QA agent grepping the backticked string literally finds nothing. Quoting a
  dash-free substring (`thin Server Actions`) would make that clause
  grep-checkable as written. Not blocking: the load-bearing part of ER8 is the
  whitelist diff, and the paragraph is trivially findable by name.
- The spec's State section says `checkAccess` is called at L39, L91, L128 and
  L149 at `13da8b2`; there is a fifth call at L180. Spec-internal prose only -
  the line actually appended to the review document does not repeat the call
  sites, so nothing shipped is wrong.
- ER7 does not state its preconditions the way ER3 and ER4 do. The playwright
  config auto-starts `npm run dev` on 127.0.0.1:3000 and `e2e/global-setup.ts`
  builds an authenticated session, so a QA run on a machine with something else
  on port 3000, or without the database, could go red for reasons outside the
  task. A one-clause precondition note would remove that ambiguity.
- ER6's `6	0` assumes each appended line stays a single physical line. The
  Approach says so explicitly and ER6 would catch a hard-wrapped edit, so this
  is only a note for the implementer: do not let an editor reflow those four
  blocks.

## [RH-37] Mover acesso a dados das Server Actions para src/lib — 2026-09-07 (code review 1)


1. Non-blocking, and explicitly out of scope for this task: section 2.5's M4
   result line (`docs/plans/code-quality-review.md:201`, "two, at ...") still
   states the undercount, and a reader who stops at section 2.5 will not see the
   correction that lives in F21 at L410. The spec deliberately freezes section 2
   as a dated measurement, which I agree with, so this is not a change to make
   here. If a future document sweep happens, a one-line pointer from L201 to the
   F21 correction would close the loop without rewriting the measurement. The
   spec's own "Post-merge checks" already carries the durable half of this lesson
   (grep both quote styles next time).
2. Non-blocking: the F8 correction attributes the `checkAccess` ->
   `assertRepertoireAccess` replacement to RH-34. I verified the end state at
   `059d4c3` but not the specific commit that performed it. If cheap, confirming
   that id would make the correction fully self-verifying like the rest of the
   line; if not, the sentence is still true with the task id dropped.


## [RH-37] Mover acesso a dados das Server Actions para src/lib — 2026-09-07 (QA 1)


None. The change is documentation-only and every gate reproduces the `201a090`
baseline exactly.


## [RH-48] Fast View parte 1/5: extrair navegacao de playlist e UI de setlist — 2026-09-07 (spec review 1)


1. **ER5's `export async function` count is stated relative to the baseline** ("prints
   exactly one less than it printed at `c8665cd`"). It is verifiable (`git show
   c8665cd:src/app/actions/playlists.ts | grep -c …`), but the absolute number is known
   today: the file has **9** exported async functions, so the ER can simply say `8`.
   Same for ER6's complexity clause, which already pins its absolute bound correctly.
2. **ER10 and the coverage table's name truncation.** The v8 text reporter caps the File
   column at ~15 characters (`spotifyPlaylistSync.ts` currently renders as
   `...aylistSync.ts`). `playlistNav.ts` (14 chars) will render in full, but
   `usePlaylistNav.ts` is 17 characters and will render truncated — a QA grepping the
   table for the literal string `usePlaylistNav.ts` finds nothing. Either note the
   truncated form in the ER or assert against
   `npx vitest run --coverage --coverage.reporter=json-summary` (or `text` scoped with
   `--coverage.include`), which prints untruncated paths.
3. **ER7's jscpd bound is correct but tight.** 19 clones today, one of them inside the
   page, and the extraction genuinely removes that pair (the drawer and sidebar rows both
   become `SetlistRow` via `SetlistPanel`), so 18 is reachable. But jscpd runs over `src`
   including `__tests__` at `minLines: 8` / `minTokens: 50`, and this task adds six new
   test files whose fixtures (the entries array + the `PlaylistNav` object) are the exact
   shape that trips it. Worth one sentence in the Approach telling the implementer to
   share those fixtures rather than copy them, so the ER is not failed by test setup.
   The "no reported clone whose two locations are both inside the page" half of the ER is
   the substantive check and is well drafted.
4. **ER11 writes the route marker as `f`**; `npx next build` prints `ƒ` (U+0192). The spec
   body gets this right. Use the same glyph in the ER, or say "marked Dynamic
   (server-rendered on demand)".
5. **ER12's whitelist lists `.meridian/tasks.json`, which is gitignored** (`.gitignore:55`
   is `.meridian/`), so it can never appear in `git diff --name-only`. Harmless in a
   whitelist, but it invites the reader to think the task writes it. `AGENTS.md` is in the
   same position: the Approach never edits it, and the Directory Structure block already
   omits `src/components/tabs/`, `bands/` and `landing/`, so adding
   `src/components/fastview/` without touching AGENTS.md is consistent with current
   practice. Either drop both entries or say explicitly that AGENTS.md may optionally gain
   the new directory row.
6. **ER4 names one assertion without naming its test** ("a `SetlistPill` test asserting the
   rendered label text matches `Setlist \(\d+/\d+\)`"). Every other assertion in ER2-ER4 is
   anchored to an exact test name; giving this one a name too would keep the whole gate
   greppable.
7. **The `navigate` / `navigateBack` identity is unspecified.** Approach §5 passes fresh
   arrow functions (`navigate: (href) => router.push(href)`) into `usePlaylistNav`, while §3
   is explicit about why the *actions* object is module-level. `react-hooks/exhaustive-deps`
   is on (via `eslint-config-next/core-web-vitals`) and ER6 requires the hook to lint
   completely silently, so the hook must keep those callbacks out of its effect deps (a ref,
   as `useBandAdmin` does). One line in §2 would remove the ambiguity.
8. The spec says `grep -rn "getPlaylistEntryIdsAction" src` "returns five hits"; the raw
   grep returns eight lines across five locations. Cosmetic, and ER5 asserts the
   post-condition (`prints nothing`, exit 1) correctly.


## [RH-48] Fast View parte 1/5: extrair navegacao de playlist e UI de setlist — 2026-09-07 (spec review 2)


- `src/components/fastview/SetlistPanel.tsx` is the only one of the eleven new files with no dedicated test file in ER4; it is guarded solely by ER10's aggregate coverage floors. A short `SetlistPanel.test.tsx` would make the shared header/scroll-container extraction — which is half the point of removing the jscpd clone — explicit rather than incidental.
- ER5's `grep -c "mode: '"` is coupled to the single-quote formatting convention in `actionSessionGuard.test.ts`. It holds for all 45 entries today, but a future reformat to double quotes would silently break the assertion rather than fail loudly. Worth a one-line note in the spec body so a later round does not have to rediscover why the quote is in the pattern.
- ER7's parenthetical "(its line number shifts, because the page gains net new import lines above it)" is an explanation, not an assertion, and the enumerated rule + function name already pins the finding. Softening it to "its line number may shift" would avoid the parenthetical reading as wrong in the unlikely case the import edits net to zero lines, without weakening the gate.
- The post-merge checks section is well aimed; consider also recording the post-RH-48 `grep -c "mode: '"` value in the RH-38 tracking notes, since RH-49..RH-52 have no further action deletions and any drift there would signal an out-of-scope edit.

## [RH-48] Fast View parte 1/5: extrair navegacao de playlist e UI de setlist — 2026-09-07 (code review 1)


### S1 — the drawer no longer closes when you tap the current ("▶ NOW") row

`src/components/fastview/SetlistRow.tsx:34-36` fires `onSelect` only when
`!isCurrent`, and `src/components/fastview/SetlistDrawer.tsx:48-51` puts
`onClose()` *inside* that `onSelect` wrapper. The pre-RH-48 page did the
opposite: the row's `onClick` called `setIsDrawerOpen(false)` unconditionally and
only then guarded the navigation on `!isCurrent`
(`page.tsx@c8665cd:713-722`). So on mobile, tapping the highlighted current song
in the bottom sheet used to dismiss the sheet and now does nothing; the reader
must use ✕ or the backdrop.

This is exactly what the spec asks for (§4: `SetlistRow` "Calls
`onSelect(entry.repertoireId)` only when `!isCurrent`"; `SetlistDrawer` "A row
click calls `onClose()` and then `onSelect(id)`"), so it is not a defect against
the specification and I am not blocking on it. If the intent was pure behaviour
preservation, the minimal fix is to give the drawer's `SetlistPanel` a row-level
close — e.g. have `SetlistRow` always invoke a callback and let the drawer decide
— rather than routing the close through the `!isCurrent`-guarded `onSelect`.
`SetlistDrawer.test.tsx` currently has no test for clicking the current row, so
either behaviour would pass today.

### S2 — the setlist fetch is now unconditional, where it used to depend on the song load

At `c8665cd` the playlist fetch lived inside `load()`, in the `else` branch of
`if (!data)`: no song entry, no nav request. `usePlaylistNav`'s effect
(`src/hooks/usePlaylistNav.ts:80-100`) now runs in parallel with the entry load
and independently of its outcome. The consequences are benign and arguably
better — the nav resolves sooner, and on a not-found song the page early-returns
before any setlist component renders (`page.tsx:343+`), so nothing extra is
shown. Recording it because it is a real difference from the removed region, not
because it needs changing.

### S3 — the `useCallback`s in the hook are defeated by the page's inline `navigate`

`page.tsx:171-172` passes `navigate: (href) => router.push(href)` and
`navigateBack: () => router.back()` as fresh closures on every render. They are
dependencies of `slideAwayTo` (`usePlaylistNav.ts:117`) and `goBack`
(`:158`), which transitively re-creates `selectEntry`, `goPrev` and `onTouchEnd`
on every render, so the memoization buys nothing today.

Importantly this is *not* a correctness problem and there is **no refetch loop**:
the load effect's dependency array is `[actions, bandId, currentRepertoireId,
returnTo]` and `actions` is the module-level `PLAYLIST_NAV_ACTIONS`
(`src/app/fastViewNavActions.ts:10-12`, the `bandAdminActions.ts` pattern
verbatim), none of which changes per render. Wrapping the two callbacks in
`useCallback` in the page — or defaulting them from a `useRouter` ref — would
make the memoization real. Non-blocking; RH-52 owns that part of the page shell.

### S4 — note for QA on ER10's per-file coverage rows

`npm run test:coverage` passes (exit 0, no threshold error) with `All files` at
statements 96.52, branches 82.07, functions 99.07, lines 96.97 — comfortably over
ER10's 95 / 78 / 97 / 95. But the text reporter in this repo only prints rows for
files below 100%, so **`playlistNav.ts` has no row at all** and ER10 cannot be
read literally off the table. Verified instead from
`coverage/coverage-final.json`: `src/lib/playlistNav.ts` is statements 100,
branches 100, functions 100, lines 100. `src/hooks/usePlaylistNav.ts` does print
a row: `98.27 | 93.75 | 100 | 100`, uncovered line 88 (the `if (cancelled)
return` guard inside the resolved fetch).

### S5 — AGENTS.md source map not extended

The tree at `AGENTS.md:126-133` lists `src/components/{layout,profile,songs,ui}`
and `src/hooks/{useToast,useBandAdmin}`; it now omits `src/components/fastview/`
and `src/hooks/usePlaylistNav.ts`. This is pre-existing drift (`src/components/
tabs/` is missing too) and ER12 does not require the edit — `AGENTS.md` is merely
*permitted* in the changed-file set. Worth two lines when RH-38 integrates the
five parts.

### S6 — pre-existing open-redirect surface, unchanged

`backTarget` (`src/lib/playlistNav.ts:134-138`) returns whatever `returnTo` the
query string carries and the page hands it straight to `router.push`. That is
byte-for-byte the pre-RH-48 behaviour, so this task introduces nothing; but now
that the decision is a named, tested pure function, a same-origin check
(`returnTo.startsWith('/') && !returnTo.startsWith('//')`) would be a two-line
addition with an obvious test. Out of scope here.


## [RH-48] Fast View parte 1/5: extrair navegacao de playlist e UI de setlist — 2026-09-07 (QA 1)


- ER4's per-file minimums are met exactly at the floor for three of the four component test files (SetlistRow 5/5, SetlistDrawer 5/5, SetlistControls 10/10) and the total is exactly 24/24. Any future test removal in `src/components/fastview/__tests__/` drops below the contract with no margin; worth keeping in mind if these files are refactored.
- `npm run lint:dup` reports exactly 18 clones against a ceiling of 18, and the `All files` branch coverage is 82.07 % against a floor of 78 %. Both are comfortable but the clone count in particular has zero headroom.
- `src/app/songs/[id]/fast-view/page.tsx` still carries a `prefer-const` error, a `no-explicit-any` error and two `no-unused-vars` warnings (`uploadDestination`, `setUploadDestination`). These are pre-existing and explicitly permitted by ER7, but the unused upload-destination state pair looks like genuinely dead code that could be dropped in a follow-up.


## [RH-49] Fast View parte 2/5: extrair biblioteca de tabs, tab ativa e upload — 2026-09-07 (spec review 1)


- **S1 — ER7's duplication bound has zero margin.** `Found 18 clones.` / 230 lines / 0.82% is exactly today's measurement, and the task adds six components with near-identical Tailwind blocks (the two destination buttons) plus five test files with the usual `// @vitest-environment jsdom` + `afterEach(cleanup)` + render-helper boilerplate. A single new clone that represents no real regression would fail the ER. Consider `N` at most 19 and at most 0.90%.
- **S2 — ER5 omits `activeTabTitle` from the stage-contract grep.** The "Boundary with RH-50" contract names four bindings and the still-inline overlay header reads `activeTabTitle` (page line 1332), but ER5 only greps `activeTabId\|activeTabRepertoireId\|activeTabUrl`. Add the fourth name so QA verifies the whole contract.
- **S3 — ER12's whitelist lists `AGENTS.md`, which the Approach never edits.** Nothing in sections 1-6 touches it; drop it to keep the closed set tight. `.meridian/tasks.json`, `docs/tasks/RH-49-spec.md` and `docs/suggestions-log.md` are legitimately in the set (task state, the spec itself, the two preserved warts the Out of Scope section defers there).
- **S4 — `wc -l <file>` prints `N <path>`, not a bare number.** ER6 says the command "prints a number strictly less than 400" / "prints a number strictly less than 1150"; phrase it as the first field of the output so a literal reading cannot fail.
- **S5 — section 5 could say explicitly that `addSongAction` stays imported.** It is still used by `handleSaveLyrics` (page line 474) after `triggerUpload` is deleted; an implementer following "line 9 becomes …, drop `RepertoireTab` if unused" might prune it too and break the lyrics save.
- **S6 — the delete-button active-tab clear changes its key.** Today the row clears the active tab when `activeTabUrl === tab.file_url` (page lines 834-841); the hook's `requestDelete` clears it when `activeTabId === tabId`. Equivalent except when two rows share a `file_url`. Worth one sentence in §2 so it reads as deliberate.
- **S7 — page bounds are well justified.** The removed regions add up to roughly 380 lines against roughly 15 added, matching the probe's 1063 lines against the `< 1150` bound; the removed page-body decision points (the `tabsOrigin` ternary, the list/skeleton/empty chain, the viewer `&&`, the modal `&&`, the `ConfirmPanel` message ternary) are consistent with 76 → 67 against the `<= 69` bound. No change needed.

## [RH-49] Fast View parte 2/5: extrair biblioteca de tabs, tab ativa e upload — 2026-09-07 (spec review 2)


- ER2 carries the same comment-trap shape one step removed: it requires
  `grep -rn "application/pdf\|Only PDF files are allowed" src/lib/tabLibrary.ts
  src/hooks/useTabLibrary.ts` to print nothing, while section 1 spends a paragraph
  explaining why no client type check exists — a natural thing for an implementer to
  restate as a comment next to `validateTabFile`, which would fail the grep. Worth an
  explicit "not even in a comment; keep the rationale in the spec" note next to the helper.
- ER9's floor of "at least 843 tests passed" is one below the 791 + 53 = 844 the spec's own
  arithmetic predicts. Harmless slack, but 844 would catch a silently dropped test.
- ER1 checks `grep -c "@/lib/tabLibrary"` only on `TabLibrarySection.tsx`. `TabList.tsx`,
  `TabViewer.tsx`, `TabUploadForm.tsx`, `TabDestinationModal.tsx` and `TabDeleteConfirm.tsx`
  also consume `MergedTab` / `TabOrigin` from the lib; extending that grep to the directory
  would pin the whole component layer's type source rather than one file's.
- The section 4 table cites absolute line numbers from the `a49a295` page (764-854, 857-891,
  908-956, 1355-1403). They are correct today and the task is pinned to that baseline, so
  this is only a durability note: quoting an anchor string alongside each range would keep
  the table readable if the baseline ever moves.

## [RH-49] Fast View parte 2/5: extrair biblioteca de tabs, tab ativa e upload — 2026-09-07 (spec review 3)


- Approach section 6 does not say how `src/hooks/__tests__/useTabLibrary.test.tsx`
  imports the hook, and the closest precedent points the other way: the RH-48
  model file `src/hooks/__tests__/usePlaylistNav.test.tsx` imports its hook
  relatively (`from '../usePlaylistNav'`). An implementer following that sibling
  convention would produce a correct test that nonetheless fails ER1's first
  grep, since only two of the three paths would match. ER1 is normative and
  enumerates the test file, so this is not ambiguous, but one clause in section 6
  ("the test imports the hook as `from '@/hooks/useTabLibrary'`, not relatively,
  so it satisfies ER1") would remove the trap entirely.
- Approach sections 1 and 4 say "mentioning the name `useTabLibrary` in a comment
  is not restricted; only the import is". That is true of grep 1 but not of grep
  2, which matches the bare path `@/hooks/useTabLibrary` anywhere under
  `src/components` or `src/lib`, comments included. Narrowing the wording to "the
  identifier `useTabLibrary`, never the module path" would keep the two sections
  and ER1 in exact agreement.

## [RH-49] Fast View parte 2/5: extrair biblioteca de tabs, tab ativa e upload — 2026-09-07 (code review 1)


1. `src/hooks/useTabLibrary.ts:94` — `.catch(onError)` is outside the `cancelled` guard, so
   a personal-tabs rejection that lands after unmount still logs. This matches the previous
   page behaviour exactly (the old `catch` also logged regardless of `cancelled`), so it is
   correctly *preserved*; worth tightening whenever RH-52 revisits the load path.
2. `src/app/songs/[id]/fast-view/page.tsx:114` — `PendingDelete` is now a one-member union
   and its `kind: 'link'` discriminant is written but never read. The spec prescribes this
   shape and RH-52 will likely re-widen it, so leaving it is defensible; if RH-52 ends up
   not adding a second arm, drop the field.
3. `src/hooks/useTabLibrary.ts:120-121` — `entryTabs` / `personalTabs` are not reset when
   `repertoireId` changes, so an in-place Fast View navigation briefly merges the previous
   song's personal tabs. This is pre-existing (the old page never reset `personalTabs`
   either) and out of this slice; a note for RH-52, which owns the entry load.
4. `src/components/fastview/TabLibrarySection.tsx:37-46` — the skeleton stays inline as
   planned; if RH-50/51 need the same two-row pulse, it is the natural first extraction.

## [RH-49] Fast View parte 2/5: extrair biblioteca de tabs, tab ativa e upload — 2026-09-07 (QA 1)


- `npx eslint .` still ends at `26 problems (12 errors, 14 warnings)`, the same
  ceiling as the baseline. The two errors that remain in
  `src/app/songs/[id]/fast-view/page.tsx` (`prefer-const` on `let html` in
  `parseLyricsMarkdown`, and `handleStatusChange(statusKey as any)`) are both
  one-line fixes untouched by this refactor and would be cheap to clear in a
  follow-up.
- `FastViewPage` complexity is now 67, down from 76 but still far above the
  default gate of 15. The Stage Mode / annotation block is the remaining bulk;
  extracting it the way the tab library was extracted here would be the natural
  next slice.


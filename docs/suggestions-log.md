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


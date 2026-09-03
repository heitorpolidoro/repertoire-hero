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

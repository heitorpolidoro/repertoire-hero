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


## [RH-50] Fast View parte 3/5: extrair o overlay do Stage Mode de PDF — 2026-09-07 (spec review 1)


- **Audit-table transcription error (spec L68).** The table renders the header's
  key separator as `` key ? `* ${key}` : '' `` (ASCII `*`), but page L1036 is
  `` key ? `• ${key}` : '' `` (U+2022). The normative instruction is "moved
  verbatim" in both the table's Destination column and Approach §4, so the page
  is the authority and a copy-paste implementation is correct — but no ER pins
  the separator, so typing it from the table would silently change on-screen copy.
  Fixing the one character in the table removes the trap.
- **Approach §6 under-lists the page's import cleanup.** After the move,
  `useCallback` and `useRef` (page L3) and `Stroke` / `TabAnnotations` (page L5)
  have no remaining use — their only uses today are L295, L155, L296 and L277.
  Leaving them would add four `@typescript-eslint/no-unused-vars` warnings and
  break ER7's `26 problems (12 errors, 14 warnings)` and the page's `2 problems`.
  ER7 forces the right outcome, so this is not a contradiction, but §6 should say
  "narrow the `react` and `@/types/database` imports" alongside "drops the imports
  at lines 9, 10 and 14".
- **`key={tabId}` on `TabDrawingStage` is not pinned by any ER.** It is what makes
  a tab switch remount the stage instead of showing another tab's strokes (RH-46).
  The verbatim-move instruction covers it, but a one-line grep
  (`grep -c "key={tabId}" src/components/fastview/PdfStageOverlay.tsx`) or an
  assertion inside the existing "hands the annotations … to the drawing stage"
  test would make the guarantee mechanical.
- **Nothing pins that the page actually renders `<PdfStageOverlay>`.** ER1 pins the
  imports and ER5 pins the removals; the only net that catches "hook wired, overlay
  never rendered" is knip in ER7 reporting an unused file. A
  `grep -c "PdfStageOverlay" "src/app/songs/[id]/fast-view/page.tsx"` clause in ER5
  would close it directly. Same for `onOpenStage={pdfStage.open}`.
- **Export style for `PdfStageOverlay` is unstated.** Every other component under
  `src/components/fastview` uses a named export while `TabDrawingStage` is a
  default export; naming the choice avoids a pointless round-trip.
- **ER6's `< 400` line bound covers the 15-test hook test.** The comparable
  `src/hooks/__tests__/useTabLibrary.test.tsx` is 389 lines for 20 tests
  (~19.5 lines/test), so ~330 lines is the expectation here — the margin is real
  but not large given this file's extra fakes (viewport, history, scroll host).
  Worth keeping in mind rather than changing.

## [RH-50] Fast View parte 3/5: extrair o overlay do Stage Mode de PDF — 2026-09-07 (code review 1)


1. `src/components/fastview/__tests__/PdfStageOverlay.test.tsx` — no test pins `key={tabId}` on
   `TabDrawingStage`. It is the mechanism that remounts the stage (and drops the previous tab's
   canvas) when the active tab changes, and a silent removal would not fail any test here. A rerender
   with a different `tabId` asserting the stub instance was replaced would close that gap.
2. `src/hooks/__tests__/usePdfStage.test.tsx` — the scroll-lock test covers `close()`; unmount with
   the stage still open (leaving the route) is not asserted. React guarantees the cleanup, so this is
   only about locking the guarantee in; one `unmount()` assertion on `host.style.overflow` would do.
3. `src/hooks/usePdfStage.ts:38` — the `getViewport` doc comment says "Test seam"; it may be worth
   adding that passing an inline arrow makes the measurement effect restart on every render (harmless
   because the state converges, but surprising to a future caller who is not a test).

## [RH-50] Fast View parte 3/5: extrair o overlay do Stage Mode de PDF — 2026-09-07 (QA 1)


- `src/hooks/usePdfStage.ts` line 66 is the only uncovered branch in the new
  code (`typeof window !== 'undefined'` inside `WINDOW_VIEWPORT`, the SSR guard).
  The hook's last test covers the truthy side; the falsy side is unreachable in
  jsdom. Non-blocking — branch coverage there is 97.22%, well above the ER10
  floor of 70.
- `git diff --name-only 6b30ddb` does not list `AGENTS.md` or
  `.meridian/tasks.json`, both of which ER12 permits. Not a defect; noted only
  so a future reader does not read the whitelist as a required set.


## [RH-51] Fast View parte 4/5: extrair letras, editor, auto-import e Stage Mode de letra — 2026-09-07 (spec review 1)


- **§8 prose vs its own code block.** "`songTitle` / `artist` are passed as already-resolved strings …
  the same `title` / `artist` values the page computes at lines 266-267" reads as if the page passes the
  `title`/`artist` *variables*, but the hook is called above the `if (loading)` early return while those
  constants are declared at 266-267 *after* it, so they are not in scope. The code block gets it right by
  inlining `entry?.song?.title ?? '(untitled)'`, which yields an identical value. Reword the prose to
  "the same expressions", so an implementer does not try to hoist the constants.
- **ER10's `All files` floors are loose.** Current coverage is 96.86 / 83.59 / 99.26 / 97.35; the ER
  floors are 90 / 74 / 92 / 90, so branches could regress ~9 points and still pass. Consider raising them
  to just under the current run.
- **ER6's `grep -c "popstate" … = 2` is brittle.** It is achievable (`usePdfStage` is exactly 2 today),
  but any doc comment in the new hook that mentions `popstate` would fail a correct implementation.
  Matching `addEventListener('popstate'` / `removeEventListener('popstate'` — or asserting `>= 2` — would
  be equally informative and not hostage to a comment.
- **Mirror `useTabLibrary`'s catch comment.** Its binding-less `catch` carries a one-line note on why the
  reason never reaches the user beyond the Toast. Adding the same to the two moved catches would keep the
  S1/P1 rationale visible in the new file.
- **`LyricsSection` sits at ~13 against ER7's ceiling of 15.** Worth flagging to the implementer so an
  extra ternary is not casually added while transcribing.
- **ER1's parenthetical is slightly overstated.** "the check matches import specifiers only, so naming
  the identifier in a doc comment is never a match" — the pattern `from '@/hooks/useLyricsEditor'` would
  match that literal text in a comment too. Harmless as written, since no planned file contains it.

## [RH-51] Fast View parte 4/5: extrair letras, editor, auto-import e Stage Mode de letra — 2026-09-07 (code review 1)


- `src/app/songs/[id]/fast-view/page.tsx:160-171` — the four callbacks
  (`onEntryLyricsSaved`, `onPersonalLyricsSaved`, `onPersonalEntryCreated` is fine,
  `notify`) are inline arrows recreated every render, so the `useCallback` around
  `save` (and `autoImport`, via `notify`) never actually preserves an identity. It is
  harmless today because no effect depends on those functions and no child is
  memoised, but if a `React.memo` ever lands on `LyricsEditorPanel` the memoisation
  will silently be a no-op. Wrapping the two save callbacks in `useCallback` on the
  page (or dropping the `useCallback` on `save`) would make the intent honest.
- `src/hooks/__tests__/useLyricsEditor.test.tsx:168,209,225` — `actions as unknown as
  LyricsEditorActions` appears three times; having `makeActions()` return
  `LyricsEditorActions & ActionSpies` would remove the double cast and keep the spy
  types.
- `src/components/fastview/__tests__/LyricsStageOverlay.test.tsx:13-42` builds its
  controller fixture through an `editingMembers()` helper while
  `LyricsSection.test.tsx:11-37` builds a flat one. Two shapes for the same fixture is
  a small readability cost; a single shared `makeLyricsController` helper (e.g. under
  `src/components/fastview/__tests__/`) would do for both — non-blocking, and note the
  duplication budget is currently comfortable (18 clones, 0.73%).

## [RH-51] Fast View parte 4/5: extrair letras, editor, auto-import e Stage Mode de letra — 2026-09-07 (QA 1)


- ER5's `LyricsSection.test.tsx` also carries a fourteenth test that the ER does
  not name (`LyricsSection renders the editor panel instead of the viewer while
  editing`). That is extra coverage above the floor, not a defect — noted only so
  the count difference (13 required, 13 present after excluding it, 14 total) is
  not mistaken for drift later.
- `src/lib/lyricsMarkdown.ts` line 24 is a single 200+ character `.replace(...)`
  holding the chord-badge class string inline; the test file already duplicates
  the same string as a `CHORD_CLASS` constant. Exporting that constant from the
  module and interpolating it would remove the duplication and make a Tailwind
  class change a one-place edit. Non-blocking.


## [RH-52] Fast View parte 5/5: extrair entrada de musica, status, links e o shell da pagina — 2026-09-07 (spec review 1)


- **Say in the Approach that the hook tests import through the `@/hooks/...` alias.** ER1
  requires `src/hooks/__tests__/X.test.tsx` to appear in `grep -rln "from '@/hooks/X'" src`,
  but the repo is split on this: `useLyricsEditor.test.tsx`, `usePdfStage.test.tsx` and
  `useTabLibrary.test.tsx` use the alias while `usePlaylistNav.test.tsx` and
  `useToast.test.tsx` use `'../usePlaylistNav'`. An implementer following the relative-import
  precedent would fail ER1. Not blocking, because ER1 is itself part of the spec the
  implementer reads, but the Test plan section should state it.
- **`FastViewOverlays.tsx` is the largest new component and has no render test.** ER5 covers
  it only with the state/effect grep. A single "renders every overlay it is given" case in
  `FastViewShell.test.tsx` would cost little and would catch a mis-forwarded prop that `tsc`
  cannot (e.g. `songTitle`/`songKey` swapped).
- **ER7's headroom is 9 lines and ER13's file list is closed.** The measured composition root
  is 191 lines against a 200-line budget, and no tenth component file is permitted by ER13's
  whitelist. If the real page lands at 205 lines the implementer has to restructure inside the
  allowed files rather than extract. Consider either recording the escape hatch (which of the
  nine components absorbs the overflow) or widening ER13 by one named component file.
- **ER10's `All files` floors are very loose** relative to the measured baseline
  (90/74/92/90 vs 96.97/84.03/99.32/97.49). They will not detect a coverage regression of
  several points. Tightening them to a point or two below the baseline would make the gate
  meaningful; ER11's per-file floors already carry most of the weight.
- **The `logger.error` shorthand in the Approach** (`logger.error('Failed to load personal entry', err)`)
  drops today's `e instanceof Error ? e : new Error(String(e))` normalisation. The spec says
  "message unchanged" and "byte-for-byte behavioural copy", so intent is clear, but quoting the
  current second argument would remove any doubt (and `logger.error`'s signature may require an
  `Error`).

## [RH-52] Fast View parte 5/5: extrair entrada de musica, status, links e o shell da pagina — 2026-09-07 (spec review 2)


- Round 1's five suggestions were not addressed and are not blocking; they still apply and are
  already recorded in `docs/suggestions-log.md` from that round. The two most worth carrying
  into implementation are (a) stating in the Test plan that the hook tests import through the
  `@/hooks/...` alias, since ER1's `grep -rln "from '@/hooks/X'" src` triple fails under the
  repo's competing relative-import precedent, and (b) ER7's 9-line headroom against a closed
  ER13 file list, which leaves the implementer no tenth component to extract into if the page
  lands over 200 lines.
- The generator's own round-2 note is right that `grep -c "useEffect("` is the reusable idiom
  when the intent is "count effects" and `grep -c "useEffect"` only when the intent is "this
  symbol appears nowhere". ER5's nine-component grep and ER6's page grep both assert `0`, so
  they are the second case and are correct as written.

## [RH-52] Fast View parte 5/5: extrair entrada de musica, status, links e o shell da pagina — 2026-09-07 (code review 1)


1. `src/components/fastview/FastViewOverlays.tsx:22-30` — `FastViewPdfStage` restates
   `usePdfStage`'s return shape structurally. It is the right call under today's boundary rule
   (RH-50's files are out of scope here), but it is the one place where a rename in
   `usePdfStage` would only be caught by `tsc` at the call site rather than at the definition.
   A follow-up could move a `PdfStageController` type into `src/lib` alongside the other three,
   the way RH-52 did for its own controllers.
2. `src/components/fastview/LinkDeleteConfirm.tsx:16` — the guard is
   `controller.pendingDeleteUrl === null`, whereas the page's old guard was the truthy
   `{pendingDelete && …}`. Unreachable difference today (a link url is never the empty
   string), but `if (!controller.pendingDeleteUrl) return null` would be exactly equivalent to
   the original for zero cost.
3. `src/app/songs/[id]/fast-view/page.tsx:184-187` — the inline `onDelete` arrow drops the old
   `handleDeleteLink`'s `if (!entry || !entry.song) return` guard. Also unreachable: the delete
   button only exists inside a card, and `controller.links` is `entry?.song?.links ?? []`, so
   there are no cards without a song. Noted only so a future reader does not read it as a lost
   check.
4. `src/hooks/useSongEntry.ts:130` — `identity: songIdentity(entry)` builds a fresh object on
   every render. Harmless as wired (only `identity.title` / `identity.artist` strings cross a
   hook boundary), but a `useMemo` would make the controller value safe to drop into a
   dependency array later.
5. `src/lib/songLinks.ts:28-35` — `appendLink` and `removeLinkByUrl` are one-line array
   operations and sit close to the YAGNI line. They earn their place here because they are what
   the moderation-path test asserts against, and the module is the components' type home
   anyway, so I would leave them.
6. There is no test file for `FastViewOverlays`. ER5 does not ask for one and the component is
   pure prop pass-through, so this is fine; noting it because it is the only one of the nine
   new components with no direct render test.

## [RH-52] Fast View parte 5/5: extrair entrada de musica, status, links e o shell da pagina — 2026-09-07 (QA 1)


- `src/hooks/useSongEntry.ts` is the one new file below 100% statement coverage
  (97.67% statements, 79.16% branches). The uncovered branches are the defensive
  guards in the personal-entry load path. Not a gate — the ER11 floor for hooks is
  90/90/90 statements/functions/lines and 75 branches, and the file clears all
  four — but a case for the `repertoireId === null` guard would close it.
- The repo-wide `rtk proxy npx eslint .` still reports 10 errors, all
  `@typescript-eslint/no-explicit-any` in test helpers and other pre-existing
  files (`src/lib/__tests__/test-helpers.ts:96` and `:120` among them). Out of
  scope for RH-52 — the task removed exactly the one error it owned — but worth a
  cleanup task.


## [RH-38] Decompor a pagina Fast View — 2026-09-07 (spec review 2, integration spec)


- ER1's phrase "prints exactly one problem line" is accurate but could be read as
  "the output is one line". The raw output is six lines (blank, file path, the
  error line, blank, `✖ 1 problem (1 error, 0 warnings)`, blank). Consider
  "prints exactly one error line ... and a summary reading `1 problem (1 error,
  0 warnings)`" so a literal-minded QA cannot fail a correct run on line count.
- ER6's requirement that the `**Correction (RH-38):**` line "states all three of
  the corrected numbers" is checked by reading prose. It is checkable because the
  numbers are enumerated, but it could be made fully mechanical by adding that
  the line must contain the literals `82`, `88`, `1495`, `1534`, `39` and `4`.
- ER8 does not restate the Postgres/`SUPABASE_SERVICE_ROLE_KEY` precondition that
  ER4 spells out, yet `e2e/global-setup.ts` creates an authenticated session and
  therefore needs the database. ER4 covers it for a QA reading the whole list, but
  a one-line restatement in ER8 would make it standalone.
- ER9's whitelist names `.meridian/tasks.json`, which is gitignored and so can
  never appear in `git diff --name-only`. Harmless given the "subset" wording;
  dropping it would remove a moment of confusion for QA.
- Post-merge note for the orchestrator: the spec's own hand-off to RH-39 is
  well-formed — the `24 problems (10 errors, 14 warnings)` ratchet and the
  concrete override list (`useBandAdmin.ts`, `linkFetcher.ts`, `moderation.ts`,
  `songs.ts`, the ten `src/lib/__tests__` files) were both reproduced today and
  can be handed over verbatim.

## [RH-38] Decompor a pagina Fast View — 2026-09-07 (code review 1)


1. `AGENTS.md:54` - the new bullet leads with a full sentence in bold
   (`- **Fast View is a composition root (RH-38).**`) while every sibling bullet
   in `Key architectural decisions` leads with a short bold topic followed by a
   colon (`- **Auth**:`, `- **Data access**:`, `- **Observability**:`). A form
   like `- **Fast View composition root (RH-38)**: ...` would scan more
   uniformly in that list. Purely cosmetic; the content is accurate and the
   greps ER7 pins (`Fast View is a composition root`) would need updating if
   this were changed, so it is arguably better left as is.
2. `docs/plans/code-quality-review.md:289` - the F6 `Status` line carries the
   whole per-commit progression (`1427/76, 1091/67, 964/54, 658/30`) inline. It
   is all true and it is one line by design, but a future reader may find the
   same data easier to consume as the table that already exists in
   `docs/tasks/RH-38-spec.md:57-65`. If the review document ever gains a
   "delivery log" section, that is where this belongs. Not worth churning the
   `4	0` numstat for now.
3. Non-blocking observation for the orchestrator, not for this diff: the F6
   `Status` line asserts the budgets pass "over the whole feature" by way of a
   `--rule` invocation that nothing in CI reproduces. Until RH-39 wires the
   thresholds into `eslint.config.mjs`, that claim is true but unenforced and
   can silently rot. RH-39 is already sequenced next, which is the right answer.

## [RH-38] Decompor a pagina Fast View — 2026-09-07 (QA 1)


None. (One observation, not a defect and not actionable for this task: `vitest run` emits a Vite
warning that `vitest.config.ts` uses ESM syntax in a file loaded as CommonJS under
`configLoader: 'native'`. It is pre-existing at `e985ba5`, outside this task's footprint, and ER9
explicitly forbids touching `vitest.config.ts`.)

## [RH-39] Impor orcamentos de complexidade, profundidade e tamanho no eslint.config.mjs — 2026-09-07 (spec review 1)


- ER7 lists "the bracket-escaping warning" among items `AGENTS.md` must mention
  "verbatim", but unlike every other item in that list it is a description rather
  than a greppable string. QA holding only the ERs has to judge it. Pin a literal
  substring instead - the Approach's AGENTS.md text already contains
  `is a character class`, which is a clean anchor.
- The Audit's "What the test budget absorbs" paragraph says the test budget "absorbs
  13 of the 14 offending test files outright" and then that "four test-file overrides
  remain". Those cannot both hold: 14 - 4 = 10 files are absorbed outright. The
  override list itself (24 entries = 20 source + 4 test) is correct and I verified it
  produces zero budget violations, so this is a narrative arithmetic slip in the Audit,
  not a defect in the deliverable. Worth correcting so the next reader can trust the
  section.
- ER10 states no preconditions, while ER9 spells out Postgres plus
  `SUPABASE_SERVICE_ROLE_KEY`. `next build` runs `scripts/migrate.mjs` only through
  `npm run build` (ER10 calls `npx next build` directly, bypassing it), and
  `playwright.config.ts` runs `e2e/global-setup.ts`, which authenticates a real user.
  Both effectively need the same live database ER9 requires. Restating the
  precondition in ER10 would make it self-contained rather than relying on ER9 having
  been run first in the same environment.
- Approach section 2's note that `MAX_OVERRIDES` is a `<=` bound is the right call and
  is well justified in the spec; consider having the guard also assert
  `overrides.length > 0`, so that deleting the whole marked block cannot pass tests 3
  and 4 vacuously. Test 5 would still catch it, so this is defence in depth only.
- Follow-up already recorded in the spec and worth keeping: clear the 10 pre-existing
  eslint errors and then wire a real `npm run lint` gate into `ci.yml`. Until that
  happens the guard test is the only thing making the budget bite, which the spec is
  admirably explicit about.

## [RH-39] Impor orcamentos de complexidade, profundidade e tamanho no eslint.config.mjs — 2026-09-07 (spec review 2)


- ER9 states "at least 1034 tests passed" while the arithmetic in the same sentence
  (1034 baseline + 6 new) fixes the number at 1040. The `>=` bound is verifiable as
  written, so this is not blocking, but a QA run that somehow lost five pre-existing
  tests and gained the six new ones would still pass the clause. Pinning it to `1040`
  would close that gap.
- ER8's duplication clause carries three coupled numbers ("no more than 18 clones and
  no more than 230 duplicated lines (at most 0.69 %)"). If `jscpd` output rounds the
  percentage differently on another machine, the parenthetical could conflict with the
  two absolute bounds. Consider treating the percentage as informative only.
- The Approach's per-file-granularity note is honest about `src/app/profile/page.tsx`
  being pinned at 394 while its 224-line function could drift upward unnoticed. That is
  accepted here and correctly documented; when the F11 follow-up lands, it may be worth
  revisiting whether the guard should pin the *second* worst number too for files with
  more than one offending function.
- Already recorded in the spec as a follow-up, and worth keeping visible: clearing the
  10 pre-existing eslint errors and then wiring a real `npm run lint` CI gate would let
  a later task delete the guard's test 5 in favour of the gate itself.

## [RH-39] Impor orcamentos de complexidade, profundidade e tamanho no eslint.config.mjs — 2026-09-07 (code review 1)


1. `src/lib/__tests__/complexityBudget.test.ts:77` — `ceilingOf` casts
   `unknown` to `[string, number]` unchecked. Test 4 guarantees the shape, but
   the tests are independent: a malformed future override (`"off"`, or a bare
   severity) makes test 6 compute `NaN - 1` and emit a confusing "looser than
   the worst number" message alongside test 4's accurate one. A `typeof` guard
   returning `Number.NaN` with a named message would keep the diagnosis crisp.
2. `src/lib/__tests__/complexityBudget.test.ts:199` — test 6 puts *every*
   reported `ruleId` into `reported`, including pre-existing non-budget findings
   (`no-unused-vars`, `no-explicit-any`). It cannot cause a false pass today
   because `expected` pairs are always budget rule names, but filtering to
   `BUDGET_RULES` as test 5 does would state the intent and cost nothing.
3. `src/lib/__tests__/complexityBudget.test.ts:113` vs `:49` — the test *name*
   hardcodes "24" while the bound lives in `MAX_OVERRIDES`. When the ratchet
   shrinks (the F11 follow-up will remove `src/app/playlists/[id]/page.tsx`),
   the name will silently lie until someone edits it. ER5 pins the name, so this
   is a note for the follow-up task rather than a change to make now.
4. `src/lib/__tests__/complexityBudget.test.ts:147` — override ceilings are
   compared against the source `BASE` (`max-lines` 400) even for test-file
   overrides, whose effective budget is 800. A hypothetical test-file override
   at `max-lines: 500` would pass test 4 while actually *tightening* the file.
   Harmless (tightening is safe, and test 6 would catch a non-exact ceiling),
   but the assertion's stated meaning — "never below the base threshold" — is
   slightly weaker than it reads for the four test-file entries.
5. The guard lints all of `src` twice per CI run (once in the reusable `test`
   job, once in `coverage`), ~7 s each. Once the 10 pre-existing eslint errors
   are cleared, a real `npm run lint` gate would subsume test 5 and let it
   shrink to the cheap structural assertions. The spec already records this as a
   follow-up; worth keeping visible.
6. Known and accepted, restated for the follow-up: `max-lines-per-function`
   ceilings are per file, so the 224-line `PersonalProfileView` in
   `src/app/profile/page.tsx` can grow to 394 unnoticed under that file's
   override. The ratchet only pins the worst number per file per rule.

## [RH-39] Impor orcamentos de complexidade, profundidade e tamanho no eslint.config.mjs — 2026-09-07 (QA 1)


- `next build` emits eight `BetterAuthError: You are using the default secret` lines because the
  production-mode env chain used by a local build does not supply `BETTER_AUTH_SECRET`. Pre-existing
  and out of scope for RH-39, but it makes "the build printed no error" harder to assert for the
  next verifier; documenting the expected noise (or supplying the secret to local production builds)
  would remove the ambiguity.
- ER2 pins an exact eslint summary (`24 problems (10 errors, 14 warnings)`), which will need editing
  the moment any unrelated warning lands. The stronger and more durable assertion is the one the
  guard already makes: zero findings from the five budget rules.


## [RH-54] query tipado parte 1/5: fundacao DbRow e casa dos row types — 2026-09-08 (spec review 1)


- ER5's parenthetical "(no existing test file was modified)" is not true as prose:
  `src/lib/__tests__/test-helpers.ts` is an existing file under `__tests__` and this task
  modifies it — the ER's own first clause requires it. The command is right, the gloss is
  wrong; "no existing test *suite* was modified" would say what is meant.
- ER10 is the only ER with an environment dependency and no stated precondition: it needs
  port 3000 free and the Postgres/`SUPABASE_SERVICE_ROLE_KEY` setup, because
  `playwright.config.ts` starts `npm run dev` and `e2e/global-setup.ts` signs a user in.
  ER5/ER8/ER9 all spell that precondition out; ER10 should too.
- ER11 whitelists `package-lock.json`, but nothing in the Approach adds, removes or bumps a
  dependency. The whitelist is a permissive closed set, so this cannot fail a correct
  implementation — it only lets an unexplained lockfile churn through. Dropping it makes the
  gate strictly stronger.
- ER7 says "a number inside the `complexity-budget-overrides` block". `eslint.config.mjs`
  has no such block: the overrides are a run of sibling objects each named
  `complexity-budget/override` (lines 69-91). Naming them the way the file does removes a
  moment of doubt for whoever reads the diff.
- ER9 asks for "`0 failed` and `0 skipped`", but vitest prints neither string on a fully
  green run — the output is just `Test Files 90 passed (90)`. The `N passed (N)` form
  already proves both (a failure renders as `1 failed | 89 passed (90)`), so the extra
  strings are better dropped than left for QA to hunt for.
- Nothing type-checks `test-helpers.ts` after this task: `tsconfig.json` excludes
  `**/__tests__/**`, and vitest strips types without checking them. ER5's greps prove the
  `any`s are gone but not that what replaced them is coherent; the runtime suites in ER5 are
  the only real safety net. The spec reasons about this correctly for the `query` signature
  (hence the ER3 probe) — worth one sentence saying the same limit applies to the mock, so a
  later reader does not mistake ER5 for a type-level guarantee.
- `BandByInviteCodeRow.member_count: string` rests on "`member_count` is a bigint, so pg
  hands it back as text". The existing `Number(row.member_count)` is correct either way, so
  nothing breaks if the assumption is wrong — but if the SQL function returns `int`, the
  interface documents a shape the driver never produces. A glance at
  `get_band_by_invite_code` in `migrations/` while implementing would settle it.

## [RH-54] query tipado parte 1/5: fundacao DbRow e casa dos row types — 2026-09-08 (spec review 2)


- The round-1 suggestions were not applied and remain open. They are all non-blocking and
  several are one-word edits that would spare QA a moment of doubt: ER5's "no existing test file
  was modified" gloss (the task does modify `src/lib/__tests__/test-helpers.ts`; "no existing
  test *suite*" is what is meant), ER7's "complexity-budget-overrides block" (the file has a run
  of sibling `complexity-budget/override` objects, not a block), ER9's "`0 failed` and
  `0 skipped`" (vitest prints neither string on a green run; `N passed (N)` already proves both),
  ER10's missing environment precondition, and `package-lock.json` in ER11's whitelist despite
  no dependency change. Worth folding into the next spec that touches this file rather than
  spending a revision round on them now.
- Section 6's new paragraph settles the marker-string question for this task. Since RH-55 to
  RH-58 will each add row types and will each want a similar consumer check, making
  `| grep -v __tests__` the default tail of every source-scanning ER in those specs — as the
  generator's own report suggests — would stop this trap recurring four more times.
- ER2's `npm run lint:dead` clause and the section 6 guard test now overlap: knip and the string
  scan both prove no `dbRows.ts` export is unused. The redundancy is cheap and the two fail at
  different times, so it is worth keeping here; it is the first place to trim if a later part of
  the split needs to shorten its ER list.

## [RH-54] query tipado parte 1/5: fundacao DbRow e casa dos row types — 2026-09-08 (code review 1)


Non-blocking, and all of them belong to a later part of the RH-40 split rather than to
this one:

1. `src/lib/dbRows.ts:36` — `SpotifyTokenRow.expires_at: string`, but
   `migrations/0001_initial_schema.sql:125` declares `expires_at timestamptz`, which
   node-postgres hands back as a `Date`, not a string. The consumer
   (`spotifyAuth.ts:28`, `new Date(tokenRow.expires_at)`) works either way, and this type
   is copied verbatim from the inline block it replaced, so the change introduces no
   regression — but the row type is now the documented mirror of the projection, and
   this one mirrors the projection inaccurately. Worth correcting to `Date | string`
   (or fixing the read) when RH-58 takes `spotifyAuth.ts`.
2. `src/lib/__tests__/dbRowTypes.test.ts:96-106` — the `any` scan runs against raw source
   lines, while the same module already exports `stripComments`. A future doc comment in
   `db.ts` that mentions `: any` (e.g. quoting `@types/pg`'s
   `{ [column: string]: any }`, which the AGENTS.md section already does) would fail the
   guard spuriously. Running the scan over `stripComments(source)` would keep the same
   teeth with no false positive.
3. `src/lib/dbRows.ts:29` — `PlaylistSongLinksRow.position` is in the SELECT list but
   unread at the only call site. That is deliberate per the column-for-column convention
   and knip does not flag it; noting it only so a later reviewer does not read it as an
   oversight.

## [RH-54] query tipado parte 1/5: fundacao DbRow e casa dos row types — 2026-09-08 (QA 1)


- ER5's verification command is malformed and should be corrected wherever this ER text is reused as a template:
  `git diff --name-only 246313f -- src --diff-filter=M` places `--diff-filter=M` after the `--` separator, so git
  parses it as a pathspec and the filter never applies. The command therefore lists added files too and prints
  `1` instead of `0` for any change that adds a test file. The correct form is
  `git diff --name-only --diff-filter=M 246313f -- src`, which prints `0` here. No code change is warranted.

- ER10's expected success line `Compiled successfully` is a substring of what Next actually prints
  (`✓ Compiled successfully in 1309ms`). If this ER is reused, matching on the substring rather than the whole
  line will keep it stable across Next's formatting changes.

- `src/lib/spotify.ts` still carries one cast matching the ER4 pattern and is not among the files this task
  touched. It is outside RH-54's scope and correctly left alone; noting it only as a candidate for whatever
  follow-up continues the `any`-elimination work, since it is now one of only six remaining sites.


## [RH-55] query tipado parte 2/5: validar o payload de moderacao — 2026-09-08 (spec review 1)


- **ER7's "is 13 after this change" is correct, but consider stating the measurement
  method.** I reproduced it: a probe copy of `moderation.ts` carrying the §3 rewrite
  (parsed payload, `for (const [column, value] of Object.entries(payload))`, the
  `if (setClauses.length > 0)` guard removed, the extra `||` clause in the catch
  allowlist) reports `reviewGlobalSongEdit` at complexity **13** under the ESLint API,
  with `submitGlobalSongEdit` 3, `checkSystemAdmin` 4, `getPendingGlobalSongEdits` 4 and
  the `withTransaction` arrow at 1 — exactly the §4 table. Likewise a probe of the §1
  validator reports `parseGlobalSongEditPayload` at **12** and every helper at 5 or less,
  and `tsc --noEmit` exits 0 with the real module in place. No change needed; recording
  the numbers here so a later round does not have to re-measure.

- **`src/lib/sqlUpdate.ts` already owns dynamic `SET`-clause building.** RH-23 extracted
  `buildUpdateSet(fields, columns, startIndex)` for `updateBand` and `updatePlaylist`; it
  returns `{ setClauses, values, nextIndex }` and skips `undefined`. The approach in §3
  hand-rolls a fourth copy of that loop. Reusing it would need no change to
  `sqlUpdate.ts` (so ER11's whitelist still holds), would keep `npm run lint:dup` further
  from ER7's 1.00% ceiling, and would make the column order explicit rather than relying
  on `Object.entries` insertion order. Not blocking — the hand-rolled loop is correct and
  the spec's justification for column-ordered construction is coherent.

- **`Object.entries(payload)` re-widens to `any`.** `GlobalSongEditPayload` has no index
  signature, so TypeScript picks the `entries(o: {}): [string, any][]` overload; `value`
  in the §3 loop is `any`, which is why `values.push(Array.isArray(value) ? … : value)`
  compiles against `(string | number | null)[]` at all. That is why my probe of the whole
  shape exits 0 under `tsc --noEmit`, so no ER is at risk — but the narrowing F17 asks
  for lives entirely in the validator, not in the loop. An explicit column list (or
  `buildUpdateSet`) would carry the types through. Worth a note in the spec so a reader
  does not over-read the typed `values` declaration.

- **`links` validation now rejects URLs without an `http(s)` scheme, including ones
  already stored in `global_songs`.** The `updateSongLinksAction` path
  (`src/lib/songs.ts:477`) submits the *whole* post-edit list, built from
  `songRes.rows[0].links`. There is no scheme validation anywhere upstream except the
  browser's `type="url"` inputs (`SongForm.tsx:414,432,527`, `AddLinkForm.tsx:38`), which
  accept `ftp:` and `mailto:` too. A legacy row holding a non-http link would make every
  destructive link edit on that song fail with
  `Invalid global song edit: links must be an array of {label, url} objects with http(s) urls`,
  with no way for the user to recover. Consider either narrowing the rule to "a non-empty
  string" for `links[].url`, or naming this as an accepted risk in Out of Scope.

- **ER9's `Compiled successfully` is a substring, not the whole line.** Next 16.3.0 prints
  `✓ Compiled successfully in 1309ms` (`.meridian/reports/RH-54-qa-1.md:374`). RH-54's QA
  accepted the substring and logged exactly this note in `docs/suggestions-log.md:3827`.
  Not blocking — the precedent is established — but "prints a line containing
  `Compiled successfully`" would retire the note.

- **ER9 does not restate the environment its Playwright run needs.** `playwright.config.ts`
  has a `globalSetup` (`./e2e/global-setup.ts`) that creates an authenticated session, so
  the run needs the same live database ER5 and ER8 spell out. QA sees only the ER list, so
  ER9 reads as if a bare build were enough. (The `--project=chromium` RH-54's dev added is
  *not* needed: the `mobile` project's `testMatch: '**/fast-view-mobile.spec.ts'` excludes
  `ssr-smoke.spec.ts`, so the default run yields exactly the `4 passed` ER9 expects.)

- **`package-lock.json` in ER11's whitelist is fine as written.** The list is permissive
  ("paths drawn from this set"), so listing it costs nothing whether or not the version
  bump touches the lockfile. No action.


## [RH-55] query tipado parte 2/5: validar o payload de moderacao — 2026-09-08 (spec review 2)


- Carried over from round 1, still non-blocking and still worth a line in the spec: the
  `links[].url` rule (`/^https?:\/\/\S+$/i`) is stricter than anything upstream. The
  `updateSongLinksAction` path (`src/lib/songs.ts:477`) resubmits the whole post-edit list
  built from stored rows, so a legacy row holding e.g. an `ftp:` link would make every
  destructive link edit on that song fail with no user-facing recovery. Either narrow the
  rule to "a non-empty string" for `links[].url` or name it as an accepted risk in Out of
  Scope. Not blocking: no expected result depends on it, and every link in the existing
  test corpus is `https:`.
- Carried over: `Object.entries(payload)` in §3 re-widens `value` to `any` (no index
  signature on `GlobalSongEditPayload`), which is why `values.push(...)` typechecks
  against `(string | number | null)[]`. The narrowing F17 asks for genuinely lives in the
  validator, so no ER is at risk, but a one-line note would stop a reader over-reading the
  typed `values` declaration. `src/lib/sqlUpdate.ts`'s `buildUpdateSet` remains the
  alternative that would carry types through and keep `npm run lint:dup` further from
  ER7's 1.00% ceiling.
- Carried over: ER9 does not restate that its Playwright run needs the same live database
  ER5 and ER8 spell out (`playwright.config.ts` has a `globalSetup` that creates an
  authenticated session), and its `Compiled successfully` is a substring of Next 16's
  `✓ Compiled successfully in NNNms` rather than a whole line. Both were accepted by
  RH-54's QA under the same wording, so neither blocks.
- From the round-2 revision report, and worth acting on outside this task: hoist the ER11
  whitelist preamble (`AGENTS.md`, `docs/suggestions-log.md`, `docs/tasks/<id>-spec.md`,
  `package.json`, `package-lock.json`) into AGENTS.md as a named convention. RH-55 lost
  one of those five by hand-copying from RH-54; parts 3, 4 and 5 of RH-40 will each
  rewrite the same list and can each lose one the same way.


## [RH-55] query tipado parte 2/5: validar o payload de moderacao — 2026-09-08 (code review 1)


1. **Three uncovered branches in the new module** (coverage points at
   `src/lib/globalSongEditPayload.ts:35`, `:53`, `:73`): a title that is
   non-empty after `trim()` but empties after `sanitizeSongTitle`
   (e.g. `{ title: '(2017 Remaster)' }`), a whitespace-only `standard_key`
   normalising to `null`, and a `links` array containing `null`
   (`[null]` — the `value === null` arm of `isSongLink`). Each is one extra
   `expect` in the existing table test; branch coverage is already 95.38% so
   this is polish, not a gap in behaviour.
2. **Non-http(s) links already in the catalog become unremovable.** The additive
   write path (`src/lib/songs.ts:462-485`) still performs no URL validation, and
   `AddLinkForm`'s `type="url"` accepts any absolute URL including
   `javascript:` and `ftp:`. Once such a link exists on a global song, a later
   *destructive* link edit submits the whole surviving set through
   `submitGlobalSongEdit` and is now refused with
   `Invalid global song edit: links must be an array of {label, url} objects with http(s) urls`,
   so the user cannot remove any link from that song. This is a consequence the
   spec chose knowingly (the http(s) rule is spec-mandated), and it is not a
   regression this diff can be blamed for, but validating link URLs on the
   additive path too — same regex, same module — would close the asymmetry.
   Worth a follow-up task alongside the two the spec already lists.
3. **Historical `links` stored as a JSON *string* can no longer be approved.**
   The deleted block had a `typeof proposed.links === 'string' ? … : JSON.stringify(…)`
   branch; the new validator rejects a string `links`. No writer in the repo
   produces that shape (`submitGlobalSongEdit` stores the object verbatim, so
   `links` stays an array in `jsonb`), so this looks like dead defensiveness
   rather than a live case — but if any production row has it, the edit becomes
   reject-only. A one-line check of `global_song_edits` in prod before merge
   would settle it.
4. **jscpd clone count went 18 → 19** (0.68% → 0.71%, still far under the 2%
   threshold): the new
   `rejects a historical proposed_data that no longer validates…` test
   (`src/lib/__tests__/moderation.test.ts:294-309`) duplicates the
   admin-check + edit-lookup mock setup at `:168-181`. Two clones of that same
   block already existed, so this follows the file's convention; a small
   `mockAdminAndPendingEdit(proposedData)` helper would retire all three.
5. **The `fields` annotation at `src/lib/moderation.ts:124** leans on
   `Object.entries` falling back to `[string, any][]` for an interface with no
   index signature — the explicit
   `Array<[string, string | number | null | SongLink[]]>` is therefore an
   assertion in annotation clothing rather than a checked narrowing. It is sound
   by construction (the payload is built field by field two files away), and it
   avoids an `as` cast, but a half-line of comment saying *why* the annotation
   is safe would keep a future reader from assuming the compiler verified it.

## [RH-55] query tipado parte 2/5: validar o payload de moderacao — 2026-09-08 (QA 1)


- ER9's quoted success string (`Compiled successfully`) is out of date for
  Next.js 16 + Turbopack, which prints `✓ Compiled successfully in <n>ms`. Future
  expected results for this repo may want the looser wording so the check does not
  read as a mismatch.
- `npm run lint:dup` now reports 19 clones (was 18); the new one is the pair of
  `test-helpers.ts` blocks already flagged before this task, so it is not caused by
  RH-55, but the duplicated-line total is drifting upward and is worth watching
  against the 1.00% ceiling.


## [RH-56] query tipado parte 3/5: tipar a camada de dados de songs e tabs — 2026-09-08 (spec review 1)


- ER9's success string: quote it the way Next 16 + Turbopack actually prints it. Suggested
  wording: "`npx next build` exits 0 and its output contains a line matching
  `Compiled successfully`" (Next 16.3.0 emits `✓ Compiled successfully in <n>ms`). This is
  the third spec in the RH-40 chain to carry the bare phrase; two QA reports have flagged it.
- ER9 could also name the invocation the last two QAs actually needed, so QA does not have to
  rediscover it: `set -a; . ./.env.local; set +a` and
  `PLAYWRIGHT_WEB_SERVER='npx next start -p 3000 -H 127.0.0.1' npx playwright test e2e/ssr-smoke.spec.ts`.
- AGENTS.md:284-285 states as a standing fact that "`src/lib/songs.ts` is pinned at
  `max-lines: 531` by the RH-39 ratchet". After this task that number is 529 and the sentence
  goes stale. `AGENTS.md` is already inside ER10's whitelist, so a one-word edit costs
  nothing; consider adding it to the Approach (an ER for it is optional — the rationale in
  that sentence survives the number change).
- The `tabs.ts` `runTabQuery` doc-comment rewrite is the one free-text edit in the task, and
  ER5's `tabs.ts` guard counts SQL keywords across the whole diff. A replacement sentence that
  happened to contain the word `UPDATE` or `SELECT` would fail a correct implementation. Very
  unlikely given the sentence being replaced, but the spec could pin the replacement text the
  same way it pins the type-argument spellings.
- ER8's "reports at least `Test Files 92 passed (92)`" mixes a floor ("at least") with an
  exact literal that already encodes the count. Since this task adds no tests, "reports
  exactly" would be clearer and equally true.
- ER4's `wc -l src/lib/songs.ts prints a number N` — `wc -l` on a named file prints the count
  *and* the filename; harmless, but `wc -l < src/lib/songs.ts` prints the bare number.

## [RH-56] query tipado parte 3/5: tipar a camada de dados de songs e tabs — 2026-09-08 (code review 1)


- `AGENTS.md:285` still justifies `dbRows.ts` with "`src/lib/songs.ts` is pinned at
  `max-lines: 531`". This change lowers that pin to 529, so the sentence is now stale by
  two lines. Non-blocking (it is rationale prose, not a rule), but worth refreshing when
  RH-40 part 4 or 5 touches the ratchet again — or better, rewording it to not quote a
  number that the ratchet keeps moving.
- `src/lib/playlists.ts:89` still casts to
  `{ id: string; user_id: string | null; band_id: string | null }` — literally
  `RepertoireAccessRow` minus `song_id`. Out of scope here (parts 4/5), but when that
  cast is removed, check whether it is the same `repertoire` projection; if so it should
  reuse or extend `RepertoireAccessRow` rather than gain a second near-identical
  interface in `dbRows.ts`.
- `{ links: SongLink[] | null }` (`songs.ts:450`) is looser than the `NOT NULL DEFAULT
  '[]'` column. Keeping it is defensible (consistent with `PlaylistSongLinksRow`, and it
  keeps the preserved `?? []` from becoming provably-dead code), but if RH-40 ever
  consolidates the two, the honest shape is `SongLink[]` with the fallback dropped in the
  same edit — not one without the other.

## [RH-56] query tipado parte 3/5: tipar a camada de dados de songs e tabs — 2026-09-08 (QA 1)


- ER9's literal expectation (`Compiled successfully`) is worth restating for Next 16, which
  emits `✓ Compiled successfully in <N>ms`. Future specs pinning this line should match on
  the substring or on exit code, so the ER does not drift with Next's formatting.
- The local `next build` emits eight `BetterAuthError: You are using the default secret`
  lines because `BETTER_AUTH_SECRET` is absent from this machine's env files. Unrelated to
  RH-56, but adding a dummy value to `.env.local` would make future build logs clean enough
  that a real error stands out.


## [RH-57] query tipado parte 4/5: tipar a camada de dados de bands, playlists e profile — 2026-09-08 (spec review 1)


- ER5's `wc -l src/lib/bands.ts src/lib/bands.server.ts src/lib/playlists.ts src/lib/profile.ts`
  prints five lines, not four: GNU/BSD `wc` appends a `total` row (838 after the change), which is
  greater than 400. The wording "prints four numbers each `<= 400`" is understandable, but adding
  "ignoring the trailing `total` row" (or using a per-file loop) removes the last hand-wave.
- ER1's first two greps are described in two different output shapes — the first as "prints `0`
  for all four files", the second as literal `src/lib/bands.ts:15` pairs. Both are correct
  (`grep -c` over multiple files always emits `file:count`), but stating the first in the same
  `file:count` form would make the two symmetric.
- ER2's `grep -c "(error as { code?: string })" src/lib/bands.ts` is a nice negative pin; the same
  treatment for the surviving `res.rows[0] as GlobalSongEdit` in `moderation.ts` is already
  covered by the repo-wide sweep, so nothing to add — noted only to confirm the coverage is not
  accidental.
- Nothing in the spec depends on post-merge state; the "Post-merge checks (orchestrator)" section
  is correctly kept outside the expected results.

## [RH-57] query tipado parte 4/5: tipar a camada de dados de bands, playlists e profile — 2026-09-08 (spec review 2)


- Approach section 2 opens "Five sites are that" and then lists six bullets (`bands.ts` 115, 210,
  278, 326 and `playlists.ts` 10, 289). The bullets, the Audit tables and ER1's pins all agree on
  six, so the implementation is not ambiguous — it is a stale word from an earlier draft, worth
  fixing to "Six" the next time the file is touched.
- Still open from round 1, unchanged and still non-blocking: ER5's
  `wc -l src/lib/bands.ts src/lib/bands.server.ts src/lib/playlists.ts src/lib/profile.ts` prints
  five lines, the fifth being `total` (838 after the change), which is not `<= 400`. Adding
  "ignoring the trailing `total` row" would remove the last hand-wave.
- Also still open from round 1: ER1's first aggregate grep is described as "prints `0` for all
  four files" while the second is given as literal `file:count` pairs. Both are correct; stating
  the first in the same `file:count` form would make the pair symmetric.
- The generator's own round-2 suggestion is a good one and belongs to `pipeline.md`, not to this
  spec: an ER-level `grep -c` whose last token is the pattern rather than a path is almost always
  the missing-operand bug. I ran exactly that check here (see above) and it is cheap; making it a
  standing step in spec review would have caught this in round 0.

## [RH-57] query tipado parte 4/5: tipar a camada de dados de bands, playlists e profile — 2026-09-08 (code review 1)


1. `AGENTS.md:269-290` documents the inline single-column literal but says nothing about the
   `query<never>` idiom for statements that return no rows, which is now used at 19 sites across
   `songs.ts`, `bands.ts`, `playlists.ts` and `profile.ts`. One sentence in that section during the
   RH-40 close-out would stop the next author from reaching for `query<DbRow>` or leaving the site
   untyped. Non-blocking and explicitly out of scope here.
2. Four lines grew past ~110 characters (`bands.ts:116`, `bands.ts:211`, `playlists.ts:11`,
   `bands.server.ts:42`). There is no `max-len` rule so nothing flags them, and wrapping them would
   have perturbed the byte-identical-SQL check this task is graded on — worth folding into a future
   formatting pass rather than this one.
3. `PlaylistEntryRow.position` is declared but never read at the call site. That is correct under the
   "mirror the projection column for column" convention (`position` is in the SELECT list and drives
   the `ORDER BY`), so I would not change it — noting it only so a future reader does not mistake it
   for dead surface and delete it.

## [RH-57] query tipado parte 4/5: tipar a camada de dados de bands, playlists e profile — 2026-09-08 (QA 1)


- Duplication sits exactly at the ER7 ceiling (19 clones / 242 duplicated lines / 0.71%), so
  the next change in this area has no headroom before the gate wording bites. Not caused by
  this task and not blocking, but worth a small cleanup budget soon.


## [RH-58] query tipado parte 5/5: tipar o caminho de dados do Spotify e seus route handlers — 2026-09-08 (spec review 1)


- ER10's whitelist includes `AGENTS.md`, but nothing in the Approach or Test
  plan edits it. Since ER10 is the only exhaustive "nothing else moved" check in
  the spec, listing a file the task never touches means an unrelated `AGENTS.md`
  edit would slip through unnoticed. Consider dropping it from the closed set.
- ER6's `grep -c 'complexity-budget/override' eslint.config.mjs` prints `23` and
  `grep -cF 'complexity: ["error", 26]' eslint.config.mjs` prints `1` are both
  strictly implied by the `git diff 9e37072 -- ... eslint.config.mjs` empty check
  in the same ER. Harmless redundancy, and arguably good documentation of intent
  — no change needed, noted only so a future reviewer does not read it as a gap.
- ER3's annotation-laundering guard only covers the three type names
  `SpotifyTrack|GlobalSongEdit|SongLink` in array form. It happens to be
  sufficient here because ER3's first grep covers the `rows[0]... as` shapes,
  but if the pattern is going to be inherited by the follow-up guard task it
  would be worth generalising to `: [A-Z][A-Za-z]*(\[\])? = await`.
- The Post-merge note proposing a `no-restricted-syntax` rule or a
  `dbRowTypes.test.ts`-style source scan is the right follow-up. When it is
  written, it should scan for *any* receiver (`query(`, `client.query(`,
  `db.query(`, `pool.query(`) rather than the three the note lists, and exempt
  `src/lib/db.ts` plus the result-discarding sites the tree deliberately keeps.
- Separately from this task: `src/lib/__tests__/complexityBudget.test.ts:82`
  would stop being flaky with an explicit per-test timeout (its `await loadConfig()`
  imports `eslint.config.mjs` dynamically and routinely exceeds the 5000 ms
  default under full-suite load, taking ~30 s of wall time in the failing runs).
  Worth its own small task, since it will keep costing QA rounds on every task
  that pins the full suite.

## [RH-58] query tipado parte 5/5: tipar o caminho de dados do Spotify e seus route handlers — 2026-09-08 (spec review 2)


- ER10's whitelist still lists `AGENTS.md`, but nothing in the Approach or Test
  plan edits it (carried over from round 1, not adopted — restated once, not
  worth another round). Since ER10 is the only exhaustive "nothing else moved"
  check, an unrelated `AGENTS.md` edit would pass unnoticed.
- ER9 cites the failure frame as `complexityBudget.test.ts:82` while the awaited
  call itself is on line 83. That matches what vitest prints today, but if the
  test file ever shifts by a line the ER's prose will read as stale; the test
  name alone already identifies the flake, and the ER's own restatement
  ("the failing test is exactly the one named above") is what QA will use.
- For RH-59: the flake is a 5000 ms default `testTimeout` on the dynamic
  `eslint.config.mjs` import under full-suite parallel load. An explicit per-test
  timeout on that one `it` is the smallest fix and would let future specs drop
  this whole tolerance clause.

## [RH-58] query tipado parte 5/5: tipar o caminho de dados do Spotify e seus route handlers — 2026-09-08 (code review 1)


1. `src/lib/spotifyPlaylistSync.ts:101` — `rows[0].links ?? []` is now a no-op to the compiler: `GlobalSongLinksRow.links` is `SongLink[]` and `global_songs.links` is `jsonb NOT NULL DEFAULT '[]'::jsonb`, so the `??` branch is unreachable both by type and by schema. The spec keeps it deliberately to hold the runtime byte-identical, which is the right call for this task, but it is now defensive code the types say cannot fire. Worth deleting in a follow-up (or, if someone believes NULL rows exist, the honest fix is `links: SongLink[] | null` — not both spellings at once). Non-blocking, and explicitly out of scope here.
2. `src/app/api/spotify/playlists/[id]/sync/route.ts:55` — `linkRes.rows[0]` is indexed without checking `rows.length`, so a missing playlist row throws a `TypeError` inside the `try` and surfaces as the generic 500 rather than a 404. Pre-existing at baseline and untouched by this diff; flagging only so it is not mistaken for something this task introduced. `src/lib/moderation.ts:151` has the same shape, guarded upstream by the `Global song edit not found` check.
3. Post-merge, the follow-up guard the spec proposes (a lint rule or source-scan test forbidding an untyped `query(` / `client.query(` / `db.query(` / `pool.query(` outside `src/lib/db.ts`) is now cheap to add: the first three receivers are verifiably at zero across `src`, and only `src/lib/auth.ts:84` would need an exemption or a `<never>`. Without it, the invariant F16 just established has nothing holding it in place.

## [RH-58] query tipado parte 5/5: tipar o caminho de dados do Spotify e seus route handlers — 2026-09-08 (QA 1)


- ER9's tolerated flake reproduced on the first full-suite run here
  (`complexityBudget.test.ts` timing out at 5000ms under parallel load while
  taking 22s wall time in the same run). It is correctly scoped out of RH-58 and
  owned by RH-59; the cheapest fix when RH-59 comes up is a per-test
  `testTimeout` on the `loadConfig()` case, since the isolated run already takes
  ~8s of which the config load dominates.
- `src/lib/spotify.ts:30` remains the last `as SpotifyTrack[]` in the RH-57
  inventory. It is an HTTP-body cast deliberately kept out of RH-58's scope, but
  it is now the only remaining entry, so a follow-up validating the Spotify
  response body would close that inventory entirely. Non-blocking.


## [RH-40] Tipar o helper query e validar o payload de moderacao — 2026-09-08 (spec review 2, close-out spec)


- **`Out of Scope`, "Correcting F16's ~44 such casts overall"**: the figure "the
  DB-row cast inventory regex gives 32" at `13da8b2` is reachable only by widening
  the inventory to `.tsx` as well; the inventory as this spec defines it
  (`--include='*.ts'`) gives 23 at `13da8b2`. The paragraph's conclusion - that the
  ~44 counting method is not reproducible, so calling it wrong would be an
  unverified claim - is unaffected and remains right. Worth aligning the number
  with the spec's own regex definition anyway, since the spec's credibility here
  rests on its counts being reproducible.
- ER1's "at the pre-split commit `246313f` the same command printed 80 lines" and
  ER3's "(the count was 26 at `246313f`)" read like checks but are background.
  A QA agent taking them as checks might check out an old commit. Marking them
  as context (or phrasing them as `git grep ... 246313f`, which is safe and does
  reproduce both numbers) would remove the temptation.
- Several ERs point at "Approach 3" and "the F16 `**Status:**` line of ER8" for
  rationale. QA sees only the ERs, so those pointers dangle. They are purely
  explanatory in every case - the mechanical check next to them is complete - so
  this is cosmetic, but inlining the one-clause reason ("its result is discarded,
  no column is read off it") would make ER1 and ER9 fully self-contained.
- Unrelated to this task's diff, worth a follow-up: AGENTS.md L285 still says
  `src/lib/songs.ts` is pinned at `max-lines: 531`, but RH-56 tightened the
  override to `529` (`eslint.config.mjs:86`, and `wc -l src/lib/songs.ts` = 529).
  ER9 forbids touching AGENTS.md here, correctly - this belongs to its own task.

## [RH-40] Tipar o helper query e validar o payload de moderacao — 2026-09-09 (spec review 3)


- ER8 verifies the F16 `**Status:**` line by commit id, placement and the `4	0`
  numstat, but never by its stated counts - which is precisely why the round-2
  defect reached review instead of being caught mechanically. If a future
  close-out task mandates a document line containing measured figures, consider
  having its ER grep for the figures together with their baseline commit (for
  example, requiring the line to match `down from 80 at .246313f.`), so a
  mis-stated or undated count fails QA rather than depending on a reviewer
  reproducing the baseline by hand.
- The spec deliberately leaves F16's "~44 such casts overall" uncorrected because
  the counting method could not be reproduced (`Out of Scope`, third bullet). That
  is the right call for this task, but the three candidate interpretations it
  records at `13da8b2` (32 / 29 / 64) are useful evidence that will be lost once
  this spec is archived. Worth a one-line note in the review document, or in
  whichever task takes up the HTTP-boundary validation follow-up, so the next
  reader does not redo the same inconclusive measurement.

## [RH-60] Corrigir as 5 vulnerabilidades novas do npm audit — 2026-09-09 (spec review 1)


1. **ER9 could use the form every prior QA already used.** RH-54, RH-55 and RH-56 all ran the SSR
   smoke as `set -a; . ./.env.local; set +a` followed by the `PLAYWRIGHT_WEB_SERVER=…` command.
   That sources every key, whereas ER9 exports only `BETTER_AUTH_SECRET` — and
   `.env.production.local` also blanks `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` and
   `SPOTIFY_REDIRECT_URI`. `ssr-smoke.spec.ts` touches none of those, so the narrow export is
   sufficient here and I did not treat it as blocking; but the broader form is strictly more robust
   and matches the established house pattern.

2. **ER4 writes scratch files to `/tmp`.** `/tmp/rh60-base-lock.json`, `/tmp/rh60-lockscope.mjs`,
   and ER5's `/tmp/rh60-lock.sha`. These work (I ran them), but agents in this project are told to
   use the session scratchpad instead of `/tmp`. Naming a scratchpad path, or noting that QA may
   substitute one, would remove the friction. Purely cosmetic — no assertion depends on the
   location.

3. **ER8's "materially below … is a finding" is the one soft clause in ten ERs.** The threshold
   comparison is fully mechanical, but "a value materially below `97.38 | 85.43 | 99.41 | 97.95` is
   a finding even when it clears the threshold" asks QA for a judgement call. Quantifying it
   (e.g. "more than one percentage point below any of the four") would make the whole ER set
   judgement-free.

4. **Two specs are in flight against the same baseline.** `docs/tasks/RH-40-spec.md` is untracked in
   the working tree alongside RH-60's. ER10 anchors its whitelist on `git diff --name-only 55656fe`,
   so if RH-40 commits before RH-60 reaches QA, a *correct* RH-60 implementation would show RH-40's
   files in that diff and fail ER10. Not a defect in the spec — every spec in this project anchors
   this way, and RH-60 is CRITICAL so it should land first — but the orchestrator should keep the
   ordering in mind, or re-anchor ER10 on the then-current `master` if RH-40 lands first.

5. **The generator's own suggestions 1-5** (in `.meridian/reports/RH-60-spec-1.md`) are all sound
   and I endorse them, in particular the `@vitest/coverage-v8` exact-peer guard test: the failure
   mode "`npm audit fix` moves `vitest`, leaves the reporter behind, `npm ls` goes `invalid` while
   `npm audit` stays green" is structural and will recur on the next vitest advisory. A one-assert
   test in the spirit of `serverExternalPackages.test.ts` would catch it. Follow-up task, not RH-60.


## [RH-60] Corrigir as 5 vulnerabilidades novas do npm audit — 2026-09-09 (code review 1)


1. **The lockfile root `version` field was stale at the baseline and is now resynced — worth knowing,
   not worth acting on.** `package-lock.json`'s `packages[""].version` read `0.1.67-202609052124` at
   `55656fe` while `package.json` already said `0.1.87-202609081036`; the `npm install` in this task
   pulled it forward to `0.1.88-202609090956`, matching `package.json`. This is a *benign side effect
   and strictly an improvement* — the lockfile is now internally consistent, where before it was 20
   version bumps behind. It also explains one of the two root-entry lines in the lockfile diff. The
   underlying cause is that the AGENTS.md Version Bumping Rule bumps `package.json` by hand without
   an `npm install`, so the lockfile root drifts until some unrelated task happens to reinstall.
   Nothing to fix here; a future task could consider whether the bump step should touch the lockfile
   root too, purely to keep the two from diverging again.

2. **`eslint-config-next` remains at `16.0.1` against `next@16.3.4`.** The spec's reasoning for
   leaving it alone is correct and I verified it holds: `eslint-config-next` declares no peer
   dependency on `next` (its peers are `eslint` and `typescript`), and `@next/eslint-plugin-next` did
   **not** move in the lockfile, so the lint baseline is provably untouched. Bumping it here would
   have moved the lint baseline for zero security benefit. Flagging only so the drift is a conscious,
   recorded decision rather than an oversight — it is now three minors behind and eventually deserves
   its own task.

3. **Pre-existing noise, correctly left alone.** The `configLoader: 'native'` / "ESM syntax in a file
   loaded as CommonJS (vitest.config.ts:1:1)" warning still prints on every vitest run. It predates
   this task and is explicitly out of scope; no action taken or wanted.


## [RH-60] Corrigir as 5 vulnerabilidades novas do npm audit — 2026-09-09 (QA 1)


None. Every expected result was met on first execution, including the two that carry a
tolerated-failure escape clause (ER7/ER8) — the RH-59 `complexityBudget` flake did not
reproduce, so both passed outright without invoking the exception.

## [RH-40] Tipar o helper query e validar o payload de moderacao — 2026-09-09 (spec review 4, re-baseline)


- AGENTS.md's `# Database Row Types` section still says `src/lib/songs.ts` is
  "pinned at `max-lines: 531` by the RH-39 ratchet", but RH-56 (`b293e82`)
  tightened `eslint.config.mjs:86` to `529` and the file is now 529 lines. The
  drift is pre-existing (RH-54 wrote the section before RH-56 landed) and RH-40
  correctly keeps AGENTS.md out of its diff per ER9, so this is not a finding
  against this spec — but it is worth a one-line follow-up task, since the stale
  number is exactly the sort of thing a later reader would "correct" in the wrong
  direction.
- ER7's suite counts, coverage numbers, production build and SSR smoke were not
  re-executed in this review (the dispatch forbade it). RH-60 was a dependency
  change that moved `next` from 16.0.0 to 16.3.4, which is the one class of
  change that can move a build or an SSR render without touching `src/`. The
  implementer should treat ER7's build and Playwright clauses as genuinely
  re-run at the merge commit rather than inherited from the round-3 measurement
  at `55656fe`. ER7 already states its counts as floors, so a small unrelated
  drift will not fail it spuriously.
- `55656fe` survives in five narrative sentences outside the quoted Status and
  Delivered lines (L11, L17, L189, L356, L372). Each is a correct historical
  reference to RH-58's commit rather than a measurement baseline, and L11/L17
  are what make the rebase legible. Recorded here only so a future reader of the
  round-4 checklist does not read those five as leftovers.
- ER9's whitelist deliberately omits `package-lock.json`. Bump `package.json`'s
  `version` by hand; any `npm install` / `npm version` in the working tree would
  rewrite the lockfile's root `version` field and break ER9's
  `git diff --name-only ca91de2` clause.
- ER4 calls `GlobalSongEditPayload` a "type"; it is declared as
  `export interface GlobalSongEditPayload` at
  `src/lib/globalSongEditPayload.ts:19`. The mechanical check ER4 actually runs
  (`grep -c "^export "` prints `2`) is unaffected, so this is wording only.


## [RH-40] Tipar o helper query e validar o payload de moderacao — 2026-09-09 (code review 1)


1. **A second full-suite flake exists that ER5/ER7's tolerance clause does not
   name.** `src/lib/__tests__/transactionAtomicity.db.test.ts:300`
   (`rejects two concurrent inserts that would take the same position`) failed
   once under the twelve-file parallel run with
   `expected null to be an instance of Error`, then passed 3/3 in isolation and
   the full twelve-file run passed clean on retry. RH-40's spec tolerates only
   the RH-59 `complexityBudget.test.ts` timeout by name, so a QA run that trips
   this instead has no disposal rule. Non-blocking for this docs-only diff;
   worth a follow-up task alongside RH-59 (or an explicit note to QA that an
   isolated re-run of this file is the disposal), since a concurrency race test
   that intermittently sees both inserts succeed may also be pointing at a real
   gap in how the unique constraint is exercised.

2. **The Correction's two error counts are unreproducible from this tree.** "one
   compiler error" versus "29 errors across 10 files" are pre-remediation
   measurements; a future reader cannot re-derive them without reverting
   `src/lib/db.ts`. They are the strongest evidence in the line, so pinning the
   commit they were measured at (`246313f`, as the adjacent count claims already
   do) would make the correction self-verifying. Not worth reopening this diff —
   fold it in if the document is edited again.

## [RH-40] Tipar o helper query e validar o payload de moderacao — 2026-09-09 (QA 1)


None.


## [RH-59] Corrigir flake do complexityBudget.test.ts — 2026-09-09 (spec review 1)


- S1 - ER7 quotes the eslint summary as `✖ 22 problems (8 errors, 14 warnings)`. This is
  factually right and, measured today, survives the write to the board intact, so it is not
  blocking. But every other spec in `docs/tasks/` quotes that line ASCII-only, and a leading
  non-ASCII glyph is the kind of thing a future reformat, terminal or log pipeline mangles. A
  future spec would be more robust quoting `22 problems (8 errors, 14 warnings)` and letting
  the glyph be implicit.
- S2 - ER8 reads "reports `Test Files  92 passed (92)` and `Tests  1064 passed (1064)` with
  `0 skipped`". Every other backticked string in that sentence is a literal output line, but
  `0 skipped` is not: vitest prints a `| N skipped` segment only when skips exist, so on a
  clean run the literal text `0 skipped` never appears. `Tests  1064 passed (1064)` with
  total == passed already proves zero skips, so the qualifier is redundant; phrasing it as
  "and no `skipped` segment in the Tests line" would remove the chance of a QA failing a
  correct run on a literal grep.
- S3 - ER3 pins `grep -c 'configPromise'` to `3`. That matches the Approach block exactly
  (declaration, `??=` assignment, `return`), so no spec-following implementation fails it. It
  is still a shape pin rather than a behaviour pin: an equivalent
  `return (configPromise ??= ...)` would give 2 and fail. Since `beforeAll(async` = 1 plus the
  timeout counts plus ER5's duration measurement already prove the import is paid once in the
  hook, this grep could be dropped or loosened to `>= 2` without weakening the result.
- S4 - Approach step 3 says the hook carries "a comment naming RH-59 and the measured numbers",
  but the code block right below it shows the hook with no comment. Harmless (no ER checks for
  a comment), but the two should agree so the implementer is not left guessing whether the
  comment is required.

## [RH-59] Corrigir flake do complexityBudget.test.ts — 2026-09-09 (code review 1)


1. `src/lib/__tests__/complexityBudget.test.ts:63-67` and `:93-97` narrate the
   same RH-59 measurement story twice (import cost, 4469 ms of 5000 ms, the
   margin). One of the two could be trimmed to a cross-reference — the hook
   comment is the one that earns its keep, since it explains *why the hook
   exists at all* to someone who would otherwise see it as redundant with the
   memoization. Non-blocking; the duplication is prose, not code, and both
   comments are accurate.
2. `src/lib/__tests__/complexityBudget.test.ts:115,131,150,176` — 60 s on tests
   that measure 0-2 ms is a very large multiple. It is what the spec pins and it
   is the right *kind* of number (a deadlock catcher, not a performance
   assertion), so this is only a note that the value is deliberately loose, not
   a request to change it.


## [RH-59] Corrigir flake do complexityBudget.test.ts — 2026-09-09 (QA 1)


None. The change is minimal and precisely scoped: a memoized loader, a
`beforeAll` that pays the import off the per-test clock, and explicit timeouts.
Assertion count, thresholds, `eslint.config.mjs` and `vitest.config.ts` are all
provably untouched, and the guard was demonstrated to still fail correctly in
both tamper directions.


## [RH-61] Server Components parte 1/5: tirar force-dynamic do layout raiz — 2026-09-09 (spec review 1)


- ER4's worker count: `grep -c 'static pages using 7 workers (19/19)'` is pinned to
  a 7-worker machine and the ER hedges in prose. Give QA one machine-independent
  command instead, e.g. `grep -cE 'static pages using [0-9]+ workers \(19/19\)'`
  prints `1`, and drop the parenthetical.
- ER4 could state that the route table and the legend are printed on **stdout**
  (verified on 16.3.4), so a QA run that captures only stdout still finds them;
  as written, "its output contains" leaves the `2>&1` question open.
- ER3's second half asks QA to revert ER1's edit and rerun. Add "then restore
  `src/app/layout.tsx`" so the tree QA hands back is not accidentally left with
  the directive reintroduced.
- ER5's prose calls all fourteen manifest keys "the routes Next classifies as
  prerendered as static content", but `/_global-error` never appears in the
  printed route table. Harmless, but a sentence noting that `/_global-error` is a
  framework-internal entry would stop a QA reader from hunting for it in the table.
- Consider pinning `git diff 65cadd8 -- package-lock.json` prints nothing in ER11:
  the version bump must not drag the lockfile along, and the current whitelist
  only implies it.
- `docs/plans/mobile-app-analysis.md` is knowingly left stale (it still claims the
  directive prevents a prerender crash). The Out of Scope section says so, which is
  the right call for this task, but it is worth a suggestions-log entry so a later
  part of RH-41 picks it up.

## [RH-61] Server Components parte 1/5: tirar force-dynamic do layout raiz — 2026-09-09 (spec review 2)


- `package-lock.json` is at `0.1.88-202609090956` while `package.json` is at
  `0.1.90-202609091102`, i.e. the repo already does not sync the lockfile version
  on a bump. The spec is unambiguous (step 5 names `package.json`, and
  `package-lock.json` is outside ER11's closed set, so `npm version` would fail
  the result), but a one-line note in the Approach — "edit the `version` field by
  hand; do not run `npm version`, which would also rewrite `package-lock.json`
  and fail ER11" — would remove a plausible implementer misstep. This restates
  round 1's lockfile suggestion in its cheaper, non-blocking form.
- The `## Audit` probe says lines `7-12` were deleted in the scratch clone while
  the normative `## Approach` says `7 through 13` (and ER1 pins `39` lines,
  which only `7-13` produces). Both are internally correct — the probe simply
  left the trailing blank line — but a reader comparing the two sections has to
  work that out. A half-sentence in the probe ("plus the trailing blank line in
  the real edit; the probe left it, which is why the probe file was 40 lines")
  would close the gap. Not ambiguity: the Approach is normative and ER1
  arbitrates.
- Round-1 suggestions that survive unchanged and are still worth taking in a
  future edit or in the implementation: ER4's `grep -cE 'static pages using
  [0-9]+ workers \(19/19\)'` machine-independent form; noting that the route
  table and legend go to stdout; adding "then restore `src/app/layout.tsx`" to
  ER3's revert-and-rerun step so QA does not hand back a tree with the directive
  reintroduced; a sentence in ER5 noting `/_global-error` is a framework-internal
  manifest entry that never appears in the printed route table.
- `docs/plans/mobile-app-analysis.md` is knowingly left stale (it still claims
  the directive prevents a prerender crash). Out of Scope says so correctly, but
  it deserves a suggestions-log entry so a later part of RH-41 picks it up.


## [RH-61] Server Components parte 1/5: tirar force-dynamic do layout raiz — 2026-09-09 (code review 1)


1. **Nested layouts are not covered.** The guard names `src/app/layout.tsx`
   explicitly; a route-group layout added by RH-41 parts 2–5 (e.g.
   `src/app/(app)/layout.tsx`) carrying `export const revalidate = 0` would pass
   both assertions — the tree-wide check only greps the `force-dynamic` literal.
   Cheap hardening for a later part: flag `export const (dynamic|revalidate)` in
   **any** `layout.tsx` under `src/app`. (Same as the developer's own suggestion
   3; I confirm the gap is real.)
2. `REPO_ROOT` is computed a second time in the new test
   (`path.resolve(__dirname, '..', '..', '..')`) because `test-helpers.ts` keeps
   its copy module-local for knip reasons. Harmless, but if a third guard needs
   it, export it once from `test-helpers.ts` and let one consumer keep knip
   quiet.
3. Now that `/profile` and `/settings` serve a cached static shell, the
   `src/proxy.ts` matcher is the *only* thing standing between an anonymous
   request and that shell. It holds today (measured 307), and the shell carries
   no data, but RH-41 part 5 (F10) touches exactly that matcher — worth an
   explicit expected result there that `GET /profile` anonymous still answers
   `307` against a `next start` build.
4. `docs/plans/mobile-app-analysis.md` still repeats the now-false "force-dynamic
   exists to prevent a real prerender crash" claim. Out of scope here (correctly
   excluded), but it is stale as of this commit.
5. `next start` emits `x-nextjs-prerender: 1` twice on prerendered routes (I saw
   it on both `/` and `/login`). Framework behaviour, harmless, noted only in
   case a CDN rule is ever keyed on that header.

## [RH-61] Server Components parte 1/5: tirar force-dynamic do layout raiz — 2026-09-09 (QA 1)


None.


## [RH-62] Server Components parte 2/5: converter /bands e /admin/moderation — 2026-09-09 (spec review 1)


- **ER12's self-contradicting pathspec.** "`git diff 57bc60a -- src/app/actions
  src/lib src/proxy.ts src/hooks src/store AGENTS.md next.config.ts` prints nothing,
  except that `src/lib/__tests__/complexityBudget.test.ts` may differ (ER11)" names a
  command whose stated outcome a correct implementation must violate, rescued only by
  the trailing clause. It is decidable as written (which is why it is not blocking),
  but a literal-minded QA runner is one reading away from failing a correct branch.
  Make it consistent with a pathspec exclusion:
  `git diff 57bc60a -- src/app/actions src/lib src/proxy.ts src/hooks src/store
  next.config.ts ':(exclude)src/lib/__tests__/complexityBudget.test.ts'` prints
  nothing. (If blocking finding 1 is taken, `AGENTS.md` leaves this list anyway.)
- **ER7's red-before claim reads like a QA step.** "Checked out at `57bc60a` with only
  this file added, both tests fail, because both placeholder strings are present in the
  prerendered documents there" is true (I confirmed both strings are in
  `.next/server/app/bands.html` and `.next/server/app/admin/moderation.html` at
  baseline), but verifying it requires a checkout of the parent commit — a git-state
  mutation QA is not allowed to perform. Phrase it as background, the way ER1 does
  ("it printed `227` at `57bc60a`"), e.g. "for the record, both placeholder strings are
  present in the `57bc60a` prerendered documents, so these assertions are red before
  the change".
- **The Approach authorises a file the whitelist forbids.** "The implementer must
  confirm with eslint rather than trust these estimates, and **split further if any
  file reports**" — a further split would add a path outside ER12's closed set and fail
  ER12. Say explicitly that any further decomposition happens *inside* the four named
  component files (extract a local function, not a new module), or that a new path
  requires a spec revision.
- **ER11 does not actually forbid a new override.** It pins the override-line count at
  `22` and the moderation entry at `0`, so an implementer who deleted the moderation
  override and added one for, say, `src/components/admin/PendingEditCard.tsx` would
  still pass — even though AGENTS.md says "never add an entry for new code". Consider
  asserting the override list's *content*, e.g. `grep -c "src/components/admin\|src/components/bands/BandsView"
  eslint.config.mjs` prints `0`.
- **`lint:dup` is tighter than the tool's own gate, and this task adds two structurally
  similar jsdom suites.** `.jscpd.json` sets `threshold: 2`, while ER11 demands "at
  most `19` clones and at most `0.71 %`". The two new test files share a preamble
  (`// @vitest-environment jsdom`, `afterEach(cleanup)`, the same
  `vi.mock('next/navigation', …)` block) that is plausibly ≥ 8 lines / 50 tokens of
  near-identical text. The wording matches RH-59/RH-60/RH-61 precedent so I did not
  block on it, but the implementer should be told to vary or factor that preamble if
  jscpd reports a 20th clone.
- **One audit inaccuracy, load-bearing claim unaffected.** "Actions and revalidation"
  says `grep -rn "revalidatePath" src/` "returns hits only in
  `src/app/actions/repertoire.ts` (8 calls) and its test". It actually also hits
  `src/app/actions/tabs.ts` and four more test files
  (`actionDataAccessGuard`, `actionSessionGuard`, `authzRepertoire.db`, `authzTabs.db`,
  `tabs.test.ts`). The claim that matters — that `bands.ts` and `moderation.ts` call
  no `revalidatePath` — is correct, and no ER depends on the wrong sentence.
- **Nothing asserts the moderation success message.** Scope promises "same success
  message", and ER10 covers approve/reject/removal but no test names the success
  banner. A ninth test (or folding the assertion into test 3) would close the gap;
  as it stands the promise is unverified rather than contradicted.
- **No ER pins that `/bands` renders real server data.** ER7's first test only asserts
  the *absence* of `Loading bands...`. An assertion that the signed-in document
  contains a band name (or the empty-state copy) would distinguish "server-rendered
  list" from "island that renders nothing". ER9 test 1 covers it at the unit level, so
  this is a nicety, not a hole.


## [RH-62] Server Components parte 2/5: converter /bands e /admin/moderation — 2026-09-09 (spec review 2)


- ER3 opens with "The five island files exist" but the `test -f` chain that
  follows names four (`BandsView.tsx`, `ModerationQueue.tsx`,
  `PendingEditCard.tsx`, `PendingEditDiff.tsx`). The prose miscounts; the
  command is unambiguous and is what QA runs, so this is cosmetic. Reading
  "five" as "four components plus something" could briefly mislead an
  implementer into looking for a fifth component. Suggest "four".
- The Approach's complexity estimates for the split moderation files
  (card 8, diff 9, queue 5) are explicitly flagged as estimates the implementer
  must confirm with eslint. That is the right instruction, but no expected
  result pins the per-file numbers — ER11 only requires the six files lint
  clean. That is adequate (clean under the base budget is the actual
  requirement) and no tightening is needed; noting it only so QA does not expect
  the arithmetic to be checkable.
- The `next build` regeneration of the `nextjs-agent-rules` block is handled by
  "revert it before the commit". A follow-up task could make that automatic
  rather than a manual step an implementer has to remember; out of scope here,
  and ER11's numstat check does catch a forgotten revert.

## [RH-62] Server Components parte 2/5: converter /bands e /admin/moderation — 2026-09-09 (code review 1)


- **S1 — raw wrapped error text now reaches the browser in production**
  (`src/app/admin/moderation/page.tsx:62-63`, `src/app/bands/page.tsx:36-37`).
  The catch passes `err.message` — e.g.
  `Failed to fetch pending global song edits: connect ECONNREFUSED 127.0.0.1:54322` —
  into the island as `initialError`, and it is rendered into the server HTML. Before
  this change the same message travelled through a Server Action rejection, which
  Next.js **redacts in production** (generic message + digest), so in production the
  underlying `pg` text was never visible; now it is. Only an authenticated user can
  reach it and it carries no credentials, so this is not blocking, and it is what the
  spec specified. But `AGENTS.md`'s R1 rule ("never the raw exception text") exists for
  the analogous case in route handlers. Consider mapping non-`Access denied` failures
  to a fixed user-facing string on the server page and leaving the detail to the
  `logger.error` the lib layer already emits.
- **S2 — record the new server-page error convention in AGENTS.md.** The Error Handling
  Conventions list has L1/L1a, A1, A2, R1, P1, S1 but no entry for "async page in
  `src/app` that reads `src/lib` directly": `getSession()` + `redirect`, catch, narrow,
  classify, hand the message to an island, do not double-log. Two pages now follow it
  and RH-63/64 will add more. The spec deliberately deferred the AGENTS.md architecture
  bullet to keep the numstat at 1/1; this is the natural place to land it in a later
  part.
- **S3 — `router.refresh()` in `ModerationQueue` is currently invisible**
  (`ModerationQueue.tsx:51`, `:74`). Because `edits` is seeded from `initialEdits` by a
  `useState` initialiser, the refreshed RSC payload changes nothing on screen; the call
  only re-seeds a later mount. That is the documented intent, but it means every
  approve/reject pays for an extra RSC round-trip whose result is discarded. If a later
  part wants the queue to actually converge on the server state, the shape to move to
  is dropping the local `edits` state and letting the prop drive the list (with
  `useTransition` for the pending flag), not adding an effect.
- **S4 — `getPendingGlobalSongEditsAction` is now production-dead**
  (`src/app/actions/moderation.ts:19`). Its only remaining references are the three
  action guard suites. knip does not flag it (test imports count), and touching
  `src/app/actions/*` is explicitly out of scope here, but it is a deletion candidate
  once part 5 lands. `getBandsAction` is still live via `src/app/AppShell.tsx:29`.
- **S5 — the `/bands` e2e assertion is absence-only**
  (`e2e/server-pages.spec.ts:28-29`). It proves the placeholder is gone but would also
  pass against a page that server-rendered an empty shell. One positive assertion on
  server-rendered content — e.g. `expect(body).toContain('>Bands<')` for the `<h1>` —
  would make it a real SSR assertion at no extra cost and stay red at `57bc60a` anyway.
- **S6 — redundant `key`** at `src/components/bands/BandsView.tsx:64`: the `<li>` inside
  `BandListItem` carries `key={band.id}` while the mapped `<BandListItem>` at `:235`
  carries the effective one. Inherited verbatim from the deleted page, harmless, and
  removable in any later touch of the file.

## [RH-62] Server Components parte 2/5: converter /bands e /admin/moderation — 2026-09-09 (QA 1)


- `next build` emits ten-plus `BetterAuthError: You are using the default
  secret.` lines during page-data collection whenever the build runs without
  `BETTER_AUTH_SECRET` exported. This is pre-existing and outside RH-62's scope
  (it reproduces from the baseline build path, and no ER covers it), but it makes
  a clean build log noisy enough that a real error could be missed in CI. Worth
  a separate task to either set a build-time placeholder secret or downgrade the
  message.


## [RH-63] Convert /playlists to a Server Component with client islands (spec review r1) — 2026-09-09

- ER5 allows `npm run lint:dup` to drift to `21` clones / `0.80 %` from today's
  `19` / `0.70 %`. Nothing in the Approach predicts new duplication — the page
  shrinks and its two helpers move into `src/lib/playlistList.ts` — so the slack
  is unexplained. Consider tightening it to `19` / `0.70 %`, or say in the
  Approach which split is expected to create a clone (the likeliest candidate is
  `formatDuration`, which `src/app/playlists/[id]/page.tsx:38` also carries; that
  pair exists today and only changes address).
- Scope says "Behaviour is preserved", but the Approach later removes the
  `&& spotifyConnected !== null` loading guard from the empty-state condition
  (page line 807), so an empty account now sees `No playlists yet` at first paint
  instead of a blank panel. That is an improvement and it is stated where it
  happens, but the Scope paragraph would read more honestly with a one-clause
  carve-out naming it, since it is the one visible difference.
- `docs/plans/code-quality-review.md` F15 gets no `Status:` line until part 5.
  Worth a note in RH-65's spec so the line is not forgotten; nothing to change
  here.
- The AGENTS.md architecture bullet that should eventually name the converted
  pages as the server-read precedent is already deferred to a suggestion by the
  spec (Out of Scope, last AGENTS.md bullet). Agreed — but after RH-63 that will
  be three converted routes (`/bands`, `/admin/moderation`, `/playlists`) with no
  written rule, which is the point at which a new contributor guesses. Consider
  making it part 5's explicit deliverable rather than a floating suggestion.

## [RH-63] Convert /playlists to a Server Component with client islands (spec review r2) — 2026-09-09

- ER13's coverage one-liner silently returns `100` for a file with no functions
  (`a.length ? … : 100`). It cannot bite here — both new lib files have
  functions — and it matches istanbul's own convention, but if this one-liner
  becomes the house pattern for later parts of RH-41, a half-sentence in the ER
  ("a file with no functions reports `100`") would spare the next QA agent the
  derivation.
- The same one-liner would break if the repository were ever checked out under a
  path containing `/src/`, because of `k.split('/src/').pop()`. Not worth
  changing for this task; worth knowing before it is copied a fourth time.
- Carried over from round 1, still unaddressed and still non-blocking: ER9's
  "Checked out at `6e32874` with only this file changed, the first new test
  fails" asks QA to move git state. It is the RH-62 ER7 precedent verbatim, so I
  did not block, but a QA agent under a "never touch git state" instruction
  cannot execute it literally.
- Carried over from round 1: after RH-63 there will be three server-converted
  routes (`/bands`, `/admin/moderation`, `/playlists`) and still no AGENTS.md
  rule naming the pattern. The spec correctly defers it, but making it an
  explicit deliverable of part 5 (RH-65) rather than a floating suggestion would
  close it.
- Carried over from round 1: `docs/plans/code-quality-review.md`'s F15 `Status:`
  line is owned by part 5; worth naming in RH-65's spec so it is not forgotten.

## [RH-63] Convert /playlists to a Server Component with client islands (code review r1) — 2026-09-09

- **`src/components/playlists/CreatePlaylistModal.tsx:4-7` — the alias.**
  `import { useBandContextStore as useBandContext } from "@/store/bandContextStore";`
  is a plain single-line import with a single call site
  (`useBandContext((s) => s.bandId())` at line 66), so it costs nothing in
  readability and the original symbol name is still greppable on that line. Not a
  blocker. But once the test above is written plainly, the alias's only stated
  justification ("so the store's name appears on exactly one line") disappears,
  and dropping it would leave the file matching the four other readers of the
  store in the codebase. Non-blocking either way.
- **`src/components/playlists/PlaylistGroupList.tsx:8-18` — the fifth prop is
  justified.** `max-params` (4) counts function parameters, and a destructured
  props object is one parameter, so the rule does not apply and eslint confirms
  it (exit 0). `spotifyConnected` is not in the spec's prop table, but the same
  section of the spec assigns the empty state to this component, and the
  empty-state copy is exactly what the flag varies
  (`{spotifyConnected && " or import one from Spotify"}`, line 69) — verbatim
  from `6e32874`'s page line 816. Moving the empty state up into `PlaylistsView`
  would trade one prop for a second place that has to know when the list is
  empty; the component stays cohesive as it is. No change requested.
- **`src/app/playlists/page.tsx:42,54` — two sequential DB round trips.**
  `getUserPlaylists(userId)` is awaited inside the `try`, then
  `hasSpotifyConnection(userId)` is awaited in the JSX prop, so the two queries
  serialise and both are on the TTFB path. This is exactly the code the spec
  prints, so it is conformant, but `Promise.all` (with the `catch` kept on the
  playlist half) would remove one round trip from first paint. Worth considering
  in RH-64/RH-65 if the pattern repeats.
- **`src/components/playlists/CreatePlaylistModal.tsx:96-116` — a failed load
  cannot be retried within one modal open.** `hasLoadedSpotify.current` is set
  before the request and never reset, which is the spec's "at most once per modal
  open" and is pinned by a test — but it also means a transient network failure
  leaves the panel on "Connect your Spotify account …" until the user closes and
  reopens the modal. Resetting the ref in the `catch` would allow a second click
  to retry without weakening the "no fetch until the tab is opened" contract.
- **`src/components/playlists/CreatePlaylistModal.tsx:101-107` — the response
  cast.** `body as SpotifyPlaylist[]` in the `else` arm is reachable for a body
  that is neither an array nor `{connected:false}` (e.g. an error envelope), in
  which case `playlists.map` would run over a non-array. `Array.isArray(body) ? …`
  as the positive test would narrow without a cast. Low risk — the route only
  emits those two shapes — and it is a verbatim carry-over of `6e32874`'s
  `loadSpotifyStatus`, so not blocking.
- **`src/components/playlists/SpotifyImportPanel.tsx:15-20,75-89` — `connected`
  conflates two causes.** `connected={!spotifyLoadFailed}` is `false` both when
  the route answers `{connected:false}` and when the request throws, so a plain
  network blip renders "Connect your Spotify account in Profile & Settings" to a
  user who *is* connected. The spec explicitly chose this copy for both cases and
  documented it in the `catch`; recording it here only so the next reader knows
  it was a decision, not an oversight.
- **Report accuracy nit.** The dev report's ER12 block says
  `grep -c "" src/lib/spotifyConnection.ts -> 30`; it is `31`. The ER only
  requires `<= 400`, so nothing turns on it.

## What I verified and found correct

- **Architecture / import direction.** The page is the composition root, holds
  `PLAYLISTS_VIEW_ACTIONS` at module scope and injects it, so nothing under
  `src/components` points back into `src/app` — verified by grep, not by report.
  The server page is byte-for-byte the RH-62 shape: `getSession()` →
  `session?.user?.id` → `redirect("/login")` (which narrows to `string`), a
  `try` around the domain read that degrades to `initialError` with the "already
  logged at L1" comment, and no `export const dynamic`. Compare
  `src/app/bands/page.tsx:24-41`; the two are structurally identical.
- **Data-access-in-`src/lib`.** The only new query lives in
  `src/lib/spotifyConnection.ts:21-24`, parameterized (`$1`), never string
  interpolated. `src/app/actions/playlists.ts`, `src/lib/playlists.ts` and
  `src/app/api/**` are byte-identical to `6e32874`.
- **Database Row Types.** `query<{ one: number }>('SELECT 1 AS one …')` names its
  row shape as a type argument, never as a cast on `res.rows`, and is the
  single-column inline projection the AGENTS.md rule explicitly permits — no
  speculative entry added to `src/lib/dbRows.ts` (which knip would have flagged).
- **Security.** No secret crosses the RSC boundary: the page passes
  `playlists`, a `string | null` error, a `boolean` and the action object. No
  token value, no refresh token, no Spotify client id. `hasSpotifyConnection`
  deliberately avoids `getSpotifyAccessToken`, so the server render never
  performs the outbound token refresh; the fourth test in
  `spotifyConnection.test.ts` pins that with a `fetch` spy. The deliberate
  degrade-to-`false` is documented at the definition and follows the `catch
  (error)` + `logger.error` house style, so `errorHandlingStyle.test.ts` stays
  green (it does — full targeted run above).
- **Lazy Spotify fetch.** `loadSpotifyPlaylists` is called only from
  `handleOpenSpotifyTab` (`CreatePlaylistModal.tsx:118-121`), which is the tab
  button's `onClick`; there is no `useEffect` that sets data state anywhere in
  the islands (the three effects in the modal are focus/Escape, moved verbatim,
  and the one in `PlaylistCard` is the rename focus). `PlaylistsView` has zero
  `useEffect`. Loading and not-connected states both render. Repeated tab clicks
  issue exactly one request — asserted by
  `requests the Spotify playlist list once when the From Spotify tab is opened`.
  `src/app/api/spotify/playlists/route.ts` is untouched.
- **KISS/YAGNI/DRY.** No speculative abstraction: the overlay is two plain state
  fields and one pure function; `PlaylistCardList` was extracted to remove the
  duplicated `<ul>`+`map` (and jscpd confirms the repo net-improved to 18 clones
  / 0.65 %). `PlaylistCard`, `PlaylistNameEditor` and `SpotifyImportListItem`
  diff clean against their `6e32874` originals apart from the duration
  derivation, which now calls `@/lib/playlistList`.
- **Overlay correctness.** `applyPlaylistOverlay` keeps the props as the source
  of truth — no `useState(initialPlaylists)` freeze — and the "never cleared"
  property is genuinely a no-op after a refresh (removed ids are absent, renamed
  rows already carry the name). The failure paths roll the overlay entry back and
  set the banner, matching `6e32874`'s behaviour.
- **Unit-test quality.** `playlistList.test.ts` covers grouping order
  (personal-first, bands alphabetical by name, multiple playlists per band),
  the missing-`band.name` fallback to the id, the empty list, both overlay
  operations plus immutability of the input (`expect(original[0].name).toBe('Old
  name')`, `expect(result[1]).toBe(original[1])`), and the duration boundaries
  `0`, `3599`, `3600`, plus `null`/absent song entries. `spotifyConnection.test.ts`
  asserts the SQL target and the parameter array, the no-row case, the throw case
  (message, `instanceof Error`, `{ userId }` context) and the no-fetch invariant.
  `PlaylistsView.test.tsx` asserts through the injected actions and the rendered
  DOM, including a negative (`refresh` not called on failure, card still there).
  Assertions are behavioural, not snapshot-shaped.
- **Ratchet.** `eslint.config.mjs` loses exactly the
  `src/app/playlists/page.tsx` entry (`src/app/playlists/\[id\]/page.tsx`
  survives); `grep -c "complexity-budget/override" eslint.config.mjs` is `21`;
  `MAX_OVERRIDES = 21` and the test title follows; `AGENTS.md` is a one-insertion
  one-deletion change of `22` → `21` in the F20 bullet, with the
  `nextjs-agent-rules` block untouched; `complexityBudget.test.ts` passes (part
  of the 37).
- **Page shape.** 58 lines, no `"use client"`, no React hooks, no
  `getUserPlaylistsAction`, no `api/spotify/playlists`, no `cookies()`, no
  `searchParams`, no `useBandContextStore`.

## [RH-63] Convert /playlists to a Server Component with client islands (code review r2) — 2026-09-09

- **`docs/suggestions-log.md` — the round-1 report was copied in wholesale,
  including its "What I verified and found correct" section.** The staged diff
  adds 122 lines under three headings (`spec review r1`, `spec review r2`,
  `code review r1`), and the `code review r1` block carries not only the seven
  suggestions — which is what a suggestions log is for — but also the eleven
  "What I verified and found correct" bullets, which are review *evidence* for a
  change that is now merged, not future work. Nothing is wrong or inaccurate;
  it just means the next person triaging the log has to skip past a block that
  has no action in it. Trimming the verification section on the next triage pass
  would keep the log scannable. Docs only, non-blocking.
- The five round-1 suggestions that touch code — the sequential DB round trips
  at `src/app/playlists/page.tsx:42,54`, the non-retryable
  `hasLoadedSpotify.current` at `CreatePlaylistModal.tsx:96-116`, the
  `body as SpotifyPlaylist[]` cast at `CreatePlaylistModal.tsx:101-107`, the
  `connected={!spotifyLoadFailed}` conflation in `SpotifyImportPanel.tsx`, and
  the `PlaylistGroupList` prop count — were all logged and remain
  non-blocking. I am not re-raising them; they are recorded in
  `docs/suggestions-log.md` for RH-64/RH-65 triage, which is the right place for
  them.

## [RH-63] Convert /playlists to a Server Component with client islands (QA r1) — 2026-09-09

- `src/lib/__tests__/transactionAtomicity.db.test.ts > rejects two concurrent inserts that would take the
  same position` failed once in three full-suite runs (`expected null to be an instance of Error`) and
  passed in isolation and on both re-runs. The file is untouched by this task, so it is out of scope
  here, but it is a real intermittent failure that will surface in CI: the test appears to assume the
  two concurrent inserts always collide, which is not guaranteed under parallel worker load. Worth a
  separate task to make the collision deterministic.
- `src/components/playlists/__tests__/CreatePlaylistModal.test.tsx` spells its cleanup as
  `afterEach(() => { cleanup(); vi.unstubAllGlobals() })` rather than the literal `afterEach(cleanup)`
  the ER names, while `PlaylistsView.test.tsx` uses the literal form. Behaviour is equivalent; only
  noting the inconsistency in spelling between the two sibling suites.
- The `next build` log emits eleven `BetterAuthError: You are using the default secret` lines during
  page-data collection. Pre-existing and unrelated to this change, but it makes real build errors harder
  to spot in CI logs.

## [RH-64] Server Components parte 4/5: reduzir useBandAdmin a dados mais comandos de intencao (spec review r1) — 2026-09-09

1. ER6's parenthetical "(it does at `35d6f66` too)" on
   `rtk proxy npx eslint src/hooks src/lib/bandAdminState.ts 'src/app/bands/[id]/page.tsx'`
   is false at the baseline: `src/lib/bandAdminState.ts` does not exist yet, so
   eslint exits non-zero with `No files matching the pattern
   "src/lib/bandAdminState.ts" were found`. The requirement itself is fine
   post-implementation; only the baseline aside is wrong. Same ER's gloss "which
   for `src/hooks` means every hook file ... is clean under the base budget with
   no per-file relaxation" is also slightly off - `src/hooks/useTabLibrary.ts`
   keeps a `max-params` 5 override (eslint.config.mjs:81), so a clean run over
   `src/hooks` does not by itself prove the absence of per-file relaxation
   there. ER7's `grep -c "src/hooks/useBandAdmin.ts" eslint.config.mjs` is what
   actually proves it for the file that matters.
2. The Audit states `BandProfileView` destructures "30 members" in its two
   statements (lines 50-57 and 59-63). It is 37 (28 + 9). The figure 30 looks
   like a carry-over from F14's own "must destructure 30+ names". Nothing
   depends on it, but it is the one number in the Audit that does not reproduce.
3. `handleDelete`, `handleLeave` and `handleRemoveMember` each call
   `setError(null)` before staging (hook lines 249, 255, 260), so opening a
   confirmation clears a previous banner today. The spec's "verbatim" promise
   covers `confirmPendingAction`'s switch but not this; the flow inventory does
   not mention it and no ER asserts it. Worth one sentence saying
   `pending.request*` still clears the shared error, since
   `useBandPendingAction` will need a `dismissError` (or equivalent) passed in
   from the composition root either way.
4. The spec moves `PendingAction` to `src/lib/bandAdminState.ts` to avoid a
   hook-to-hook type import, but says nothing about `BandAdminActions`, which
   both sub-hooks need and which must stay exported from
   `src/hooks/useBandAdmin.ts` (its only importer,
   `src/app/bandAdminActions.ts`, is out of scope). Suggest naming the intended
   route - `import type { BandAdminActions }` (or a `Pick<>` of it) in the
   sub-hooks, which TypeScript erases so no runtime cycle appears.
5. ER7 requires `src/app/profile/page.tsx`'s `max-lines` ceiling to be strictly
   below 723, i.e. the file must shrink. It only can if the rewritten
   destructuring keeps the page's condensed multi-name-per-line style: 19 names
   written one per line would be ~21 lines against today's 13 and would grow the
   file by ~8. The Approach hints at this ("lose ~20 and ~8 lines
   respectively"); making it explicit would remove the trap.
6. ER4 pins `Tests 11 passed (11)` on `bandAdminState.test.ts` with 11 exact
   names, which forbids a twelfth pure-function test (for instance
   `isDraftNameBlank` on a non-blank name). Consider `>= 11` with the eleven
   names still required, so extra coverage of pure functions is not penalised.
7. `useBandAdmin.ts`'s own doc comment (lines 61-71) ends on "so a caller can
   close over this hook's own `setError` without re-running the load effect on
   every render". After this task there is no `setError`; the sentence should
   name `reportError`. Not covered by any ER and easy to leave stale.
8. The Audit records the baseline state of `bands-confirm` and `server-pages`
   but not of `e2e/ssr-smoke.spec.ts`, which ER8 nonetheless asserts is
   "unchanged from `35d6f66`" at `4 passed`. It is well-founded - RH-63's ER9
   required `ssr-smoke` green and RH-63 is `35d6f66` - and the file does hold 4
   tests, but one line in the Audit would close the gap without a QA having to
   go read the previous spec.

## [RH-64] Server Components parte 4/5: reduzir useBandAdmin a dados mais comandos de intencao (dev r1) — 2026-09-09

- **AGENTS.md's directory map now lists one of four band-controller files.** The
  map under `src/hooks/` names `useBandAdmin.ts` as "Band-detail controller
  shared by /bands/[id] and the /profile band tab", which is still true, but the
  controller is now four files (`useBandAdmin.ts`, `useBandEdit.ts`,
  `useBandPendingAction.ts`, `src/lib/bandAdminState.ts`). RH-64's Out of Scope
  forbids any AGENTS.md edit beyond `21` -> `20`, so this is recorded rather than
  done: a follow-up could add the two sibling hooks and the state module to the
  map, the way the Fast View controllers are described in the architecture
  bullet.
- **`pending.confirm` cannot be backed by a function literally named `confirm`.**
  `src/lib/__tests__/noBrowserDialogs.test.ts` (RH-16) greps all of `src` for
  `confirm(` and does not exempt a declaration, so `async function confirm()`
  inside `useBandPendingAction.ts` fails that guard even though nothing native is
  involved. The member is exposed as `confirm: confirmPending`. A future spec
  that names a controller command `confirm` should say so up front, or the guard
  should learn to skip `function confirm(`.
- **The `[id]` glob in an eslint CLI argument is load-bearing.**
  `npx eslint 'src/app/bands/\[id\]/page.tsx'` (brackets escaped the way
  `eslint.config.mjs` needs them) fails with `No files matching the pattern`,
  while the unescaped `'src/app/bands/[id]/page.tsx'` from ER6 works. Worth a
  note wherever the re-pinning recipe is written down, since the recipe tells the
  implementer to lint the file by path.

## [RH-64] Server Components parte 4/5: reduzir useBandAdmin a dados mais comandos de intencao (code review r1) — 2026-09-09

1. **`invite.copied` never gets tested reverting after 2000 ms.**
   `src/hooks/useBandAdmin.ts:217` schedules `setTimeout(() => setCopied(false),
   2000)`, and the spec's behaviour inventory calls out "the `Copied!` label
   reverting after 2000 ms", but no test advances timers over it. The baseline
   suite did not cover it either, so this is not a regression and I am not
   blocking on it — but `vi.useFakeTimers()` plus
   `act(() => vi.advanceTimersByTime(2000))` in
   `copies the invite URL and flags the copied state`
   (`src/hooks/__tests__/useBandAdmin.test.tsx:348`) would close the last
   uncovered branch of the invite widget cheaply.

2. **The delete/leave `it.each` runs two scenarios against one mounted hook.**
   `src/hooks/__tests__/useBandAdmin.test.tsx:607-633` asserts the success leg
   (`onGone`, action cleared) and then re-triggers the same command with
   `mockRejectedValueOnce` to assert the failure banner. It passes and the
   coupling is deliberate, but a failure in the second half will report under a
   title that describes the first, and the two legs share mutated spy state.
   Splitting into two `it.each` blocks would keep ER5's required titles on the
   success legs and give the failure legs their own names.

3. **Type-only import cycle between the composition root and its sub-hooks.**
   `src/hooks/useBandEdit.ts:12` and `src/hooks/useBandPendingAction.ts:3` do
   `import type { BandAdminActions } from "@/hooks/useBandAdmin"`, while
   `useBandAdmin.ts:3-7` imports both of them. It is erased at compile time, `tsc
   --noEmit` is clean and the jsdom suite proves no runtime cycle, and it is the
   route spec review explicitly proposed — but note the spec moved `PendingAction`
   into `src/lib/bandAdminState.ts` for exactly the purpose of *avoiding* a
   hook-to-hook type import, and `BandAdminActions` reintroduces one. A follow-up
   could move the `BandAdminActions` interface next to `PendingAction` in
   `src/lib/bandAdminState.ts` (or a new `src/lib/bandAdminActionsContract.ts`),
   leaving `src/hooks/useBandAdmin.ts` to re-export it for
   `src/app/bandAdminActions.ts`. Out of scope here — `bandAdminActions.ts` is
   pinned unchanged by ER10.

4. **`/profile`'s `onNotFound` closes over a `const` declared 8 lines later.**
   `src/app/profile/page.tsx:43` is `onNotFound: () => reportError("Band not
   found.")`, but `reportError` is destructured at line 51. This is safe —
   `useBandAdmin` reads `onNotFound` through a ref and only calls it from the
   load effect, long after the binding initializes, and the hook's doc comment
   (`src/hooks/useBandAdmin.ts:111-114`) documents the guarantee — but it reads
   as a TDZ hazard to anyone who has not read that comment. A one-line comment at
   the call site pointing at the guarantee would save the next reader the trip.

5. **AGENTS.md's directory map still describes the controller as one file.**
   `AGENTS.md:135` names only `useBandAdmin.ts`; the controller is now four files
   (`useBandAdmin.ts`, `useBandEdit.ts`, `useBandPendingAction.ts`,
   `src/lib/bandAdminState.ts`). Correctly *not* done here — RH-64's Out of Scope
   forbids any AGENTS.md edit beyond `21` → `20`, and ER7 pins the numstat to
   `1 1` — and the developer already logged it in `docs/suggestions-log.md`.
   Noting it so the follow-up is not lost.

6. **Consider tightening `noBrowserDialogs`' detector to skip declarations.**
   `src/lib/__tests__/noBrowserDialogs.test.ts:23`'s `DIALOG_CALL` matches
   `function confirm(` as well as a call, which is what forced Deviation A. A
   negative lookbehind for `function\s+` (or an explicit
   `(?<!function\s)` / declaration filter, with a detector test for it) would let
   a future controller name a command `confirm` honestly. Out of scope for RH-64
   — that file is outside the whitelist and ER10 pins the changed-file set — and
   already logged by the developer.

## [RH-64] Server Components parte 4/5: reduzir useBandAdmin a dados mais comandos de intencao (QA r1) — 2026-09-09

- `e2e/bands-confirm.spec.ts` is flaky in this environment at roughly one
  failure in three full-file runs, and the flake predates this task (reproduced
  at `35d6f66` with the untouched RH-16 tests, including two failures out of
  five repeats of `cancel keeps the band` alone). The symptom is the band
  detail page stuck on `Loading...` right after `createBand` navigates to
  `/bands/<id>`, i.e. the `BANDS_PAGE_LOAD_POLICY` "keep loading on not-found"
  branch being hit for a band that was just created. Adding a fourth test to
  the file raises the per-run probability that at least one test hits it, so it
  will be seen more often from now on. Worth a separate task: either make
  `createBand` retry the heading assertion, or find the read-after-write race
  behind the not-found.
- Nothing in the refactor itself invites a change; the surface test that pins
  the 19 keys is a good guard against the setters creeping back.

## [RH-65] Server Components parte 5/5: tornar src/proxy.ts uma conveniencia de redirect estreita e documentada (spec review r1) — 2026-09-09

1. **`## Approach`, "What changes for a visitor, exactly", first bullet is
   factually wrong.** It says a stale-cookie visitor on a gated private route
   sees "The page's own `authClient.useSession()` resolves to no user and it
   renders its signed-out state." `grep -rn useSession` shows that none of
   `/profile`, `/settings`, `/songs/search`, `/songs/[id]/fast-view` or
   `/bands/[id]` calls `useSession` at all, and neither `src/app/AppShell.tsx`
   nor `src/components/layout/AppLayout.tsx` redirects on a missing session —
   they merely skip loading data. Measured, the visitor gets HTTP 200 and an
   empty app shell with no bounce. The **conclusion** (no exposure) is still
   correct, for a different reason: those pages are either statically
   prerendered or fed exclusively by fail-closed Server Actions. Rewriting the
   bullet to say that would make the spec's security argument true as written.
2. **The header comment's "every route handler under `src/app/api/` answers its
   own 401" overstates.** `/api/spotify/playlists` answers `200
   {"connected":false}`, `/api/dev/profiles` answers `404`, and
   `/api/auth/spotify/authorize` answers no 401 at all. Since this comment is
   the durable statement of where authorization lives, consider "every route
   handler under `src/app/api/` resolves its own session and answers for
   itself" instead. No ER greps the sentence, so this is prose quality only.
3. **Test 12's name carries the same overstatement** — `passes a present but
   unvalidated session cookie through to the page, which owns the authorization
   decision`. For `/profile` the decision is owned by the Server Actions, not
   the page. Consider `…, which no longer receives a redirect` or similar.
   Changing it means changing ER4's literal list too.
4. **`/api/auth/spotify/authorize` has no session check** and hands an
   `spotify_oauth_state` cookie plus a Spotify consent redirect to any
   anonymous caller. This is true at `6aa099c` and unchanged by RH-65 (it sits
   under `skipSession`), so it is correctly out of scope — but it is exactly
   the kind of thing F10's "no route may rely on the proxy" is about. Worth a
   `docs/suggestions-log.md` entry alongside the HMAC follow-up the spec
   already plans.
5. **`## Audit` coverage numbers are slightly off.** The spec records
   statements `97.58` and functions `99.73`; a fresh `npm run test:coverage` at
   `6aa099c` prints `97.53` and `99.47`. No ER depends on them (ER10 pins only
   the thresholds and the per-file one-liner, which reproduces exactly), so
   this is cosmetic.
6. **Citation off by two.** `## Audit` cites `proxy.md:253` for "Proxy defaults
   to using the Node.js runtime"; it is line 255. The `proxy.md:249-251` quote
   about Server Functions is correct.
7. **Minor internal tension.** `## Approach` says "the implementer records it
   in `docs/suggestions-log.md`", while `## Whitelist` lists that file as
   "permitted but not required" and no ER checks it. Harmless, but picking one
   would remove the wobble.

## [RH-65] Server Components parte 5/5: tornar src/proxy.ts uma conveniencia de redirect estreita e documentada (follow-up candidates, dev) — 2026-09-09

- **A session cookie whose HMAC does not verify bounces its owner off the auth
  pages until it expires.** `src/proxy.ts` now checks cookie *presence* only, by
  design and by declaration. Better Auth clears a cookie whose signature
  verifies but whose session row is gone (`GET /api/auth/get-session` answers
  `null` plus a `Max-Age=0` `Set-Cookie`), and `/` and `/api/auth/(.*)` are
  deliberately outside the matcher so that recovery stays reachable. The
  residual case is a cookie that was hand-crafted or issued under a rotated
  `BETTER_AUTH_SECRET`: nothing clears it, so `/login` keeps redirecting to `/`.
  Two candidate fixes, neither in RH-65's scope: verify the cookie's HMAC in the
  proxy (`getSessionCookie` has no such mode, so this means importing
  `@better-auth/utils`' signer and re-introducing a small amount of crypto work
  per matched request), or add a `/login?signout=1` escape hatch that skips the
  signed-in redirect and clears the token client-side.
- **`/api/auth/spotify/authorize` has no session check of its own.** Raised in
  the RH-65 spec review (r1, item 4) and true at `6aa099c`: the handler hands an
  `spotify_oauth_state` cookie plus a Spotify consent redirect to any anonymous
  caller. It sat under the old proxy's `skipSession` prefix list, so RH-65
  neither improves nor regresses it — but it is exactly the class of thing F10's
  "no route may rely on the proxy" is about, and it is the last `/api/` handler
  that answers a stranger without resolving a session. Worth its own task
  alongside the two `authorize`/`callback`/`disconnect` siblings.

## [RH-65] Server Components parte 5/5: tornar src/proxy.ts uma conveniencia de redirect estreita e documentada (code review r1) — 2026-09-09

1. **`src/proxy.ts:16-17` and `AGENTS.md:48` — "every route handler under
   src/app/api/ resolves its own session and answers for itself" is still not
   literally true of two handlers.** `/api/auth/spotify/authorize` resolves no
   session at all (it hands a CSRF cookie and a consent redirect to any
   anonymous caller), and `/api/dev/profiles` gates on `NODE_ENV`, not on a
   session. Both are correctly out of scope and both are logged as follow-ups,
   but the sentence sits in the file whose entire purpose is a durable, precise
   statement of where authorization lives — and `docs/suggestions-log.md` now
   contains a bullet that directly contradicts it ("the last `/api/` handler
   that answers a stranger without resolving a session"). A four-word
   parenthetical — "…answers for itself (the two exceptions,
   `/api/auth/spotify/authorize` and `/api/dev/profiles`, are tracked in
   `docs/suggestions-log.md`)" — would close the gap without touching any ER.

2. **`src/lib/__tests__/proxy.test.ts:20` — the matcher guard compiles entries
   as plain JS regex, which is a close approximation of Next's path-to-regexp,
   not the thing itself.** It agrees perfectly for all twelve current entries (I
   verified against `getMiddlewareMatchers`), so nothing is wrong today. But a
   future entry written in the named-parameter dialect the same docs endorse —
   `/bands/:path*` — would sail through `new RegExp('^/bands/:path*$')` as a
   *literal-colon* pattern matching nothing, and the suite would still be green
   while the redirect silently stopped firing. Compiling through
   `next/dist/build/analysis/get-page-static-info`'s `getMiddlewareMatchers`
   instead would make the guard exact. Out of scope here (ER5 pins the current
   idiom via the untouched `pdfWorkerAsset.test.ts`), but worth a follow-up.

3. **`src/app/api/spotify/search/route.ts:71` — the bare `catch` turns a
   `getSession()` infrastructure failure into a `401`, not a `500`.** This is
   fail-closed, it is byte-for-byte the pattern
   `/api/auth/spotify/disconnect:14` and `/api/auth/spotify/callback:113`
   already use, and the old proxy behaved the same way (a failed session lookup
   became a `307` to `/login`), so there is no regression and consistency argues
   for leaving it. Noted only so the choice is on the record.

4. **Message-string drift across the 401 envelopes** — `'Not authenticated'`
   (search), `'Unauthorized'` (disconnect), `'User is not authenticated'`
   (callback). The R1-mandated shape `{ error, code }` is consistent; only the
   fixed message varies. Pre-existing, not introduced by this change, and a
   one-line constant in `@/lib/auth-session` would settle it whenever someone is
   next in those files.

## [RH-65] Server Components parte 5/5: tornar src/proxy.ts uma conveniencia de redirect estreita e documentada (QA r1) — 2026-09-09

- ER6's fifteen-route table and ER7's `/nope` 404 are only asserted by curl in this report; the
  vitest matcher tests cover the same routing decisions in-process, but there is no committed
  regression test that a *new* private page route added under `src/app/` is either present in the
  matcher or self-guarding. `src/proxy.ts` warns about this in prose ("A new private page route does
  not inherit the redirect - add it here"); a test enumerating page directories and asserting each
  either matches the matcher or calls `redirect('/login')` would make the warning enforceable.
- `npm run test:coverage` reports `Functions 376/377`; the single uncovered function is outside this
  task's scope, but pinning it would let the functions threshold be raised from 78.

## [RH-41] Carregar dados de pagina em Server Components e enxugar os controllers client (spec review r1) — 2026-09-09

- Reconcile RH-63's QA figure explicitly. RH-63 measured "11 prerendered / 17
  dynamic" at `35d6f66`; this spec says 10 / 17 at `66d9442`, and a reader
  comparing the two records will suspect a route regressed. It did not: the route
  file set is identical at both commits (26 route-defining files, empty diff),
  and `grep -c '○'` without the trailing ` /` prints 11 on today's log because it
  also counts the `○  (Static)` legend line. One sentence in the "Two properties
  of the build output are traps" paragraph would close that loop permanently.
- The F10 `**Status:**` line asserts "every Server Action, route handler and
  Server Component page resolves its own session and answers for itself". That is
  AGENTS.md L48's convention almost verbatim, and spot checks agree with it
  (`deleteBandAction` and `updateSongLinksAction` both call `getRequiredUserId()`
  today), but in this document F1, F2, F3, F7 and T1 are still open findings
  saying several actions do not — and F10's own "Why it matters" cites them by
  name. Phrasing it normatively ("no page, action or route handler may rely on
  it: each resolves its own session") would state the convention without reading
  as a claim that F1/F2/F7 are closed.
- ER9 requires `git diff --name-only 66d9442 | sort` to print the four whitelist
  paths and "nothing else". RH-40's equivalent ER said "a subset of exactly this
  whitelist", which is the safer form: if a review round ends with no suggestions
  appended, `docs/suggestions-log.md` would not be in the diff and a correct
  implementation would fail an exact-set check. The `-- src migrations e2e
  eslint.config.mjs vitest.config.ts AGENTS.md README.md
  docs/plans/mobile-app-analysis.md` clause already carries the real closure.
- ER9 contains a `§` (in "re-deriving its §3.2 conclusion"). It round-tripped
  into the persisted `expected_results` intact, so nothing is broken, but
  "section 3.2" would keep that ER ASCII-only; ER4's box glyphs cannot be
  avoided the same way since they are the literal build-output symbols.
- Post-merge checks already name both follow-ups (the mobile-app-analysis
  correction and a Server-Component page-pattern guard). Worth stating in the
  second one which allow-list the guard would need, since Out of Scope says that
  allow-list is what makes it its own task.

## [RH-41] Carregar dados de pagina em Server Components e enxugar os controllers client (spec review r2) — 2026-09-09

- The Audit says `docs/plans/mobile-app-analysis.md` repeats the claim "in six
  places" and then lists seven line numbers (L17, L29, L137, L169, L181, L311,
  L330); `grep -c "force-dynamic"` prints 7. Say "seven" or drop the count. The
  Out of Scope bullet lists eight numbers because it folds in L39, the proxy
  claim, which is a different assertion — worth splitting the two lists
  explicitly.
- The F15 line says the four dashboards read through "Server Actions in
  `src/app/actions/` calling `getRequiredUserId()`". For `/` and `/bands/[id]`
  the call is one level down, in `resolveOwner()` inside
  `src/app/actions/repertoire.ts` (and the bands/playlists actions call it
  directly). "calling `getRequiredUserId()`, directly or through
  `resolveOwner()`" would be exactly true and costs four words.
- ER8 is now the longest ER and reads three separate assertions about the same
  F15 line (a `grep -c`, a prose reading, and the ten-file correspondence). If
  the line changes for blocking finding 1, consider pinning the group membership
  with a second literal pattern (for example a phrase containing
  `fast-view` alongside `deferred with no named owner`) so QA has a grep rather
  than a reading for the part that just went wrong twice.
- Post-merge checks now list three follow-ups; if `/songs/[id]/fast-view` joins
  the unowned group, the third bullet's list should say five pages, and the
  allow-list named in the guard follow-up (ten pages) still stands unchanged.

## [RH-41] Carregar dados de pagina em Server Components e enxugar os controllers client (spec review r3) — 2026-09-09

- ER8 says the three finding lines "between them they name the commit ids
  `57bc60a`, `6e32874`, `35d6f66`, `6aa099c` and `66d9442` (the F15 line names
  one further id, `e985ba5` ...)". The F14 line also names `246313f` and the F15
  line also names `13da8b2`, both as measurement baselines rather than as
  resolution claims. A QA reading "one further id" as exhaustive could stumble;
  "names no further *resolution* id beyond `e985ba5`" would close that reading
  for four words.
- ER8 is now 4190 characters and is by some margin the longest result. The two
  literal patterns (`deferred with no named owner`, `decomposed and closed by
  F6`) already carry the part that went wrong twice, so the long prose
  restatement of the F15 line that follows them could be trimmed to the
  assertions that are not already pinned by a grep, without losing any
  mechanical strength.
- The Audit's group-3 paragraph (spec L254-268) runs a single sentence from
  "The first four are interactive dashboards" through the `/settings` route
  handler; L259 is also the one line in the spec whose wrap is broken
  ("... being closed. They read *and* mutate, ..."). Purely cosmetic, but it is
  the paragraph a future reader will go to first when re-deriving the grouping.
- The F15 line points at `docs/tasks/RH-41-spec.md` as the durable record of the
  five unowned pages. That file is committed by ER9, so the reference resolves;
  if the orchestrator later opens the follow-up task from the Post-merge list,
  updating that pointer to the new task id would keep the review document
  self-contained.

## [RH-41] Carregar dados de pagina em Server Components e enxugar os controllers client (code review r1) — 2026-09-09

1. `docs/tasks/RH-41-spec.md:130` says "`src/proxy.ts` opens with a 22-line
   header comment". The file opens with two `import` lines; the 22-line comment
   is at L4-25. The shipped review-doc line does not repeat the imprecision - it
   says "the file's own header comment declares in its second line", which is
   exactly right (comment L5 is
   `NOT AN AUTHORIZATION BOUNDARY (RH-65, code-quality review F10).`). Nothing to
   change in the merged artefact; noting it only so a later reader of the spec is
   not confused. Not worth a revision round.

## What was checked, and the evidence

### 1. The five inserted lines are byte-identical to the spec's Approach fences

Extracted the five added lines from
`git diff --cached 66d9442 -- docs/plans/code-quality-review.md` (strip `+`) and
the fence bodies from the Approach section (spec L399-460), then `diff`ed them:
identical, 5 lines against 5 lines, no differences, same order. Both sides carry
"seventeen tests" after the orchestrator's correction, so the transcription
picked up the corrected text rather than the pre-correction draft.

`git diff --cached --check 66d9442` exits 0 (no trailing whitespace, no
whitespace errors) and the file contains no CR bytes.

### 2. Placement and house format

Insertion points, verified in the working tree:

| Line | Heading (line) | Preceding line |
|---|---|---|
| 324 `**Status:** Resolved by RH-65` | `### F10 ...` (317) | 323 `**Remediation:**` |
| 357 `**Correction (RH-41):**` | `### F14 ...` (350) | 356 `**Remediation:**` |
| 358 `**Status:** Resolved by RH-64` | `### F14 ...` (350) | 357 the Correction |
| 367 `**Status:** Resolved by RH-61 ...` | `### F15 ...` (360) | 366 `**Remediation:**` |
| 560 `**Status:** Delivered by RH-61 ...` | `### T8 ...` (555) | 559 `**Covers:** F10, F13, F14, F15` |

Every line lands inside the block it belongs to and before the next `###`
(F11 at 326, F16 at 369, T9 at 562). The F14 pair is in the spec's prescribed
order, Correction then Status. The format matches the house style already in the
file - T7's `**Status:** Delivered by RH-54 (...)` at L553 is the immediate
neighbour of the new T8 line and has the same shape, and the finding lines use
`**Status:** Resolved` as F6, F8, F16, F17, F21, F22, F26 do.

ER8's mechanical counts all hold at the staged tree:

| Pattern | Expected | Measured |
|---|---|---|
| `^\*\*Status:\*\* Resolved` | 10 | 10 |
| `^\*\*Status:\*\* Delivered` | 4 | 4 |
| `^\*\*Correction` | 5 | 5 |
| `^\*\*Correction (RH-41):\*\*` | 1 | 1 |
| `RH-41` | 5 | 5 |
| `RH-53` | 2 | 2 |
| `deferred with no named owner` | 1 | 1 |
| `decomposed and closed by F6` | 1 | 1 |
| `The seven pages still fetching` | 0 | 0 |

The `RH-41` count of exactly 5 confirms none of the attributions was dropped
while transcribing, which the spec flags as load-bearing.

### 3. Every factual claim in the five lines is true at 66d9442

**F10 line.** `grep -c "pathname === '/'" src/proxy.ts` -> 0.
`grep -cE "fetch\(|AbortController|setTimeout|get-session|async |await "
src/proxy.ts` -> 0. `better-auth/cookies` -> 1, `getSessionCookie` -> 2,
`@/lib/auth` -> 0, `NOT AN AUTHORIZATION BOUNDARY` -> 1 (comment line 5, i.e.
the comment's second line, as claimed). The matcher has exactly 12 quoted
entries and they are exactly the twelve the line lists, in the order it lists
them: `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/profile`,
`/settings`, `/bands/(.*)`, `/playlists/(.*)`, `/songs/(.*)`, `/admin/(.*)`,
`/bands`, `/playlists`. AGENTS.md: `not an authorization boundary` -> 3,
`session gate on every request` -> 0,
`calls the Better Auth session endpoint via` -> 0.

**Proxy test count - the spec mis-count the developer reported.**
`src/lib/__tests__/proxy.test.ts` has 17 `it(` blocks, and
`rtk proxy npx vitest run src/lib/__tests__/proxy.test.ts` prints
`Test Files  1 passed (1)` / `Tests  17 passed (17)`, exit 0, nothing skipped.
The orchestrator's corrected ER1 (`Tests  17 passed (17)`, spec L499) is the
measured value. The four test names the F10 line and the spec cite all exist:
`resolves the session without ever calling fetch` (L67),
`passes a present but unvalidated session cookie through to the page, which owns
the authorization decision` (L116),
`does not match /, the invite route or any route under /api` (L151),
`lists exactly twelve matcher entries, each a valid regular-expression source`
(L178).

**F14 lines.** Returned-object surface: 19 members, 0 `set[A-Z]` at HEAD;
39 members and 10 setters at `246313f` (measured with the spec's own `awk`
slice against `git show 246313f:src/hooks/useBandAdmin.ts`). The nineteen names
in the Status line match the returned object exactly.
`src/lib/bandAdminState.ts` and `src/lib/bandAdminLoad.ts` both exist;
`wc -l src/hooks/useBandAdmin.ts` -> 288, `246313f` -> 370.
`grep -c "src/hooks/useBandAdmin.ts" eslint.config.mjs` -> 0, so the override
entry was deleted, not relaxed. Longest function measured directly:
`Function 'useBandAdmin' has too many lines (173)` and
`has a complexity of 13` - exactly the "298 to 173 at complexity 13, under the
base budget" the line claims.

**F14 Correction line.**
`rtk proxy npx eslint 'src/app/bands/[id]/page.tsx' 'src/app/profile/page.tsx'
--rule '{"complexity":["error",1]}'` still reports
`Function 'BandDetailPage' has a complexity of 30` and
`Function 'BandProfileView' has a complexity of 23`, so the correction's central
assertion (the scores did not move when the hook surface shrank to 19) is true
today. The independent corroboration also holds: `eslint.config.mjs:71` is
`files: ["src/app/bands/\\[id\\]/page.tsx"] ... complexity: ["error", 30],
"max-lines-per-function": ["error", 469], "max-lines": ["error", 487]`, and the
`ca91de2..66d9442` diff of that file shows the profile entry changing only
`394/723 -> 385/714` with `complexity: ["error", 23]` untouched - the ratchet
behaviour the line describes.

**F15 line.** Page sizes: `src/app/bands/page.tsx` 41,
`src/app/playlists/page.tsx` 58, `src/app/admin/moderation/page.tsx` 77 - all
three as stated. `grep -c "force-dynamic" src/app/layout.tsx` -> 0;
`grep -rl "force-dynamic" src/` -> exactly `src/app/api/dev/profiles/route.ts`;
no `export const revalidate` anywhere under `src/`. Census: 15 `page.tsx` files,
10 carrying `use client`. The ten files are exactly the ten the line enumerates:
`/`, `/bands/[id]`, `/forgot-password`, `/login`, `/playlists/[id]`, `/profile`,
`/reset-password`, `/settings`, `/signup`, `/songs/[id]/fast-view` - so the
4 + 1 + 5 grouping is checkable against the tree and the arithmetic closes.
The four island/guard suites named all exist
(`rootLayoutRendering.test.ts`, `BandsView.test.tsx`, `PlaylistsView.test.tsx`,
`ModerationQueue.test.tsx`).

Ownership claims in the F15 line: F11's `**Location:**` is only
`src/app/playlists/[id]/page.tsx:273`/`:1076`, so handing `/playlists/[id]` to
F11/RH-53 is right and the other four dashboards are correctly *not* attributed
to it. RH-53 is `backlog` in `.meridian/tasks.json`. F6 (heading at L281) carries
`**Status:** Resolved by RH-48 (a49a295) ... and RH-52 (e985ba5)`, so it is
closed and cannot own future work, which is exactly the reasoning the line gives
for putting `/songs/[id]/fast-view` in group 3.
`src/app/songs/[id]/fast-view/page.tsx` is 222 lines with 0 `useState`/
`useEffect` matches. The fail-closed chain is real:
`src/hooks/useSongEntry.ts:58` is the mount effect calling
`actions.getSongEntry` / the personal-entry action, wired in
`src/app/fastViewEntryActions.ts:23-24` to `getSongEntryAction` and
`getPersonalEntryForSongAction`; `getSongEntryAction`
(`src/app/actions/repertoire.ts:72`) calls `resolveOwner(bandId)` whose first
statement (L26) is `const userId = await getRequiredUserId()`, and
`getPersonalEntryForSongAction` (L149) calls `getRequiredUserId()` directly and
returns `null` on throw. `/settings`' claim holds too:
`src/app/api/spotify/playlists/route.ts:15` calls `getRequiredUserId()` and
L17/L23 answer `{ connected: false }` when it throws.

**Route split.** A build exists in `.next`, so this was read rather than trusted:
`prerender-manifest.json .routes` has 11 keys -
`/ /_global-error /_not-found /forgot-password /icon.jpg /login /profile
/reset-password /settings /signup /songs/search`; the `app-path-routes-manifest`
entries not in that set number 17 and are exactly the seventeen dynamic routes
the spec lists, out of 28 app paths total. The F15 line's "27 routes, of which
10 are prerendered ... and 17 are server-rendered on demand" is that same tree
minus `/_global-error`, and its ten-route static list matches the manifest set
minus `/_global-error` exactly. `/bands`, `/playlists` and `/admin/moderation`
are all in the dynamic set.

**T8 line.** All three F13 coordinates resolve in
`src/app/playlists/[id]/page.tsx` (1344 lines): L277
`const { data: session } = authClient.useSession()`, L291
`const [currentUserId, setCurrentUserId] = useState<string | null>(null)`, L343
`setCurrentUserId(session?.user?.id ?? null)`.

**Commit ids.** All ids named in the five lines and in the spec resolve and are
the tasks claimed: `57bc60a` perf(RH-61), `6e32874` refactor(RH-62), `35d6f66`
feat(RH-63), `6aa099c` refactor(RH-64), `66d9442` refactor(RH-65), plus the
cited `e985ba5` refactor(RH-52), `a49a295` refactor(RH-48), `246313f`
chore(RH-39), `13da8b2` test(RH-24), `ca91de2` fix(RH-60), `65cadd8`
test(RH-59).

**Overrides.** `grep -c 'complexity-budget/override' eslint.config.mjs` -> 20
(24 at `246313f`, 23 at `ca91de2`), and `eslint.config.mjs` is not in the diff.

### 4. Blast radius (ER9)

`git diff --cached --numstat 66d9442 -- docs/plans/code-quality-review.md` is
`5	0` - five insertions, zero deletions, so F13's block, T8's
`**Justification:**`, the section 2 tables and section 4 rows 10/13/14/15 are
untouched by construction.

`git diff --cached 66d9442 -- src` is empty.
`git diff --cached --name-only 66d9442 -- src migrations e2e eslint.config.mjs
vitest.config.ts AGENTS.md README.md docs/plans/mobile-app-analysis.md` prints
nothing. `git diff --cached --stat 66d9442 -- src/components/landing
src/i18n/dictionaries` prints nothing (Landing Page Rule not engaged).

`git diff --cached --name-only 66d9442 | sort` lists exactly the four whitelisted
paths and no others.

`package.json` version `0.1.95-202609091654` -> `0.1.96-202609091801`: matches
`^0\.1\.96-20[0-9]{10}$` and sorts strictly above the baseline. Patch bumped,
timestamp plausible for the commit's local time.

### 5. Spec internal consistency after the orchestrator's edit

`grep -n -i "nineteen\|seventeen" docs/tasks/RH-41-spec.md`:

- L54 "seventeen dynamic ones" - the 17 dynamic routes. Correct.
- L95 "seventeen dynamic routes above, out of 28 app paths" - same. Correct.
- L142 "seventeen tests across two `describe` blocks" - the 17 proxy tests.
  Correct (corrected from "nineteen").
- L416 (F10 fence) "whose seventeen tests assert ..." - the 17 proxy tests.
  Correct, and byte-identical to what landed at review doc L324.
- L157 "The nineteen are `currentUserId`, ..." - the 19 `useBandAdmin` members.
  Correctly left as "nineteen".
- L501 (ER2) "lists exactly these nineteen names" - same. Correct.

No occurrence of "nineteen" refers to a test count and no occurrence of
"seventeen" refers to a hook member count. ER1 reads `Tests  17 passed (17)`
(L499) and there is no surviving `passed (19)` anywhere in the spec. The review
document contains one occurrence of either word, "seventeen tests" at L324, and
no stale count. No mismatch to flag.

### 6. `docs/suggestions-log.md` is append-only

The diff has zero deletion lines. Reconstructed the check independently:
`git show 66d9442:docs/suggestions-log.md` is 5127 lines, and
`head -5127 docs/suggestions-log.md` is byte-identical to it - so the 84 new
lines are strictly appended. The appended block is a single
`## [RH-41] ... (spec review r1) - 2026-09-09` entry, consistent with the file's
existing entry format.

## Notes on scope

This is a documentation close-out with an empty `src` diff, so there is no new
logic to unit-test and no lint surface to dirty; the "missing unit tests for new
logic" and "dirty lint" blocking categories do not apply. The verification the
task is actually delivering is the ER set, and the parts of it that are cheap and
local were re-run here (proxy suite 17/17, the two complexity measurements, the
`useBandAdmin` surface, the manifest route split) rather than taken on report.
The full-suite, coverage, build and Playwright ERs are QA's to run.

## [RH-41] Carregar dados de pagina em Server Components e enxugar os controllers client (QA r1) — 2026-09-09

- ER4's manifest-based reading is the right call, but the F15 status line in
  `docs/plans/code-quality-review.md` still quotes the printed route table ("27 routes, of which 10 are
  prerendered"). That is accurate for the table and ER4 explains the 27/28 and 10/11 reconciliation, but
  a future reader comparing the document against `prerender-manifest.json` (11 entries, including
  `/_global-error`) will hit the same discrepancy RH-63's QA hit. A parenthetical in that line naming the
  manifest counts would make the document self-reconciling. Non-blocking; no ER requires it.

## [RH-42] Exigir verificacao para troca de e-mail (spec review r1) — 2026-09-09

- **ER4's idempotency evidence is vacuous.** `scripts/migrate.mjs` records every
  applied filename in `_migrations` and prints `Skipping migration: ... (already executed)`
  on the second pass, so "running `npm run db:migrate` twice in a row exits 0 both
  times" never re-executes `0008` and proves nothing about `CREATE OR REPLACE` /
  `DROP TRIGGER IF EXISTS`. If the re-runnability is worth an ER, apply the file
  directly twice (`psql "$DATABASE_URL" -f migrations/0008_sync_profile_email.sql`,
  exit 0 both times). Low stakes — the runner never re-runs a recorded migration —
  which is why this is not blocking.
- **ER5 does not name the command that applies the new migration.** It says
  "(migrations applied)"; ER4 carries `npm run db:migrate`. Since QA reads the ERs as
  a set this works, but ER5 is the one QA will run first and it is otherwise
  scrupulously self-contained. One clause would close it.
- **ER13's `Status:` count is the only relative baseline in the spec.** "prints a
  number exactly 2 greater than at 890a27b" makes QA compute the baseline; every
  other ER states the absolute. It is `14` at 890a27b, so say "prints `16`".
- **The guard regexes are line-scoped and the codebase already shows the evasion.**
  `findViolations` splits on `\n` before testing, and `updateProfile` in
  `src/lib/profile.ts` writes its statement as a template literal with `UPDATE profiles`
  and `SET ...` on separate lines. A re-introduced raw identity write formatted the
  same way slips past both ER2 patterns. Worth either normalising whitespace before
  matching or noting the limitation in the suite's header comment, so the next reader
  does not over-trust it.
- **Approach §8 understates the `thinActions.test.ts` edit.** The table says "rename
  the entry to `requestEmailChangeAction`", but that row asserts
  `toHaveBeenCalledWith(USER_ID, ...)` under the title "passes the resolved session
  user id through to src/lib", and the new action passes `(Headers, newEmail)` and no
  user id. The row needs a new mock target (`@/lib/emailChange`), a `next/headers`
  mock, and a different `expected` shape. ER10 forces the suite green so the
  implementation is not ambiguous, but the prose will mislead the implementer's first
  pass.
- **Two line citations drift by three.** The audit cites `update-user.mjs` L465-475
  for `sendChangeEmailConfirmation` and L480-489 for the verification branch; the
  installed file has them at 468 and 482. L409, L414-417, L424, L431-435 and
  `sign-up.mjs:241` are exact, as is `email-verification.mjs:216-219`. Worth
  correcting since ER3 points a future reader at those numbers.
- **ER3 could pin `emailVerification.expiresIn`.** Approach §3 sets it to 3600 and
  nothing checks it; a link that expires in the default window is a different product
  than one that expires in an hour.
- **The taken-address copy is honest but silent.** ER8 correctly requires identical
  copy for the taken and free cases. Consider adding, in the pending state, a line
  telling the user what to do if no mail arrives — it costs nothing, leaks nothing,
  and is the only recourse a user has in the `{ status: true }`-with-no-mail case.
- **ER11's jscpd cap is tight.** Six new suites land in a tree already at exactly the
  pinned `18` clones. Nothing wrong with the ratchet, but the shared
  `describe.skipIf` / fixture-cleanup boilerplate across `emailChangeVerification.db.test.ts`
  and its neighbours is the likely place a nineteenth clone appears.

## Not verified

`npm run build`, the four green e2e specs and `npm run test:coverage` were not
re-run — they need a build and a running server, and none of the spec's claims about
them contradicted anything I could check statically. The CI env block, the e2e file
list and the coverage thresholds/`coverage-final.json` artefact were all confirmed by
reading `.github/workflows/ci.yml`, `vitest.config.ts` and `coverage/`.

## [RH-42] Exigir verificacao para troca de e-mail (spec review r2) — 2026-09-09

- **ER4's quoted call literal does not typecheck, and ER12 pins `tsc --noEmit`
  clean.** Probed with the exact object ER4 writes:

  ```
  auth.options.emailAndPassword.sendResetPassword({
    user: { email: 'reset-target@example.com', name: 'Jane' },
    url: 'https://example.com/reset?token=abc',
  })
  ```
  ->  `error TS2739: Type '{ email: string; name: string; }' is missing the
      following properties from type '{ id: string; createdAt: Date; updatedAt:
      Date; email: string; emailVerified: boolean; name: string; image?: ... }':
      id, createdAt, updatedAt, emailVerified`

  Not blocking: the ER's assertions (recipient, url, subject, resolves) are
  unaffected, and an implementer will add the four fields or cast. But a literal
  transcription breaks ER12 for a full round, so it is worth writing the ER's
  snippet with a complete `user` (`id`, `emailVerified`, `createdAt`,
  `updatedAt`) or with an explicit cast, since the whole point of ER4 is that it
  be transcribable.

- **ER3's rationale for `expiresIn: 3600` is factually wrong.** ER3 says the pin
  makes "a verification link live one hour rather than the package default".
  `3600` **is** the package default:
  `createEmailVerificationToken(secret, email, updateTo, expiresIn = 3600, ...)`
  at `email-verification.mjs:12`, and `init-options.d.mts:559` documents
  `@default 3600 seconds (1 hour)`. The assertion is still worth keeping — it
  pins the value explicitly and would fail if the option were dropped — but the
  justification should be "explicit rather than inherited, so a future default
  change cannot silently move it", not "rather than the package default".

- **The guard's known limitation is documented in Approach §7 but not required
  by any ER.** ER2 describes both halves of the suite without asking for the
  header comment, so the comment can be silently skipped. One clause in ER2
  (`grep` for a fragment of the limitation text in
  `src/lib/__tests__/identityWriteGuard.test.ts`) would close it. Trivial
  stakes — it is a comment inside a test file — which is why this is not a
  finding.

- **Approach §3's inline citations drift from the audit's.** §3 cites L465 and
  L480 where the audit (correctly, this round) cites L468 and L482 for the same
  two branches. Same code, two different numbers in one document; worth
  aligning since ER3 points a future reader at these lines.

## Not verified

`npm run build`, the four green e2e specs, `npm run test:coverage` and
`npm run lint:dup` were not re-run this round — none of them changed between the
two spec revisions, and round 1 confirmed the ones that are statically
checkable. No migration was applied and no write was issued to the local
database; the `psql` probe used a script that errors before touching anything
and a `SELECT`.

## [RH-42] Exigir verificacao para troca de e-mail (spec review r3) — 2026-09-09

- **ER5's parenthetical says "the second run" where, in the order ER5 itself
  prescribes, an unguarded migration already fails on the first psql run.**
  Because `npm run db:migrate` has applied the file before the two psql runs, run
  1 is application #2 and is where `CREATE TRIGGER` would collide. Harmless — the
  pass criterion is "exits `0` on both runs" — but "would exit `3` on a repeat
  application" would be the accurate rationale.
- **Write ER4's snippet with a complete `user` object** (`id`, `emailVerified`,
  `createdAt`, `updatedAt`) or an explicit cast. The literal as written does not
  typecheck (`TS2739`), and ER12 pins `tsc --noEmit` clean; the ER is meant to be
  transcribable.
- **ER3's rationale for `expiresIn: 3600` is factually wrong** (carried from round
  2, unadopted). `3600` *is* the package default —
  `createEmailVerificationToken(secret, email, updateTo, expiresIn = 3600, ...)`
  at `email-verification.mjs:12`, `@default 3600 seconds (1 hour)` at
  `init-options.d.mts:559`. Keep the assertion, fix the justification to
  "explicit rather than inherited".
- **The guard's known limitation is documented in Approach §7 but required by no
  ER** (carried from round 2, unadopted). One `grep` clause in ER2 for a fragment
  of the limitation text would close it.
- **Approach §3's line citations drift from the audit's** (carried from round 2,
  unadopted): §3 says L465/L480, the audit says L468/L482 for the same two
  branches. Worth aligning, since ER3 points a future reader at these lines.

## Not verified this round

`npm run build`, the four green e2e specs, `npm run test:coverage`,
`npm run lint:dup` and `rtk proxy npx eslint .` — none of the ERs carrying them
changed in this revision, and rounds 1 and 2 covered what is statically
checkable. No migration applied; the only database interaction was the
`SELECT`-only `ON_ERROR_STOP` probe described above.

## [RH-42] Exigir verificacao para troca de e-mail (implementation) — 2026-09-09

Three deliberate departures from what the spec's source findings asked for,
recorded here because each is a decision a future reader could otherwise read as
an omission.

- **F12's remediation asks to keep the raw identity write behind
  `checkSystemAdmin`; it was deleted outright instead.** There is no admin caller
  today and none is planned in this task, `npm run lint:dead` (knip) fails on an
  export nobody imports, and a privileged raw-identity write kept alive "for
  later" is precisely what `src/lib/__tests__/identityWriteGuard.test.ts` now
  exists to prevent. If an admin-facing email edit is ever needed it is a new
  task and it goes through `auth.api.changeEmail` / `auth.api.updateUser` behind
  an admin check, not through SQL.
- **F12's remediation also asks for a uniqueness pre-check; it was deliberately
  not implemented.** A distinct "that address is already registered" answer is an
  account-enumeration oracle on an endpoint any signed-in user can call. Better
  Auth 1.6.22 answers the taken case with a silent `{ status: true }` and sends
  no mail (`node_modules/better-auth/dist/api/routes/update-user.mjs` L431-435),
  and uniqueness itself is enforced by the `UNIQUE` constraint on `"user".email`.
  The UI copy is therefore identical for the taken and the free case, which
  `src/components/profile/__tests__/EmailChangeSection.test.tsx` asserts.
- **RH-36's `updateEmail leaves the user row untouched ...` atomicity case
  (recorded as ER3(b) of `docs/tasks/RH-36-spec.md`) was removed, not
  preserved.** The function it exercised no longer exists. The property it
  asserted - that the auth row and the profile row never disagree - is asserted
  more strongly by `src/lib/__tests__/emailChangeVerification.db.test.ts`, which
  drives the real Better Auth write and proves the trigger rolls the `"user"`
  row back when the `profiles` write fails.

## Follow-ups worth a task later

- **The guard is line-scoped and says so.** `findViolations` splits on `\n`
  before matching, so a raw identity write formatted as a multi-line template
  literal - the shape `updateProfile` in `src/lib/profile.ts` already has - would
  not be caught. The limitation is written into the suite's header comment rather
  than hidden. A parser-based check (or a `stripComments`-style statement
  joiner in `test-helpers.ts`) would close it for every guard in the repo at
  once, not just this one.
- **No end-to-end spec covers `/profile`.** The flow needs a mailbox, so the
  database suite carries the behaviour instead. If a mail-capture fixture ever
  lands in `e2e/`, the change-email round trip is the first thing worth putting
  through it.

## [RH-42] Exigir verificacao para troca de e-mail (code review r1) — 2026-09-09

1. **`mailOrLog`'s catch is unreachable in production (`src/lib/auth.ts:22-31`).**
   `sendAuthEmail` already swallows every provider failure internally
   (`src/lib/authEmail.ts:78-85`) and nothing outside its own `try` can throw, so
   it never rejects — the wrapper's `catch` can only fire when `@/lib/authEmail`
   is mocked, which is exactly the one test that covers it
   (`authConfig.test.ts:130`). Two layers swallowing the same failure also means
   a real Resend outage logs `Failed to send auth email` once, from the inner
   layer, and the outer message is dead text. The spec prescribed both layers, so
   this is not a defect — but a one-line note in `mailOrLog`'s doc comment saying
   it is a belt-and-braces guard against a *future* throwing sender (rather than a
   live path) would stop the next reader from assuming the inner swallow is
   missing. Alternatively, collapse to one layer by letting `sendAuthEmail`
   propagate and keeping only `mailOrLog`.

2. **`emailChangeVerification.db.test.ts` is order-coupled.** Case (b) reads
   `captured[0]` populated by case (a); case (e) depends on the verified state
   case (b) leaves behind; case (c) runs last and depends on (e). The file labels
   them (a),(b),(d),(e),(c) — the declaration order is deliberately not the
   alphabetical order, which is a hint but an easy one to miss. A `.only` or a
   reorder during a future edit will produce a confusing failure rather than a
   skip. Consider either a comment at the top of the `describe` stating the chain
   explicitly, or asserting the precondition at the head of each dependent case
   (e.g. `expect(captured).toHaveLength(1)` before reading `captured[0]` in (b)).

3. **The dev echo is not gated on `NODE_ENV`** (`src/lib/authEmail.ts:79-83`).
   With no `RESEND_API_KEY` the token URL — a single-use credential that moves the
   login identity — is written to `console.log` in whatever environment the app is
   running in. In practice a production deployment without a mail provider cannot
   complete the flow at all, and this is verbatim the 890a27b behaviour the spec
   asked to preserve, so it is not a regression. Still, adding
   `process.env.NODE_ENV !== 'production'` to the condition (and logging a
   `logger.warn` about the missing provider in production instead) would make the
   "this is the local path" claim in the doc comment enforced rather than assumed.

4. **The pending banner survives a subsequent edit of the field**
   (`src/components/profile/EmailChangeSection.tsx:94-103`). After a successful
   request, `sentTo` stays set; typing a *different* address keeps showing
   "Confirmation link sent to `<the previous address>`" and suppresses the
   "We will email a confirmation link to `<new value>`" preview, because the
   ternary branches on `sentTo` before checking `submittable`. Clearing `sentTo`
   in the `onChange` handler (or preferring the preview when
   `trimmed !== sentTo`) would keep the two lines from contradicting each other.
   Cosmetic; no expected result covers it.

5. **`injectProfilesFailure` interpolates `rowId` into DDL**
   (`emailChangeVerification.db.test.ts:90-96`). Unavoidable — a `CREATE TRIGGER`
   `WHEN` clause cannot take a bind parameter — and the value is a UUID the test
   itself just created, so there is no real risk; it also matches the existing
   `injectFailure` helper in `transactionAtomicity.db.test.ts`. Noting it only so
   a future reader does not mistake it for a pattern to copy into `src/`.

## [RH-42] Exigir verificacao para troca de e-mail (code review r2) — 2026-09-09

1. **Stale line references in the appended suggestions-log entry**
   (`docs/suggestions-log.md`, item 3 of the RH-42 r1 block). It cites
   `src/lib/authEmail.ts:79-83` for the dev echo, which the round-2 fix pushed
   down to `:108-112`; item 1 likewise cites `:78-85` for the swallow, now
   `:114-128`. The log is a historical record so this is not wrong as written,
   but a reader following the reference will land in the middle of
   `renderAuthEmail`. Since these are carried forward as open suggestions,
   re-pointing them (or dropping the line numbers in favour of the function
   names) would keep them actionable. Purely cosmetic; no gate covers it.

2. **A future plain-text part must take the raw fields.** `sendAuthEmail`
   sends `html` only today, so the entity-in-plain-text hazard does not exist.
   If a `text:` part is ever added for deliverability, it must interpolate
   `email.greeting` / `email.body` directly and *not* the escaped locals —
   otherwise recipients on plain-text clients read `Tom &amp; Jerry`. A one-line
   note next to the `escapeHtmlText` docblock would pin that for the next
   author. Not needed for this task.

3. Round-1 suggestions 1-5 remain open and unchanged; the round-2 diff did not
   touch the code they refer to, and none of them blocks. They are recorded in
   `docs/suggestions-log.md` for later triage, which is the correct disposition.

## [RH-42] Exigir verificacao para troca de e-mail (QA r1) — 2026-09-09

1. ER14 asks the F12/T9 `**Status:**` lines to name "RH-42 and its commit hash".
   They currently say "the commit carrying this line, on top of `890a27b`", which is
   unavoidable pre-commit but reads differently from the file's established
   convention (F14: "Resolved by RH-64 (`6aa099c`)"). A follow-up amend that
   substitutes the real hash after the commit exists would make the two close-outs
   greppable the same way as every earlier one.
2. `src/lib/__tests__/identityWriteGuard.test.ts` documents its own limitation
   honestly (line-scoped patterns; a template literal splitting `UPDATE profiles`
   from `SET ...` across lines evades it, as `updateProfile` in
   `src/lib/profile.ts` already does). If the guard is ever load-bearing beyond a
   ratchet, joining logical statements before matching would close that gap.
3. ER7's "trimmed lowercased address for `  Jane@Example.COM  `" is proved across
   `normalizeEmail` and a separate `validateEmailChange` trimming case rather than
   in one assertion. Nothing is missing, but a single
   `validateEmailChange('someone-else@example.com', '  Jane@Example.COM  ')` case
   would map one-to-one onto the wording.

## [RH-43] Consolidar convencoes de nomes, divisao de modulos e i18n no AGENTS.md (spec review r1) — 2026-09-09

- ER4 says the sorted export list is "exactly `assertBandMember`, `createBand`,
  `createBandPlaylist`, `deleteBand`, `getBandMembers`, `getBandPlaylists`,
  `getBandWithMembers`, `getBands`, `joinBandByInviteClient`, `leaveBand`,
  `removeBandMember`, `regenerateBandInviteCode`, `updateBand`", but the command it
  pins ends in `| sort`, which puts `regenerateBandInviteCode` **before**
  `removeBandMember`. Swap the two so QA can compare the output literally.
- Test 7's rule ("scans non-test files under `src/` for `getDictionary` and asserts
  the consumer set is exactly `['src/components/landing/LandingPage.tsx']`") needs
  one more sentence: `src/lib/i18n.ts:59` holds the *definition* and a naive text
  scan will report it as a second consumer. Say how the definition site is excluded
  (by path, or by requiring a call expression rather than `export function`).
- Test 1 could reuse `src/app/actions/__tests__/actionScan.ts`
  (`allExportedActionNames()`, `actionFileNames()`) instead of re-implementing the
  scan; `__tests__` is exempt from the F21 import restriction, so the import is
  legal. If you prefer a standalone scan, say why in the spec so the next reader
  does not think it was an oversight.
- The audit says AGENTS.md's components block "names two components that have
  since been joined by forty-nine". It names seven (AppLayout, ConditionalLayout,
  InstrumentPicker, SongForm, ConfirmPanel, Toast, AlertBanner), so the arithmetic
  is 51 - 7 = 44. Cosmetic, and this sentence is not written to any document, but
  it is the kind of number a later reader will re-derive.
- "`LanguageSelector.tsx` ... no copy at all" (audit, and verbatim in the F25
  `**Status:**` line) is not quite right: the file hardcodes four strings -
  `Select Language`, the `Language selector` aria-label, `Portugues (BR)` and
  `English`. What is true, and is what the argument needs, is that it reads no copy
  *from a dictionary*. Worth tightening, since it is the one file in the app that
  hardcodes a non-English string.
- "The other 68 of 69 non-test `.tsx` files under `src/` hardcode English" is an
  overstatement for files that carry no user-visible copy at all (`layout.tsx`,
  `ConditionalLayout.tsx`). "hardcode their copy in English, where they have any"
  would survive a re-count.
- ER8 leaves `npm run lint:dup` at "below the 2 % threshold" while quoting the
  `bb5070b` figures. Adding a ~200-line scanning test file with several similar
  `readdir`/`filter` helpers is the most likely thing in this task to move the
  jscpd number; consider pinning "no new clone group under `src/lib/__tests__`" or
  simply keeping the loose threshold and noting the risk in the Approach so the
  implementer keeps the helpers distinct.
- The Approach tells the implementer to keep the guard inside the base complexity
  budget so the override list stays at 20. Worth adding the concrete constraint
  that ER5 also forbids the words `allowed`, `exempt`, `skip` and `todo` anywhere
  in the file, including comments - the natural comment for test 6's
  "direct imports only" rationale, and for excluding `__tests__` directories, can
  trip that grep by accident.

## [RH-43] Consolidar convencoes de nomes, divisao de modulos e i18n no AGENTS.md (spec review r2) — 2026-09-09

- The Naming Conventions preamble's "The guard covers exactly its five and
  nothing more" is true of the section but false of the guard, which has seven
  tests - tests 6 and 7 enforce the Module Layout and Internationalisation rules,
  and both of those sections name the guard file. Scope the sentence ("of the
  claims in this section, the guard covers exactly the five tagged
  `(guarded)`"), so the three sections do not appear to disagree about what the
  one test file does.
- Test 6's name, `no "use client" file imports a src/lib module that imports
  @/lib/db`, describes the one-hop rule the spec spent a paragraph rejecting. A
  name like `... a src/lib module that reaches @/lib/db` would match the closure
  semantics; ER5 pins the name verbatim, so both would have to move together.
- Even re-pinned, ER2's `grep -c "src/components/<area>/"` proves nothing about
  the ten area directories, since it already matches at `bb5070b` through
  `AGENTS.md:49`. ER3 already checks all ten directory names against
  `ls -d src/components/*/ | wc -l`; the ER2 grep could simply be dropped.
- `src/lib/spotifyRouteAuth.ts` also reaches `pg` through
  `@/lib/auth-session` (L28), not only through the three modules the Audit and
  AGENTS.md name. The three named are all one-hop-to-a-direct-importer, so the
  text is accurate as a set of shortest paths; a reader re-deriving it may
  nevertheless count four and think a path is missing. One clause ("among
  others") would settle it.
- ER8's coverage gate was not re-run this round (it needs the full coverage pass);
  its four threshold numbers do match `vitest.config.ts:77-82`, and
  `lint:dead`, `audit` and `lint:dup` were re-run and are green at `bb5070b`.
- ER1 asks the reader to confirm by reading that the section "names the 44 Server
  Action *function* exports..." - a long prose list that QA can only verify by
  eye. The three phrase greps plus the 5/5 tag counts already carry most of it;
  consider adding one grep per named exception (`tabs.ts:17`, `useToast`,
  `auth-client.ts`) so the exception set is mechanically checkable rather than
  read.

## [RH-43] Consolidar convencoes de nomes, divisao de modulos e i18n no AGENTS.md (spec review r3) — 2026-09-09

- **Reword the mixed-import parenthetical (spec L502-504).** It reads "An inline
  `import { type X }` specifier is the same case in principle; at `bb5070b` there
  are none against `@/lib` in client files, so treating a mixed clause as a value
  import is acceptable and simpler." Taken as "there are no inline `type`
  specifiers against `@/lib` in client files" it is false - there are **seven**
  (`src/app/page.tsx` and `src/app/playlists/[id]/page.tsx` ->
  `@/lib/spotify`; `TabDrawingStage.tsx` -> `@/lib/annotationMath`;
  `StatusDropdown.tsx` -> `@/lib/songStatus`; `ui/Toast.tsx` -> `@/lib/uiTones`;
  `LandingPage.tsx` and `LanguageSelector.tsx` -> `@/lib/i18n`). Taken as "no
  clause consists *solely* of inline `type` specifiers" it is true (measured: 0),
  and that is the only reading under which the "so" clause is not vacuous - which
  is why this is a suggestion and not a blocker. But an implementer who reads it
  the first way may not handle mixed clauses at all, and nothing in ER5 would
  catch that: all seven target modules are in the pure 31, so a guard that
  wrongly treats a mixed clause as type-only is still green today and still
  passes both ER5 probes. One clause fixes it: "no clause consists solely of
  inline `type` specifiers; the seven mixed clauses (all against pure modules)
  count as value imports".
- ER8's jscpd pin gives two numbers for one gate ("no worse than `250 (0.67%)`").
  They agree at today's tree size (250 / 37763 = 0.66%), so the pin is safe, but
  saying which one binds ("the duplicated-lines cell is at most 250") would leave
  QA nothing to interpret.
- The Approach (L500) tells the implementer to "**skip** any import statement
  whose clause begins `import type`" while ER5 forbids the token `skip` anywhere
  in the guard file. The spec already anticipates this at L544-550 and names this
  exact case, so it is handled - but the instruction and the prohibition sit 45
  lines apart and use the same word. Phrasing the instruction as "treat any
  import statement whose clause begins `import type` as not an edge" would remove
  the trap at its source.
- ER5 pins that the guard is green and that the two probes behave, but pins no
  cardinality on what the scan found. A one-line addition - that the value-import
  scan resolves **15** distinct `@/lib` modules across the 60 client files - would
  make a scan that silently under-counts (the failure mode suggestion 1
  describes) mechanically detectable instead of latent.
- ER8's coverage gate was not re-run this round (it needs the full coverage pass);
  `vitest`, `tsc`, `eslint`, `lint:dup`, `lint:dead` and `audit` were all re-run
  at `bb5070b` and are green with exactly the numbers ER8 records.

## [RH-43] Consolidar convencoes de nomes, divisao de modulos e i18n no AGENTS.md (spec review r4) — 2026-09-09

- **Reword the mixed-import parenthetical (spec L501-503)**, carried forward from
  round 3 and re-measured. As written, "at `bb5070b` there are none against
  `@/lib` in client files" is true only under the reading "no clause consists
  *solely* of inline `type` specifiers" (measured 0); under the more natural
  reading "no inline `type` specifier exists" it is false - there are **seven**
  mixed clauses. Both readings leave the guard green today because all seven
  targets are in the pure 31, so this is not a blocker, but one clause removes the
  ambiguity permanently: "no clause consists solely of inline `type` specifiers;
  the seven mixed clauses (all against pure modules) count as value imports".
- **Pin the scan's cardinality in ER5** (round-3 suggestion, still open). ER5
  pins that the guard is green and that the two probes behave, but pins no count
  on what the scan resolved. Adding "the value-import scan resolves **15**
  distinct `@/lib` modules across the 60 client files" would make the
  under-counting failure mode above mechanically detectable instead of latent -
  re-measured this round and still 15.
- **The amended bullet is now the block's two longest lines** (spec L659 is 90
  characters, L660 is 93, against a 79-81 character wrap everywhere else in the
  fenced block). Purely cosmetic, but if an implementer re-wraps them to match
  the surrounding style, ER1 requires that
  `src/components/ui/__tests__/feedbackSurfaces.test.tsx` stay on one physical
  line or the pinned count of 1 becomes 2. Wrapping the block's own text at 80
  before hand-off would remove the temptation.
- ER8's jscpd pin still gives two numbers for one gate ("no worse than
  `250 (0.67%)`"); saying which one binds would leave QA nothing to interpret
  (round-3 suggestion, not re-measured this round).
- The Approach (L500) still tells the implementer to "**skip** any import
  statement whose clause begins `import type`" while ER5 forbids the token `skip`
  anywhere in the guard file. The spec anticipates the collision at L544-550, so
  it is handled; phrasing the instruction as "treat ... as not an edge" would
  remove the trap at its source (round-3 suggestion).
- ER8's gates were re-run in full at round 3 and are unchanged by this round's
  amendment, which touches only spec prose; they were not re-run here.

## [RH-43] Consolidar convencoes de nomes, divisao de modulos e i18n no AGENTS.md (code review r1) — 2026-09-09

All non-blocking. None of these should hold up the merge; several are explicitly
sanctioned by the spec and are recorded here only so a future task has them.

1. **`AGENTS.md` "nine of the 106 test files" is stale by one at the merge
   commit** (the tree now has 107, the guard being the 107th). The section
   preamble scopes its numbers to `bb5070b` and the spec pins the block
   byte-for-byte, so this is correct as delivered — but a future edit of that
   bullet could phrase it as "nine of them need a live Postgres" and stop the
   count going stale on every new test file.

2. **The test-6 failure message enumerates 16 server-only modules while
   AGENTS.md's prose names 15.** The extra name is `db` itself, which is the
   right call (§3e), but a reader diffing the message against the document will
   pause on the discrepancy. A four-word clause in the message — "…plus `@/lib/db`
   itself" — would remove the friction at no cost, whenever that file is next
   touched.

3. **Test 3 is marginally broader than the claim it guards.** It requires *every*
   non-test file under `src/components` to be `PascalCase.tsx`, so a future
   `src/components/<area>/helpers.ts` would fail a test named "every component
   file … is PascalCase.tsx". No such file exists today, and the stricter reading
   is defensible; worth a sentence in AGENTS.md if a co-located non-component
   helper is ever wanted.

4. **A wholly inline-type clause would read as a value import.**
   `import { type A } from '@/lib/x'` (no bare `import type` prefix) is counted
   as an edge. The spec states this simplification explicitly and there are none
   against `@/lib` in client files at `bb5070b`, so it is not a defect — but it
   is the first thing to revisit if the Out-of-Scope item "forbidding type-only
   client imports" is ever picked up, since the two readings would then need to
   be reconciled in one place.

5. **Test 5 is line-oriented.** A declaration split as
   `export const foo =\n  async () => {}` would slip past the detector. No
   occurrence exists, and prettier/eslint formatting in this repo does not
   produce that shape, so the risk is theoretical.

6. **`export … from '@/lib/x'` re-exports are not edges in test 6.** A
   `'use client'` file that re-exported a server-only module rather than
   importing it would not be flagged. None exists; noting it as the one gap in an
   otherwise complete scan.

7. **Follow-ups already captured by the spec** (repeating them so they are not
   lost between documents): F24 option (a) — fold `bands.server.ts` into
   `bands.ts`, keep one `joinBandByInvite` returning `JoinBandResult`, delete the
   caller-less `joinBandByInviteClient`, re-point `/join/[code]` and three test
   files; and re-deriving `docs/plans/mobile-app-analysis.md` section 3.2 against
   the post-RH-61/RH-65 architecture, which has now been raised in three review
   rounds and should become a task or be closed as deliberately historical.

## [RH-43] Consolidar convencoes de nomes, divisao de modulos e i18n no AGENTS.md (QA r1) — 2026-09-09

- `src/lib/__tests__/namingConventions.test.ts` computes the server-only closure
  from `src/lib/*.ts` only. A future server-only module placed in a `src/lib`
  subdirectory would fall outside `libModuleNames()` and so outside the closure,
  silently. AGENTS.md's Module Layout section says `src/lib/*.ts` and no
  subdirectory exists today, so nothing is wrong now; a one-line assertion that
  `src/lib` has no non-`__tests__` subdirectory would keep the guard's population
  honest if that ever changes. Non-blocking.
- The `i18n scope` test pins the consumer set with an exact-equality assertion on
  a single path, so legitimately adding a second landing-page file that reads copy
  requires editing the test. That is arguably the point (the decision should be
  re-litigated deliberately), but the failure message could say so explicitly.
  Non-blocking.

## [RH-44] Corrigir CI vermelho na master (spec review r1) — 2026-09-09

- ER5 asserts `grep -rn "retries" e2e/ playwright.config.ts` prints only the pre-existing
  `retries: process.env.CI ? 2 : 0` line. The intent is "no new retry knob", but the pattern is
  a bare word: a perfectly correct JSDoc such as "…retries the click until the dialog opens"
  would fail it. Tightening the pattern to `retries:` would keep the guarantee without
  constraining prose.
- The audit's phrase "a database that is never reset" is accurate locally but invites the wrong
  conclusion about CI, where `.github/workflows/ci.yml:23-36` gives the job a fresh Postgres
  service container plus `npm run db:migrate` on every run. Worth one clause stating that in CI
  the collision is strictly within-run (retry re-runs the fixture against the database the
  first attempt already dirtied), and that the never-reset database is a local amplifier.
- The fill-if-empty rule is attributed to "commit `d102d28`, RH-15". Those are two separate
  changes: `d102d28` introduced fill-if-empty and explicitly said no correction mechanism
  existed yet; RH-15 (`fbd3197`, `3923f6d`) added `Correct Global Info` and the moderation
  queue later. Splitting the citation would make the audit exactly right.
- `e2e/bands-confirm.spec.ts:36` is cited for `E2E Band Confirm ${Date.now()}`; the line is 37.
- Approach B instructs the implementer to record the "editable title field whose value is
  silently discarded" UX gap in `docs/suggestions-log.md`, but no ER pins that entry. The spec
  already knows this gap exists — it is not a conditional discovery — so a one-clause addition
  to ER6 ("`docs/suggestions-log.md` gains an entry naming the silently-discarded title field")
  would make the hand-off verifiable rather than trusted. Not blocking: the substantive
  deliverable is fully pinned without it.
- Out of Scope already flags the `server-pages.spec.ts:81` multi-worker detachment flake for
  the suggestions log. Worth noting there that ER4's `--workers=1` is what keeps it out of this
  task's measurements, so a future reader does not mistake the constraint for a workaround the
  task introduced.

## [RH-44] Corrigir CI vermelho na master (implementation) — 2026-09-09

Four application-side observations made while repairing the E2E suite. All of
them are `src/` changes, which RH-44's whitelist forbids, so each is recorded
here as its own future item rather than fixed in passing.

- **The song edit dialog accepts a title it will silently discard.** `SongForm`
  renders `#sf-title` as an editable field in edit mode, but `updateSong`
  (`src/lib/songs.ts:257-267`) writes `global_songs` fill-if-empty, so a title
  that is already set is never overwritten and the user gets no feedback at all:
  the dialog closes, the card keeps its old title, and nothing says why. The
  correction path that does exist is `Correct Global Info` ->
  `submitGlobalSongEditAction` -> the admin moderation queue (RH-15). Options
  are to disable the field once the catalog value is non-empty and point at
  `Correct Global Info`, or to route a changed title into the moderation queue
  automatically. `e2e/songs-crud.spec.ts` now pins the current behaviour, so
  whichever is chosen will show up as a test that has to be rewritten
  deliberately.
- **The "Add song" FAB covers the action buttons of whichever card lands in the
  bottom-right corner.** The FAB is `fixed bottom-20 right-5` (`src/app/page.tsx:605`)
  and the per-card Edit/Delete buttons sit at the right edge of each row, so once
  the list is long enough to put a row under it, that row's Delete button cannot
  be clicked at all — Playwright reports `<button aria-label="Add song"> intercepts
  pointer events`, and a real thumb hits the same obstacle. Worth either padding
  the bottom of the list past the FAB or shrinking the FAB's hit area. `deleteSong`
  in `e2e/helpers.ts` now filters the list before clicking, which sidesteps the
  overlap but does not remove it.
- **Better Auth's rate limiter makes repeated sign-ins from one address flaky
  against a production build.** `next start` runs with `NODE_ENV=production`, where
  Better Auth enables rate limiting and caps `/sign-in/email` at a few requests per
  ten seconds; `e2e/global-setup.ts` plus the two signing-in tests in
  `e2e/auth.spec.ts` exceed it, and the login form then shows `Too many requests.
  Please try again later.` for entirely valid credentials. CI does not see this
  because `npm run test:e2e` starts the dev server. The spec's tests now retry the
  submit and the invalid-credentials test explicitly refuses to be satisfied by the
  rate-limit banner, but the durable fix is a test-only Better Auth rate-limit
  exemption (or a per-run e2e user), which is an `src/lib/auth.ts` change.
- **The local parallel-worker flake in `e2e/server-pages.spec.ts:81`** (out of scope
  per the spec): running the full suite without `--workers=1` has failed with
  `locator.fill: ... element was detached from the DOM` inside `createPlaylist`,
  where the `toPass` block re-clicks the modal toggle and re-opens the modal under
  the `fill`. ER4's `--workers=1` mirrors `playwright.config.ts` under CI and is
  what keeps this out of RH-44's measurements — it is not a workaround this task
  introduced. The fix is to stop re-clicking once the modal is open (assert the
  toggle's state instead of clicking blind).

## [RH-44] Corrigir CI vermelho na master (code review r1) — 2026-09-09

**S1 — `signInAndLandOn` can re-enter after a submit that actually succeeded
(`e2e/auth.spec.ts:54-57`).** The retry re-runs `fillAndSubmitLogin`, which
clicks `getByRole('button', { name: /sign in/i })`. On the success path
`src/app/login/page.tsx:40-55` never calls `setLoading(false)` — it goes straight
to `router.push(redirect)` — so while the navigation is in flight the button
renders `Signing in...` (`page.tsx:164`), which `/sign in/i` does not match. If a
successful post-submit navigation takes longer than the 5s inner assertion (a
cold `/profile` compile on CI's dev server is the realistic case), attempt 2's
`click()` waits for a locator that will never resolve, bounded only by the test
timeout — so a login that worked is reported as a timeout. Cheap fix: make the
loop idempotent by checking the URL before re-submitting, e.g.
`if (!page.url().includes('/login')) { await expect(page).toHaveURL(destination); return }`
at the top of the block, or scope the retry to the rate-limit banner
(`if (await banner.isVisible())`). Not blocking: the outcome is a false failure,
never a false pass, CI's `retries: 2` would rescue it with `/profile` warm, and
the pre-existing code failed on the same slow navigation too.

**S2 — the 30s `toPass` budget in `e2e/auth.spec.ts` is unreachable.** The file
carries no `test.describe.configure({ timeout: ... })`, so the per-test budget is
`playwright.config.ts:10`'s `30_000` — the same number as the two `toPass`
timeouts. The JSDoc at `:47-48` says "a real failure to honour it still fails
once the retry budget runs out", but the retry budget can never run out: the test
timeout fires first, with a less legible error. Either raise the file timeout the
way `bands-confirm.spec.ts:20` and `fast-view-mobile.spec.ts` do, or lower the
two `toPass` timeouts to something reachable (20s leaves room for the 10s
rate-limit window plus a full attempt).

**S3 — `deleteSong` interpolates the title straight into a `RegExp`
(`e2e/helpers.ts:167`).** `new RegExp(\`Delete ${title}\`, 'i')` is safe today
only because `uniqueSongTitle` emits `[A-Za-z0-9 -]`. The moment a fixture prefix
gains a `(`, `+` or `.` this breaks in a confusing way. A one-line escape helper,
or `getByLabel(\`Delete ${title}\`, { exact: true })`, removes the trap. Same
applies to `openEditDialog` at `:125` (pre-existing).

**S4 — the shared e2e user's repertoire grows by four rows per full local run.**
Spec-sanctioned and harmless in CI (fresh service container per run), and no spec
depends on list length, so this is not a correctness issue. But a developer's
local home page accumulates `E2E %` cards indefinitely, which slowly makes every
`songCard` render heavier and makes the FAB-overlap defect easier to hit
manually. An `afterEach` in `songs-crud.spec.ts` calling the existing
`deleteSong` for the add/edit fixtures (tolerating "not found") would keep it
bounded at near-zero cost, and would fail closed since the titles are unique.

**S5 — pre-existing lint warning blocks `eslint e2e --max-warnings 0`.**
`e2e/global-setup.ts:13` imports `chromium` without using it. Inherited from
`68a605b` and outside this task's whitelist-in-practice (the file is "permitted
but not required" and was not touched), so it must not be fixed here — but the
next task that opens that file should drop the import, since it is the only thing
standing between `e2e/` and a zero-warning gate.

**S6 — typo in a new comment.** `e2e/fast-view-mobile.spec.ts`: "on top of the
the hydration retry loop" — duplicated "the".

## [RH-44] Corrigir CI vermelho na master (QA r1) — 2026-09-09

- ER5's constraint is written against `e2e/helpers.ts` and `e2e/fast-view-mobile.spec.ts`;
  `e2e/auth.spec.ts` independently gained a `toPass` retry around the sign-in submit
  (`signInAndLandOn`, lines 50–58) to absorb Better Auth's rate limiter, which only engages
  against a production `next start`. That is a correct read of the mechanism and the
  destination assertion is unweakened, but it means the four auth tests will now spend up to
  30s retrying if sign-in ever breaks for a non-rate-limit reason. A cheap hardening would be
  to fail fast when the error banner text is neither empty nor `too many requests`, mirroring
  the exclusion already present in `invalid credentials show an error message` (line 85).
  Non-blocking.
- `uniqueSongTitle` keys uniqueness on `Date.now()`-`process.pid`-sequence. Under
  `--workers=1` and under CI's single worker this is airtight; with parallel local workers two
  processes could in principle share a pid namespace only across containers, which is not a
  real risk here. No change needed, noted only so the invariant is written down somewhere
  other than the helper's own comment.

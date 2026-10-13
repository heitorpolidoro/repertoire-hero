# RH-28 — Fix drawing-mode controls on tablet and add an on/off toggle

Follow-up to RH-5 (`docs/tasks/RH-5-spec.md`), driven by operator testing on a tablet.
Single deliverable, PR-sized: the PDF Stage Mode overlay in
`src/app/songs/[id]/fast-view/page.tsx` and the drawing layer in
`src/components/tabs/TabDrawingStage.tsx`.

## Investigation — what is actually wrong

The task text hypothesised "control auto-hide logic". **There is none.** A repo-wide
search for `controlsVisible|autoHide|auto-hide|showControls|hideControls|idle` matches
only `idleTimeoutMillis` in `src/lib/db.ts`. No timer, no opacity transition, and no
conditional ever hides the Stage Mode toolbar. The toolbar is a plain `shrink-0` flex
child rendered unconditionally at `TabDrawingStage.tsx:526`. That hypothesis is ruled
out; the real cause is viewport sizing, and it is reproducible on any mobile/tablet
browser with collapsing chrome.

### Cause 1 (primary) — the overlay is sized to the *layout* viewport, not the visual one

The overlay chain is:

- `AppLayout` root: `<div className="flex h-screen">` (`100vh`)
- PDF Stage Mode overlay: `<div className="fixed inset-0 z-50 bg-black flex flex-col">`
  (`fast-view/page.tsx:1382`) — `inset-0` resolves against the initial containing block
- `TabDrawingStage` root: `flex-1 w-full h-full … flex flex-col` (`TabDrawingStage.tsx:483`),
  containing the scrollable page area (`flex-1 min-h-0 overflow-hidden`) and the toolbar
  (`shrink-0`, bottom).

On iOS/iPadOS Safari and Android Chrome the initial containing block (and therefore
`100vh` / `fixed; inset: 0`) equals the **large viewport** — the size the page has when
the browser's chrome is collapsed. Whenever the chrome is expanded (which is the state
right after navigation, and again any time the browser decides to show it), the visual
viewport is 50–110 px shorter than the layout viewport, and the bottom strip of the
fixed overlay — which is exactly the toolbar — is rendered *below* the visible area.
The toolbar is not hidden; it is off-screen. This is the classic `100vh` mobile bug and
it matches the report precisely: it renders once (chrome collapsed), then disappears
and never comes back.

### Cause 2 (why it never comes back) — nothing can scroll the document back

`touchAction: 'none'` is set inline on the `TabDrawingStage` root (`:483`) and on the
scroll container (`:485`). No gesture anywhere inside Stage Mode can scroll the
*document*, which is what would make the browser collapse its chrome again. Once the
toolbar goes below the fold it is permanently unreachable — "no longer visible or
reachable", exactly as reported.

### Cause 3 (aggravating) — the toolbar is tall at tablet widths

The control row is `flex items-center justify-between gap-2 flex-wrap` with four groups
(mode / colours / zoom / undo-clear) plus a separate page-navigation row above it. At
tablet portrait widths those groups wrap to two or three lines, making the toolbar
~110–150 px tall — i.e. the whole block that falls outside the visual viewport, and a
large slice of screen even when it is visible.

### Cause 4 (aggravating) — the page behind the overlay is never scroll-locked

Opening Stage Mode locks nothing. Touches on the overlay header (which is *not*
`touch-action: none`) still scroll the underlying Fast View page, which is what drives
the browser chrome in and out and shifts the visual viewport.

**Which element actually scrolls.** Not `document` / `body`: the app shell is
`AppLayout.tsx:212` `<div className="flex h-screen">`, exactly viewport-height, so the
document never has anything to scroll and `document.body.style.overflow = 'hidden'` is a
no-op here. The Fast View page is rendered inside `AppLayout.tsx:273`
`<main className="flex-1 overflow-y-auto bg-gray-50 pb-16 md:pb-0">`, and *that* `<main>`
is the page's scroll container. The PDF Stage Mode overlay (`fast-view/page.tsx:1382`) is
a sibling of the page's layout `<div>` (`:634`) and therefore also a descendant of that
same `<main>`, which makes it the overlay's nearest scrollable DOM ancestor and the
element a vertical drag on the overlay header chains to. The lock in §3 targets it, not
`body`.

(The page renders a second `<main>` of its own at `fast-view/page.tsx:636`, but it is
`min-h-screen` with no `overflow` and never scrolls; the overlay is *outside* it, which is
also why the overlay's `position: fixed` is not trapped by that element's
`translate-x-0` transform.)

### Cause 5 — the drawing layer always captures touches (motivates the toggle)

The `<canvas>` is always mounted with `onPointerDown/Move/Up` and `touch-action: none`,
so every touch on the page area is drawing or panning. There is no way to just *read*
the tab, scroll it natively, or hand the tablet to someone without leaving stray marks.
Additionally `pointersRef` entries are removed only in `endPointer`
(`pointerup` / `pointercancel`); `lostpointercapture` is not handled, so a pointer the
browser silently takes away leaves a stale entry and the *next* single touch is counted
as `size === 2` and interpreted as a pinch — the controls appear to "stop responding".

## Scope

**In scope**

1. Make the PDF Stage Mode overlay and its toolbar sized to, and always inside, the
   **visual viewport** on tablets and phones.
2. Keep the toolbar to a single, constant-height control row at every supported width,
   with the device safe-area inset carried outside the toolbar's own box.
2b. Suppress **browser** pinch-zoom inside the Stage Mode overlay (the in-app zoom
   controls remain), because it is incompatible with visual-viewport sizing.
3. Scroll-lock **the Fast View page's actual scroll container** (the app shell's
   `<main>`, `AppLayout.tsx:273`) while PDF Stage Mode is open, restore it on close, and
   stop touch scroll inside the overlay from chaining to it. `document.body` is not
   touched — it never scrolls in this shell (see Cause 4).
4. Add an explicit **drawing on/off toggle**, defaulting to **off**, that fully
   disengages the drawing layer (native scrolling and page turning work; saved
   annotations still render read-only).
5. Harden pointer bookkeeping (`lostpointercapture`, reset on disable).
6. A new pure helper module plus its vitest suite.

**Not in scope**

- The lyrics Stage Mode overlay (`isStageMode`, `fast-view/page.tsx:1300`) — it scrolls
  internally and its controls sit at the top, so it does not exhibit the bug.
- Any change to `getTabAnnotationsAction` / `saveTabAnnotationsAction`, the
  `annotations` JSONB shape, `Stroke`, or any migration.
- Any new drawing feature (redo, shapes, text, partial erase, stroke width control).
- Adding jsdom / `@testing-library/react` / any new dependency. The vitest environment
  stays `node` (see `vitest.config.ts`); component behaviour is verified manually per
  the RH-5 precedent, and only DOM-free logic is unit-tested.
- Playwright coverage of the Stage Mode drawing gestures (unchanged from RH-5: manual/QA).

## Approach

### 1. New pure module `src/lib/stageInteraction.ts`

DOM-free and React-free (same rationale as `annotationMath.ts`: the decisions that are
easy to get wrong become directly unit-testable in the existing `node` vitest env).

```ts
/** Height the Stage Mode overlay must use so its toolbar stays on screen. */
export function stageViewportHeight(
  visualViewportHeight: number | undefined | null,
  innerHeight: number,
): number

/** CSS `pointer-events` for the annotation canvas. */
export function canvasPointerEvents(drawingEnabled: boolean): 'auto' | 'none'

/**
 * CSS `touch-action` for the **drawing subtree only** (`:484`, `:485`, the canvas).
 * Never applied to the stage root — see §2a/§4 for why.
 */
export function stageTouchAction(drawingEnabled: boolean): 'none' | 'pan-x pan-y'

/**
 * Whether a `visualViewport` measurement may be used to size the overlay.
 * False while the browser's visual viewport is pinch-zoomed (scale !== 1), because
 * a zoomed visual viewport reports a fraction of the layout viewport and a non-zero
 * `offsetTop`, neither of which describes the box a `position: fixed` overlay occupies.
 */
export function isStableViewportMeasurement(
  visualViewportScale: number | undefined | null,
): boolean

/** Whether a pointer event on the canvas should be handled as draw/erase/pan. */
export function shouldHandleStagePointer(drawingEnabled: boolean): boolean
```

Rules:

- `stageViewportHeight` returns `visualViewportHeight` when it is a finite number `> 0`,
  otherwise `innerHeight`. It never returns `0`, `NaN`, or a negative number.
- `canvasPointerEvents(true) === 'auto'`, `canvasPointerEvents(false) === 'none'`.
- `stageTouchAction(true) === 'none'` (drawing must suppress native gestures),
  `stageTouchAction(false) === 'pan-x pan-y'` (reading allows native one- and two-finger
  **panning/scrolling** of the PDF but **not** browser pinch-zoom — see §2a).
- `isStableViewportMeasurement(scale)` is exactly
  `!Number.isFinite(scale) || Math.abs(scale - 1) <= 0.01`. A non-finite scale
  (`undefined`, `null`, `NaN`) means "this browser does not report a scale", which is
  indistinguishable from "not zoomed", so it is treated as stable; a reported scale is
  stable only within 1 % of `1`.
- `shouldHandleStagePointer` mirrors `drawingEnabled`; the component calls it as the
  first line of each pointer handler so a stale/late event after a toggle-off is dropped.

### 2. Visual-viewport sizing of the overlay (`fast-view/page.tsx`)

- Add a small client-side effect in the Fast View page that tracks the viewport height
  while `isPdfStageMode` is true: read `window.visualViewport?.height`,
  `window.visualViewport?.scale` and `window.innerHeight`; **if
  `isStableViewportMeasurement(scale)` is false, return without touching state** (keep
  the last stable height — a pinch-zoomed visual viewport is not a layout box, and
  resizing the fixed overlay to `layoutHeight / scale` is what would push the toolbar
  off-screen again); otherwise pass height + `innerHeight` through `stageViewportHeight`
  and store the result in state. Subscribe to `visualViewport`'s `resize` **and**
  `scroll` events (plus `window`'s `resize` / `orientationchange`) so it re-measures when
  the browser chrome expands or collapses — the `scroll` subscription exists because iOS
  Safari fires only `scroll` (not `resize`) for some chrome transitions, and the same
  stability guard applies to it. `visualViewport.offsetTop` is deliberately **not** read
  or applied: at scale 1 it is always 0, and it is only non-zero while pinch-zoomed,
  which §2a suppresses. Clean up all listeners on close/unmount.
- Apply the result as an inline `height` on the overlay root, replacing the implicit
  `inset-0` height: `className="fixed inset-x-0 top-0 z-50 bg-black flex flex-col"` with
  `style={{ height: overlayHeight ? `${overlayHeight}px` : '100dvh' }}`. `100dvh` is the
  pre-measurement / no-`visualViewport` fallback; the measured pixel value is
  authoritative because it is correct in every mobile browser regardless of `dvh` support.
  The overlay root's inline `style` therefore carries exactly three concerns:
  `height` (this section), `touchAction: 'pan-x pan-y'` (§2a #1), and
  `overflow: 'hidden'` + `overscrollBehavior: 'contain'` (§3). Also attach a
  `useRef<HTMLDivElement>` to it — §3 resolves the page's scroll container by walking up
  from that ref.
- **Safe area**: do **not** put `env(safe-area-inset-bottom)` on the toolbar container —
  that would make the toolbar's own height device-dependent (0 px in desktop emulation,
  20–34 px on iPhone/iPad) and unmeasurable against a fixed budget. Instead render a
  dedicated spacer as the toolbar's next sibling inside `TabDrawingStage`, below it:
  `<div aria-hidden className="shrink-0 bg-gray-900/95" style={{ height: 'env(safe-area-inset-bottom, 0px)' }} />`.
  The home-indicator area is then filled with the toolbar's own background colour, the
  controls sit above it, and the toolbar element's border-box height is identical on
  every device (see §4).

### 2a. Browser pinch-zoom is suppressed inside PDF Stage Mode

**How `touch-action` actually composes.** `touch-action` is **not** an inherited
property; its initial value is `auto`, so `getComputedStyle(el).touchAction` reads `'auto'`
for every element that does not set it, no matter what its ancestors set. What the browser
*honours* is a different quantity: the effective touch behaviour of a node is the
**intersection** down its ancestor chain — Blink computes
`effective(node) = effective(parent) ∩ own(node)`. Two consequences drive this design and
both are load-bearing:

1. A descendant can only ever **narrow** what an ancestor permits. Setting
   `touch-action: pan-x pan-y` on the overlay root is therefore sufficient to kill browser
   pinch-zoom for the entire overlay subtree, including nodes this app does not own
   (`.react-pdf__Document`, `.react-pdf__Page`, `.react-pdf__Page__canvas`) and nodes that
   compute to `auto` (the header spans, the ✕ button, every toolbar button and span).
   Those `auto` computed values are expected and harmless: `auto ∩ pan-x pan-y = pan-x pan-y`.
2. A descendant can never **widen** it. This is what §4 must respect: the toolbar cannot
   be given back a gesture that one of its own ancestors has already removed.

So the invariant this task enforces is **"no element inside the overlay *sets*
`touch-action: auto` or `pinch-zoom`"** — a source-level, greppable property — and **not**
"no element *computes* to `auto`", which is unsatisfiable for non-inherited properties and
would require stamping `touch-action` onto react-pdf-owned DOM the app never renders.

The overlay's height is derived from `window.visualViewport`, so the browser's own
pinch-zoom would fight the sizing model: at scale `s > 1`, `visualViewport.height`
becomes ≈ `layoutHeight / s` and `offsetTop` becomes non-zero, so a `fixed; top: 0`
overlay sized to that measurement shrinks to a fraction of the screen while the user pans
away from `offsetTop === 0` — reproducing the exact reported bug. This task therefore
**disables browser pinch-zoom for the whole Stage Mode overlay** and keeps the existing
in-app zoom (`handleZoomIn` / `handleZoomOut` / `handleZoomReset`, which scale the PDF
canvas and never touch the visual viewport) as the only way to zoom the tab:

**The complete `touch-action` assignment.** Exactly **six** elements set the property —
the five below plus the toolbar (#6), which §4 requires to carry its own `'pan-x'`. Every
other node in the overlay is left alone and is governed by the intersection rule above.

| # | Element | Value | Why |
|---|---|---|---|
| 1 | Stage Mode overlay root — `fast-view/page.tsx:1382` | `'pan-x pan-y'` (constant) | Single choke point that removes browser pinch-zoom from the whole subtree, react-pdf DOM included. |
| 2 | Stage root — `TabDrawingStage.tsx:483` | `'pan-x pan-y'` (constant) | **Changed from the current `'none'`.** It is the common ancestor of *both* the drawing area and the toolbar, so it must stay permissive enough for the toolbar's `pan-x` (§4). It never carries `stageTouchAction()`. |
| 3 | Stage container — `TabDrawingStage.tsx:484` | `stageTouchAction(drawingEnabled)` | Drawing subtree; `'none'` while drawing. |
| 4 | Scroll container — `TabDrawingStage.tsx:485` | `stageTouchAction(drawingEnabled)` | Drawing subtree; `'none'` while drawing. |
| 5 | Annotation canvas — `TabDrawingStage.tsx:513` | `stageTouchAction(drawingEnabled)` | Drawing subtree; `'none'` while drawing. |
| 6 | Toolbar container — `TabDrawingStage.tsx:526` | `'pan-x'` (constant) | **Mandatory, not optional.** Horizontal scroll of the no-wrap control row (§4), no vertical chaining, no pinch-zoom. It must be set explicitly on the toolbar; inheriting #2's `pan-x pan-y` is *not* an acceptable substitute — §4 requires the toolbar's own computed value to be `'pan-x'`. |

The toolbar (#6) is a sibling of #3, not a descendant, so its `touchAction: 'pan-x'`
intersects only with #2 and #1 — both `pan-x pan-y` — giving an effective `pan-x`
independent of `drawingEnabled`. **The `'none'` of drawing mode never appears on any
ancestor of the toolbar.** This is the whole reason #2 changes from `'none'` to
`'pan-x pan-y'`: gestures over the *drawing area* are still fully suppressed by #3–#5,
which is where drawing actually happens.

Additional rules:

- No element inside the overlay may **set** `touch-action` to `auto` or `pinch-zoom`, in an
  inline style or via a Tailwind `touch-auto` / `touch-pinch-zoom` / `touch-manipulation`
  class. `src/app/globals.css` contains no `touch-action` rule today and must not gain one.
- Nodes that *compute* to `auto` because they set nothing (header spans, ✕ button, toolbar
  buttons/spans, `.react-pdf__*`) are correct as-is and must not be given the property.

Consequence: `window.visualViewport.scale` stays `1` throughout a Stage Mode session, the
`isStableViewportMeasurement` guard in §2 is a belt-and-braces defence (accessibility
zoom, desktop `Ctrl`+wheel, a stray pinch on browser chrome), and ER10/ER11 are mutually
satisfiable rather than contradictory.

### 3. Scroll lock on the element that actually scrolls

Per Cause 4 the scrolling element behind the overlay is **not** `document` / `body` — it
is the app shell's `<main>` (`AppLayout.tsx:273`, `flex-1 overflow-y-auto`), which is also
the overlay's nearest scrollable ancestor. `document.body.style.overflow` is therefore
**not** set by this task; doing so would be a no-op and must not appear in the diff.

Three parts, all inside one `useEffect` in `fast-view/page.tsx` keyed on `isPdfStageMode`:

1. **Resolve the scroll host from the overlay, not by tag name.** This page contains two
   `<main>` elements (`AppLayout.tsx:273`, which scrolls, and `fast-view/page.tsx:636`,
   which does not), so resolve by computed overflow, walking up from the overlay root ref
   (§2):

   ```ts
   function findScrollHost(node: HTMLElement | null): HTMLElement | null {
     for (let el = node?.parentElement ?? null; el; el = el.parentElement) {
       const oy = getComputedStyle(el).overflowY
       if (oy === 'auto' || oy === 'scroll') return el
     }
     return null
   }
   ```

   The effect runs after the overlay has mounted (it depends on `isPdfStageMode`, and the
   ref is populated by then). If `findScrollHost` returns `null`, skip part 2 silently —
   part 3 still contains the gesture.

2. **Lock and restore it.** Save `host.style.overflow` into a ref (normally the empty
   string), set `host.style.overflow = 'hidden'`, and in the effect cleanup assign the
   *saved string back verbatim* — so an element that had no inline overflow returns to
   having none, computing back to `auto`, rather than being frozen at a literal
   `'auto'`/`'hidden'`. Setting `overflow: hidden` does not reset `scrollTop`, so the page
   is still where the user left it after closing. The ✕ button (`closePdfStageMode`), the
   back-button `popstate` handler and unmount all flip `isPdfStageMode` to `false` or
   unmount the page, and therefore all run this same cleanup.

3. **Stop chaining out of the overlay.** Give the overlay root inline
   `overflow: 'hidden'` and `overscrollBehavior: 'contain'`. `overscroll-behavior` only
   takes effect on a scroll container, and `overflow: hidden` makes the overlay root one
   (a non-scrollable one), so a vertical drag anywhere inside the overlay — including the
   header, which sets no `touch-action` — has nowhere to chain to. Keep
   `overscrollBehavior: 'contain'` on the stage scroll container (`TabDrawingStage.tsx:485`)
   as well, so reaching the end of the PDF does not chain to the overlay root either.

### 4. Constant-height toolbar

Replace `flex-wrap` on the control row with `flex-nowrap overflow-x-auto` and give the
row `overscroll-behavior-x: contain`. Consequences:

- Toolbar height is constant (page-nav row + one control row) at any width ≥ 320 px;
  it can never grow to three wrapped lines and eat a third of a tablet screen.
- When more controls exist than fit (drawing **on**, narrow width), the row scrolls
  horizontally instead of wrapping, via a native touch gesture on the toolbar.
- The toolbar container gets `touchAction: 'pan-x'` explicitly (horizontal scroll of the
  row, no vertical chaining, **no pinch-zoom** — see §2a). It is never `'auto'` and never
  relies on an ancestor's value.
- **This only works because no ancestor of the toolbar is ever `touch-action: none`.** A
  descendant cannot widen an ancestor's `touch-action` (§2a, intersection rule), so if the
  stage root at `:483` kept its current `'none'` while drawing were on, the toolbar's
  effective value would be `none ∩ pan-x = none` and the control row would be
  unscrollable by touch in precisely the state — drawing on, narrow width — that this
  section exists to serve. Per §2a the stage root is therefore `'pan-x pan-y'` at all
  times and `stageTouchAction(drawingEnabled)` is scoped to `:484` / `:485` / the canvas,
  none of which is an ancestor of the toolbar. Implementers must not "restore" `'none'` to
  `:483`.

**Height budget — the arithmetic.** Toolbar container (`TabDrawingStage.tsx:526`)
`border-t px-3 py-2 flex flex-col gap-2`:

| Part | Height |
|---|---|
| `border-t` | 1 px |
| `py-2` (top + bottom) | 16 px |
| page-nav row (`text-xs` = 16 px line box + `py-1.5` buttons = 2 × 6 px) | 28 px |
| `gap-2` | 8 px |
| control row (`flex-nowrap`, tallest child is the 44 × 44 px toggle from §5) | 44 px |
| **total border-box** | **97 px** |

The budget is therefore **≤ 104 px** (97 px + ~7 px slack for font-metric and rounding
differences across platforms), and it is a budget on the **toolbar element's own
border-box height**, which by §2 excludes `env(safe-area-inset-bottom)` entirely — the
inset lives in the sibling spacer. The same number is therefore measurable and must hold
both in desktop device emulation (inset resolves to 0 px) and on real iPad/iOS hardware
(inset 20–34 px, absorbed by the spacer). The *total* bottom furniture on hardware is
`≤ 104 px + env(safe-area-inset-bottom)`, i.e. ≤ 138 px in the worst case; that is a
consequence, not a separate gate.

### 5. Drawing on/off toggle (`TabDrawingStage.tsx`)

- New state `const [drawingEnabled, setDrawingEnabled] = useState(false)` — **off by
  default** every time Stage Mode opens. The preference is not persisted (neither
  server-side nor in `localStorage`); Stage Mode always opens in read mode so a tablet
  handed to a bandmate can never be drawn on by accident.
- Toolbar renders the toggle **always**, in the leftmost position of the control row:
  - `type="button"`, `aria-label="Toggle drawing"`, `aria-pressed={drawingEnabled}`.
  - Label `✏️ Draw: Off` / `✏️ Draw: On`; emerald background when on, neutral gray when
    off, matching the existing mode-button styling.
  - Minimum touch target 44 × 44 px (`min-h-11 min-w-11` or equivalent padding) so it is
    comfortably tappable on a tablet.
- **Drawing off (default):**
  - Canvas gets `pointerEvents: canvasPointerEvents(false)` (`'none'`) — touches fall
    through to the scroll container.
  - The drawing subtree (`:484`, `:485`, the canvas) gets
    `touchAction: stageTouchAction(false)` (`'pan-x pan-y'`), restoring native one-finger
    scroll/pan of the PDF. Browser pinch-zoom stays suppressed (§2a); the in-app zoom
    controls remain the way to zoom. The stage root (`:483`) is unchanged at
    `'pan-x pan-y'`.
  - The canvas stays mounted and keeps rendering the current page's saved strokes, so
    annotations remain **visible read-only**.
  - The drawing-only controls — mode selector (Pen/Erase/Pan), colour swatches (presets
    + custom), Undo, Clear page — are **not rendered**. Page nav, `Page X / N`, the
    save-state pill, zoom controls, and the toggle remain.
  - Because the mode selector is hidden, `mode` is irrelevant while off; it is retained
    in state and restored on re-enable.
- **Drawing on:** the RH-5 behaviour — canvas interactive, `touch-action: none` on the
  drawing subtree (`:484`, `:485`, the canvas) so no native gesture competes with a
  stroke, all drawing controls visible. The one deliberate difference from RH-5 is that
  the `'none'` no longer sits on the stage root at `:483`, which would drag the toolbar
  down with it (§4).
- **Transition off:** abort any in-progress stroke (`activeStrokeRef.current = null`),
  clear `pointersRef` and `pinchStateRef`/`lastPanPosRef`, `redraw()`, then `flushSave()`
  so no debounced write is lost when the user switches to reading and closes Stage Mode.
- Every pointer handler (`handlePointerDown`, `handlePointerMove`, `endPointer`) starts
  with `if (!shouldHandleStagePointer(drawingEnabled)) return`, as a guard against
  in-flight events after a toggle-off (the CSS `pointer-events: none` handles the common
  case; this handles captured pointers).

### 6. Pointer bookkeeping hardening

Add `onLostPointerCapture` on the canvas, routed to the same cleanup path as
`endPointer` (delete the pointer id from `pointersRef`, drop `pinchStateRef` when fewer
than two pointers remain, abort the in-progress stroke without committing a stray mark).
This removes the "next tap is misread as a pinch" failure mode described in Cause 5.

### 7. Tests — `src/lib/__tests__/stageInteraction.test.ts` (new)

Vitest, `node` environment, no DOM. Cases:

1. `stageViewportHeight(700, 800) === 700` — the visual viewport wins over `innerHeight`.
2. `stageViewportHeight(undefined, 800) === 800` and `stageViewportHeight(null, 800) === 800`
   — fallback when `window.visualViewport` is unavailable.
3. `stageViewportHeight(0, 800) === 800` and `stageViewportHeight(NaN, 800) === 800`
   — degenerate measurements never produce a zero-height overlay.
4. `canvasPointerEvents(false) === 'none'` / `canvasPointerEvents(true) === 'auto'`.
5. `stageTouchAction(false) === 'pan-x pan-y'` / `stageTouchAction(true) === 'none'`;
   assert explicitly that `stageTouchAction(false) !== 'auto'` so a future edit cannot
   silently re-enable browser pinch-zoom (§2a).
6. `shouldHandleStagePointer(false) === false` / `shouldHandleStagePointer(true) === true`.
7. `isStableViewportMeasurement`: `true` for `1`, `1.005`, `0.995`, `undefined`, `null`
   and `NaN`; `false` for `1.5`, `2`, `0.5` and `1.02`.

### 8. Conventions

- No **new** `alert()` / `confirm()` (AGENTS.md). The existing Toast-based clear
  confirmation is unchanged. `fast-view/page.tsx` already contains two pre-existing
  `confirm()` calls, in the delete-tab and delete-link handlers; they are **not** Stage
  Mode surfaces, this task does not touch them, and converting them is RH-16's job.
  Leave them exactly as they are.
- Toggle is a real `<button>` with `aria-pressed`, consistent with the existing
  `aria-label`-based buttons in the toolbar (the repo uses no `data-testid`).

## Expected Results

- [ ] `src/lib/stageInteraction.ts` (new) exports `stageViewportHeight`,
      `canvasPointerEvents`, `stageTouchAction`, `isStableViewportMeasurement` and
      `shouldHandleStagePointer`, and imports nothing from `react`, `react-dom` or the
      DOM (no `window`/`document` reference in the module).
- [ ] `npx vitest run src/lib/__tests__/stageInteraction.test.ts` passes and asserts at
      least: `stageViewportHeight(700, 800) === 700`;
      `stageViewportHeight(undefined, 800) === 800` and
      `stageViewportHeight(null, 800) === 800`; `stageViewportHeight(0, 800) === 800` and
      `stageViewportHeight(NaN, 800) === 800`; `canvasPointerEvents(false) === 'none'` and
      `canvasPointerEvents(true) === 'auto'`; `stageTouchAction(false) === 'pan-x pan-y'`,
      `stageTouchAction(true) === 'none'` and `stageTouchAction(false) !== 'auto'`;
      `shouldHandleStagePointer(false) === false` and
      `shouldHandleStagePointer(true) === true`; `isStableViewportMeasurement` true for
      `1`, `1.005`, `0.995`, `undefined`, `null`, `NaN` and false for `1.5`, `2`, `0.5`,
      `1.02`.
- [ ] The Stage Mode toolbar contains a button whose accessible name is
      "Toggle drawing"; on opening Stage Mode it reports `aria-pressed="false"` and its
      visible label reads `Draw: Off`.
- [ ] With PDF Stage Mode open, these six elements — overlay root, stage root, stage
      container, scroll container, annotation canvas and toolbar container — compute to
      exactly these `touch-action` values, with **drawing off**. Resolve them in the console from
      the unique overlay anchor (`.fixed.z-50` is *not* unique — `page.tsx:554`, `:1302`
      and `:1408` also match):
      ```js
      const overlay   = document.querySelector('[title="Close PDF Stage Mode"]').closest('.fixed')
      const stageRoot = overlay.children[1]
      const stageCtr  = stageRoot.children[0]
      const scroller  = stageCtr.children[0]
      const toolbar   = stageRoot.children[1]
      const canvas    = overlay.querySelector('canvas.absolute')
      ```
      `getComputedStyle(...).touchAction` is `'pan-x pan-y'` for `overlay`, `stageRoot`,
      `stageCtr`, `scroller` and `canvas`, and `'pan-x'` for `toolbar`. The annotation
      canvas additionally computes to `pointer-events: none`.
- [ ] With **drawing on**, the same six reads give `'pan-x pan-y'` for `overlay` and
      `stageRoot`, `'none'` for `stageCtr`, `scroller` and `canvas`, and `'pan-x'` for
      `toolbar` — i.e. `touch-action: none` appears on the drawing subtree only and never
      on the stage root.
- [ ] No element in the overlay **sets** `touch-action` to `auto` or `pinch-zoom`
      (computed `auto` on nodes that set nothing — the header spans, the ✕ button, the
      toolbar buttons, the `.react-pdf__*` nodes — is expected and is *not* a failure,
      because `touch-action` is not inherited and the effective value is the
      ancestor-chain intersection). Verified at source level:
      `grep -rn "touchAction\|touch-auto\|touch-pinch-zoom\|touch-manipulation" src/components/tabs/TabDrawingStage.tsx src/app/songs/\[id\]/fast-view/page.tsx`
      returns **exactly six** lines and no others — one per assignment below, none of them
      `'auto'` or `'pinch-zoom'`:
      1. `fast-view/page.tsx`, PDF Stage Mode overlay root (`fixed … z-50 bg-black`): `touchAction: 'pan-x pan-y'`
      2. `TabDrawingStage.tsx`, stage root (`flex-1 w-full h-full bg-black`, was `'none'`): `touchAction: 'pan-x pan-y'`
      3. `TabDrawingStage.tsx`, stage container (`flex-1 min-h-0 relative overflow-hidden`): `touchAction: stageTouchAction(drawingEnabled)`
      4. `TabDrawingStage.tsx`, scroll container (`w-full h-full overflow-auto`): `touchAction: stageTouchAction(drawingEnabled)`
      5. `TabDrawingStage.tsx`, annotation `<canvas class="absolute top-0 left-0">`: `touchAction: stageTouchAction(drawingEnabled)`
      6. `TabDrawingStage.tsx`, toolbar container (`shrink-0 bg-gray-900/95 … border-t`): `touchAction: 'pan-x'`

      and `grep -rn "touch-action" src/app/globals.css` returns no matches.
- [ ] Manual/QA (browser pinch is suppressed): with PDF Stage Mode open and drawing off,
      a two-finger pinch anywhere over the PDF, the toolbar or the overlay header leaves
      `window.visualViewport.scale === 1` and does not change the browser's zoom; the PDF
      is still zoomable via the in-app zoom controls, which leave
      `window.visualViewport.scale === 1` as well.
- [ ] Manual/QA (read mode): with drawing off, a one-finger drag over the PDF scrolls the
      page natively and creates **no** stroke — the save-state pill stays on "Saved" and
      never enters "Saving…"; `‹ Prev` / `Next ›` still turn pages.
- [ ] Manual/QA (read mode still shows ink): a page with previously saved strokes renders
      those strokes while drawing is off; they are visible but cannot be modified.
- [ ] With drawing off, the mode selector (Pen/Erase/Pan), the colour swatches, `↶ Undo`
      and `Clear page` are **absent from the DOM**, while page nav, `Page X / N`, the
      save-state pill, the zoom controls and the toggle are present.
- [ ] Tapping the toggle sets `aria-pressed="true"` and label `Draw: On`, renders the
      mode selector, colour swatches, Undo and Clear page, and switches the canvas to
      `pointer-events: auto` with `touch-action: none` on the drawing subtree
      (`stageCtr`, `scroller`, `canvas`) and **not** on the stage root; drawing,
      erasing, undo, clear and the debounced autosave then behave exactly as they did
      before this task (stroke appears, pill cycles "Saving…" → "Saved").
- [ ] Manual/QA (no lost work): draw a stroke and immediately (< 800 ms) tap the toggle
      to Off — the save is flushed rather than dropped; the pill reaches "Saved", and
      closing and reopening Stage Mode shows the stroke on the same page and position.
- [ ] Manual/QA (tablet, the reported bug): in device emulation at 768 × 1024, 820 × 1180
      and 1024 × 768, open PDF Stage Mode on a multi-page tab — the toolbar is fully
      visible on first render **and remains fully visible** after scrolling the PDF,
      turning pages, using the **in-app zoom controls** (`+` / `−` / reset, which do not
      touch the browser's visual viewport), and toggling drawing on/off. In every one of
      those states `toolbar.getBoundingClientRect().bottom <= window.visualViewport.height`
      and `window.visualViewport.scale === 1`.
- [ ] While PDF Stage Mode is open **and `window.visualViewport.scale === 1`**, the
      overlay root's rendered height equals
      `stageViewportHeight(window.visualViewport?.height, window.innerHeight)` (checkable
      in the console: overlay `getBoundingClientRect().height` matches
      `window.visualViewport.height` within 1 px), and the overlay root no longer relies
      on `inset-0` / `100vh` for its height. Because browser pinch-zoom is suppressed
      inside the overlay, scale 1 is the only state reachable by touch; if a scale
      other than 1 is forced (e.g. desktop `Ctrl`+wheel), the overlay keeps its last
      stable height rather than shrinking — the height state must not update while
      `isStableViewportMeasurement(scale)` is false.
- [ ] The scroll lock targets the Fast View page's real scroll container, the app shell's
      `<main>` (`src/components/layout/AppLayout.tsx:273`, class contains
      `flex-1 overflow-y-auto`), resolvable in the console as `document.querySelector('main')`
      (the first `<main>` in document order; the page's own inner `<main>` never scrolls).
      While PDF Stage Mode is open, `getComputedStyle(document.querySelector('main')).overflowY`
      is `'hidden'`, and the overlay root
      (`document.querySelector('[title="Close PDF Stage Mode"]').closest('.fixed')`)
      computes to `overflow: hidden` with `overscroll-behavior: contain`.
- [ ] After closing PDF Stage Mode (✕ button or device back button),
      `document.querySelector('main').style.overflow` is the empty string,
      `getComputedStyle(document.querySelector('main')).overflowY` is `'auto'` again, and
      the Fast View page scrolls normally.
- [ ] `document.body` / `document.documentElement` are never written to by this change:
      `grep -rn "body.style\|documentElement.style" src/app/songs/\[id\]/fast-view/page.tsx src/components/tabs/TabDrawingStage.tsx`
      returns no matches (the shell is `flex h-screen`, so `body` never scrolls and
      locking it would be a no-op).
- [ ] Manual/QA (the reported chaining): with the Fast View page scrolled part-way down,
      note `document.querySelector('main').scrollTop`, open PDF Stage Mode, and drag one
      finger up and down repeatedly on the overlay header (the black bar with the
      "Close PDF Stage Mode" ✕) and over the toolbar — the page behind does not scroll:
      `document.querySelector('main').scrollTop` is unchanged. After closing, the page is
      still at that same scroll offset and scrolls normally.
- [ ] The toolbar's control row does not wrap: at viewport widths 320, 480, 768, 1024 and
      1280 px, with drawing both on and off, the toolbar element's own
      `getBoundingClientRect().height` is the same value within 1 px and is **≤ 104 px**
      (97 px computed + ~7 px slack). This is the toolbar's border box **only**;
      `env(safe-area-inset-bottom)` is not part of it — `getComputedStyle(toolbar).paddingBottom`
      must be `8px` on every device, with the inset carried by the separate spacer sibling
      — so the same ≤ 104 px holds identically in desktop emulation (inset 0) and on
      iPad/iOS hardware (inset 20–34 px). Any overflow is reachable by horizontal
      scrolling of the row rather than by an extra wrapped line.
- [ ] The horizontal scroll of the control row is actually reachable by **touch in
      drawing mode**. With the viewport at 320 px wide and drawing **on**,
      the control row overflows (`row.scrollWidth > row.clientWidth`) and no ancestor of
      the toolbar blocks the gesture:
      `(() => { const bad = []; for (let n = toolbar; n; n = n.parentElement) if (getComputedStyle(n).touchAction === 'none') bad.push(n); return bad })()`
      returns an empty array. A one-finger horizontal drag across the row (touch
      emulation or real tablet) moves it — `row.scrollLeft` goes from `0` to `> 0` — and
      leaves `window.visualViewport.scale === 1`.
- [ ] A safe-area spacer element is rendered as the toolbar's next sibling with
      `height: env(safe-area-inset-bottom, 0px)` and the toolbar's background colour; on a
      device (or emulated device) with a non-zero bottom inset, no toolbar control is
      overlapped by the home indicator, and the spacer's height equals the inset while the
      toolbar's height is unchanged from the zero-inset case.
- [ ] Manual/QA (stale-pointer regression): toggling drawing off mid-stroke and back on,
      then drawing again, produces a new stroke — not a zoom change — confirming
      `pointersRef` / `pinchStateRef` are reset on disable and `lostpointercapture` is
      handled; no stray mark is committed by the aborted stroke.
- [ ] No **new** `alert(` or `confirm(` call is introduced by this task, and no native
      browser dialog appears anywhere in PDF Stage Mode — toggling drawing on/off,
      `Clear page`, `↶ Undo`, page nav, the zoom controls and closing the overlay all
      complete without a native `confirm`/`alert` popup; the Clear page confirmation is
      the existing Toast-style inline panel. Checked against the unchanged baseline, by
      content rather than by line number (these files already contained the matches below
      before this task, in delete flows unrelated to Stage Mode — retrofitting them is
      RH-16's job, not this one):
      `grep -n "alert(\|confirm(" src/app/songs/\[id\]/fast-view/page.tsx` returns
      **exactly two** lines — the delete-tab handler
      (`if (!confirm('Are you sure you want to delete this tab?')) return`) and the
      delete-link handler
      (`if (!confirm('Are you sure you want to delete this link?')) return`) — and no
      others; the same grep on `src/components/tabs/TabDrawingStage.tsx` returns
      **exactly one** line, the comment
      `{/* Clear-page confirmation — Toast-based, no native confirm() */}`; and on
      `src/lib/stageInteraction.ts` it returns **no matches**.
- [ ] `npm run lint` and `npm run test` pass with no new failures.
- [ ] `package.json` `version` is bumped from `0.1.49-202608311417` to a higher patch
      version with a `-YYYYMMDDHHmm` timestamp suffix (AGENTS.md version-bump rule).

## Out of Scope

- Persisting the drawing on/off preference across Stage Mode sessions or across devices —
  it always opens **off**.
- The lyrics Stage Mode overlay and its font-size / dark-mode controls.
- Any change to the annotation data model, the server actions, or the Vercel Blob upload
  path.
- New drawing capabilities (redo, stroke width, shapes, text, partial erase).
- Adding jsdom / `@testing-library/react` and component-level unit tests; the vitest
  environment stays `node`.
- Playwright e2e coverage of Stage Mode gestures — e2e cannot reach this surface without
  a Vercel Blob PDF upload, and RH-5 already classified these as manual/QA.
- Re-theming or restyling the toolbar beyond the no-wrap/height/safe-area-spacer changes
  described above.
- Converting the two pre-existing `window.confirm` calls in `fast-view/page.tsx`
  (delete tab, delete link) to inline/Toast confirmations — they are outside Stage Mode
  and are covered by RH-16.
- Supporting **browser** pinch-zoom inside PDF Stage Mode, or making the overlay track
  `visualViewport.offsetTop` / `scale` while zoomed. Zooming the tab is the in-app zoom
  controls' job; see §2a for why the two models cannot coexist.

## Delivery Notes

- Commit message: Conventional Commits with the task id as scope, e.g.
  `fix(RH-28): keep stage-mode toolbar on screen and add drawing toggle`
  (`git log --grep 'RH-28'` must find it).
- **Version bump is mandatory**: any commit to `master` must bump `package.json`
  `version` (patch + `-YYYYMMDDHHmm` local-time suffix), per AGENTS.md.
- No browser `alert()` / `confirm()` anywhere in the change.
- The `<!-- BEGIN:nextjs-agent-rules -->` block in `AGENTS.md` is rewritten by
  `next dev`; if it shows up in the diff, commit it with the work rather than reverting it.

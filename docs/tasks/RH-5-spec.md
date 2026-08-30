# RH-5 — Implementar anotações manuscritas (camada de desenho) sobre as tablaturas

## Scope

Add a freehand drawing layer that a musician can use to hand-annotate a
tab PDF (e.g. circle a chord, write a fingering reminder, mark a section
to repeat) while reading it in **Stage Mode** — the fullscreen "on stand"
viewer already reachable from Fast View
(`src/app/songs/[id]/fast-view/page.tsx`, the `isPdfStageMode` overlay).

This task covers, end to end:

1. A Postgres migration adding **one JSONB column** to `repertoire_tabs`
   to persist per-page freehand stroke data (vector, not a rasterized
   image — see Approach for why).
2. Replacing Stage Mode's current PDF surface — a `<iframe>` pointed at
   Google's public Docs Viewer (`docs.google.com/gview?url=...`) — with
   a real, same-origin PDF renderer (`react-pdf` / `pdfjs-dist`) for the
   *Stage Mode overlay only*. This is a hard prerequisite for drawing:
   a cross-origin Google iframe cannot expose page geometry or accept a
   canvas overlay, so there is no way to add a drawing layer on top of
   it without first controlling the render surface ourselves.
3. A `<canvas>` drawing layer, positioned absolutely over the rendered
   PDF page inside Stage Mode, supporting freehand pen strokes **in any
   color** (a custom color picker, not a fixed preset-only palette),
   **a whole-stroke eraser tool**, and **pinch-to-zoom / pan while
   drawing or erasing** — all via the Pointer Events API (mouse, touch,
   and stylus/pen go through one code path).
4. Server Actions to load and persist stroke data, autosaving as the
   musician draws or erases, scoped per tab **and** per page. (Erasing
   a stroke does not need a new action — see Approach §2.)
5. Unit tests for the new data round-trip (server actions) and access
   control reuse. Manual/QA verification for the actual drawing/erase/
   zoom interaction (see Expected Results — this is explicitly and
   unavoidably a canvas/UI feature that cannot be fully asserted by
   `vitest`).

Explicitly **not** covered by this task (see Out of Scope): the small
inline (non-fullscreen) PDF preview embedded directly in the Fast View
page body keeps using the Google Docs Viewer iframe unchanged — only
Stage Mode's viewer is swapped. Redo, undo-of-an-erase, exporting a
flattened annotated PDF, and real-time multi-user collaborative
drawing are all deferred. (Multi-color, eraser, and zoom/pan-while-
drawing — previously deferred in an earlier draft of this spec — are
now in scope; see Approach §3.)

## Why this file exists before any code

Per the task justification, this spec is written and reviewed with the
user *before* the migration or the canvas are built — the data model
(one JSONB column vs. a stroke-rows table vs. a rendered-overlay-image
column) and the "swap Stage Mode's PDF engine" decision are both real,
hard-to-reverse architectural calls that deserve scrutiny up front
rather than discovery mid-implementation.

## Current State (confirmed by reading the code)

- `repertoire_tabs` (`migrations/0002_add_tabs_and_lyrics.sql`): `id`,
  `repertoire_id`, `title`, `file_url`, `created_at`. No page count, no
  annotation storage of any kind.
- `src/app/actions/tabs.ts`: `uploadTabAction` (validates PDF magic
  bytes, uploads to Vercel Blob, inserts a row), `deleteTabAction`,
  `getTabsAction` (all three gated by `checkAccess`, which checks the
  caller owns or is a band-member on the tab's `repertoire_id`).
- **No PDF rendering library exists in this codebase.**
  `package.json` has no `react-pdf`, `pdfjs-dist`, `fabric`, `konva`,
  or any canvas-drawing dependency. Every current PDF surface — the
  inline embedded preview (`fast-view/page.tsx` ~line 888) and Stage
  Mode (~line 1387) — is a Google Docs Viewer iframe:
  `https://docs.google.com/gview?url=<blobUrl>&embedded=true`. This is
  a third-party, cross-origin, un-styleable, non-interactive embed —
  it cannot be measured, paginated programmatically, or drawn on. This
  confirms the feasibility risk called out in the task: a real PDF
  rendering library must be introduced.
- No existing test file covers `src/app/actions/tabs.ts` at all
  (`find … -iname "*tab*"` under `__tests__` only matches the source
  files themselves, not tests) — there is no existing test convention
  to mirror for this action file; new tests establish one.
- `next.config.ts` runs Next.js 16 with **both** a Webpack config
  (`npm run dev` explicitly passes `--webpack`) **and** an empty
  `turbopack: {}` block (the `next build` default bundler). Any new
  bundler-sensitive asset — notably the pdf.js worker script — must
  work under both, which rules out bundler-specific worker-loading
  tricks (e.g. Webpack's `new URL(...)` worker pattern) as the
  *primary* mechanism; see Approach.

## Approach

### 1. Data model — one JSONB column, vector strokes, keyed by page

`migrations/0005_add_tab_annotations.sql` (mirrored byte-for-byte at
`supabase/migrations/0005_add_tab_annotations.sql`, following the
0003/0004 pattern of identical files in both directories):

```sql
-- Migration 0005: freehand drawing-layer annotations on tab PDFs.
-- One JSONB column on repertoire_tabs, keyed by page number, storing
-- vector stroke data (not a rasterized image — see spec RH-5).

ALTER TABLE repertoire_tabs
    ADD COLUMN IF NOT EXISTS annotations jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN repertoire_tabs.annotations IS
    'Freehand drawing-layer strokes, keyed by page number as a string, e.g. {"1": [ {stroke...}, ... ], "2": [...] }. Coordinates are normalized 0..1 relative to page width/height so they render correctly at any zoom/viewport.';
```

**Why a single JSONB column, not a `repertoire_tab_annotations` rows
table or a rendered-overlay-image column** (the three options the task
called out to weigh):

- **Rows table** (one row per stroke, or per page) is the "more
  normalized" option, but buys nothing here: annotations are always
  read and written as a whole page's worth of strokes at once (draw a
  stroke → save the page's array; open a tab → load all its pages'
  strokes in one query), never queried or filtered by individual
  stroke. A rows table would need its own migration *and* its own CRUD
  surface for a access pattern that's fundamentally "one blob of
  document data," which is exactly what JSONB is for in this schema
  (the project already tolerates this shape — e.g. `tags text[]` on
  `repertoire`/`playlists` instead of a normalized tags table, per
  `AGENTS.md`'s Domain Concepts). It also directly matches the
  justification's own phrasing — "a coluna" (singular).
- **Rendered-overlay-image column** (rasterize the canvas to a PNG per
  page, upload it to Vercel Blob, store its URL) was considered and
  rejected: it requires a Blob write on *every* save (not just once
  per upload, as today), throws away editability (an undo/clear on a
  raster image means "redo the whole page," not "pop one stroke"),
  forecloses the explicitly-planned future multi-color/undo/redo scope
  extension, and doesn't compose with band-shared tabs the way a
  structured stroke list does (a future task could reasonably want
  "who drew this stroke" — impossible once flattened to pixels).
- **Vector JSON is also strictly smaller and cheaper**: a few dozen
  freehand strokes per page is a few KB of JSON; a 1200×1600 PNG
  overlay per page is a Blob object and a network round-trip per save.

**Stroke shape** (documented in the migration's `COMMENT ON COLUMN`
and enforced at the application layer, not by a DB `CHECK` — matching
how `repertoire.tags text[]`/`playlists` JSON-ish fields aren't
schema-validated in Postgres either):

```ts
interface Stroke {
  id: string          // client-generated (crypto.randomUUID()), used for undo (pop by id) and eraser hit-testing (remove by id)
  color: string        // any hex color, e.g. "#ef4444" or "#7c3aed" — already a free string, not an enum; see "Multi-color" in Approach §3
  width: number         // stroke width in normalized units (see below)
  points: [number, number][] // [x, y] pairs, each 0..1 relative to the PDF page's own native (scale-independent) dimensions — see "Zoom/pan" in Approach §3 for exactly what this means once zoom is variable
}

// repertoire_tabs.annotations shape:
type TabAnnotations = Record<string /* page number, 1-indexed, as string */, Stroke[]>
```

Coordinates and stroke width are stored **normalized to page
dimensions** (0..1), not raw pixels — this is what makes a stroke drawn
on a phone screen at one zoom level still land in the right place when
the same tab is reopened on a laptop or a different Stage Mode viewport
size, **and, now that zoom is in scope, also what makes a stroke drawn
at any zoom level (1.0x–3.0x) land correctly at any other zoom level**.
`react-pdf`'s `Page` `onRenderSuccess` callback passes a `PageCallback`
object (confirmed from `react-pdf`'s own type declarations, `dist/shared/types.d.ts`)
with **both** `width`/`height` (the page's *currently rendered* pixel
size, which varies with the zoom level in effect at that render) **and**
`originalWidth`/`originalHeight` (the PDF page's fixed, scale-independent
native size in pdf.js's own coordinate space — identical on every render
call regardless of zoom, viewport, or fit-width). Normalization always
divides/multiplies against `originalWidth`/`originalHeight`, never
against the current `width`/`height` — see "Zoom/pan while drawing" in
Approach §3 for the full conversion and why this specific anchor was
chosen over the current rendered size.

### 2. Backend — extend `src/app/actions/tabs.ts`

**No new server action is introduced for the eraser, and none is
needed for multi-color or zoom/pan either.** `saveTabAnnotationsAction`
already persists "this page's entire stroke array, whatever it
contains" — erasing a stroke is, from the backend's point of view,
indistinguishable from any other edit that produces a shorter `Stroke[]`
for the current page: the client removes the erased stroke's entry from
its local array (same as an Undo pop) and calls the exact same
`saveTabAnnotationsAction(tabId, repertoireId, pageNumber, strokes)`
that drawing already debounces to. Multi-color needs zero backend
change because `Stroke.color` was already declared as a free `string`
(see §1) — the 4-preset-only *palette* was purely a toolbar/UI
restriction, never a data-model one. Zoom/pan is entirely client-side
ephemeral UI state (never persisted — see §3) and touches the stored
`Stroke.points`/`width` format not at all, since that format was
already zoom-agnostic 0..1 normalization (§1). In short: this whole
scope expansion is additive on the frontend only; the two actions below
are unchanged from the original spec.

Two additions, reusing the existing `checkAccess(userId, repertoireId)`
guard exactly as `uploadTabAction`/`deleteTabAction`/`getTabsAction` do
today — no new authorization logic:

```ts
export async function getTabAnnotationsAction(
  tabId: string,
  repertoireId: string,
): Promise<{ data?: TabAnnotations; error?: string }> {
  try {
    const userId = await getRequiredUserId()
    await checkAccess(userId, repertoireId)
    const { rows } = await query(
      'SELECT annotations FROM repertoire_tabs WHERE id = $1 AND repertoire_id = $2',
      [tabId, repertoireId]
    )
    if (rows.length === 0) return { error: 'Tab not found' }
    return { data: rows[0].annotations as TabAnnotations }
  } catch (err: any) {
    return { error: err.message || 'Failed to load annotations' }
  }
}

export async function saveTabAnnotationsAction(
  tabId: string,
  repertoireId: string,
  pageNumber: number,
  strokes: Stroke[],
): Promise<{ success?: boolean; error?: string }> {
  try {
    const userId = await getRequiredUserId()
    await checkAccess(userId, repertoireId)
    // jsonb_set writes/overwrites only this page's key, leaving every
    // other page's strokes in the same row untouched.
    // RETURNING id is required so the affected row count can be checked
    // below — without it a non-matching tabId/repertoireId pair would
    // silently no-op and this action would still report { success: true },
    // masking a not-found case (mirrors getTabAnnotationsAction's
    // `rows.length === 0` not-found check above, applied to the UPDATE's
    // result instead of a SELECT's).
    const { rows } = await query(
      `UPDATE repertoire_tabs
       SET annotations = jsonb_set(annotations, $3, $4::jsonb, true)
       WHERE id = $1 AND repertoire_id = $2
       RETURNING id`,
      [tabId, repertoireId, `{${pageNumber}}`, JSON.stringify(strokes)]
    )
    if (rows.length === 0) return { error: 'Tab not found' }
    return { success: true }
  } catch (err: any) {
    return { error: err.message || 'Failed to save annotations' }
  }
}
```

`getTabsAction`'s existing `SELECT` is **not** changed to include
`annotations` — tab list rows are used for the list UI and the small
inline preview, which don't draw; annotations are fetched on demand
only when Stage Mode opens a tab, via the new
`getTabAnnotationsAction`, to avoid bloating every tab-list fetch with
drawing data most renders never use.

**Save semantics — last-write-wins, whole-page overwrite, no
row-level locking**: `saveTabAnnotationsAction` replaces a page's
entire stroke array in one call. For a personal tab this is
uncontroversial (single writer). For a **band-shared tab**, two band
members could in principle both open Stage Mode on the same tab/page
and draw concurrently — the second save wins, silently discarding the
first member's strokes made in that window. This mirrors the existing
band-tab model (no per-tab locking exists anywhere in `tabs.ts` today)
and is called out explicitly as an accepted MVP limitation, not a
silent gap — collaborative-drawing conflict resolution is Out of
Scope.

### 3. Frontend — swap Stage Mode's PDF surface to `react-pdf`

**New dependency**: `react-pdf` (thin, actively-maintained React
wrapper over `pdfjs-dist`; gives a `<Document>`/`<Page>` component
pair with an `onRenderSuccess(page)` callback exposing rendered pixel
`width`/`height` — exactly the page-geometry access a raw
`docs.google.com/gview` iframe cannot provide). `pdfjs-dist` comes in
as its transitive dependency.

**Worker loading, given the dual-bundler constraint (Webpack in dev,
Turbopack in build)**: point `pdfjs-dist`'s `GlobalWorkerOptions.workerSrc`
at a CDN URL pinned to the exact installed `pdfjs-dist` version (e.g.
`https://unpkg.com/pdfjs-dist@<version>/build/pdf.worker.min.mjs`) set
once in a small client-only init module (e.g.
`src/lib/pdfWorker.ts`, imported only from the new Stage Mode drawing
component). This sidesteps bundler-specific worker-asset wiring
entirely — appropriate here since the app already fetches tab PDFs
themselves from an external Blob URL, so one more external asset
fetch (the worker script) is consistent with the existing trust/network
model, and it avoids two separate worker-loading code paths for
Webpack vs. Turbopack.

**Component**: a new client component,
`src/components/tabs/TabDrawingStage.tsx`, rendered by Stage Mode in
`fast-view/page.tsx` in place of the current `<iframe>` block
(~line 1387):

- Renders `<Document file={activeTabUrl}><Page pageNumber={page} width={baseFitWidth * zoomLevel} onRenderSuccess={...} /></Document>` from `react-pdf`. **`baseFitWidth` is brand-new logic this task introduces, not a reuse of any prior computation**: today's Stage Mode surface is a plain `<iframe className="w-full h-full">`, which is sized by CSS percentages and has no JS-computed pixel width anywhere to mirror — `react-pdf`'s `<Page width={...}>` prop requires an actual pixel number, unlike a CSS-percentage iframe. The mechanism: a container `<div ref={stageContainerRef}>` wraps the Stage Mode PDF viewing area (the outer, fixed-layout viewport box — distinct from the inner `overflow: auto` zoom-scroll container introduced in "Zoom/pan" below, whose own content can grow larger than it once `zoomLevel > 1.0`; observing that inner container instead would risk a resize-measurement feedback loop tied to zoomed content size). A `ResizeObserver` observes `stageContainerRef` and reads its `contentRect.width` on every callback firing, storing the latest value in `baseFitWidth` state. `ResizeObserver` is used instead of a plain `window`/`resize` event listener because it correctly reacts to container-size changes from causes other than the window itself resizing — e.g. the toolbar's own layout changing, orientation change, or the browser's dynamic mobile viewport chrome showing/hiding. This measured width (in CSS pixels) is passed directly as `react-pdf`'s `<Page width={baseFitWidth * zoomLevel}>` prop, and `baseFitWidth` is recomputed — with `<Page>` re-rendered at the new width — every time the `ResizeObserver` callback fires, not just once on mount; `zoomLevel` (see "Zoom/pan" below) multiplies it.
- A `<canvas>` absolutely positioned over the rendered `<Page>`, sized to match its *currently rendered* pixel dimensions exactly (`page.width`/`page.height` from `onRenderSuccess`, which change with `zoomLevel`), redrawn from the current page's `Stroke[]` (denormalizing `points` back to the current render's pixels — see "Zoom/pan" below for the exact formula) whenever the page, strokes, zoom level, or canvas size changes.
- Page navigation: since `react-pdf` renders one page at a time (unlike Google's continuous-scroll embed), Stage Mode gains explicit `‹ Prev` / `Next ›` controls and a `Page X / N` indicator (total pages from `<Document onLoadSuccess={({numPages}) => ...}>`). This is a **visible, intentional UX change** to Stage Mode's non-drawing viewing behavior (page-by-page instead of Google's vertical scroll) — flagged here for reviewer attention, and considered an acceptable trade-off since it's required to make drawing possible at all. Navigating to a different page also resets `zoomLevel` to `1.0` (see "Zoom/pan" below).
- A floating toolbar (bottom of the Stage Mode overlay, thumb-reachable — consistent with the mobile-first "on stand" design language in `AGENTS.md`'s UI/UX Behavioral Directives): a **three-way Pen / Erase / Pan mode toggle** (was a two-way Pen/Pan toggle before this revision), a color control (see "Multi-color" below), `+`/`−` zoom buttons and a "100%" reset tap target (see "Zoom/pan" below), Undo, Clear page, and a save-state indicator ("Saved" / "Saving…").
- **Pointer handling**: `onPointerDown`/`onPointerMove`/`onPointerUp` on the canvas, using `setPointerCapture` so a stroke or erase-drag started on the canvas keeps receiving events even if the pointer briefly leaves its bounds — one unified code path for mouse, touch, and stylus/pen via the Pointer Events API (no separate touch-event handling needed). Active pointers are tracked in a `Map<pointerId, {x, y}>`; see "Zoom/pan" below for how a second simultaneous pointer changes this from a draw/erase gesture into a pinch gesture. While in Pen or Erase mode with exactly one active pointer, native touch scrolling/browser pinch-zoom on the canvas is suppressed (`touch-action: none`) so the gesture isn't fought by the browser's own handling; while in Pan mode, the canvas still needs to receive pointer events itself now (unlike the pre-zoom design, where `pointer-events: none` let the browser scroll the underlying page natively) because panning a *zoomed* page is handled entirely by this component's own scroll-container logic — a controlled scroll that reads pointer movement deltas via the same `onPointerDown`/`onPointerMove`/`onPointerUp`/`setPointerCapture` path as Pen/Erase and applies them directly to the scroll container's `scrollLeft`/`scrollTop` — **never native browser scroll**. `touch-action: none` is therefore set in Pan mode too, exactly as in Pen/Erase mode, not just those two: native scroll/pan is suppressed in all three modes so it can never fight the component's own pointer-driven scroll logic, and so two-finger pinch detection (see "Zoom/pan" below) is never intercepted by the browser first. See "Zoom/pan" below for the same mechanism described again for the pinch-to-zoom interaction.
- **Autosave**: each completed stroke (`pointerup` in Pen mode) is appended to local React state immediately (instant visual feedback, no round-trip latency while drawing) and triggers a debounced (~800ms) call to `saveTabAnnotationsAction` for the current page, coalescing rapid consecutive strokes into one save. Each stroke removed by the eraser (see "Eraser" below) triggers the same debounced save path — there is no separate "erase save" mechanism. A save is also flushed immediately (not debounced) when the page changes or Stage Mode closes, so no stroke is ever lost to a pending debounce timer on exit. There is no explicit "Save" button in the MVP — this matches the app's existing autosave-style mutation patterns (no save button anywhere else in Fast View) and suits the "hands are busy holding an instrument" context better than requiring a deliberate tap.
- Undo pops the most recently *drawn* stroke (by `id`, tracked via an append-order array) from the current page's array and re-triggers the debounced save; there is no redo, and **erasing a stroke is not undoable in this MVP** — the same non-reversibility already accepted for Clear page (see Out of Scope). Clear page empties the current page's stroke array (with a non-blocking confirmation via the app's existing Toast pattern before committing — no native `confirm()`, per `AGENTS.md`'s NO Browser Alerts rule) and saves immediately.

**Multi-color** (custom color picker, not just the 4 presets): the
toolbar's color control keeps the 4 fixed preset swatches from the
original design as one-tap quick picks (fast, thumb-reachable, no
sub-menu — important for a musician between song sections), and adds a
5th "custom" swatch backed by a native `<input type="color" />`. The
native color input already returns a fully valid `#rrggbb` hex string
on every platform (desktop and mobile browsers both ship a system color
picker for it), so no separate hex-text-entry field or client-side
color validation is needed. Tapping the custom swatch opens the native
picker; whatever color is chosen becomes both the active drawing color
and the custom swatch's own displayed color (so it's a one-tap re-pick
of the last custom color next time, not just a reset launcher). This
requires **no data-model or backend change**: `Stroke.color` was
already declared `string` in the original spec (§1), so persisting an
arbitrary hex value instead of one of 4 fixed values is a pass-through
— the UI restriction to 4 presets, not the schema, was the only thing
limiting color choice before this revision.

**Eraser** (whole-stroke only, not partial/pixel erasing): a new Erase
toolbar mode. While in Erase mode with one active pointer down, on
every `pointermove` the component hit-tests the pointer's current
canvas-relative pixel position against every stroke on the current
page: for each `Stroke`, walk its `points` array, **denormalize each
point to the canvas's *currently rendered* pixel space** (the same
`pixelX = normX * page.width` formula used for drawing/redraw, see
"Zoom/pan" below — this step is what puts a stored, zoom-agnostic
`Stroke` point into the same coordinate space as the live pointer),
and compute the pixel distance between the pointer's position and each
denormalized point. If any point is within a fixed tolerance of **16
CSS px, left exactly as-is — not scaled, multiplied, or divided by
`zoomLevel` or any current-zoom factor in any way**, that whole stroke
is spliced out of the page's `Stroke[]` array immediately (removed by
`id`) and the canvas is redrawn without it.

  **Why the tolerance is unscaled, unlike stroke width**: stroke
  `width` is a *persisted, normalized* value (§1) that must be
  converted *from* normalized page-fraction space *into* whatever
  `page.width` currently is, precisely so a stroke drawn thick at one
  zoom level still looks the same relative thickness at another zoom —
  that conversion is `pixelWidth = normWidth * page.width`, which
  *grows* the on-screen pixel value as `zoomLevel` increases. The
  eraser tolerance is a completely different kind of number: it is
  never stored, never normalized, and never expressed as a fraction of
  the page at all — it is defined directly and only in on-screen CSS
  pixels, because it approximates the physical contact size of a
  fingertip or stylus tip against the glass, which does not change
  when the app's `zoomLevel` changes. By the time the hit-test runs,
  both operands of the distance comparison — the denormalized stroke
  point and the pointer's `clientX/Y`-derived position — are already
  in the same "current screen pixels" coordinate space (see
  denormalization step above), so applying the zoom scale factor a
  second time to the 16px constant would be a coordinate-space error,
  not a refinement: it would make the hit radius grow on screen as the
  user zooms in, the opposite of "feels the same physical size at any
  zoom level." The tolerance constant must therefore be compared
  directly against pixel-space coordinates with no zoom-scaling step
  applied to it at all.

The drag can hit-test and remove multiple strokes in one continuous erase
gesture (each removal re-runs the hit-test against the now-shorter
array on subsequent `pointermove` events). This is deliberately the
simplest correct design given the vector-stroke model: **splitting a
stroke into sub-strokes so only the erased segment disappears is
explicitly out of scope** (see Out of Scope) — erasing always removes
an entire stroke, never a fragment of one. Erase mode uses the same
`setPointerCapture`/`touch-action: none` handling as Pen mode for a
single active pointer.

**Zoom/pan while drawing** — the trickiest part of this revision, so
spelled out precisely:

- **State**: a `zoomLevel` number, `1.0`–`3.0`, held in component state
  (`useState`, not persisted to the backend or across Stage Mode
  sessions — see Out of Scope). Default `1.0` on opening Stage Mode and
  on every page navigation (Prev/Next resets zoom, per above) — this
  keeps each newly-viewed page predictable (always starts fit-to-width)
  rather than carrying a jarring leftover zoom level from the previous
  page.
- **Rendering at zoom**: `<Page width={baseFitWidth * zoomLevel} .../>`
  as noted above. When `zoomLevel > 1.0`, the rendered page (and the
  canvas sized to match it exactly) is wider/taller than the Stage Mode
  viewport, so the `<Page>`+`<canvas>` pair sits inside a `overflow:
  auto` scroll container that only activates at `zoomLevel > 1.0`
  (at `1.0` it's exactly viewport-sized, matching today's behavior with
  no scrollbars).
- **The normalization anchor — why `originalWidth`/`originalHeight`,
  not the current rendered `width`/`height`**: `react-pdf`'s
  `onRenderSuccess` callback (confirmed via its `PageCallback` type,
  `dist/shared/types.d.ts` in the published package) exposes **four**
  numbers per render, not two: `width`/`height` (pixels, *at the current
  `width` prop / zoom level* — these change every time `zoomLevel`
  changes) and `originalWidth`/`originalHeight` (the PDF page's native,
  scale-independent size in pdf.js's own coordinate space — identical
  on every single render of that page, completely unaffected by
  `zoomLevel`, viewport size, or device). Coordinate normalization
  always goes through the second pair, never the first:
  - **On draw/erase (pointer → normalized 0..1)**: read the pointer's
    position relative to the canvas element (`clientX/Y` minus
    `canvas.getBoundingClientRect().left/top`, which already accounts
    for the current scroll offset inside the zoom scroll container —
    i.e. pan is handled for free by using bounding-rect-relative
    coordinates rather than raw client coordinates). Convert that
    *currently-rendered-pixel* position into the page's fixed native
    space using the current render's own `width`/`height` as the scale
    factor: `nativeX = (pixelX / page.width) * page.originalWidth`,
    then store `normX = nativeX / page.originalWidth` (which algebraically
    simplifies to `pixelX / page.width` — see note below on why the
    longer form is still what implementers should write, not the
    simplified one).
  - **On render/denormalize (normalized 0..1 → pixels at current
    zoom)**: `nativeX = normX * page.originalWidth`, then
    `pixelX = (nativeX / page.originalWidth) * page.width` — i.e.
    `pixelX = normX * page.width`, using **whatever `page.width` is
    right now**, at the current zoom.
  - **Why go through `originalWidth` explicitly instead of writing the
    algebraically-simplified `pixelX / page.width` directly**: because
    `originalWidth`/`originalHeight` are stable across the *entire*
    lifetime of a page (never recomputed, never subject to a stale
    React-state race during a zoom transition), whereas `page.width`
    is a value captured from the *last* `onRenderSuccess` firing and
    could, in principle, be one render cycle stale relative to what the
    canvas is actually displaying if a zoom change and a draw/erase
    gesture race. Routing every conversion through the fixed
    `originalWidth`/`originalHeight` anchor — even though it's
    mathematically equivalent to the simplified form when both values
    are in sync — makes correctness independent of that potential race,
    and gives a single stable definition of "normalized" (a fraction of
    the PDF page's own native geometry) rather than "a fraction of
    whatever the canvas happened to measure most recently." This is
    also why a stroke drawn at 2x zoom still lands correctly when later
    viewed at 1x or 3x: its stored `points` were always a fraction of
    the page's own fixed geometry, never of any particular zoom's pixel
    grid.
  - Stroke `width` is normalized/denormalized the same way, through
    `originalWidth` (a fraction of page width, scaled back up to
    whatever `page.width` is at render time) — no format change to the
    `Stroke` type from the original spec.
- **Pinch-to-zoom vs. draw/erase — a two-pointer heuristic, always
  available, no separate "zoom mode"**: regardless of whether the
  toolbar is currently set to Pen, Erase, or Pan, **a second
  simultaneously-active pointer always means "pinch zoom/pan," not
  "start a second stroke."** This matches the one-finger-draws /
  two-finger-zooms convention already standard in mobile drawing/
  annotation apps (Procreate, GoodNotes, Notability, etc.), needs no
  extra toolbar tap to switch into a "zoom mode," and — the deciding
  factor for this app's specific context — doesn't cost a musician a
  hand off their instrument to tap a mode button before they can
  zoom in in the first place. Implementation: the pointer-tracking
  `Map` from "Pointer handling" above is the source of truth. When it
  transitions from size 1 to size 2, any in-progress stroke or
  erase-drag is **aborted, not committed** (the partial stroke/erase
  path collected so far is discarded — this avoids an accidental short
  scribble or stray erase exactly where the second finger lands to
  start a pinch) and the component switches to tracking the distance
  between the two pointers (for zoom delta, clamped to `1.0`–`3.0`) and
  their midpoint's movement (for pan delta, applied as the scroll
  container's `scrollLeft`/`scrollTop`) frame to frame. When the pointer
  count drops back to 0 or 1, pinch tracking ends and a fresh
  single-pointer touch starts a normal stroke/erase-drag/pan again.
  Native browser/OS pinch-to-zoom-the-whole-page is kept disabled
  throughout Stage Mode (as it already implicitly is via `touch-action`
  suppression during drawing before this revision) so the *only* pinch
  gesture available on the canvas is this app's own — the browser never
  intercepts it to zoom the whole viewport (which would zoom the
  toolbar chrome too, breaking the fixed thumb-reachable layout).
- **`+`/`−` toolbar buttons**: a non-touch/precise path to the same
  `zoomLevel` state (mouse/trackpad users, and an accessible alternative
  to the pinch gesture), each press stepping by a fixed increment (e.g.
  `0.25`) clamped to `1.0`–`3.0`; a "100%" control resets to `1.0`
  immediately. These are the two *required* zoom inputs for this task;
  a trackpad `ctrl`+wheel gesture mapped to the same handler would be a
  natural follow-on but is not required by Expected Results here (see
  Out of Scope).
- **Pan mode's single-finger behavior** now means "drag scrolls the
  zoom scroll container" via the same **controlled scroll** mechanism
  described in "Pointer handling" above: the component reads the
  single active pointer's movement delta from its own
  `onPointerDown`/`onPointerMove`/`onPointerUp` handlers (with
  `setPointerCapture`, `touch-action: none`) and applies that delta
  directly to the scroll container's `scrollLeft`/`scrollTop` —
  **not** native/browser scroll — since the container only has
  meaningful scroll room once `zoomLevel > 1.0`. This is the same
  reason `touch-action: none` is set in Pan mode, not just Pen/Erase:
  native scroll is suppressed everywhere in this component in favor of
  its own controlled-scroll logic, so it never fights that logic and
  never steals a second finger away from pinch-zoom detection. At
  `zoomLevel === 1.0` there's nothing to scroll and Pan mode is a
  no-op, exactly as it did before this revision.

**The small inline (non-fullscreen) PDF preview in the main Fast View
body is unchanged** — it keeps the Google Docs Viewer iframe exactly
as it is today. Drawing, erasing, multi-color, and zoom/pan are only
available inside Stage Mode.

### 4. Types

`src/types/database.ts`: extend `RepertoireTab` with an optional field
so existing call sites (which never select `annotations`) remain valid:

```ts
export interface RepertoireTab {
  id: string;
  repertoire_id: string;
  title: string;
  file_url: string;
  created_at: string;
  annotations?: TabAnnotations; // only present when explicitly fetched via getTabAnnotationsAction
}
```

`Stroke` / `TabAnnotations` types live alongside the new actions in
`src/app/actions/tabs.ts` (or a small shared `src/types/annotations.ts`
if reused by the component — implementer's choice, not load-bearing).

### 5. Tests

**New `src/app/actions/__tests__/tabs.test.ts`** (first test file for
this action module — mocking `@/lib/db`'s `query`, following the same
mocking convention as `src/lib/__tests__/bands.server.test.ts`):

- `getTabAnnotationsAction` returns the stored `annotations` object for an authorized caller.
- `getTabAnnotationsAction` returns `{ error: 'Tab not found' }` when the tab id/repertoire id pair doesn't match a row.
- `getTabAnnotationsAction` propagates the `checkAccess` denial (`{ error: 'Access denied' }`) for a caller who owns neither the personal repertoire entry nor a band membership on it — reusing the existing `checkAccess` behavior, asserting it still applies to the new action.
- `saveTabAnnotationsAction` issues an `UPDATE ... SET annotations = jsonb_set(...) ... RETURNING id` call with the page number folded into the JSON path (`'{<pageNumber>}'`) and the serialized stroke array as the value, and returns `{ success: true }` when the mocked `query` resolves with a non-empty `rows` array (i.e. one row was affected).
- `saveTabAnnotationsAction` returns `{ error: 'Tab not found' }` — not `{ success: true }` — when the mocked `query` resolves with `rows: []` for the `UPDATE ... RETURNING id`, simulating a non-matching `tabId`/`repertoireId` pair that matched zero rows.
- `saveTabAnnotationsAction` propagates the `checkAccess` denial (`{ error: 'Access denied' }`, not `{ success: true }`) for a caller who owns neither the personal repertoire entry nor a band membership on it — the same access-control coverage as `getTabAnnotationsAction`'s denial case above, applied to the save path so both new actions are proven to honor `checkAccess` and neither can silently no-op past it.
- `saveTabAnnotationsAction` returns `{ error: ... }` (not a thrown exception) on a DB error, matching the try/catch-and-return-error convention every existing function in this file already uses.

This is the mechanically-verifiable core of the feature: the data
round-trip. It does **not and cannot** exercise the actual drawing
interaction — pointer-driven canvas drawing, `react-pdf` rendering,
touch/stylus input, and visual stroke placement are UI/rendering
concerns outside `vitest`'s DOM-less unit test scope, and are covered
by the manual/QA checklist in Expected Results instead. No Playwright
e2e test is added for the canvas drawing gesture itself in this task
(simulating a realistic freehand pointer path in Playwright is high-
effort/low-value versus a manual pass); a future task can add one if
regressions become a recurring problem.

**No new automated tests are added for multi-color, eraser, or
zoom/pan** beyond what's listed above — all three are purely
client-side canvas/pointer-gesture behavior (color picker input,
hit-test-and-splice-on-drag, pinch/pan math), the same category of
"UI/rendering concern outside `vitest`'s DOM-less scope" already
established for pen drawing itself, and are covered by new manual/QA
checklist items instead (see Expected Results). On the backend side
there is nothing new to test: an erase is exercised by the **same**
`saveTabAnnotationsAction` test coverage already listed above (it's
just another call with a `Stroke[]` value — a shorter array after a
removal isn't a distinct code path from a longer one after a draw), and
multi-color/zoom touch no backend code at all (§2).

## Expected Results

- [ ] `migrations/0005_add_tab_annotations.sql` exists, adds `annotations jsonb NOT NULL DEFAULT '{}'::jsonb` to `repertoire_tabs` via `ADD COLUMN IF NOT EXISTS`, and is mirrored byte-for-byte at `supabase/migrations/0005_add_tab_annotations.sql`.
- [ ] Running `npm run db:migrate` (or the equivalent local Postgres migration flow) applies cleanly against an existing local DB that already has `repertoire_tabs` rows, and every pre-existing row ends up with `annotations = '{}'`.
- [ ] `react-pdf` (and its `pdfjs-dist` transitive dependency) is added to `package.json` `dependencies` (not `devDependencies`), and `npm run build` succeeds (confirms the worker-loading approach works under the Turbopack build path, not just Webpack dev).
- [ ] `getTabAnnotationsAction(tabId, repertoireId)` returns the tab's stored `annotations` JSONB for a caller who owns the repertoire entry or is a member of its owning band, `{ error: 'Access denied' }` for anyone else (via the existing `checkAccess`), and `{ error: 'Tab not found' }` for a non-matching id pair.
- [ ] `saveTabAnnotationsAction(tabId, repertoireId, pageNumber, strokes)` persists `strokes` under that page's key in `annotations` without altering any other page's key in the same row, is access-gated by `checkAccess` (returns `{ error: 'Access denied' }` rather than silently succeeding), and returns `{ error: 'Tab not found' }` rather than `{ success: true }` when the `UPDATE ... RETURNING id` affects zero rows (non-matching `tabId`/`repertoireId`).
- [ ] `src/app/actions/__tests__/tabs.test.ts` (new) passes, covering the seven cases listed in Approach §5 — including a `checkAccess`-denial case and a not-found case for **both** `getTabAnnotationsAction` and `saveTabAnnotationsAction`.
- [ ] `RepertoireTab` in `src/types/database.ts` gains an optional `annotations?: TabAnnotations` field; every existing call site that constructs/consumes a `RepertoireTab` (list rendering, upload/delete flows) still compiles with no changes required, since the field is optional.
- [ ] Opening Stage Mode (`isPdfStageMode`) on a tab renders the PDF via `react-pdf` (a real `<canvas>`-backed page render, inspectable in devtools as same-origin canvas content) instead of the `docs.google.com/gview` iframe; the small inline (non-fullscreen) PDF preview elsewhere on the Fast View page is unchanged and still uses the Google Docs Viewer iframe.
- [ ] Stage Mode shows working `‹ Prev` / `Next ›` page controls and a `Page X / N` indicator for a multi-page tab PDF.
- [ ] Manual/QA (mouse): in Stage Mode's Pen mode, drawing a freehand stroke with a mouse renders visibly on the canvas in the selected color immediately (no perceptible lag), Undo removes the most recent stroke, and Clear page empties the current page after a Toast-based (not native `confirm()`) confirmation.
- [ ] Manual/QA (touch/stylus): on a touchscreen device or trackpad-simulated touch, drawing with a finger or stylus in Pen mode draws correctly and does not trigger page scroll/pinch-zoom while a stroke is in progress; toggling to Pan mode lets a single-finger drag pan the zoomed page via the component's own controlled scroll (reading pointer deltas and applying them to the scroll container's `scrollLeft`/`scrollTop`, not native browser scroll), and the `‹ Prev` / `Next ›` controls remain usable in Pan mode.
- [ ] Manual/QA (persistence): draw a stroke, wait for the toolbar's save-state indicator to show "Saved," close Stage Mode, reopen the same tab's Stage Mode — the stroke reappears in the correct position and page. Repeat on a different-sized viewport (e.g. desktop after drawing on mobile) and confirm the stroke still lands in the geometrically correct place (validates the normalized 0..1 coordinate storage).
- [ ] Manual/QA (page isolation): draw on page 1, navigate to page 2, draw a different stroke, navigate back to page 1 — page 1's stroke is unchanged and page 2's stroke persisted independently.
- [ ] Manual/QA (access control): a user who is not the tab's owner and not a member of its owning band cannot fetch or save annotations for that tab (confirm via the existing `checkAccess` denial path — no new bypass introduced).
- [ ] Toolbar's mode toggle is three-way — Pen / Erase / Pan — replacing the prior two-way Pen/Pan toggle; all three modes are reachable and visually distinguishable in the toolbar.
- [ ] The color control offers the original 4 preset swatches **plus** a 5th custom swatch backed by a native `<input type="color" />`; selecting any arbitrary color via the custom picker and drawing a stroke persists that exact hex value as `Stroke.color` (verified by reopening Stage Mode and confirming the redrawn stroke's color matches).
- [ ] `Stroke.color`'s type/storage is unchanged (`string`, no enum/CHECK constraint added) — confirms multi-color required no data-model or migration change, per Approach §1/§2.
- [ ] Manual/QA (eraser, whole-stroke): in Erase mode, dragging the pointer over/near any point of a previously-drawn stroke removes that entire stroke from the canvas and from the current page's persisted `Stroke[]`; strokes not touched by the eraser path are unaffected.
- [ ] Manual/QA (eraser, whole-stroke only — not partial): dragging the eraser through the *middle* of a long stroke removes the whole stroke, not just the segment the eraser passed over, confirming no stroke-splitting behavior was implemented.
- [ ] Manual/QA (eraser autosave): erasing a stroke triggers the same debounced (~800ms) autosave via the existing `saveTabAnnotationsAction` (save-state indicator cycles "Saving…" → "Saved"); no new server action exists for erasing.
- [ ] Manual/QA (eraser + undo): after erasing a stroke, Undo does **not** restore it (Undo only pops the most recently *drawn* stroke) — confirms the documented "erase is not undoable" MVP limitation.
- [ ] Toolbar gains functional `+`/`−` zoom buttons and a "100%" reset control, clamping `zoomLevel` to the `1.0`–`3.0` range, usable in all three modes (Pen/Erase/Pan).
- [ ] Manual/QA (pinch zoom): on a touch device, a two-finger pinch gesture on the canvas zooms/pans the page regardless of the currently-selected Pen/Erase/Pan mode; if a one-finger stroke or erase-drag is already in progress when a second finger touches down, that in-progress stroke/erase is aborted (not partially committed) rather than producing a stray mark.
- [ ] Manual/QA (pan while zoomed): with `zoomLevel > 1.0`, single-finger drag in Pan mode scrolls/pans within the zoomed page (rather than being a no-op, as it would be at `zoomLevel === 1.0`).
- [ ] Manual/QA (zoom round-trip correctness — the core "get it right" check): draw a stroke while zoomed to 2x (or any level `> 1.0`), then zoom back to 100% (or close and reopen Stage Mode, which resets zoom to 1.0x) — the stroke renders in the exact same geometric position on the page at every zoom level tested, confirming normalization against `page.originalWidth`/`page.originalHeight` (not the currently-rendered `width`/`height`) round-trips correctly independent of the zoom level active at draw time vs. view time.
- [ ] Manual/QA (zoom resets per page): navigating Prev/Next to a different page resets `zoomLevel` to `1.0` (fit-width) rather than carrying over the previous page's zoom level.
- [ ] Native browser/OS pinch-to-zoom of the whole page/viewport remains disabled throughout Stage Mode (only the app's own in-canvas pinch gesture and the toolbar's `+`/`−` controls change `zoomLevel`) — confirms the toolbar chrome never gets zoomed along with the page content.
- [ ] `npm run lint` and `npm run test` (vitest) pass with no new failures.

## Out of Scope

- Redo (only Undo of the single most recent *drawn* stroke; once cleared, a page's strokes are not recoverable through the UI).
- Undo of an erase action — erasing a stroke is not reversible via the toolbar's Undo control in this MVP (mirrors Clear page's existing non-reversibility; Undo only pops the most recently drawn stroke).
- Partial/pixel-level erasing or splitting a stroke into sub-strokes — the eraser always removes a whole stroke, never a fragment of one (see Approach §3, "Eraser").
- Persisting the user's `zoomLevel` across page navigation or across Stage Mode sessions — zoom always resets to `1.0` (fit-width) on page change and on reopening Stage Mode; it is ephemeral client state, never sent to the backend.
- A trackpad `ctrl`+wheel gesture (or other OS-level pinch input) as a zoom control path — only the in-canvas two-finger Pointer Events pinch gesture and the toolbar's `+`/`−`/"100%" buttons are required zoom inputs for this task.
- Exporting/flattening the PDF + annotations into a single downloadable annotated PDF file.
- Real-time collaborative drawing (two band members drawing on the same tab/page simultaneously) or any conflict-resolution/locking beyond the documented last-write-wins overwrite.
- Bringing `react-pdf`/canvas rendering to the small inline (non-fullscreen) PDF preview in the main Fast View body — that surface keeps the Google Docs Viewer iframe unchanged.
- Playwright e2e coverage of the pointer-drawing gesture itself, including the eraser and pinch-zoom gestures (manual/QA only, per Approach §5).
- Any change to `uploadTabAction`/`deleteTabAction`'s existing behavior, validation, or Vercel Blob usage.
- Shapes, text annotations, or any drawing primitive beyond freehand pen strokes and the whole-stroke eraser.

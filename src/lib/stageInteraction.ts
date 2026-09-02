/**
 * Pure, DOM-free decision helpers for the PDF Stage Mode overlay (RH-28).
 *
 * Extracted for the same reason as `annotationMath.ts`: the decisions that are
 * easy to get wrong — which viewport measurement is authoritative, when a
 * `visualViewport` reading may be trusted at all, and exactly which
 * `touch-action` / `pointer-events` value each part of the drawing subtree
 * carries — become directly unit-testable in the existing `node` vitest
 * environment, without a DOM or a pointer-event simulation.
 *
 * This module must not import from `react` / `react-dom` and must not touch
 * `window` or `document`.
 *
 * See docs/tasks/RH-28-spec.md §1 and §2a for the full reasoning.
 */

/**
 * Height the Stage Mode overlay must use so its toolbar stays on screen.
 *
 * On iOS/iPadOS Safari and Android Chrome the initial containing block — and
 * therefore `100vh` and a `position: fixed; inset: 0` box — equals the *large*
 * viewport (browser chrome collapsed). While the chrome is expanded the visual
 * viewport is 50–110 px shorter, and the bottom strip of the overlay, which is
 * exactly the toolbar, renders below the visible area. Sizing the overlay to
 * `visualViewport.height` is what keeps the toolbar on screen.
 *
 * Returns `visualViewportHeight` when it is a finite number greater than zero,
 * otherwise `innerHeight`. It never returns `0`, `NaN` or a negative number for
 * a sane `innerHeight`.
 */
export function stageViewportHeight(
  visualViewportHeight: number | undefined | null,
  innerHeight: number,
): number {
  if (typeof visualViewportHeight === 'number' && Number.isFinite(visualViewportHeight) && visualViewportHeight > 0) {
    return visualViewportHeight
  }
  return innerHeight
}

/** CSS `pointer-events` for the annotation canvas. */
export function canvasPointerEvents(drawingEnabled: boolean): 'auto' | 'none' {
  return drawingEnabled ? 'auto' : 'none'
}

/**
 * CSS `touch-action` for the **drawing subtree only** (the stage container, the
 * scroll container and the canvas).
 *
 * Never applied to the stage root: `touch-action` composes as the intersection
 * down the ancestor chain, so a `'none'` on the stage root would also remove
 * the toolbar's horizontal-scroll gesture, which is precisely the state — drawing
 * on, narrow viewport — where that gesture is needed (spec §2a/§4).
 *
 * `'pan-x pan-y'` (rather than `'auto'`) while reading is deliberate: native
 * one- and two-finger panning of the PDF works, browser pinch-zoom does not.
 * Browser pinch-zoom is incompatible with sizing the overlay from
 * `visualViewport`; the in-app zoom controls remain the way to zoom the tab.
 */
export function stageTouchAction(drawingEnabled: boolean): 'none' | 'pan-x pan-y' {
  return drawingEnabled ? 'none' : 'pan-x pan-y'
}

/**
 * Whether a `visualViewport` measurement may be used to size the overlay.
 *
 * False while the browser's visual viewport is pinch-zoomed (`scale !== 1`),
 * because a zoomed visual viewport reports a fraction of the layout viewport
 * and a non-zero `offsetTop`, neither of which describes the box a
 * `position: fixed` overlay occupies — resizing the overlay to that measurement
 * is what would push the toolbar off screen again.
 *
 * A non-finite scale (`undefined`, `null`, `NaN`) means "this browser does not
 * report a scale", which is indistinguishable from "not zoomed", so it counts
 * as stable. A reported scale is stable only within 1 % of `1`.
 */
export function isStableViewportMeasurement(visualViewportScale: number | undefined | null): boolean {
  if (typeof visualViewportScale !== 'number' || !Number.isFinite(visualViewportScale)) return true
  return Math.abs(visualViewportScale - 1) <= 0.01
}

/**
 * Whether a pointer event on the annotation canvas should be handled as a
 * draw / erase / pan gesture.
 *
 * Mirrors `drawingEnabled`. Called as the first line of each pointer handler so
 * a stale or late event — e.g. from a pointer the canvas had captured before the
 * user switched drawing off — is dropped, which the CSS `pointer-events: none`
 * alone does not cover.
 */
export function shouldHandleStagePointer(drawingEnabled: boolean): boolean {
  return drawingEnabled
}

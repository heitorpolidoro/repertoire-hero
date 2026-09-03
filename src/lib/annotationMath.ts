/**
 * Coordinate-normalization and eraser-hit-test math for the Stage Mode
 * drawing layer (RH-5). Extracted into pure, DOM-free functions so the
 * normalization anchor (the PDF page's fixed, scale-independent
 * `originalWidth`/`originalHeight` — never the currently-rendered
 * `width`/`height`, which changes with `zoomLevel`) and the unscaled
 * eraser tolerance can be unit-tested directly, without needing a
 * canvas/pointer-event simulation.
 *
 * See docs/tasks/RH-5-spec.md, Approach §3 ("Zoom/pan while drawing" and
 * "Eraser") for the full reasoning behind both.
 */
import type { Stroke } from '@/types/database'

export interface PageGeometry {
  /** The page's currently-rendered pixel width, at the current zoom level. */
  width: number
  /** The page's currently-rendered pixel height, at the current zoom level. */
  height: number
  /** The PDF page's fixed, scale-independent native width (pdf.js's own coordinate space). */
  originalWidth: number
  /** The PDF page's fixed, scale-independent native height (pdf.js's own coordinate space). */
  originalHeight: number
}

/**
 * Converts a pointer position, in the canvas's *currently-rendered* pixel
 * space, into a 0..1 fraction of the page's fixed native geometry.
 *
 * Deliberately routed through `originalWidth`/`originalHeight` rather than
 * written as the algebraically-simplified `pixelX / page.width` — see the
 * spec's "Why go through originalWidth explicitly" note. This makes
 * correctness independent of `page.width` potentially being one render
 * cycle stale relative to what's on screen during a zoom-change race.
 */
export function normalizePoint(pixelX: number, pixelY: number, page: PageGeometry): [number, number] {
  const nativeX = (pixelX / page.width) * page.originalWidth
  const nativeY = (pixelY / page.height) * page.originalHeight
  return [nativeX / page.originalWidth, nativeY / page.originalHeight]
}

/**
 * Converts a stored 0..1 normalized point back into pixels in whatever
 * the page's *currently-rendered* size (`page.width`/`page.height`) is
 * right now — i.e. at the current zoom level, whatever it is.
 */
export function denormalizePoint(normX: number, normY: number, page: PageGeometry): [number, number] {
  const nativeX = normX * page.originalWidth
  const nativeY = normY * page.originalHeight
  const pixelX = (nativeX / page.originalWidth) * page.width
  const pixelY = (nativeY / page.originalHeight) * page.height
  return [pixelX, pixelY]
}

/** Same normalization anchor as normalizePoint, applied to a stroke's width (x-axis only). */
export function normalizeWidth(pixelWidth: number, page: PageGeometry): number {
  const nativeWidth = (pixelWidth / page.width) * page.originalWidth
  return nativeWidth / page.originalWidth
}

/** Same denormalization anchor as denormalizePoint, applied to a stroke's width. */
export function denormalizeWidth(normWidth: number, page: PageGeometry): number {
  const nativeWidth = normWidth * page.originalWidth
  return (nativeWidth / page.originalWidth) * page.width
}

/**
 * Eraser hit-test tolerance, in flat CSS pixels — deliberately left
 * UNSCALED (never multiplied/divided by zoomLevel). It approximates the
 * physical contact size of a fingertip/stylus against the glass, which
 * doesn't change as the app's zoomLevel changes. See spec Approach §3,
 * "Eraser", "Why the tolerance is unscaled, unlike stroke width".
 */
export const ERASE_TOLERANCE_PX = 16

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by)
}

/**
 * Hit-tests a pointer's current canvas-relative pixel position against
 * every stroke's points (each denormalized to the page's *currently
 * rendered* pixel space via `page`), returning the id of the first
 * stroke with any point within ERASE_TOLERANCE_PX, or null if none.
 *
 * Whole-stroke only: this never removes a fragment of a stroke — the
 * caller splices the entire matched stroke out of the page's array.
 */
export function findStrokeToErase(
  strokes: Stroke[],
  pointerX: number,
  pointerY: number,
  page: PageGeometry,
): string | null {
  for (const stroke of strokes) {
    for (const [normX, normY] of stroke.points) {
      const [px, py] = denormalizePoint(normX, normY, page)
      if (distance(px, py, pointerX, pointerY) <= ERASE_TOLERANCE_PX) {
        return stroke.id
      }
    }
  }
  return null
}

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
): EraseResult {
  const removedId = findStrokeToErase(strokes, pointerX, pointerY, page)
  if (!removedId) return { strokes, removedId: null }
  return { strokes: strokes.filter((s) => s.id !== removedId), removedId }
}

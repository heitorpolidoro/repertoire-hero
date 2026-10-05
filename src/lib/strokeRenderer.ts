/**
 * The stage's canvas painter: one annotation stroke, in device pixels.
 *
 * It lived inside `TabDrawingStage` until RH-99, where it closed over nothing —
 * every input was already a parameter — so moving it here is mechanical and
 * leaves the drawn pixels identical. It joins `annotationMath.ts` and
 * `stageInteraction.ts`: the stage's pure pieces live in `src/lib` and are unit
 * tested against a fake 2D context, with no DOM.
 *
 * Coordinates arrive in *pixels*, already denormalized by
 * `denormalizePoint`/`denormalizeWidth` — this module knows nothing about the
 * page geometry a stroke was recorded against.
 */

/**
 * Strokes the given polyline onto `ctx`.
 *
 * Three cases, and the reason for each:
 * - **no point** — nothing is drawn, and no style is assigned, so an empty
 *   stroke cannot leak its colour into the next one in the caller's loop;
 * - **one point** — a tap, drawn as a filled dot of half the stroke width,
 *   because a zero-length `stroke()` paints nothing at all;
 * - **two or more** — one `moveTo` and a `lineTo` per remaining point.
 *
 * The width floors at 1: thinner than a device pixel is invisible.
 */
export function drawPath(
  ctx: CanvasRenderingContext2D,
  points: [number, number][],
  widthPx: number,
  strokeColor: string,
) {
  if (points.length === 0) return
  ctx.lineWidth = Math.max(widthPx, 1)
  ctx.strokeStyle = strokeColor
  if (points.length === 1) {
    ctx.beginPath()
    ctx.fillStyle = strokeColor
    ctx.arc(points[0][0], points[0][1], Math.max(widthPx, 1) / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i][0], points[i][1])
  }
  ctx.stroke()
}

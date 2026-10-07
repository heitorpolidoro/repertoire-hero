'use client'

import { useEffect, useRef, useState } from 'react'
import type { StagePageSurfaceProps } from './StagePageSurface'

/**
 * The image page surface (RH-128): a photograph of a chart, drawn as the one
 * and only page of the stage.
 *
 * It reports `1` page on mount rather than on load, so the page-navigation row
 * is correctly absent from the first frame instead of appearing and vanishing.
 *
 * The geometry it reports is what the annotation layer is sized and normalized
 * against, and it is the same shape a `react-pdf` page reports: the rendered
 * box (`renderWidth` by its proportional height) plus the native dimensions,
 * which for an `<img>` are exactly `naturalWidth`/`naturalHeight`.
 *
 * **It is read in an effect, not only in the `load` handler**, and that is
 * load-bearing in both directions:
 *
 * - `renderWidth` changes on a *mounted* surface — the stage's zoom buttons,
 *   the pinch gesture, a device rotation — and an `<img>` repainted at a new
 *   width fires no second `load`. The stage sizes the annotation canvas from
 *   the reported geometry alone, so a geometry stuck at the old box leaves the
 *   rest of the image impossible to draw on, and normalizes every stroke that
 *   *is* drawn against the wrong box — persisted annotations that reopen in
 *   the wrong place. `react-pdf` has no such hazard: it re-fires
 *   `onRenderSuccess` for each render.
 * - An image the browser has already cached is `complete` at mount and fires
 *   no `load` at all, so a load-only reader reports nothing whatsoever on the
 *   second open of a chart.
 *
 * Nothing is reported until the image is `complete` with both naturals above
 * zero: a still-decoding or broken image leaves them at 0, and a zero-width
 * geometry would send every later `normalizePoint` to `Infinity`.
 *
 * `onGeometry` must be referentially stable across renders (the stage passes
 * its `setPageGeometry` setter) — it is an effect dependency.
 */
export function ImagePageSurface({
  fileUrl,
  renderWidth,
  onPageCount,
  onGeometry,
}: StagePageSurfaceProps) {
  const imageRef = useRef<HTMLImageElement>(null)
  // Bumped by `load` and by `error`, purely to re-run the effect below: the
  // decode is what turns a 0×0 element into one with dimensions, and an error
  // is what settles it at 0×0 for good.
  const [decodeCount, setDecodeCount] = useState(0)

  useEffect(() => {
    onPageCount(1)
  }, [onPageCount])

  useEffect(() => {
    const image = imageRef.current
    if (!image || !image.complete) return
    const { naturalWidth, naturalHeight } = image
    if (!naturalWidth || !naturalHeight) return
    onGeometry({
      width: renderWidth,
      height: (renderWidth * naturalHeight) / naturalWidth,
      originalWidth: naturalWidth,
      originalHeight: naturalHeight,
    })
  }, [fileUrl, renderWidth, decodeCount, onGeometry])

  // A plain `<img>`, not `next/image`: the source is a user-uploaded Blob URL
  // or the synthetic same-origin cache key the service worker answers offline,
  // and the optimizer is exactly what is unreachable with no network. It would
  // also change the very `naturalWidth`/`naturalHeight` the annotation geometry
  // is anchored to.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imageRef}
      src={fileUrl}
      alt=""
      onLoad={() => setDecodeCount((count) => count + 1)}
      onError={() => setDecodeCount((count) => count + 1)}
      className="block max-w-none"
      style={{ width: `${renderWidth}px`, height: 'auto' }}
    />
  )
}

'use client'

import type { PageGeometry } from '@/lib/annotationMath'
import { isImageTab } from '@/lib/tabRenderer'
import { ImagePageSurface } from './ImagePageSurface'
import { PdfPageSurface } from './PdfPageSurface'

/**
 * What the drawing stage asks of whatever produces its page (RH-128).
 *
 * The stage supplies the three inputs it already had — the file, which page and
 * how wide to draw it — and consumes the two outputs it already consumed: how
 * many pages there are, and the geometry the annotation layer is sized and
 * normalized against. Nothing in the stroke maths changes between the two
 * implementations, because `normalizePoint` cancels the native dimensions out:
 * an `<img>`'s `naturalWidth`/`naturalHeight` are exactly the
 * `originalWidth`/`originalHeight` a `react-pdf` page reports.
 */
export interface StagePageSurfaceProps {
  fileUrl: string
  /** The row's `song_files.content_type`; absent reads as PDF (RH-127/RH-128). */
  contentType?: string | null
  /** 1-based. An image surface has only page 1 and ignores it. */
  pageNumber: number
  /** The page's target CSS width in pixels, i.e. fit-width times the zoom level. */
  renderWidth: number
  /** Reported once the page count is known. An image reports `1`. */
  onPageCount: (count: number) => void
  /** Reported every time the rendered page's box or native size is known. */
  onGeometry: (geometry: PageGeometry) => void
}

/**
 * The stage's page, whichever kind of file it is.
 *
 * This is the only renderer `TabDrawingStage` knows about, and the branch is
 * the whole of it: the PDF implementation is the `Document`/`Page` pair the
 * stage used to hold inline, and the image implementation is one `<img>`.
 */
export function StagePageSurface(props: StagePageSurfaceProps) {
  return isImageTab(props.contentType) ? (
    <ImagePageSurface {...props} />
  ) : (
    <PdfPageSurface {...props} />
  )
}

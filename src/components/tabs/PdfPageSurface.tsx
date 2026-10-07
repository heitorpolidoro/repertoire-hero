'use client'

import { Document, Page } from 'react-pdf'
import '@/lib/pdfWorker'
import type { StagePageSurfaceProps } from './StagePageSurface'

/**
 * The PDF page surface: `react-pdf`'s `Document`/`Page` pair, moved verbatim
 * out of `TabDrawingStage` by RH-128 and rewired to the two callbacks.
 *
 * Both imports above are deliberately static. Fast View imports
 * `FastViewOverlays` -> `PdfStageOverlay` -> `TabDrawingStage` -> this module
 * eagerly, and AGENTS.md's Turbopack note depends on that chain staying eager;
 * making it dynamic here would change what the dev bundler loads and when.
 *
 * `'@/lib/pdfWorker'` is a side-effect import — it points pdf.js at the worker
 * asset `scripts/copy-pdf-worker.mjs` copies into `public/`.
 */
export function PdfPageSurface({
  fileUrl,
  pageNumber,
  renderWidth,
  onPageCount,
  onGeometry,
}: StagePageSurfaceProps) {
  return (
    <Document
      file={fileUrl}
      onLoadSuccess={({ numPages: n }) => onPageCount(n)}
      loading={<div className="text-white text-sm p-8">Loading PDF…</div>}
      error={<div className="text-red-400 text-sm p-8">Failed to load PDF.</div>}
    >
      <Page
        pageNumber={pageNumber}
        width={renderWidth}
        renderTextLayer={false}
        renderAnnotationLayer={false}
        onRenderSuccess={(page) =>
          onGeometry({
            width: page.width,
            height: page.height,
            originalWidth: page.originalWidth,
            originalHeight: page.originalHeight,
          })
        }
      />
    </Document>
  )
}

'use client'

import type { RefObject } from 'react'
import TabDrawingStage from '@/components/tabs/TabDrawingStage'
import type { Stroke, TabAnnotations } from '@/types/database'

export interface PdfStageOverlayProps {
  open: boolean
  overlayRef: RefObject<HTMLDivElement | null>
  /** Measured px height; null falls back to '100dvh'. */
  height: number | null
  tabId: string | null
  fileUrl: string | null
  tabTitle: string
  songTitle: string
  songKey?: string | null
  annotations: TabAnnotations | null
  annotationsError: string | null
  onSaveAnnotations: (pageNumber: number, strokes: Stroke[]) => Promise<{ success?: boolean; error?: string }>
  onClose: () => void
}

/**
 * The full-screen PDF Stage Mode surface: a header bar and the drawing stage.
 *
 * Presentational only — every measurement, subscription and persistence
 * decision belongs to `usePdfStage`, which supplies `height`, `overlayRef`,
 * the annotations and the two callbacks (RH-50).
 */
export function PdfStageOverlay({
  open,
  overlayRef,
  height,
  tabId,
  fileUrl,
  tabTitle,
  songTitle,
  songKey,
  annotations,
  annotationsError,
  onSaveAnnotations,
  onClose,
}: PdfStageOverlayProps) {
  if (!open || !fileUrl || !tabId) return null

  return (
    <div
      ref={overlayRef}
      className="fixed inset-x-0 top-0 z-50 bg-black flex flex-col"
      style={{
        // The measured viewport height is authoritative (correct in every
        // mobile browser); `100dvh` is only the pre-measurement fallback.
        height: height ? `${height}px` : '100dvh',
        // Removes browser pinch-zoom from the whole overlay subtree,
        // react-pdf's own DOM included — it is incompatible with sizing the
        // overlay from the viewport measurement. In-app zoom controls remain.
        touchAction: 'pan-x pan-y',
        // Makes the overlay root a (non-scrollable) scroll container so
        // `overscroll-behavior` applies and no drag inside it chains out.
        overflow: 'hidden',
        overscrollBehavior: 'contain',
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 text-white border-b border-gray-800 shrink-0">
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-bold truncate">{tabTitle || 'PDF Tab'}</span>
          <span className="text-xs text-gray-400 truncate">{songTitle} {songKey ? `• ${songKey}` : ''}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold text-sm flex items-center justify-center transition-colors focus:outline-none"
          title="Close PDF Stage Mode"
        >
          ✕
        </button>
      </div>
      <TabDrawingStage
        key={tabId}
        fileUrl={fileUrl}
        annotations={annotations}
        annotationsError={annotationsError}
        onSaveAnnotations={onSaveAnnotations}
      />
    </div>
  )
}

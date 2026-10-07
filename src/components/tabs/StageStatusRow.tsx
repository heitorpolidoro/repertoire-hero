'use client'

export interface StageStatusRowProps {
  /** 1-based, as displayed. */
  pageNumber: number
  /** `null` until the page surface has reported; `1` for an image. */
  numPages: number | null
  onGoToPage: (page: number) => void
  /** Already resolved by `stageSaveLabel` — this row only paints it. */
  saveLabel: string
  /** Paints the badge red; the label alone does not carry the state. */
  saveFailed: boolean
}

/**
 * The toolbar's top row: page navigation, and the save-state badge (RH-128).
 *
 * **The navigation follows the page count, never the file type.** An image is
 * one page and a single-page PDF is one page, and neither has anywhere to
 * navigate to, so the prev/next buttons and the `Page n / m` indicator are
 * rendered only above one page. The badge is outside that gate and always
 * rendered: a tab that can be annotated with no visible save state is the one
 * outcome the gate must not produce, and this row is where that state lives.
 *
 * Extracted out of `TabDrawingStage` by RH-128 together with the page surface.
 * That file sits under a `max-lines` ratchet that may only shrink, and the
 * gate is also a branch its pinned `complexity` had no room for.
 */
export function StageStatusRow({
  pageNumber,
  numPages,
  onGoToPage,
  saveLabel,
  saveFailed,
}: StageStatusRowProps) {
  const hasPageNav = numPages !== null && numPages > 1

  return (
    <div className="flex items-center justify-center gap-3 text-white text-xs">
      {hasPageNav && (
        <>
          <button
            type="button"
            onClick={() => onGoToPage(pageNumber - 1)}
            disabled={pageNumber <= 1}
            className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed font-semibold"
          >
            ‹ Prev
          </button>
          <span className="font-mono">
            Page {pageNumber} / {numPages}
          </span>
          <button
            type="button"
            onClick={() => onGoToPage(pageNumber + 1)}
            disabled={pageNumber >= numPages}
            className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed font-semibold"
          >
            Next ›
          </button>
        </>
      )}
      <span
        className={`ml-2 text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded-full ${
          saveFailed ? 'bg-red-950 text-red-300' : 'bg-gray-800 text-gray-300'
        }`}
      >
        {saveLabel}
      </span>
    </div>
  )
}

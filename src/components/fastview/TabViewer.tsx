'use client'

export interface TabViewerProps {
  url: string | null
  title: string
  onOpenStage: () => void
  onClose: () => void
  /**
   * True while the browser has no network. Passed down from the page's single
   * `useOfflineStatus()` call — this component never reads the signal itself
   * (RH-38/RH-52). Optional and `false` by default, so the online card and
   * every other call site are unchanged.
   */
  offline?: boolean
}

/**
 * The embedded viewer card for the selected tab. Renders nothing without an
 * active tab, so the page keeps no conditional of its own.
 *
 * Offline (RH-80) the header row is untouched and only the body changes. The
 * body is a cross-origin `docs.google.com/gview` iframe, which with no network
 * paints a blank 550px card — and because this card's `Stage` button is the
 * only `onOpenStage` trigger in the app, a blank card would hide the one
 * renderer that *does* work offline (Stage Mode's `react-pdf` reads the
 * same-origin cache key `src/app/sw.ts` answers). So offline the iframe is
 * replaced by a panel that says so and points at Stage Mode.
 */
export function TabViewer({ url, title, onOpenStage, onClose, offline = false }: TabViewerProps) {
  if (!url) return null

  return (
    <div className="flex flex-col gap-2 bg-white border border-emerald-200 rounded-xl p-3 shadow-sm transition-all duration-300">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-semibold text-gray-700 truncate max-w-[200px] sm:max-w-[280px]">
          Viewing: {title}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenStage}
            className="text-xs font-medium text-emerald-600 hover:text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 transition-colors flex items-center gap-1"
          >
            <span>⛶</span> Stage
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
      {offline ? (
        <div
          data-testid="tab-viewer-offline"
          className="w-full rounded-lg border border-dashed border-emerald-300 bg-emerald-50/50 px-6 py-10 flex flex-col items-center gap-2 text-center"
        >
          <span aria-hidden="true" className="text-3xl">
            📴
          </span>
          <p className="text-sm font-semibold text-gray-700">Preview needs a connection</p>
          <p className="max-w-xs text-xs text-gray-500">
            This chart is downloaded and ready. Open <span className="font-medium">Stage</span>{' '}
            above to read it offline.
          </p>
        </div>
      ) : (
        <iframe
          src={`https://docs.google.com/gview?url=${encodeURIComponent(url)}&embedded=true`}
          className="w-full h-[550px] rounded-lg border border-gray-150"
          title={title}
        />
      )}
    </div>
  )
}

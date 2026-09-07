'use client'

export interface TabViewerProps {
  url: string | null
  title: string
  onOpenStage: () => void
  onClose: () => void
}

/**
 * The embedded viewer card for the selected tab. Renders nothing without an
 * active tab, so the page keeps no conditional of its own.
 */
export function TabViewer({ url, title, onOpenStage, onClose }: TabViewerProps) {
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
      <iframe
        src={`https://docs.google.com/gview?url=${encodeURIComponent(url)}&embedded=true`}
        className="w-full h-[550px] rounded-lg border border-gray-150"
        title={title}
      />
    </div>
  )
}

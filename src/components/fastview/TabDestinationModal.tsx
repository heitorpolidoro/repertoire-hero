'use client'

import type { TabOrigin } from '@/lib/tabLibrary'

export interface TabDestinationModalProps {
  open: boolean
  uploading: boolean
  onChoose: (destination: TabOrigin) => void
  onCancel: () => void
}

/**
 * Band vs personal destination choice for an upload, shown only in a band entry.
 *
 * Rendered at the page's root fragment rather than inside its `<main>`: `<main>`
 * always carries a `translate-*` class, which makes it the containing block of
 * any fixed-position descendant, so `fixed inset-0` would resolve against the
 * narrow reading column instead of the viewport.
 */
export function TabDestinationModal({ open, uploading, onChoose, onCancel }: TabDestinationModalProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl border border-gray-150 shadow-2xl max-w-sm w-full p-6 flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-150">
        <div>
          <h3 className="text-base font-bold text-gray-900">Upload Destination</h3>
          <p className="text-xs text-gray-500 mt-1">Where would you like to save this PDF?</p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onChoose('personal')}
            disabled={uploading}
            className="flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 hover:border-blue-300 hover:bg-blue-50/20 text-left transition-all group focus:outline-none"
          >
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-gray-800 group-hover:text-blue-700 transition-colors">👤 Personal studies</span>
              <span className="text-[10px] text-gray-400">Private only to you</span>
            </div>
            <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">Private</span>
          </button>

          <button
            type="button"
            onClick={() => onChoose('band')}
            disabled={uploading}
            className="flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 hover:border-emerald-300 hover:bg-emerald-50/20 text-left transition-all group focus:outline-none"
          >
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-gray-800 group-hover:text-emerald-700 transition-colors">👥 Band files</span>
              <span className="text-[10px] text-gray-400">Shared with all members</span>
            </div>
            <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">Shared</span>
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 mt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={uploading}
            className="px-4 py-2 border border-gray-200 hover:bg-gray-50 text-xs font-semibold rounded-lg text-gray-600 transition-colors focus:outline-none"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

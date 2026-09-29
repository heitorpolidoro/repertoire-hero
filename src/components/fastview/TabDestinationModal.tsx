'use client'

import { Spinner } from '@/components/ui/Spinner'
import type { TabOrigin } from '@/lib/tabLibrary'

export interface TabDestinationModalProps {
  open: boolean
  /** The destination of the upload in flight; null while nothing uploads. */
  uploadDestination: TabOrigin | null
  onChoose: (destination: TabOrigin) => void
  onCancel: () => void
}

interface DestinationOption {
  destination: TabOrigin
  label: string
  hint: string
  badge: string
  className: string
  labelClassName: string
  badgeClassName: string
}

const OPTIONS: DestinationOption[] = [
  {
    destination: 'personal',
    label: '👤 Personal studies',
    hint: 'Private only to you',
    badge: 'Private',
    className: 'hover:border-blue-300 hover:bg-blue-50/20',
    labelClassName: 'group-hover:text-blue-700',
    badgeClassName: 'text-blue-600 bg-blue-50',
  },
  {
    destination: 'band',
    label: '👥 Band files',
    hint: 'Shared with all members',
    badge: 'Shared',
    className: 'hover:border-emerald-300 hover:bg-emerald-50/20',
    labelClassName: 'group-hover:text-emerald-700',
    badgeClassName: 'text-emerald-600 bg-emerald-50',
  },
]

/**
 * Band vs personal destination choice for an upload, shown only in a band entry.
 *
 * The modal stays up for the whole upload: the chosen option swaps its badge for
 * a spinner and every button is disabled, so a slow PDF upload never looks like
 * a click that did nothing.
 *
 * Rendered at the page's root fragment rather than inside its `<main>`: `<main>`
 * always carries a `translate-*` class, which makes it the containing block of
 * any fixed-position descendant, so `fixed inset-0` would resolve against the
 * narrow reading column instead of the viewport.
 */
export function TabDestinationModal({ open, uploadDestination, onChoose, onCancel }: TabDestinationModalProps) {
  if (!open) return null

  const uploading = uploadDestination !== null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className="bg-white rounded-2xl border border-gray-150 shadow-2xl max-w-sm w-full p-6 flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-150"
        aria-busy={uploading}
      >
        <div>
          <h3 className="text-base font-bold text-gray-900">Upload Destination</h3>
          <p className="text-xs text-gray-500 mt-1" role="status">
            {uploading ? 'Uploading PDF, please wait…' : 'Where would you like to save this PDF?'}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {OPTIONS.map((option) => {
            const isChosen = uploadDestination === option.destination
            return (
              <button
                key={option.destination}
                type="button"
                onClick={() => onChoose(option.destination)}
                disabled={uploading}
                className={`flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 text-left transition-all group focus:outline-none disabled:cursor-not-allowed ${
                  uploading ? (isChosen ? '' : 'opacity-50') : option.className
                }`}
              >
                <div className="flex flex-col">
                  <span className={`text-sm font-semibold text-gray-800 transition-colors ${uploading ? '' : option.labelClassName}`}>
                    {option.label}
                  </span>
                  <span className="text-[10px] text-gray-400">{option.hint}</span>
                </div>
                {isChosen ? (
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
                    <Spinner />
                    Uploading…
                  </span>
                ) : (
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${option.badgeClassName}`}>{option.badge}</span>
                )}
              </button>
            )
          })}
        </div>

        <div className="flex items-center justify-end gap-2 mt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={uploading}
            className="px-4 py-2 border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-semibold rounded-lg text-gray-600 transition-colors focus:outline-none"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

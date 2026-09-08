'use client'

import { STATUS_OPTIONS, type SongStatusController } from '@/lib/songStatus'
import { STATUS_CONFIG } from '@/lib/statusConfig'

export interface StatusDropdownProps {
  controller: SongStatusController
}

/**
 * The mastery-status badge and the dropdown it opens: a backdrop that closes on
 * an outside tap and the five statuses in mastery order, the current one ticked.
 *
 * Presentational only — the open state and the write belong to `useSongStatus`
 * (RH-52). The list maps the `SongStatus`-typed `STATUS_OPTIONS` rather than
 * `Object.entries(STATUS_CONFIG)`, which is what removed the page's `as any`.
 */
export function StatusDropdown({ controller }: StatusDropdownProps) {
  const cfg = STATUS_CONFIG[controller.status]

  return (
    <div className="relative shrink-0 mt-1">
      <button
        type="button"
        onClick={controller.toggleDropdown}
        disabled={controller.updating}
        className={`px-3 py-1 rounded-full text-sm font-medium transition-colors border hover:shadow-sm flex items-center gap-1.5 focus:outline-none ${cfg.bgColor} ${cfg.textColor} border-transparent hover:border-gray-300/40`}
      >
        <span>{cfg.label}</span>
        <span className="text-[10px] opacity-70" aria-hidden="true">&#9662;</span>
      </button>

      {controller.isDropdownOpen && (
        <>
          {/* Backdrop overlay to close when clicking outside */}
          <div
            className="fixed inset-0 z-20"
            onClick={controller.closeDropdown}
          />

          {/* Floating Dropdown List */}
          <ul className="absolute right-0 mt-1 w-40 bg-white border border-gray-200 rounded-xl shadow-lg py-1.5 z-30 flex flex-col gap-0.5 text-left">
            {STATUS_OPTIONS.map((option) => {
              const isSelected = controller.status === option.status
              return (
                <li key={option.status}>
                  <button
                    type="button"
                    onClick={() => controller.change(option.status)}
                    className={`w-full text-left px-3 py-1.5 text-xs font-medium hover:bg-gray-50 flex items-center justify-between transition-colors ${
                      isSelected ? 'text-emerald-700 bg-emerald-50/50' : 'text-gray-700'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {/* Color Dot indicator */}
                      <span className={`w-2.5 h-2.5 rounded-full ${option.bgColor}`} />
                      <span>{option.label}</span>
                    </span>
                    {isSelected && (
                      <span className="text-emerald-600 font-bold">&#10003;</span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

'use client'

import type { PlaylistEntry } from '@/lib/playlistNav'

/**
 * Where the row is rendered. The two surfaces are pixel-identical except for two
 * Tailwind fragments the desktop sidebar adds, so they share this component
 * rather than the two copies the Fast View page carried before RH-48.
 */
export type SetlistRowVariant = 'drawer' | 'sidebar'

export interface SetlistRowProps {
  /** Zero-based position in the setlist; rendered one-based. */
  index: number
  entry: PlaylistEntry
  isCurrent: boolean
  variant: SetlistRowVariant
  onSelect: (repertoireId: string) => void
}

const CURRENT_CLASSES = 'bg-emerald-50 text-emerald-900 font-bold border-emerald-300 shadow-xs'
const IDLE_CLASSES = 'bg-white text-gray-700 hover:bg-gray-50 border-gray-100'

/** One song of the setlist, in the mobile drawer or the desktop sidebar. */
export function SetlistRow({ index, entry, isCurrent, variant, onSelect }: SetlistRowProps) {
  const isSidebar = variant === 'sidebar'
  const stateClasses = isCurrent
    ? `${CURRENT_CLASSES}${isSidebar ? ' ring-1 ring-emerald-400/20' : ''}`
    : `${IDLE_CLASSES}${isSidebar ? ' hover:border-gray-200' : ''}`

  return (
    <button
      type="button"
      onClick={() => {
        if (!isCurrent) onSelect(entry.repertoireId)
      }}
      className={`w-full text-left px-3.5 py-3 rounded-xl transition-all flex items-center justify-between text-xs border ${stateClasses}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className={`w-5 shrink-0 text-right font-mono text-xs ${isCurrent ? 'text-emerald-700 font-bold' : 'text-gray-400'}`}>
          {index + 1}.
        </span>
        <div className="min-w-0 truncate">
          <p className="truncate font-medium">{entry.title}</p>
          {entry.artist && <p className="text-[11px] text-gray-400 truncate">{entry.artist}</p>}
        </div>
      </div>
      {isCurrent && (
        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full shrink-0">
          ▶ NOW
        </span>
      )}
    </button>
  )
}

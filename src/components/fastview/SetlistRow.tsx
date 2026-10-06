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
/** No Fast View address yet: rendered, legible, and not a target. */
const UNADDRESSABLE_CLASSES = 'bg-white text-gray-400 border-gray-100 cursor-not-allowed'

/**
 * One song of the setlist, in the mobile drawer or the desktop sidebar.
 *
 * An entry whose owner holds no repertoire row is **rendered and disabled**
 * (RH-125): every entry of the playlist is in the list now, in position order,
 * but Fast View is still addressed by the owner row's id — re-addressing it by
 * version is RH-109 — so there is nothing to navigate to until then. Showing
 * the song and refusing the tap beats hiding it, which is what used to collapse
 * the whole setlist.
 */
export function SetlistRow({ index, entry, isCurrent, variant, onSelect }: SetlistRowProps) {
  const isSidebar = variant === 'sidebar'
  const repertoireId = entry.repertoireId
  const stateClasses = !repertoireId
    ? UNADDRESSABLE_CLASSES
    : isCurrent
      ? `${CURRENT_CLASSES}${isSidebar ? ' ring-1 ring-emerald-400/20' : ''}`
      : `${IDLE_CLASSES}${isSidebar ? ' hover:border-gray-200' : ''}`

  return (
    <button
      type="button"
      disabled={!repertoireId}
      title={repertoireId ? undefined : 'Not in this repertoire yet'}
      onClick={() => {
        if (repertoireId && !isCurrent) onSelect(repertoireId)
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
      {/* The mockup's option B (`docs/tasks/RH-126-mock.html`): a muted chip
          saying *why* there is no progress, rather than an `Unknown` chip that
          looks exactly like a song the musician owns and has not started. */}
      {!repertoireId && (
        <span className="text-[10px] font-medium text-gray-400 bg-white border border-dashed border-gray-300 px-2 py-0.5 rounded-full shrink-0">
          Not in repertoire
        </span>
      )}
      {repertoireId && isCurrent && (
        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full shrink-0">
          ▶ NOW
        </span>
      )}
    </button>
  )
}

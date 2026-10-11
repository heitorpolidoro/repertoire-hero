'use client'

import type { SetlistEntry } from '@/lib/playlistNav'

/**
 * Where the row is rendered. The two surfaces are pixel-identical except for two
 * Tailwind fragments the desktop sidebar adds, so they share this component
 * rather than the two copies the Fast View page carried before RH-48.
 */
export type SetlistRowVariant = 'drawer' | 'sidebar'

export interface SetlistRowProps {
  /** Zero-based position in the setlist; rendered one-based. */
  index: number
  entry: SetlistEntry
  isCurrent: boolean
  variant: SetlistRowVariant
  /** Called with the entry's `versionId` — the Fast View address (RH-132). */
  onSelect: (versionId: string) => void
}

const CURRENT_CLASSES = 'bg-emerald-50 text-emerald-900 font-bold border-emerald-300 shadow-xs'
const IDLE_CLASSES = 'bg-white text-gray-700 hover:bg-gray-50 border-gray-100'

/**
 * One song of the setlist, in the mobile drawer or the desktop sidebar.
 *
 * **Every entry is a target** (RH-132): Fast View is addressed by
 * `song_versions.id` and the owner comes from the page's `?bandId=`, so a
 * version whose owner holds no repertoire row opens like any other — at version
 * defaults, read-only. The dead grey state RH-125 gave such a row, with its
 * refused tap and its explanatory tooltip, is gone: the row is interactive, and
 * it can be the current song and carry the ▶ NOW pill.
 *
 * The muted *Not in repertoire* chip stays: it is still true, and it is what
 * tells the musician why the row shows no progress. It is drawn for a
 * `repertoireId` of exactly `null` — "the owner holds no row" — and not for an
 * absent one: a queue-sourced entry (RH-133) carries no repertoire field at
 * all, because the queue stores only what navigating needs, and "I was not
 * told" is not the same statement as "there is no row".
 */
export function SetlistRow({ index, entry, isCurrent, variant, onSelect }: SetlistRowProps) {
  const isSidebar = variant === 'sidebar'
  const stateClasses = isCurrent
    ? `${CURRENT_CLASSES}${isSidebar ? ' ring-1 ring-emerald-400/20' : ''}`
    : `${IDLE_CLASSES}${isSidebar ? ' hover:border-gray-200' : ''}`

  return (
    <button
      type="button"
      onClick={() => {
        if (!isCurrent) onSelect(entry.versionId)
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
      {entry.repertoireId === null && (
        <span className="text-[10px] font-medium text-gray-400 bg-white border border-dashed border-gray-300 px-2 py-0.5 rounded-full shrink-0">
          Not in repertoire
        </span>
      )}
      {isCurrent && (
        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full shrink-0">
          ▶ NOW
        </span>
      )}
    </button>
  )
}

'use client'

import type { SetlistEntry, SetlistRowMarker } from '@/lib/playlistNav'

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
  /**
   * Row indicator (RH-199):
   * - `'now'`: active player track (or viewed song when idle/stopped)
   * - `'play'`: viewed song when player is active on another track
   * - `null`: neither indicator
   */
  marker?: SetlistRowMarker
  /** Called with the entry's `versionId` — the Fast View address (RH-132). */
  onSelect: (versionId: string) => void
  /** Called when the row's Play control is clicked (RH-199). */
  onPlay?: () => void
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
 * refused tap and its explanatory tooltip, is gone: the row is interactive.
 *
 * **RH-199 separates viewed song from active player track**:
 * - The viewed song (`isCurrent`) keeps the green highlight classes.
 * - The `▶ NOW` pill marks the active track (`marker === 'now'`) while the
 *   setlist player is playing or paused, or the viewed song when idle/stopped.
 * - When the player is active and the viewed song is a different entry, that
 *   viewed row displays a separate `▶ Play` control (`marker === 'play'`) that
 *   restarts setlist playback from that song.
 *
 * The muted *Not in repertoire* chip stays: it is still true, and it is what
 * tells the musician why the row shows no progress. It is drawn for a
 * `repertoireId` of exactly `null` — "the owner holds no row" — and not for an
 * absent one: a queue-sourced entry (RH-133) carries no repertoire field at
 * all, because the queue stores only what navigating needs, and "I was not
 * told" is not the same statement as "there is no row".
 */
export function SetlistRow({
  index,
  entry,
  isCurrent,
  variant,
  marker = isCurrent ? 'now' : null,
  onSelect,
  onPlay,
}: SetlistRowProps) {
  const isSidebar = variant === 'sidebar'
  const stateClasses = isCurrent
    ? `${CURRENT_CLASSES}${isSidebar ? ' ring-1 ring-emerald-400/20' : ''}`
    : `${IDLE_CLASSES}${isSidebar ? ' hover:border-gray-200' : ''}`

  const showPlay = marker === 'play' && !!onPlay

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          if (!isCurrent) onSelect(entry.versionId)
        }}
        className={`w-full text-left px-3.5 py-3 ${showPlay ? 'pr-20' : ''} rounded-xl transition-all flex items-center justify-between text-xs border ${stateClasses}`}
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
        {/* The mockup's option B (`docs/tasks/RH-125-mock.html`): a muted chip
            saying *why* there is no progress, rather than an `Unknown` chip that
            looks exactly like a song the musician owns and has not started. */}
        {entry.repertoireId === null && (
          <span className="text-[10px] font-medium text-gray-400 bg-white border border-dashed border-gray-300 px-2 py-0.5 rounded-full shrink-0">
            Not in repertoire
          </span>
        )}
        {marker === 'now' && (
          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full shrink-0">
            ▶ NOW
          </span>
        )}
      </button>
      {showPlay && (
        <button
          type="button"
          onClick={onPlay}
          aria-label={`Play from ${entry.title}`}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1 rounded-full shadow-xs"
        >
          ▶ Play
        </button>
      )}
    </div>
  )
}

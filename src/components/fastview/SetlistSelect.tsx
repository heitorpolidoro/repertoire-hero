'use client'

import type { PlaylistEntry, PlaylistNav } from '@/lib/playlistNav'

export interface SetlistSelectProps {
  nav: PlaylistNav | null
  entries: PlaylistEntry[]
  currentRepertoireId: string
  onSelect: (repertoireId: string) => void
}

/** Below `lg`: a native select, the fastest way to jump across a long setlist. */
export function SetlistSelect({ nav, entries, currentRepertoireId, onSelect }: SetlistSelectProps) {
  if (!nav || entries.length === 0) return null

  return (
    <div className="lg:hidden">
      <select
        value={currentRepertoireId}
        onChange={(event) => {
          const targetId = event.target.value
          if (targetId === currentRepertoireId) return
          onSelect(targetId)
        }}
        className="w-full text-xs font-semibold bg-white text-gray-700 border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 shadow-xs truncate"
      >
        {entries.map((entry, index) => (
          <option key={entry.repertoireId} value={entry.repertoireId}>
            {index + 1}. {entry.title} {entry.artist ? `- ${entry.artist}` : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

'use client'

import type { SetlistEntry, PlaylistNav } from '@/lib/playlistNav'

export interface SetlistSelectProps {
  nav: PlaylistNav | null
  entries: SetlistEntry[]
  /** The route's `song_versions.id` — what the options are valued by (RH-132). */
  currentVersionId: string
  onSelect: (versionId: string) => void
}

/**
 * Below `lg`: a native select, the fastest way to jump across a long setlist.
 *
 * Every entry is a selectable option valued by its `versionId` (RH-132): Fast
 * View is version-addressed, so an owner holding no repertoire row no longer
 * makes an entry unreachable. The value space and `currentVersionId` are the
 * same space, which is what keeps the current song shown as selected.
 */
export function SetlistSelect({ nav, entries, currentVersionId, onSelect }: SetlistSelectProps) {
  if (!nav || entries.length === 0) return null

  return (
    <div className="lg:hidden">
      <select
        value={currentVersionId}
        onChange={(event) => {
          const targetId = event.target.value
          if (targetId === currentVersionId) return
          onSelect(targetId)
        }}
        className="w-full text-xs font-semibold bg-white text-gray-700 border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 shadow-xs truncate"
      >
        {entries.map((entry, index) => (
          <option key={entry.versionId} value={entry.versionId}>
            {index + 1}. {entry.title} {entry.artist ? `- ${entry.artist}` : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

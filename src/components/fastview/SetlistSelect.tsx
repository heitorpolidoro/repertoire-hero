'use client'

import { isEntryUnavailable, type SetlistEntry, type PlaylistNav } from '@/lib/playlistNav'

export interface SetlistSelectProps {
  nav: PlaylistNav | null
  entries: SetlistEntry[]
  /** The route's `song_versions.id` — what the options are valued by (RH-132). */
  currentVersionId: string
  onSelect: (versionId: string) => void
  /** Offline, the queue versions on this device; `null` marks nothing (RH-196). */
  availableVersionIds?: ReadonlySet<string> | null
}

/** `<n>. <title> - <artist>`, or `<n>. <title> (not on this device)` offline (RH-196). */
function optionLabel(index: number, entry: SetlistEntry, unavailable: boolean): string {
  if (unavailable) return `${index + 1}. ${entry.title} (not on this device)`
  return `${index + 1}. ${entry.title} ${entry.artist ? `- ${entry.artist}` : ''}`
}

/**
 * Below `lg`: a native select, the fastest way to jump across a long setlist.
 *
 * Every entry is a selectable option valued by its `versionId` (RH-132): Fast
 * View is version-addressed, so an owner holding no repertoire row no longer
 * makes an entry unreachable. The value space and `currentVersionId` are the
 * same space, which is what keeps the current song shown as selected.
 *
 * Offline, an entry not on this device is a disabled option without its artist
 * (RH-196); online every option stays enabled.
 */
export function SetlistSelect({
  nav,
  entries,
  currentVersionId,
  onSelect,
  availableVersionIds = null,
}: SetlistSelectProps) {
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
        {entries.map((entry, index) => {
          const unavailable = isEntryUnavailable(entry.versionId, availableVersionIds)
          return (
            <option key={entry.versionId} value={entry.versionId} disabled={unavailable}>
              {optionLabel(index, entry, unavailable)}
            </option>
          )
        })}
      </select>
    </div>
  )
}

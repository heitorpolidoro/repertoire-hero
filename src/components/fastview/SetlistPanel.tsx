'use client'

import type { ReactNode } from 'react'
import { SetlistRow, type SetlistRowVariant } from './SetlistRow'
import { isEntryUnavailable, setlistRowMarker, type SetlistEntry } from '@/lib/playlistNav'

export interface SetlistPanelProps {
  /** What the queue calls itself: a playlist's name, a practice session's. */
  queueLabel: string
  /** Right-hand side of the header: the drawer's close button, the sidebar's counter. */
  trailing: ReactNode
  /** The header row's classes, which is all the two surfaces disagree about. */
  headerClassName: string
  entries: SetlistEntry[]
  /** The route's `song_versions.id`, matched against each entry's own (RH-132). */
  currentVersionId: string
  /** The setlist player's active track version id when playing or paused; null otherwise (RH-199). */
  activeVersionId?: string | null
  variant: SetlistRowVariant
  onSelect: (versionId: string) => void
  /** RH-167: the "Play setlist" tap; the control is absent without it. */
  onPlay?: () => void
  /** Offline, the queue versions on this device; `null` marks nothing (RH-196). */
  availableVersionIds?: ReadonlySet<string> | null
}

/**
 * The header + scrolling song list shared by the mobile drawer and the desktop
 * sidebar. Existing to remove the header, the scroll container *and* the row
 * markup the two surfaces used to duplicate character for character.
 */
export function SetlistPanel({
  queueLabel,
  trailing,
  headerClassName,
  entries,
  currentVersionId,
  activeVersionId,
  variant,
  onSelect,
  onPlay,
  availableVersionIds = null,
}: SetlistPanelProps) {
  return (
    <>
      <div className={headerClassName}>
        <div className="flex items-center gap-2 min-w-0 pr-2">
          <span className="text-base shrink-0">🎵</span>
          <h3 className="font-bold text-gray-900 text-sm truncate" title={queueLabel}>
            {queueLabel}
          </h3>
        </div>
        {trailing}
      </div>

      {onPlay && (
        <button
          type="button"
          onClick={onPlay}
          className="mx-4 mt-3 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          &#9654; Play setlist
        </button>
      )}

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-1.5">
        {entries.map((entry, index) => {
          const marker = setlistRowMarker(entry.versionId, currentVersionId, activeVersionId ?? null)
          return (
            <SetlistRow
              // Keyed by the entry's own identity (RH-125): `repertoireId` may be
              // null for more than one entry, and two nulls are not two keys.
              key={entry.versionId}
              index={index}
              entry={entry}
              // By `versionId` since RH-132: the prop carries a version id, so
              // comparing it to an owner row id would never match and no row
              // would ever be marked current.
              isCurrent={entry.versionId === currentVersionId}
              marker={marker}
              variant={variant}
              onSelect={onSelect}
              onPlay={marker === 'play' ? onPlay : undefined}
              unavailable={isEntryUnavailable(entry.versionId, availableVersionIds)}
            />
          )
        })}
      </div>
    </>
  )
}

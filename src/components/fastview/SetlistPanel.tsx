'use client'

import type { ReactNode } from 'react'
import { SetlistRow, type SetlistRowVariant } from './SetlistRow'
import type { PlaylistEntry } from '@/lib/playlistNav'

export interface SetlistPanelProps {
  playlistName: string
  /** Right-hand side of the header: the drawer's close button, the sidebar's counter. */
  trailing: ReactNode
  /** The header row's classes, which is all the two surfaces disagree about. */
  headerClassName: string
  entries: PlaylistEntry[]
  /** The route's `song_versions.id`, matched against each entry's own (RH-132). */
  currentVersionId: string
  variant: SetlistRowVariant
  onSelect: (versionId: string) => void
}

/**
 * The header + scrolling song list shared by the mobile drawer and the desktop
 * sidebar. Existing to remove the header, the scroll container *and* the row
 * markup the two surfaces used to duplicate character for character.
 */
export function SetlistPanel({
  playlistName,
  trailing,
  headerClassName,
  entries,
  currentVersionId,
  variant,
  onSelect,
}: SetlistPanelProps) {
  return (
    <>
      <div className={headerClassName}>
        <div className="flex items-center gap-2 min-w-0 pr-2">
          <span className="text-base shrink-0">🎵</span>
          <h3 className="font-bold text-gray-900 text-sm truncate" title={playlistName}>
            {playlistName}
          </h3>
        </div>
        {trailing}
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-1.5">
        {entries.map((entry, index) => (
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
            variant={variant}
            onSelect={onSelect}
          />
        ))}
      </div>
    </>
  )
}

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
  currentRepertoireId: string
  variant: SetlistRowVariant
  onSelect: (repertoireId: string) => void
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
  currentRepertoireId,
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
            key={entry.repertoireId}
            index={index}
            entry={entry}
            isCurrent={entry.repertoireId === currentRepertoireId}
            variant={variant}
            onSelect={onSelect}
          />
        ))}
      </div>
    </>
  )
}

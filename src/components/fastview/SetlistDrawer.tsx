'use client'

import { SetlistPanel } from './SetlistPanel'
import type { PlaylistEntry, PlaylistNav } from '@/lib/playlistNav'

export interface SetlistDrawerProps {
  open: boolean
  nav: PlaylistNav | null
  entries: PlaylistEntry[]
  /** The route's `song_versions.id` (RH-132). */
  currentVersionId: string
  onClose: () => void
  onSelect: (versionId: string) => void
}

/**
 * Mobile setlist: a bottom sheet over the whole viewport, below `lg`.
 *
 * Renders `null` on its own whenever it has nothing to show, so the page keeps
 * no setlist conditional of its own.
 */
export function SetlistDrawer({
  open,
  nav,
  entries,
  currentVersionId,
  onClose,
  onSelect,
}: SetlistDrawerProps) {
  if (!open || !nav) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end lg:hidden">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-xs" onClick={onClose} />
      <div className="relative z-10 bg-white rounded-t-2xl max-h-[80vh] flex flex-col shadow-2xl animate-in slide-in-from-bottom duration-200">
        <SetlistPanel
          playlistName={nav.playlistName}
          headerClassName="flex items-center justify-between px-5 py-4 border-b border-gray-100"
          trailing={
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-sm font-bold p-1"
            >
              ✕
            </button>
          }
          entries={entries}
          currentVersionId={currentVersionId}
          variant="drawer"
          onSelect={(versionId) => {
            onClose()
            onSelect(versionId)
          }}
        />
      </div>
    </div>
  )
}

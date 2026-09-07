'use client'

import { SetlistPanel } from './SetlistPanel'
import type { PlaylistEntry, PlaylistNav } from '@/lib/playlistNav'

export interface SetlistSidebarProps {
  nav: PlaylistNav | null
  entries: PlaylistEntry[]
  currentRepertoireId: string
  onSelect: (repertoireId: string) => void
}

/**
 * Desktop setlist: the dedicated right-hand column from `lg` up.
 *
 * The `<aside>` classes are the AGENTS.md "Fast View Playlist Layout" contract
 * (`w-80 shrink-0 border-l border-gray-200 bg-white sticky top-0 h-screen`) and
 * are asserted by this component's test, not merely described here.
 */
export function SetlistSidebar({ nav, entries, currentRepertoireId, onSelect }: SetlistSidebarProps) {
  if (!nav || entries.length === 0) return null

  return (
    <aside className="w-80 shrink-0 border-l border-gray-200 bg-white sticky top-0 h-screen overflow-y-auto hidden lg:flex flex-col z-20">
      <SetlistPanel
        playlistName={nav.playlistName}
        headerClassName="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10 shadow-2xs"
        trailing={
          <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
            {nav.position} / {nav.total}
          </span>
        }
        entries={entries}
        currentRepertoireId={currentRepertoireId}
        variant="sidebar"
        onSelect={onSelect}
      />
    </aside>
  )
}

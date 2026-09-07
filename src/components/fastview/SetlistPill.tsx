'use client'

import type { PlaylistNav } from '@/lib/playlistNav'

export interface SetlistPillProps {
  nav: PlaylistNav | null
  onOpen: () => void
}

/**
 * The `🎵 Setlist (X/Y)` pill that sits next to `← Back` below `lg` and opens
 * the bottom sheet. Its label is the AGENTS.md "Fast View Playlist Layout"
 * contract for the mobile header row.
 */
export function SetlistPill({ nav, onOpen }: SetlistPillProps) {
  if (!nav) return null

  return (
    <button
      type="button"
      onClick={onOpen}
      className="lg:hidden flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 transition-colors"
    >
      <span>🎵</span>
      <span>Setlist ({nav.position}/{nav.total})</span>
    </button>
  )
}

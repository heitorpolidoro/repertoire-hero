'use client'

import type { PlaylistNav } from '@/lib/playlistNav'

export interface SwipeHintProps {
  nav: PlaylistNav | null
}

/**
 * The thin strip at the bottom of the page telling a touch reader that the
 * neighbouring songs of the setlist are one swipe away, and where they are.
 */
export function SwipeHint({ nav }: SwipeHintProps) {
  if (!nav) return null

  return (
    <div className="lg:hidden flex items-center justify-between px-1 text-[10px] text-gray-400 select-none pb-2">
      <span>{nav.prevId ? '← prev' : ''}</span>
      <span className="font-semibold">{nav.position} / {nav.total}</span>
      <span>{nav.nextId ? 'next →' : ''}</span>
    </div>
  )
}

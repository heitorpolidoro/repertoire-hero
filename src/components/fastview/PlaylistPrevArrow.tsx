'use client'

export interface PlaylistPrevArrowProps {
  prevId: string | null
  onNavigate: () => void
}

/**
 * The floating desktop arrow back to the previous song of the setlist.
 *
 * There is deliberately **no** next arrow: forward movement on desktop happens
 * through the sidebar, and the swipe gesture covers both directions on touch.
 * The asymmetry is preserved from the pre-RH-48 page, hence the specific name.
 */
export function PlaylistPrevArrow({ prevId, onNavigate }: PlaylistPrevArrowProps) {
  if (!prevId) return null

  return (
    <button
      type="button"
      onClick={onNavigate}
      className="fixed left-4 top-1/2 -translate-y-1/2 z-30 hidden lg:flex items-center justify-center w-11 h-11 rounded-full bg-white/90 backdrop-blur border border-gray-200 shadow-lg text-gray-500 hover:text-emerald-600 hover:border-emerald-200 hover:shadow-emerald-100 transition-all focus:outline-none"
      aria-label="Previous song"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
    </button>
  )
}

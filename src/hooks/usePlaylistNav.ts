import { useCallback, useEffect, useRef, useState } from 'react'
import {
  backTarget,
  computePlaylistNav,
  fastViewHref,
  playlistIdFromReturnTo,
  slideDirection,
  swipeTarget,
  SLIDE_OUT_MS,
  type PlaylistEntry,
  type PlaylistNav,
  type SlideDirection,
} from '@/lib/playlistNav'

/**
 * The single playlist Server Action the controller calls. Injected rather than
 * imported, so `src/hooks` never points back into the App Router tree (F21).
 * Required and never defaulted — a default would have to import `@/app`.
 */
export interface PlaylistNavActions {
  getPlaylistDetailsWithEntries: (
    playlistId: string,
    bandId?: string | null,
  ) => Promise<{ name: string; entries: PlaylistEntry[] }>
}

export interface UsePlaylistNavOptions {
  currentRepertoireId: string
  returnTo: string | null
  bandId: string | null
  /** Required, never defaulted — see `src/app/fastViewNavActions.ts`. */
  actions: PlaylistNavActions
  /** `router.push` */
  navigate: (href: string) => void
  /** `router.back` */
  navigateBack: () => void
}

export interface PlaylistNavController {
  nav: PlaylistNav | null
  entries: PlaylistEntry[]
  isDrawerOpen: boolean
  slideOut: SlideDirection | null
  openDrawer: () => void
  closeDrawer: () => void
  /** No-op when `repertoireId` is the current entry. */
  selectEntry: (repertoireId: string) => void
  goPrev: () => void
  goBack: () => void
  onTouchStart: (clientX: number) => void
  onTouchEnd: (clientX: number) => void
}

/**
 * Fast View's playlist-navigation controller: it owns the setlist fetch, the
 * mobile drawer's open/closed state, the slide-out animation and every router
 * push the setlist UI can trigger.
 *
 * All the decisions themselves live in `@/lib/playlistNav` and are unit-tested
 * without React; what is left here is the state, the effects and the timer. The
 * navigation is optional chrome — a song opened outside a playlist, or a
 * playlist the viewer may no longer read, simply leaves `nav` at `null` and the
 * setlist components render nothing.
 */
export function usePlaylistNav({
  currentRepertoireId,
  returnTo,
  bandId,
  actions,
  navigate,
  navigateBack,
}: UsePlaylistNavOptions): PlaylistNavController {
  const [nav, setNav] = useState<PlaylistNav | null>(null)
  const [entries, setEntries] = useState<PlaylistEntry[]>([])
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [slideOut, setSlideOut] = useState<SlideDirection | null>(null)
  const touchStartX = useRef<number | null>(null)
  const slideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const playlistId = playlistIdFromReturnTo(returnTo)
    if (!playlistId) return

    let cancelled = false
    actions
      .getPlaylistDetailsWithEntries(playlistId, bandId)
      .then((details) => {
        if (cancelled) return
        setEntries(details.entries)
        setNav(computePlaylistNav(details.entries, currentRepertoireId, playlistId, details.name))
      })
      .catch(() => {
        // Setlist navigation is optional chrome — a song that cannot resolve its
        // playlist still reads perfectly well on its own.
      })

    return () => {
      cancelled = true
    }
  }, [actions, bandId, currentRepertoireId, returnTo])

  // The pending slide-out must not push a route after the page is gone.
  useEffect(() => {
    return () => {
      if (slideTimer.current !== null) clearTimeout(slideTimer.current)
    }
  }, [])

  const slideAwayTo = useCallback(
    (repertoireId: string, direction: SlideDirection) => {
      setSlideOut(direction)
      slideTimer.current = setTimeout(() => {
        slideTimer.current = null
        navigate(fastViewHref(repertoireId, returnTo, bandId))
      }, SLIDE_OUT_MS)
    },
    [bandId, navigate, returnTo],
  )

  const selectEntry = useCallback(
    (repertoireId: string) => {
      if (repertoireId === currentRepertoireId) return
      slideAwayTo(repertoireId, slideDirection(entries, currentRepertoireId, repertoireId))
    },
    [currentRepertoireId, entries, slideAwayTo],
  )

  const goPrev = useCallback(() => {
    const prevId = nav?.prevId
    if (!prevId) return
    slideAwayTo(prevId, 'right')
  }, [nav?.prevId, slideAwayTo])

  const onTouchStart = useCallback((clientX: number) => {
    touchStartX.current = clientX
  }, [])

  const onTouchEnd = useCallback(
    (clientX: number) => {
      const startX = touchStartX.current
      touchStartX.current = null
      if (startX === null) return

      const target = swipeTarget(startX - clientX, nav)
      if (!target) return
      slideAwayTo(target.repertoireId, target.direction)
    },
    [nav, slideAwayTo],
  )

  const goBack = useCallback(() => {
    const target = backTarget(returnTo)
    if (target.kind === 'push') {
      navigate(target.href)
      return
    }
    navigateBack()
  }, [navigate, navigateBack, returnTo])

  const openDrawer = useCallback(() => setIsDrawerOpen(true), [])
  const closeDrawer = useCallback(() => setIsDrawerOpen(false), [])

  return {
    nav,
    entries,
    isDrawerOpen,
    slideOut,
    openDrawer,
    closeDrawer,
    selectEntry,
    goPrev,
    goBack,
    onTouchStart,
    onTouchEnd,
  }
}

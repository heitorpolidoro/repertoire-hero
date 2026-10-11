import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  backTarget,
  computePlaylistNav,
  fastViewHref,
  keyboardTarget,
  slideDirection,
  swipeTarget,
  SLIDE_OUT_MS,
  type PlaylistNav,
  type SlideDirection,
} from '@/lib/playlistNav'
import { readSongQueue, resolveQueueOwner, type SongQueueEntry } from '@/lib/songQueue'

export interface UsePlaylistNavOptions {
  /** The route's `song_versions.id` — the Fast View address (RH-132). */
  currentVersionId: string
  /** The page's `?bandId=`, read from `searchParams` and nothing else. */
  bandId: string | null
  /** `router.push` */
  navigate: (href: string) => void
  /** `router.back` */
  navigateBack: () => void
  /**
   * Whether ArrowLeft / ArrowRight move through the setlist. Off while a Stage
   * Mode surface is up, so a key press never yanks the musician out of it.
   * Defaults to true.
   */
  keyboardEnabled?: boolean
}

export interface PlaylistNavController {
  nav: PlaylistNav | null
  entries: SongQueueEntry[]
  isDrawerOpen: boolean
  slideOut: SlideDirection | null
  openDrawer: () => void
  closeDrawer: () => void
  /** No-op when `versionId` is the current entry. */
  selectEntry: (versionId: string) => void
  goPrev: () => void
  goBack: () => void
  onTouchStart: (clientX: number) => void
  onTouchEnd: (clientX: number) => void
}

/** One array, so `entries` keeps a stable identity while there is no queue. */
const NO_ENTRIES: SongQueueEntry[] = []

/**
 * `sessionStorage` emits no event for a same-tab write, and a queue is not
 * edited under a mounted page anyway: it is written by the screen that built
 * it, immediately before navigating here. So there is nothing to subscribe to,
 * and the unsubscribe is a no-op.
 */
function subscribeToSongQueue(): () => void {
  return () => {}
}

/**
 * Server-rendered, there is no tab and therefore no queue. Reading the store as
 * an external snapshot rather than in an effect is what keeps the hydrated
 * markup identical to the server's while still showing the chrome immediately
 * after hydration.
 */
function noQueueOnTheServer(): null {
  return null
}

/**
 * Fast View's setlist-navigation controller: it reads the tab's song queue, owns
 * the mobile drawer's open/closed state, the slide-out animation and every
 * router push the setlist UI can trigger.
 *
 * **It fetches nothing** (RH-133). The queue is one `sessionStorage` entry,
 * written by whatever built it, and reading it is synchronous and local — which
 * is what makes the chrome work with no network at all, the standing offline
 * rule's requirement. The reader runs once on mount: a queue dies with the tab
 * and is not edited under a mounted page, while the *position* inside it is
 * derived on every render from the route's version id, because no position is
 * stored.
 *
 * The queue is **scoped to the route**: a stored queue that does not hold the
 * current version is treated as no queue at all, so a song opened alone carries
 * neither the chrome nor the Back target of an earlier navigation in the same
 * tab.
 *
 * All the decisions themselves live in `@/lib/playlistNav` and `@/lib/songQueue`
 * and are unit-tested without React; what is left here is the state, the
 * effects and the timer. The navigation is optional chrome — a song opened alone
 * simply leaves `nav` at `null` and the setlist components render nothing.
 */
export function usePlaylistNav({
  currentVersionId,
  bandId,
  navigate,
  navigateBack,
  keyboardEnabled = true,
}: UsePlaylistNavOptions): PlaylistNavController {
  const storedQueue = useSyncExternalStore(subscribeToSongQueue, readSongQueue, noQueueOnTheServer)

  // **A queue applies to this route only when it holds this route's version.**
  // The store is tab-wide and dies only with the tab, so a song reached from
  // somewhere that built no queue — the dashboard, a shared link — would
  // otherwise inherit the previous navigation's setlist chrome and, worse, its
  // Back target. Scoping the whole queue to the route keeps the chrome a
  // function of the URL and the queue together: either the stored list is about
  // the song on screen, or there is no queue here at all. The entry points that
  // build no queue also `clearSongQueue()` as they navigate; this is the half
  // that does not depend on every future entry point remembering to.
  const queue =
    storedQueue?.entries.some((entry) => entry.versionId === currentVersionId) === true
      ? storedQueue
      : null

  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [slideOut, setSlideOut] = useState<SlideDirection | null>(null)
  const touchStartX = useRef<number | null>(null)
  const slideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const entries = queue?.entries ?? NO_ENTRIES

  // Derived, never stored: the current place is the route's version id matched
  // against the stored entries.
  const nav = useMemo(
    () => (queue ? computePlaylistNav(queue.entries, currentVersionId, queue.label) : null),
    [currentVersionId, queue],
  )

  // The `?bandId=` of the hrefs this controller pushes, and nothing else: the
  // URL wins whenever it carries one, and the queue's recorded context applies
  // only when it does not. `resolveQueueOwner`'s docblock carries why that is
  // safe for a client-writable store, and why the page's own write arguments
  // never come through here.
  const hrefBandId = resolveQueueOwner(bandId, queue?.owner)

  // The pending slide-out must not push a route after the page is gone.
  useEffect(() => {
    return () => {
      if (slideTimer.current !== null) clearTimeout(slideTimer.current)
    }
  }, [])

  const slideAwayTo = useCallback(
    (versionId: string, direction: SlideDirection) => {
      setSlideOut(direction)
      slideTimer.current = setTimeout(() => {
        slideTimer.current = null
        navigate(fastViewHref(versionId, hrefBandId))
      }, SLIDE_OUT_MS)
    },
    [hrefBandId, navigate],
  )

  const selectEntry = useCallback(
    (versionId: string) => {
      if (versionId === currentVersionId) return
      slideAwayTo(versionId, slideDirection(entries, currentVersionId, versionId))
    },
    [currentVersionId, entries, slideAwayTo],
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
      slideAwayTo(target.versionId, target.direction)
    },
    [nav, slideAwayTo],
  )

  // Arrow keys (and the Bluetooth page-turner pedals that emit them) move
  // through the setlist exactly like a swipe does.
  useEffect(() => {
    if (!keyboardEnabled || !nav) return

    const handleKeyDown = (event: KeyboardEvent) => {
      // One slide at a time: a held key must not queue a second push.
      if (slideTimer.current !== null) return
      const target = keyboardTarget(
        {
          key: event.key,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          defaultPrevented: event.defaultPrevented,
          editableTarget: isEditableTarget(event.target),
        },
        nav,
      )
      if (!target) return
      event.preventDefault()
      slideAwayTo(target.versionId, target.direction)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [keyboardEnabled, nav, slideAwayTo])

  // Back goes to the href the queue recorded as its origin, whatever kind of
  // screen that is, and walks history back when there is no queue to ask.
  const goBack = useCallback(() => {
    const target = backTarget(queue?.originHref ?? null)
    if (target.kind === 'push') {
      navigate(target.href)
      return
    }
    navigateBack()
  }, [navigate, navigateBack, queue?.originHref])

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

/** Focus in a text field, a select or a contenteditable element. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

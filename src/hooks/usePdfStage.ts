import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { findScrollHost, lockScrollHost } from '@/lib/scrollHost'
import { isStageHistoryEntry, stageHistoryState } from '@/lib/stageHistory'
import { isStableViewportMeasurement, stageViewportHeight } from '@/lib/stageInteraction'
import type { Stroke, TabAnnotations } from '@/types/database'

/**
 * The annotation Server Actions the controller calls. Injected rather than
 * imported, so `src/hooks` never points back into the App Router tree (F21).
 * Required and never defaulted — a default would have to import that tree.
 */
export interface PdfStageActions {
  getAnnotations: (tabId: string, repertoireId: string) => Promise<{ data?: TabAnnotations; error?: string }>
  saveAnnotations: (
    tabId: string,
    repertoireId: string,
    pageNumber: number,
    strokes: Stroke[],
  ) => Promise<{ success?: boolean; error?: string }>
}

/** The slice of the browser's visual viewport this hook uses; a test passes a fake. */
export interface VisualViewportLike {
  height?: number
  scale?: number
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
}

export interface UsePdfStageOptions {
  /** `activeTabId` from `useTabLibrary`; null when no tab is selected. */
  tabId: string | null
  /** `activeTabRepertoireId` from `useTabLibrary`. */
  repertoireId: string | null
  /** Required, never defaulted — see `src/app/fastViewTabActions.ts` (F21). */
  actions: PdfStageActions
  /** Test seam. Defaults to a module-level reader of the browser's viewport. */
  getViewport?: () => VisualViewportLike | null | undefined
}

export interface PdfStageController {
  isOpen: boolean
  open: () => void
  close: () => void
  overlayRef: RefObject<HTMLDivElement | null>
  /** Measured visual-viewport height in px; null before the first measurement. */
  height: number | null
  /** null while loading, `{}` for a tab with none (RH-46 prop contract). */
  annotations: TabAnnotations | null
  annotationsError: string | null
  saveAnnotations: (pageNumber: number, strokes: Stroke[]) => Promise<{ success?: boolean; error?: string }>
}

/** The annotation payload, keyed by the tab it was loaded for (RH-46). */
interface StageAnnotations {
  tabId: string
  data: TabAnnotations
  error: string | null
}

/**
 * The default viewport reader. Module-level, so its identity is stable and the
 * measurement effect cannot be restarted by a re-render — the same reason
 * `TAB_LIBRARY_ACTIONS` is module-level (RH-49).
 */
const WINDOW_VIEWPORT = () => (typeof window !== 'undefined' ? window.visualViewport : undefined)

/**
 * Fast View's PDF Stage Mode controller: it owns the overlay's open/close
 * state, the visual-viewport measurement that keeps the drawing toolbar on
 * screen (RH-28), the scroll-lock of the page's real scroll container, the
 * back-button intercept and the RH-46 annotation load/save.
 *
 * The overlay itself is presentational (`components/fastview/PdfStageOverlay`),
 * and the decisions live in `@/lib/stageInteraction` and `@/lib/scrollHost`;
 * what is left here is the state, the effects and the injected actions (RH-50).
 */
export function usePdfStage({
  tabId,
  repertoireId,
  actions,
  getViewport = WINDOW_VIEWPORT,
}: UsePdfStageOptions): PdfStageController {
  const [isOpen, setIsOpen] = useState(false)
  const [height, setHeight] = useState<number | null>(null)
  const [payload, setPayload] = useState<StageAnnotations | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const open = useCallback(() => setIsOpen(true), [])

  const close = useCallback(() => {
    setIsOpen(false)
    if (isStageHistoryEntry(window.history.state)) {
      window.history.back()
    }
  }, [])

  // Mobile back button intercept: while the stage is up, one extra history
  // entry stands between it and leaving the page, and popping it closes the
  // overlay. The lyrics Stage Mode keeps the mirror image of this effect on the
  // page; both push the same marker, from `@/lib/stageHistory`.
  useEffect(() => {
    if (!isOpen) return

    window.history.pushState(stageHistoryState(), '')

    const handleBackNavigation = () => setIsOpen(false)

    window.addEventListener('popstate', handleBackNavigation)
    return () => {
      window.removeEventListener('popstate', handleBackNavigation)
    }
  }, [isOpen])

  // Size the overlay to the *visual* viewport. `100vh` / `inset-0` resolve
  // against the large viewport on iOS/iPadOS Safari and Android Chrome, i.e.
  // the size the page has with the browser chrome collapsed; while the chrome
  // is expanded the bottom strip of the overlay — exactly the toolbar — is laid
  // out below the visible area, which is the reported "toolbar flashes then is
  // unreachable" bug on tablets.
  useEffect(() => {
    if (!isOpen) return

    const vv = getViewport()

    const measure = () => {
      // A pinch-zoomed visual viewport reports a fraction of the layout
      // viewport, which is not the box a fixed overlay occupies — keep the last
      // stable height instead of shrinking the overlay (and pushing the toolbar
      // off screen again).
      if (!isStableViewportMeasurement(vv?.scale)) return
      setHeight(stageViewportHeight(vv?.height, window.innerHeight))
    }

    measure()
    // iOS Safari fires only `scroll` (not `resize`) for some chrome
    // expand/collapse transitions, hence both subscriptions.
    vv?.addEventListener('resize', measure)
    vv?.addEventListener('scroll', measure)
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    return () => {
      vv?.removeEventListener('resize', measure)
      vv?.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
      setHeight(null)
    }
  }, [getViewport, isOpen])

  // Scroll-lock the page's real scroll container while the stage is open. That
  // container is the app shell's <main> (AppLayout, `flex-1 overflow-y-auto`) —
  // not `body`, which never scrolls in a `flex h-screen` shell — and it is also
  // the overlay's nearest scrollable ancestor, i.e. the element a vertical drag
  // on the overlay header would otherwise chain to.
  useEffect(() => {
    if (!isOpen) return
    return lockScrollHost(findScrollHost(overlayRef.current))
  }, [isOpen])

  // Stage Mode annotations: fetched here, handed to the drawing stage as props
  // (RH-46). The payload is keyed by the tab it was loaded for, so reopening
  // the stage for a different tab renders the loading state (a null annotations
  // prop) until that tab's own fetch resolves — a stale payload is never shown.
  useEffect(() => {
    if (!isOpen || !tabId || !repertoireId) return
    let cancelled = false
    actions.getAnnotations(tabId, repertoireId).then((res) => {
      if (cancelled) return
      setPayload({ tabId, data: res.data ?? {}, error: res.error ?? null })
    })
    return () => {
      cancelled = true
    }
  }, [actions, isOpen, repertoireId, tabId])

  const payloadForTab = payload && payload.tabId === tabId ? payload : null

  const saveAnnotations = useCallback(
    async (pageNumber: number, strokes: Stroke[]): Promise<{ success?: boolean; error?: string }> => {
      if (!tabId || !repertoireId) return { error: 'Tab not found' }
      return actions.saveAnnotations(tabId, repertoireId, pageNumber, strokes)
    },
    [actions, repertoireId, tabId],
  )

  return {
    isOpen,
    open,
    close,
    overlayRef,
    height,
    annotations: payloadForTab?.data ?? null,
    annotationsError: payloadForTab?.error ?? null,
    saveAnnotations,
  }
}

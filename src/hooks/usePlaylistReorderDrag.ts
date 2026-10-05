import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { logger } from '@/lib/logger'
import {
  edgeScrollStep,
  insertionIndexAt,
  reorderIds,
} from '@/lib/playlistReorderDrag'

/**
 * The handlers the drag *handle* binds — and only the handle. Nothing else on
 * the row listens for a pointer, which is half of why a press outside the
 * handle scrolls the list instead of lifting a row; the other half is the
 * handle's `touch-action: none` against the row's `pan-y`.
 *
 * `pointermove` and `pointerup` are bound here rather than on the window
 * because `setPointerCapture` retargets them to the handle for the rest of the
 * gesture, so the finger may leave the handle and the drag still follows it.
 */
export interface PlaylistReorderHandleProps {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: () => void
  onPointerCancel: () => void
}

export interface PlaylistReorderDragOptions {
  /** The rendered rows' `playlist_songs.id`s, in the order they are rendered. */
  orderedIds: string[]
  /** The controller's drag commit; a no-op release never reaches it. */
  onReorder: (orderedIds: string[]) => Promise<void>
  /** The scroll container, for the edge auto-scroll. */
  containerRef: RefObject<HTMLElement | null>
}

/** Values and bindings only — the list renders from these and decides nothing. */
export interface PlaylistReorderDragController {
  /** The row being dragged, or `null` when no gesture is in flight. */
  draggingIndex: number | null
  /** How far that row has travelled, in px, for its `translateY`. */
  offset: number
  /** The gap the insertion line marks, or `null` while nothing is dragging. */
  insertionIndex: number | null
  /** The row `ref` factory: the gesture measures midpoints off these nodes. */
  registerRow: (index: number) => (node: HTMLElement | null) => void
  /** What the handle spreads. */
  handleProps: (index: number) => PlaylistReorderHandleProps
}

/** One gesture in flight. `to` is an insertion index into the rendered list. */
interface ReorderDrag {
  from: number
  startY: number
  y: number
  to: number
}

/** The rendered rows' vertical midpoints, in list order, measured live. */
function midpointsOf(rows: Map<number, HTMLElement>): number[] {
  return [...rows.entries()]
    .sort(([indexA], [indexB]) => indexA - indexB)
    .map(([, node]) => {
      const rect = node.getBoundingClientRect()
      return rect.top + rect.height / 2
    })
}

/** Scrolls the container when the pointer nears an edge, so an off-screen
 * position is reachable without letting go. */
function autoScroll(container: HTMLElement | null, y: number): void {
  if (!container) return
  const rect = container.getBoundingClientRect()
  const step = edgeScrollStep(y, rect.top, rect.bottom)
  if (step !== 0) container.scrollTop += step
}

/**
 * RH-103 — the playlist reorder gesture: Pointer Events, CSS `touch-action` and
 * no dependency.
 *
 * HTML5 drag-and-drop does not fire on touch, so the row is dragged with
 * pointer capture instead. There is no long-press delay and no movement
 * threshold: the browser decides by **where the finger landed**, because the
 * handle is the only element carrying `touch-action: none`. A press anywhere
 * else is a scroll, from its first pixel.
 *
 * Every decision is read from `@/lib/playlistReorderDrag`, so what the gesture
 * *concludes* is unit-testable without a DOM; what is left here is the
 * measuring, the state of one drag and the two ways it ends — `pointerup`
 * commits, `pointercancel` and `Escape` write nothing.
 */
export function usePlaylistReorderDrag({
  orderedIds,
  onReorder,
  containerRef,
}: PlaylistReorderDragOptions): PlaylistReorderDragController {
  const rows = useRef(new Map<number, HTMLElement>())
  const [drag, setDrag] = useState<ReorderDrag | null>(null)

  // Escape puts the row back. Registered only while a drag is in flight, so the
  // key is not swallowed from the rename input or any other panel.
  useEffect(() => {
    if (!drag) return
    const abandon = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrag(null)
    }
    window.addEventListener('keydown', abandon)
    return () => window.removeEventListener('keydown', abandon)
  }, [drag])

  const registerRow = (index: number) => (node: HTMLElement | null) => {
    if (node) rows.current.set(index, node)
    else rows.current.delete(index)
  }

  const begin = (event: ReactPointerEvent<HTMLElement>, index: number) => {
    const handle = event.currentTarget
    if (typeof handle.setPointerCapture === 'function') {
      // Absent in jsdom and on a browser without the API; the drag still works
      // for as long as the pointer stays over the handle.
      handle.setPointerCapture(event.pointerId)
    }
    setDrag({ from: index, startY: event.clientY, y: event.clientY, to: index })
  }

  const follow = (event: ReactPointerEvent<HTMLElement>) => {
    const y = event.clientY
    const to = insertionIndexAt(midpointsOf(rows.current), y)
    setDrag(prev => (prev === null ? prev : { ...prev, y, to }))
    autoScroll(containerRef.current, y)
  }

  const commit = () => {
    if (!drag) return
    const result = reorderIds(orderedIds, drag.from, drag.to)
    setDrag(null)
    // The controller owns the failure: it rolls the order back and fills the
    // error banner, so nothing is left for this call site but the rejection a
    // caller must not drop.
    if (result.reordered) {
      onReorder(result.orderedIds).catch((cause: unknown) =>
        logger.error('Playlist reorder commit failed', cause),
      )
    }
  }

  return {
    draggingIndex: drag?.from ?? null,
    offset: drag ? drag.y - drag.startY : 0,
    insertionIndex: drag ? drag.to : null,
    registerRow,
    handleProps: (index: number) => ({
      onPointerDown: event => begin(event, index),
      onPointerMove: follow,
      onPointerUp: commit,
      onPointerCancel: () => setDrag(null),
    }),
  }
}

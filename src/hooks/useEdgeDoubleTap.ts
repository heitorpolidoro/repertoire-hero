import { useEffect, useRef } from 'react'
import {
  evaluateDoubleTap,
  isEdgeZone,
  isTapCandidate,
  type TapRecord,
} from '@/lib/stageNav'

export interface UseEdgeDoubleTapOptions {
  enabled?: boolean
  onPrev?: () => void
  onNext?: () => void
}

function isInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(
    target.closest('button, input, textarea, select, a') ||
    target.isContentEditable
  )
}

interface PointerTracker {
  startX: number
  startY: number
  startTime: number
  maxDistance: number
  zone: 'left' | 'right' | null
}

/**
 * Hook for edge double-tap detection in Stage Mode overlays (RH-197).
 *
 * Tracks pointer events on the screen edges and triggers `onPrev` / `onNext`
 * when consecutive taps land in the left or right edge zones.
 * Discards events if `enabled` is false, if multi-touch is detected, or if
 * the gesture originates on an interactive control (button, input, select).
 */
export function useEdgeDoubleTap({
  enabled = true,
  onPrev,
  onNext,
}: UseEdgeDoubleTapOptions): void {
  const lastTapRef = useRef<TapRecord | null>(null)
  const activePointersRef = useRef<Map<number, PointerTracker>>(new Map())
  const hasMultiTouchRef = useRef(false)

  const onPrevRef = useRef(onPrev)
  const onNextRef = useRef(onNext)

  useEffect(() => {
    onPrevRef.current = onPrev
    onNextRef.current = onNext
  }, [onNext, onPrev])

  useEffect(() => {
    const activePointers = activePointersRef.current
    if (!enabled) {
      lastTapRef.current = null
      activePointers.clear()
      hasMultiTouchRef.current = false
      return
    }

    const handlePointerDown = (e: PointerEvent) => {
      if (isInteractive(e.target)) return

      if (activePointersRef.current.size >= 1) {
        hasMultiTouchRef.current = true
        lastTapRef.current = null
      }

      const zone = isEdgeZone(e.clientX, window.innerWidth)
      activePointersRef.current.set(e.pointerId, {
        startX: e.clientX,
        startY: e.clientY,
        startTime: Date.now(),
        maxDistance: 0,
        zone,
      })
    }

    const handlePointerMove = (e: PointerEvent) => {
      const tracker = activePointersRef.current.get(e.pointerId)
      if (!tracker) return

      const dist = Math.hypot(e.clientX - tracker.startX, e.clientY - tracker.startY)
      if (dist > tracker.maxDistance) {
        tracker.maxDistance = dist
      }
    }

    const handlePointerUp = (e: PointerEvent) => {
      const tracker = activePointersRef.current.get(e.pointerId)
      activePointersRef.current.delete(e.pointerId)

      if (hasMultiTouchRef.current) {
        if (activePointersRef.current.size === 0) {
          hasMultiTouchRef.current = false
        }
        return
      }

      if (!tracker || !tracker.zone) return

      const duration = Date.now() - tracker.startTime
      const totalDistance = Math.max(
        tracker.maxDistance,
        Math.hypot(e.clientX - tracker.startX, e.clientY - tracker.startY),
      )

      if (!isTapCandidate(totalDistance, duration)) {
        lastTapRef.current = null
        return
      }

      const currentTap: TapRecord = {
        clientX: e.clientX,
        clientY: e.clientY,
        timeMs: Date.now(),
        zone: tracker.zone,
      }

      const direction = evaluateDoubleTap(lastTapRef.current, currentTap)
      if (direction === 'next') {
        lastTapRef.current = null
        onNextRef.current?.()
      } else if (direction === 'prev') {
        lastTapRef.current = null
        onPrevRef.current?.()
      } else {
        lastTapRef.current = currentTap
      }
    }

    const handlePointerCancel = (e: PointerEvent) => {
      activePointersRef.current.delete(e.pointerId)
      if (activePointersRef.current.size === 0) {
        hasMultiTouchRef.current = false
      }
      lastTapRef.current = null
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      lastTapRef.current = null
      activePointers.clear()
      hasMultiTouchRef.current = false
    }
  }, [enabled])
}

/**
 * Pure decision helpers for stage mode navigation (RH-197).
 *
 * Provides edge-zone determination, tap movement validation, and double-tap
 * evaluation for navigating between queued songs without conflicting with
 * scrolling, zooming, or PDF interactions.
 *
 * DOM-free and runnable in any test environment.
 */

export const DOUBLE_TAP_MAX_DELAY_MS = 350
export const DOUBLE_TAP_MAX_DISTANCE_PX = 50
export const TAP_MOVE_TOLERANCE_PX = 15
export const TAP_MAX_DURATION_MS = 500

export type EdgeZone = 'left' | 'right'

export interface TapRecord {
  clientX: number
  clientY: number
  timeMs: number
  zone: EdgeZone
}

/**
 * Determines whether a clientX position falls within the left or right edge trigger zone.
 * Edge trigger width is 20% of viewport width, with a minimum of 64px.
 */
export function isEdgeZone(clientX: number, viewportWidth: number): EdgeZone | null {
  const edgeWidth = Math.max(64, Math.round(viewportWidth * 0.2))
  if (clientX <= edgeWidth) return 'left'
  if (clientX >= viewportWidth - edgeWidth) return 'right'
  return null
}

/**
 * Validates whether pointer travel and duration qualify as a tap gesture,
 * filtering out vertical scrolls, canvas drags, and long presses.
 */
export function isTapCandidate(pointerMoveDistancePx: number, durationMs: number): boolean {
  return pointerMoveDistancePx <= TAP_MOVE_TOLERANCE_PX && durationMs <= TAP_MAX_DURATION_MS
}

/**
 * Evaluates whether two consecutive taps constitute a valid double-tap in an edge zone.
 * Requires:
 * 1. Both taps occurred in the same edge zone.
 * 2. Time delta <= DOUBLE_TAP_MAX_DELAY_MS (350 ms).
 * 3. Distance between taps <= DOUBLE_TAP_MAX_DISTANCE_PX (50 px).
 *
 * Returns 'prev' for left edge double-tap, 'next' for right edge double-tap, else null.
 */
export function evaluateDoubleTap(
  lastTap: TapRecord | null,
  currentTap: TapRecord,
): 'prev' | 'next' | null {
  if (!lastTap) return null
  if (lastTap.zone !== currentTap.zone) return null

  const delay = currentTap.timeMs - lastTap.timeMs
  if (delay < 0 || delay > DOUBLE_TAP_MAX_DELAY_MS) return null

  const distance = Math.hypot(currentTap.clientX - lastTap.clientX, currentTap.clientY - lastTap.clientY)
  if (distance > DOUBLE_TAP_MAX_DISTANCE_PX) return null

  return currentTap.zone === 'left' ? 'prev' : 'next'
}

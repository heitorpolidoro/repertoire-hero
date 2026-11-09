import { describe, it, expect } from 'vitest'
import {
  isEdgeZone,
  evaluateDoubleTap,
  isTapCandidate,
  DOUBLE_TAP_MAX_DELAY_MS,
  DOUBLE_TAP_MAX_DISTANCE_PX,
  TAP_MOVE_TOLERANCE_PX,
  TAP_MAX_DURATION_MS,
  type TapRecord,
} from '../stageNav'

describe('isEdgeZone', () => {
  it('returns left within the left 20% / 64px, right within the right 20% / 64px, and null in the middle', () => {
    // Viewport width 1000px: 20% is 200px (max(64, 200) = 200px)
    expect(isEdgeZone(0, 1000)).toBe('left')
    expect(isEdgeZone(200, 1000)).toBe('left')
    expect(isEdgeZone(201, 1000)).toBeNull()
    expect(isEdgeZone(500, 1000)).toBeNull()
    expect(isEdgeZone(799, 1000)).toBeNull()
    expect(isEdgeZone(800, 1000)).toBe('right')
    expect(isEdgeZone(1000, 1000)).toBe('right')

    // Narrow viewport 200px: 20% is 40px, but minimum is 64px
    expect(isEdgeZone(64, 200)).toBe('left')
    expect(isEdgeZone(65, 200)).toBeNull()
    expect(isEdgeZone(135, 200)).toBeNull()
    expect(isEdgeZone(136, 200)).toBe('right')
  })
})

describe('isTapCandidate', () => {
  it('accepts gestures within movement and duration tolerance', () => {
    expect(isTapCandidate(0, 100)).toBe(true)
    expect(isTapCandidate(TAP_MOVE_TOLERANCE_PX, TAP_MAX_DURATION_MS)).toBe(true)
  })

  it('rejects movements > 15 px (scroll/pan) and gestures longer than 500 ms', () => {
    expect(isTapCandidate(TAP_MOVE_TOLERANCE_PX + 1, 100)).toBe(false)
    expect(isTapCandidate(5, TAP_MAX_DURATION_MS + 1)).toBe(false)
    expect(isTapCandidate(30, 600)).toBe(false)
  })
})

describe('evaluateDoubleTap', () => {
  const baseTap: TapRecord = {
    clientX: 30,
    clientY: 100,
    timeMs: 1000,
    zone: 'left',
  }

  it('returns prev for two consecutive taps in the left zone within 350 ms and 50 px', () => {
    const secondTap: TapRecord = {
      clientX: 35,
      clientY: 110,
      timeMs: 1200, // +200ms
      zone: 'left',
    }
    expect(evaluateDoubleTap(baseTap, secondTap)).toBe('prev')
  })

  it('returns next for two consecutive taps in the right zone within 350 ms and 50 px', () => {
    const rightFirst: TapRecord = {
      clientX: 980,
      clientY: 200,
      timeMs: 1000,
      zone: 'right',
    }
    const rightSecond: TapRecord = {
      clientX: 975,
      clientY: 205,
      timeMs: 1250,
      zone: 'right',
    }
    expect(evaluateDoubleTap(rightFirst, rightSecond)).toBe('next')
  })

  it('returns null when lastTap is null', () => {
    expect(evaluateDoubleTap(null, baseTap)).toBeNull()
  })

  it('returns null for taps in opposite zones, taps separated by > 350 ms, or taps separated by > 50 px', () => {
    // Opposite zones
    const oppositeZoneTap: TapRecord = {
      clientX: 980,
      clientY: 100,
      timeMs: 1100,
      zone: 'right',
    }
    expect(evaluateDoubleTap(baseTap, oppositeZoneTap)).toBeNull()

    // Too late (> 350 ms)
    const lateTap: TapRecord = {
      clientX: 30,
      clientY: 100,
      timeMs: 1000 + DOUBLE_TAP_MAX_DELAY_MS + 1,
      zone: 'left',
    }
    expect(evaluateDoubleTap(baseTap, lateTap)).toBeNull()

    // Too far (> 50 px distance)
    const farTap: TapRecord = {
      clientX: 30 + DOUBLE_TAP_MAX_DISTANCE_PX + 1,
      clientY: 100,
      timeMs: 1100,
      zone: 'left',
    }
    expect(evaluateDoubleTap(baseTap, farTap)).toBeNull()
  })
})

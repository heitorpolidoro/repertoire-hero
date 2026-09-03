import { describe, it, expect } from 'vitest'
import {
  normalizePoint,
  denormalizePoint,
  normalizeWidth,
  denormalizeWidth,
  findStrokeToErase,
  applyEraseAt,
  ERASE_TOLERANCE_PX,
  type PageGeometry,
} from '../annotationMath'
import type { Stroke } from '@/types/database'

describe('normalizePoint / denormalizePoint', () => {
  it('round-trips a point drawn at 2x zoom to the same normalized fraction as at 1x', () => {
    const page1x: PageGeometry = { width: 600, height: 800, originalWidth: 600, originalHeight: 800 }
    const page2x: PageGeometry = { width: 1200, height: 1600, originalWidth: 600, originalHeight: 800 }

    // A point drawn at (300, 400) on the 1x render...
    const norm1x = normalizePoint(300, 400, page1x)
    // ...and the geometrically equivalent point drawn at (600, 800) on the 2x render...
    const norm2x = normalizePoint(600, 800, page2x)

    // ...must normalize to the exact same 0..1 fraction, regardless of zoom level at draw time.
    expect(norm1x).toEqual(norm2x)
    expect(norm1x).toEqual([0.5, 0.5])
  })

  it('denormalizes a stroke stored at 2x zoom back to the correct pixel position at 1x and 3x', () => {
    const page2xAtDrawTime: PageGeometry = { width: 1200, height: 1600, originalWidth: 600, originalHeight: 800 }
    const [normX, normY] = normalizePoint(600, 800, page2xAtDrawTime) // drawn at 2x

    const page1x: PageGeometry = { width: 600, height: 800, originalWidth: 600, originalHeight: 800 }
    const page3x: PageGeometry = { width: 1800, height: 2400, originalWidth: 600, originalHeight: 800 }

    expect(denormalizePoint(normX, normY, page1x)).toEqual([300, 400])
    expect(denormalizePoint(normX, normY, page3x)).toEqual([900, 1200])
  })

  it('normalizes/denormalizes the origin and far corner correctly', () => {
    const page: PageGeometry = { width: 500, height: 1000, originalWidth: 500, originalHeight: 1000 }
    expect(normalizePoint(0, 0, page)).toEqual([0, 0])
    expect(normalizePoint(500, 1000, page)).toEqual([1, 1])
    expect(denormalizePoint(0, 0, page)).toEqual([0, 0])
    expect(denormalizePoint(1, 1, page)).toEqual([500, 1000])
  })
})

describe('normalizeWidth / denormalizeWidth', () => {
  it('a stroke width normalized at one zoom denormalizes to a proportionally larger pixel width at 2x zoom', () => {
    const page1x: PageGeometry = { width: 600, height: 800, originalWidth: 600, originalHeight: 800 }
    const page2x: PageGeometry = { width: 1200, height: 1600, originalWidth: 600, originalHeight: 800 }

    const normWidth = normalizeWidth(3, page1x) // 3 CSS px at 1x
    expect(denormalizeWidth(normWidth, page1x)).toBeCloseTo(3)
    expect(denormalizeWidth(normWidth, page2x)).toBeCloseTo(6) // grows with zoom, unlike eraser tolerance
  })
})

describe('findStrokeToErase — 16 CSS px tolerance, never scaled by zoom', () => {
  const strokes: Stroke[] = [
    { id: 'stroke-a', color: '#000000', width: 0.005, points: [[0.5, 0.5]] },
    { id: 'stroke-b', color: '#000000', width: 0.005, points: [[0.1, 0.1], [0.9, 0.9]] },
  ]

  it('removes a stroke when the pointer is within 16px of one of its points, at 1x zoom', () => {
    const page1x: PageGeometry = { width: 1000, height: 1000, originalWidth: 1000, originalHeight: 1000 }
    // stroke-a's point (0.5, 0.5) denormalizes to (500, 500) at 1x
    const hit = findStrokeToErase(strokes, 500 + 10, 500, page1x)
    expect(hit).toBe('stroke-a')
  })

  it('does not remove a stroke when the pointer is just beyond the 16px tolerance', () => {
    const page1x: PageGeometry = { width: 1000, height: 1000, originalWidth: 1000, originalHeight: 1000 }
    const hit = findStrokeToErase(strokes, 500 + ERASE_TOLERANCE_PX + 1, 500, page1x)
    expect(hit).toBeNull()
  })

  it('applies the exact same 16px tolerance at 2x zoom, not scaled up with the render size', () => {
    // At 2x zoom, stroke-a's (0.5, 0.5) point denormalizes to (1000, 1000) pixels, not (500, 500).
    const page2x: PageGeometry = { width: 2000, height: 2000, originalWidth: 1000, originalHeight: 1000 }

    // A pointer 20px away in *current* pixel space is outside tolerance at any zoom —
    // if the tolerance were incorrectly scaled by zoomLevel (e.g. 16 * 2 = 32), this would
    // wrongly hit; it must not.
    const justOutside = findStrokeToErase(strokes, 1000 + 20, 1000, page2x)
    expect(justOutside).toBeNull()

    const justInside = findStrokeToErase(strokes, 1000 + 15, 1000, page2x)
    expect(justInside).toBe('stroke-a')
  })

  it('removes the whole stroke when the hit point is anywhere along a long stroke, not a segment of it', () => {
    const page1x: PageGeometry = { width: 1000, height: 1000, originalWidth: 1000, originalHeight: 1000 }
    // stroke-b's points span (100,100) to (900,900); hit-test near its second point.
    const hit = findStrokeToErase(strokes, 900, 900, page1x)
    expect(hit).toBe('stroke-b')
  })

  it('returns null when no stroke is within tolerance', () => {
    const page1x: PageGeometry = { width: 1000, height: 1000, originalWidth: 1000, originalHeight: 1000 }
    const hit = findStrokeToErase(strokes, 5, 5, page1x)
    expect(hit).toBeNull()
  })
})

describe('applyEraseAt — pure whole-stroke erase (RH-20)', () => {
  const page: PageGeometry = { width: 1000, height: 1000, originalWidth: 1000, originalHeight: 1000 }

  // Three well-separated strokes: A at (500,500), B along (100,100)-(900,900),
  // C at (200,800). Every hit position below is far outside the 16px tolerance
  // of the other two, so each assertion isolates exactly one stroke.
  function makeStrokes(): Stroke[] {
    return [
      { id: 'stroke-a', color: '#000000', width: 0.005, points: [[0.5, 0.5]] },
      { id: 'stroke-b', color: '#ef4444', width: 0.005, points: [[0.1, 0.1], [0.9, 0.9]] },
      { id: 'stroke-c', color: '#2563eb', width: 0.005, points: [[0.2, 0.8]] },
    ]
  }

  it('returns the input array by identity and a null removedId on a miss', () => {
    const strokes = makeStrokes()
    const result = applyEraseAt(strokes, 5, 5, page)

    expect(result.removedId).toBeNull()
    // Identity, not just deep equality: the caller uses `removedId !== null` as
    // the sole "the persistent model changed" signal, and a miss must not
    // produce a new array that looks like a change.
    expect(result.strokes).toBe(strokes)
  })

  it('removes only the hit stroke and reports its id on a hit', () => {
    const strokes = makeStrokes()
    const result = applyEraseAt(strokes, 500 + 10, 500, page)

    expect(result.removedId).toBe('stroke-a')
    expect(result.strokes.map((s) => s.id)).toEqual(['stroke-b', 'stroke-c'])
  })

  it('preserves the original relative order of the surviving strokes', () => {
    const strokes = makeStrokes()
    // stroke-b is in the middle; removing it must not reorder a and c.
    const result = applyEraseAt(strokes, 900, 900, page)

    expect(result.removedId).toBe('stroke-b')
    expect(result.strokes.map((s) => s.id)).toEqual(['stroke-a', 'stroke-c'])
  })

  it('returns a new array on a hit and never mutates the input', () => {
    const strokes = makeStrokes()
    const before = [...strokes]
    const result = applyEraseAt(strokes, 500, 500, page)

    expect(result.strokes).not.toBe(strokes)
    expect(strokes).toHaveLength(3)
    expect(strokes).toEqual(before)
  })

  it('chains: feeding one result into a second call at another stroke removes both', () => {
    // The multi-hit fast-drag case — two erase hits inside a single pointer
    // gesture. Each call must apply to the *result* of the previous one, so
    // neither removal resurrects the other.
    const strokes = makeStrokes()
    const first = applyEraseAt(strokes, 500, 500, page)
    const second = applyEraseAt(first.strokes, 200, 800, page)

    expect(first.removedId).toBe('stroke-a')
    expect(second.removedId).toBe('stroke-c')
    expect(second.strokes.map((s) => s.id)).toEqual(['stroke-b'])
    // The original array is still intact after both calls.
    expect(strokes).toHaveLength(3)
  })

  it('honours the same unscaled 16px tolerance as findStrokeToErase', () => {
    const strokes = makeStrokes()
    expect(applyEraseAt(strokes, 500 + ERASE_TOLERANCE_PX, 500, page).removedId).toBe('stroke-a')
    expect(applyEraseAt(strokes, 500 + ERASE_TOLERANCE_PX + 1, 500, page).removedId).toBeNull()
  })

  it('returns the empty input array by identity when there is nothing to erase', () => {
    const empty: Stroke[] = []
    const result = applyEraseAt(empty, 500, 500, page)

    expect(result.removedId).toBeNull()
    expect(result.strokes).toBe(empty)
  })
})

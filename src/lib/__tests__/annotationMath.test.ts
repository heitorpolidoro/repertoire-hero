import { describe, it, expect } from 'vitest'
import {
  normalizePoint,
  denormalizePoint,
  normalizeWidth,
  denormalizeWidth,
  findStrokeToErase,
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

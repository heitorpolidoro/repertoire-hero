/**
 * RH-103 — the drag's arithmetic, without a DOM.
 *
 * `usePlaylistReorderDrag` reads every decision from here, so the gesture's
 * choices — which gap the pointer is over, what the order becomes, whether the
 * release changed anything — are unit-testable against plain numbers. The file
 * needs no `@vitest-environment` line: `src/lib/playlistReorderDrag.ts` touches
 * no DOM API and holds no React.
 */

import { describe, it, expect } from 'vitest'
import {
  edgeScrollStep,
  insertionIndexAt,
  isSameOrder,
  reorderIds,
} from '@/lib/playlistReorderDrag'

/** Three 56px rows starting at y = 100: midpoints 128, 184, 240. */
const MIDPOINTS = [128, 184, 240]

describe('insertionIndexAt', () => {
  it('reports 0 for a pointer above the first row midpoint', () => {
    expect(insertionIndexAt(MIDPOINTS, 100)).toBe(0)
    expect(insertionIndexAt(MIDPOINTS, 127)).toBe(0)
  })

  it('reports the gap between two midpoints', () => {
    expect(insertionIndexAt(MIDPOINTS, 150)).toBe(1)
    expect(insertionIndexAt(MIDPOINTS, 200)).toBe(2)
  })

  it('reports the end of the list below the last midpoint', () => {
    expect(insertionIndexAt(MIDPOINTS, 260)).toBe(3)
  })

  it('counts a pointer exactly on a midpoint as past it', () => {
    expect(insertionIndexAt(MIDPOINTS, 128)).toBe(1)
    expect(insertionIndexAt(MIDPOINTS, 240)).toBe(3)
  })

  it('reports 0 for an empty list', () => {
    expect(insertionIndexAt([], 400)).toBe(0)
  })
})

describe('reorderIds', () => {
  const ids = ['a', 'b', 'c', 'd']

  it('permutes a downward move, the release index being read against the original list', () => {
    expect(reorderIds(ids, 0, 2)).toEqual({ reordered: true, orderedIds: ['b', 'a', 'c', 'd'] })
    expect(reorderIds(ids, 0, 4)).toEqual({ reordered: true, orderedIds: ['b', 'c', 'd', 'a'] })
  })

  it('permutes an upward move', () => {
    expect(reorderIds(ids, 2, 0)).toEqual({ reordered: true, orderedIds: ['c', 'a', 'b', 'd'] })
    expect(reorderIds(ids, 3, 1)).toEqual({ reordered: true, orderedIds: ['a', 'd', 'b', 'c'] })
  })

  it('reports nothing to do when the release index equals the origin index', () => {
    expect(reorderIds(ids, 2, 2)).toEqual({ reordered: false })
  })

  it('reports nothing to do for the gap just below the origin, which is the same place', () => {
    expect(reorderIds(ids, 2, 3)).toEqual({ reordered: false })
  })

  it('reports nothing to do for an origin outside the list', () => {
    expect(reorderIds(ids, -1, 0)).toEqual({ reordered: false })
    expect(reorderIds(ids, 4, 0)).toEqual({ reordered: false })
  })

  it('leaves the source array untouched', () => {
    reorderIds(ids, 0, 3)
    expect(ids).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('isSameOrder', () => {
  it('is true for the same ids in the same places', () => {
    expect(isSameOrder(['a', 'b'], ['a', 'b'])).toBe(true)
  })

  it('is false for a different order and for a different length', () => {
    expect(isSameOrder(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(isSameOrder(['a', 'b'], ['a'])).toBe(false)
  })
})

describe('edgeScrollStep', () => {
  it('scrolls up near the top edge and down near the bottom edge', () => {
    expect(edgeScrollStep(110, 100, 600)).toBeLessThan(0)
    expect(edgeScrollStep(590, 100, 600)).toBeGreaterThan(0)
  })

  it('does not scroll in the middle of the container', () => {
    expect(edgeScrollStep(350, 100, 600)).toBe(0)
  })
})

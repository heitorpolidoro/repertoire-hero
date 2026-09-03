/**
 * RH-23 — `buildUpdateSet` is the shared dynamic `SET` clause builder used by
 * `updateBand` and `updatePlaylist`. The generated SQL text and parameter order
 * must stay byte-identical to the hand-rolled loops it replaced.
 */

import { describe, it, expect } from 'vitest'
import { buildUpdateSet } from '../sqlUpdate'

describe('buildUpdateSet', () => {
  it('emits one clause per provided column, in the declared column order', () => {
    const result = buildUpdateSet(
      { color: 'red', name: 'Bandy', description: 'desc', cover_url: 'http://x' },
      ['name', 'description', 'cover_url', 'color'],
    )

    expect(result.setClauses).toEqual([
      'name = $1',
      'description = $2',
      'cover_url = $3',
      'color = $4',
    ])
    expect(result.values).toEqual(['Bandy', 'desc', 'http://x', 'red'])
    expect(result.nextIndex).toBe(5)
  })

  it('skips undefined fields and numbers the placeholders contiguously', () => {
    const result = buildUpdateSet(
      { name: 'Bandy', description: undefined, cover_url: null, color: undefined },
      ['name', 'description', 'cover_url', 'color'],
    )

    expect(result.setClauses).toEqual(['name = $1', 'cover_url = $2'])
    expect(result.values).toEqual(['Bandy', null])
    expect(result.nextIndex).toBe(3)
  })

  it('keeps null and false as real values (only undefined is skipped)', () => {
    const result = buildUpdateSet(
      { sync_with_spotify: false, tags: [] },
      ['name', 'description', 'sync_with_spotify', 'tags'],
    )

    expect(result.setClauses).toEqual(['sync_with_spotify = $1', 'tags = $2'])
    expect(result.values).toEqual([false, []])
  })

  it('starts numbering at the given startIndex', () => {
    const result = buildUpdateSet({ name: 'Bandy', color: 'blue' }, ['name', 'color'], 4)

    expect(result.setClauses).toEqual(['name = $4', 'color = $5'])
    expect(result.nextIndex).toBe(6)
  })

  it('returns an empty result when nothing is provided', () => {
    expect(buildUpdateSet({}, ['name', 'color'])).toEqual({
      setClauses: [],
      values: [],
      nextIndex: 1,
    })
    expect(buildUpdateSet({}, ['name', 'color'], 7)).toEqual({
      setClauses: [],
      values: [],
      nextIndex: 7,
    })
  })
})

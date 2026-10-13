/**
 * RH-168 - the due order: days since last practised / the level's interval,
 * highest first; exact ties shuffled through the injected source.
 */
import { describe, it, expect } from 'vitest'
import { orderForPractice, PRACTICE_INTERVAL_DAYS, type PracticeCandidate } from '../practiceOrder'

const NOW = Date.parse('2026-06-30T12:00:00.000Z')
const DAY = 86_400_000

function song(id: string, status: PracticeCandidate['status'], daysAgo: number | null): PracticeCandidate {
  return {
    versionId: id,
    title: id,
    artist: null,
    status,
    lastPracticed: daysAgo === null ? null : new Date(NOW - daysAgo * DAY).toISOString(),
  }
}

const ids = (list: PracticeCandidate[]) => list.map((s) => s.versionId)

/** mulberry32: deterministic per seed. */
function seeded(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('PRACTICE_INTERVAL_DAYS', () => {
  it('holds unassessed always due, learning 1, practicing 3, polishing 14, mastered 21', () => {
    expect(PRACTICE_INTERVAL_DAYS).toEqual({
      unknown: null,
      learning: 1,
      practicing: 3,
      polishing: 14,
      mastered: 21,
    })
  })
})

describe('orderForPractice', () => {
  it.each([
    ['learning', 1],
    ['practicing', 3],
    ['polishing', 14],
    ['mastered', 21],
  ] as const)('a %s song is at ratio 1 after %i days', (status, interval) => {
    // At exactly one interval the ratio is 1: it ties with a learning song 1 day old
    // and outranks the same level half an interval ago.
    const result = orderForPractice(
      [song('below', status, interval / 2), song('tie', status, interval), song('ref', 'learning', 1)],
      { now: NOW, random: () => 0 },
    )
    expect(ids(result).slice(0, 2).sort()).toEqual(['ref', 'tie'])
    expect(ids(result)[2]).toBe('below')
  })

  it('ranks unassessed (unknown and a missing status) and never-practised above every finite ratio', () => {
    const result = orderForPractice(
      [
        song('overdue', 'learning', 1000),
        song('never', 'mastered', null),
        song('unknown', 'unknown', 1),
        song('absent', null, 5),
      ],
      { now: NOW, random: () => 0 },
    )
    expect(ids(result)[3]).toBe('overdue')
    expect(ids(result).slice(0, 3).sort()).toEqual(['absent', 'never', 'unknown'])
  })

  it('sorts by days / interval across levels, highest first', () => {
    const result = orderForPractice(
      [
        song('mastered-30d', 'mastered', 30), // 1.43
        song('learning-2d', 'learning', 2), // 2
        song('practicing-3d', 'practicing', 3), // 1
        song('polishing-7d', 'polishing', 7), // 0.5
      ],
      { now: NOW },
    )
    expect(ids(result)).toEqual(['learning-2d', 'mastered-30d', 'practicing-3d', 'polishing-7d'])
  })

  it('uses fractional days', () => {
    const result = orderForPractice([song('a', 'learning', 1.5), song('b', 'learning', 1.6)], { now: NOW })
    expect(ids(result)).toEqual(['b', 'a'])
  })

  it('does not mutate its input', () => {
    const input = [song('a', 'learning', 1), song('b', 'learning', 2)]
    orderForPractice(input, { now: NOW })
    expect(ids(input)).toEqual(['a', 'b'])
  })

  it('returns an empty list for an empty list', () => {
    expect(orderForPractice([], { now: NOW })).toEqual([])
  })

  it('shuffles exact ties through the injected source, deterministically per seed', () => {
    const tied = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => song(id, 'learning', 2))
    const run = (seed: number) => ids(orderForPractice(tied, { now: NOW, random: seeded(seed) }))

    expect(run(1)).toEqual(run(1))
    const orders = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => run(s).join('')))
    expect(orders.size).toBeGreaterThan(1)
    for (const order of orders) expect(order.split('').sort().join('')).toBe('abcdef')
  })

  it('draws from the injected source', () => {
    const tied = ['a', 'b', 'c'].map((id) => song(id, 'unknown', null))
    let calls = 0
    orderForPractice(tied, {
      now: NOW,
      random: () => {
        calls += 1
        return 0
      },
    })
    expect(calls).toBe(2)
  })

  it('shuffles the always-due and never-practised songs together as one tie group', () => {
    const group = [song('u', 'unknown', 3), song('n', 'practicing', null), song('m', null, null)]
    const seen = new Set<string>()
    for (let seed = 1; seed <= 20; seed++) {
      seen.add(ids(orderForPractice(group, { now: NOW, random: seeded(seed) })).join(''))
    }
    expect(seen.size).toBeGreaterThan(2)
  })

  it('keeps ratio order for near-ties under any seed', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const result = orderForPractice(
        [song('seven', 'polishing', 7), song('eight', 'polishing', 8), song('nine', 'polishing', 9)],
        { now: NOW, random: seeded(seed) },
      )
      expect(ids(result)).toEqual(['nine', 'eight', 'seven'])
    }
  })

  it('defaults now and random', () => {
    const result = orderForPractice([
      { versionId: 'y', title: 'y', artist: null, status: 'learning', lastPracticed: new Date().toISOString() },
      {
        versionId: 'x',
        title: 'x',
        artist: null,
        status: 'learning',
        lastPracticed: new Date(Date.now() - 3 * DAY).toISOString(),
      },
    ])
    expect(ids(result)).toEqual(['x', 'y'])
  })

  it('accepts a Date for now', () => {
    const result = orderForPractice([song('a', 'learning', 1), song('b', 'learning', 2)], { now: new Date(NOW) })
    expect(ids(result)).toEqual(['b', 'a'])
  })

  it('treats an unparseable date as never practised', () => {
    const bad: PracticeCandidate = { ...song('bad', 'learning', 0), lastPracticed: 'not a date' }
    expect(ids(orderForPractice([song('ok', 'learning', 100), bad], { now: NOW }))).toEqual(['bad', 'ok'])
  })
})

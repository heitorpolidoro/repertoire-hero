/**
 * RH-113 — `searchSongs` query text and parameters, against a mocked `pg`.
 * The behavior itself is settled in `catalogSearch.db.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({ query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))

import { query } from '@/lib/db'
import { searchSongs } from '../songs'

const mockQuery = vi.mocked(query)

describe('searchSongs query construction (RH-113)', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never)
  })

  it('ER6: a blank query returns [] without touching the database', async () => {
    expect(await searchSongs('   ')).toEqual([])
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('escapes %, _ and backslash in the LIKE pattern and passes the raw text for ranking', async () => {
    await searchSongs(' 50%_a\\b ')
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(params).toEqual(['%50\\%\\_a\\\\b%', '50%_a\\b', '50\\%\\_a\\\\b%'])
    expect(sql).toMatch(/ILIKE \$1/)
    expect(sql).toMatch(/LIMIT 20/)
  })

  it('orders by exact title, title prefix, similarity, title, then id', async () => {
    await searchSongs('love')
    const sql = (mockQuery.mock.calls[0] as [string])[0]
    const order = sql.slice(sql.indexOf('ORDER BY')).replace(/\s+/g, ' ')
    expect(order).toMatch(/lower\(s\.title\) = lower\(\$2\) DESC/)
    expect(order).toMatch(/s\.title ILIKE \$3 DESC/)
    expect(order).toMatch(/GREATEST\(similarity\(s\.title, \$2\), similarity\(s\.artist, \$2\)\) DESC/)
    expect(order).toMatch(/s\.title ASC, s\.id ASC/)
  })

  it('wraps a database failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('boom'))
    await expect(searchSongs('x')).rejects.toThrow('Failed to search global songs: boom')
  })
})

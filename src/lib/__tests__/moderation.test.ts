import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  submitCatalogSuggestion,
  getPendingCatalogSuggestions,
  reviewCatalogSuggestionGroup,
} from '../moderation'
import { query } from '@/lib/db'

vi.mock('@/lib/db', () => {
  const query = vi.fn()
  // RH-36: the transaction runs on a client whose `query` is this same mock, so
  // the per-statement expectations below stay statement-for-statement.
  const withTransaction = (fn: (client: { query: typeof query }) => unknown) => fn({ query })
  return { query, pool: { query: vi.fn() }, withTransaction }
})

/** One stored suggestion row, as the review path reads it back. */
function suggestion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'suggestion-1',
    group_id: 'group-1',
    target_table: 'songs',
    target_id: 'song-1',
    target_column: 'title',
    value: 'New Title (2026 Remaster)',
    reason: null,
    requested_by: 'user-1',
    status: 'pending',
    reviewed_by: null,
    rejection_reason: null,
    created_at: '2026-08-31T12:00:00Z',
    updated_at: '2026-08-31T12:00:00Z',
    ...overrides,
  }
}

describe('moderation domain module', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset()
  })

  describe('submitCatalogSuggestion', () => {
    it('writes one row per proposed column in a single statement', async () => {
      const rows = [
        suggestion({ target_column: 'title', value: 'New Title (2026 Remaster)' }),
        suggestion({ id: 'suggestion-2', target_column: 'artist', value: 'Artist' }),
      ]
      vi.mocked(query).mockResolvedValueOnce({ rowCount: 2, rows } as never)

      const result = await submitCatalogSuggestion('user-1', 'song-1', {
        title: 'New Title (2026 Remaster)',
        artist: 'Artist',
      })

      expect(result).toEqual(rows)
      expect(query).toHaveBeenCalledTimes(1)
      const [sql, params] = vi.mocked(query).mock.calls[0]
      expect(sql).toContain('INSERT INTO catalog_suggestions')
      // One statement, two tuples, one shared group id and one shared reason.
      expect(sql.match(/\(\$1, \$\d+, \$\d+::uuid,/g)).toHaveLength(2)
      expect(params!.slice(1)).toEqual([
        'user-1',
        null,
        'songs',
        'song-1',
        'title',
        '"New Title (2026 Remaster)"',
        'songs',
        'song-1',
        'artist',
        '"Artist"',
      ])
    })

    // RH-138 (ER3) — one row per change, each keyed by the link's own id.
    it('fans a removal and an edit out as song_links rows sharing one group', async () => {
      const removed = '11111111-1111-4111-8111-111111111111'
      const edited = '22222222-2222-4222-8222-222222222222'
      // 1. the membership check, 2. the INSERT
      vi.mocked(query).mockResolvedValueOnce({ rowCount: 2, rows: [{ id: removed }, { id: edited }] } as never)
      vi.mocked(query).mockResolvedValueOnce({ rowCount: 2, rows: [suggestion()] } as never)

      await submitCatalogSuggestion('user-1', 'song-1', {
        linkChanges: [
          { linkId: removed, removed: true, url: 'https://ignored.example/x' },
          { linkId: edited, url: 'https://tabs.example/new' },
        ],
        reason: 'stale links',
      })

      expect(vi.mocked(query).mock.calls[0][1]).toEqual(['song-1', [removed, edited]])
      const [sql, params] = vi.mocked(query).mock.calls[1]
      expect(sql.match(/\(\$1, \$\d+, \$\d+::uuid,/g)).toHaveLength(2)
      expect(params!.slice(1)).toEqual([
        'user-1',
        'stale links',
        'song_links',
        removed,
        'removed',
        'true',
        'song_links',
        edited,
        'url',
        '"https://tabs.example/new"',
      ])
    })

    it('refuses a link that is not a row of the song, writing nothing', async () => {
      vi.mocked(query).mockResolvedValueOnce({ rowCount: 0, rows: [] } as never)
      await expect(
        submitCatalogSuggestion('user-1', 'song-1', {
          linkChanges: [{ linkId: '11111111-1111-4111-8111-111111111111', removed: true }],
        }),
      ).rejects.toThrowError(/^Invalid catalog suggestion: /)
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('refuses malformed link changes before touching the database', async () => {
      const id = '11111111-1111-4111-8111-111111111111'
      const bad: unknown[] = [
        'x',
        [null],
        [{ linkId: 'not-a-uuid', removed: true }],
        [{ linkId: id }],
        [{ linkId: id, position: 3 }],
        [{ linkId: id, removed: true }, { linkId: id, label: 'x' }],
        [{ linkId: id, url: 'ftp://x/y' }],
      ]
      for (const linkChanges of bad) {
        await expect(
          submitCatalogSuggestion('user-1', 'song-1', { linkChanges }),
        ).rejects.toThrowError(/^Invalid catalog suggestion: /)
      }
      expect(query).not.toHaveBeenCalled()
    })

    it('still refuses a submission that proposes nothing at all', async () => {
      await expect(submitCatalogSuggestion('user-1', 'song-1', { linkChanges: [] })).rejects.toThrowError(
        /at least one of/,
      )
      await expect(submitCatalogSuggestion('user-1', 'song-1', { reason: 'x' })).rejects.toThrowError(
        /at least one of/,
      )
    })

    it('carries the submitted reason into the reason column, never as a target_column', async () => {
      vi.mocked(query).mockResolvedValueOnce({ rowCount: 1, rows: [suggestion()] } as never)

      await submitCatalogSuggestion('user-1', 'song-1', { title: 'Plush', reason: 'typo' })

      const [sql, params] = vi.mocked(query).mock.calls[0]
      expect(params![2]).toBe('typo')
      expect(sql.match(/\(\$1, \$\d+, \$\d+::uuid,/g)).toHaveLength(1)
      expect(params).not.toContain('reason')
    })

    it('rejects an invalid payload at submission without touching the database', async () => {
      await expect(
        submitCatalogSuggestion('user-1', 'song-1', { duration_seconds: 'abc' })
      ).rejects.toThrowError(
        new Error('Invalid catalog suggestion: duration_seconds must be a non-negative integer or null')
      )

      expect(query).not.toHaveBeenCalled()
    })

    it('throws error when database query fails during submission', async () => {
      vi.mocked(query).mockRejectedValueOnce(new Error('DB failure'))

      await expect(
        submitCatalogSuggestion('user-1', 'song-1', { title: 'Test' })
      ).rejects.toThrow('Failed to submit a catalog suggestion: DB failure')
    })
  })

  describe('getPendingCatalogSuggestions', () => {
    it('returns the grouped pending cards when the user is a system admin', async () => {
      // 1. Admin permission check query
      vi.mocked(query).mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ is_system_admin: true }],
      } as never)

      const cards = [
        {
          group_id: 'group-1',
          song_id: 'song-1',
          proposed_data: { title: 'New Title' },
          suggestion_ids: { title: 'suggestion-1' },
          reason: null,
          requested_by: 'user-1',
          created_at: '2026-08-31T12:00:00Z',
          song: { id: 'song-1', title: 'Old Title', artist: 'Artist' },
          requester: { id: 'user-1', email: 'user@example.com', full_name: 'User One' },
        },
      ]

      // 2. Grouped projection
      vi.mocked(query).mockResolvedValueOnce({ rowCount: 1, rows: cards } as never)

      const result = await getPendingCatalogSuggestions('admin-1')

      expect(result).toEqual(cards)
      expect(query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('SELECT is_system_admin FROM profiles'),
        ['admin-1']
      )
      // Only `pending` rows are aggregated, and they are aggregated per group.
      expect(query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("WHERE cs.status = 'pending'"),
        []
      )
      expect(query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('jsonb_object_agg(c.target_column, c.value)'),
        []
      )
    })

    it('throws Access denied when user is not a system admin', async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ is_system_admin: false }],
      } as never)

      await expect(getPendingCatalogSuggestions('regular-user')).rejects.toThrow(
        'Access denied: User is not a system admin'
      )
    })

    it('throws Access denied when user profile is not found', async () => {
      vi.mocked(query).mockResolvedValueOnce({ rowCount: 0, rows: [] } as never)

      await expect(getPendingCatalogSuggestions('unknown-user')).rejects.toThrow(
        'Access denied: User is not a system admin'
      )
    })
  })

  describe('reviewCatalogSuggestionGroup', () => {
    /** Queues the admin check, then the group read. */
    function readsGroup(rows: ReturnType<typeof suggestion>[]) {
      vi.mocked(query).mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ is_system_admin: true }],
      } as never)
      vi.mocked(query).mockResolvedValueOnce({ rowCount: rows.length, rows } as never)
    }

    it('throws Access denied when admin user is not system admin', async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ is_system_admin: false }],
      } as never)

      await expect(
        reviewCatalogSuggestionGroup('regular-user', 'group-1', 'approve')
      ).rejects.toThrow('Access denied: User is not a system admin')
    })

    it('throws when the group is not found', async () => {
      readsGroup([])

      await expect(
        reviewCatalogSuggestionGroup('admin-1', 'nonexistent-group', 'approve')
      ).rejects.toThrow('Catalog suggestion group not found')
    })

    it('reads the group with no status filter, so an already-reviewed one says so', async () => {
      readsGroup([suggestion({ status: 'approved' })])

      await expect(
        reviewCatalogSuggestionGroup('admin-1', 'group-1', 'approve')
      ).rejects.toThrow('Catalog suggestion group is already reviewed')

      expect(vi.mocked(query).mock.calls[1][0]).not.toContain("status = 'pending'")
    })

    it('records the rejection on every pending row of the group', async () => {
      readsGroup([suggestion()])

      const rejected = [suggestion({ status: 'rejected', rejection_reason: 'Incorrect metadata' })]
      vi.mocked(query).mockResolvedValueOnce({ rowCount: 1, rows: rejected } as never)

      const result = await reviewCatalogSuggestionGroup(
        'admin-1',
        'group-1',
        'reject',
        { reason: 'Incorrect metadata' }
      )

      expect(result).toEqual(rejected)
      expect(query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining("status = 'rejected'"),
        ['admin-1', 'Incorrect metadata', 'group-1']
      )
    })

    it('applies every approved column in one UPDATE songs, then flips and supersedes', async () => {
      readsGroup([
        suggestion({ target_column: 'title', value: 'Plush (2017 Remaster)' }),
        suggestion({ id: 's2', target_column: 'album', value: 'Core (Super Deluxe Edition)' }),
        suggestion({ id: 's3', target_column: 'artist', value: 'Stone Temple Pilots' }),
        suggestion({ id: 's4', target_column: 'standard_key', value: 'E' }),
      ])

      // 3. UPDATE songs
      vi.mocked(query).mockResolvedValueOnce({ rowCount: 1, rows: [] } as never)
      // 4. flip the group
      const approved = [suggestion({ status: 'approved', reviewed_by: 'admin-1' })]
      vi.mocked(query).mockResolvedValueOnce({ rowCount: 1, rows: approved } as never)
      // 5. supersede the competitors
      vi.mocked(query).mockResolvedValueOnce({ rowCount: 0, rows: [] } as never)

      const result = await reviewCatalogSuggestionGroup('admin-1', 'group-1', 'approve')

      expect(result).toEqual(approved)

      // RH-122 — the normalisers no longer strip: a parenthesised edition is
      // not a `" - "` suffix, so both the title and the album reach the catalog
      // exactly as proposed. What matters here is that **one** statement
      // carries every approved value.
      expect(query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('UPDATE songs'),
        [
          'Plush (2017 Remaster)',
          'Core (Super Deluxe Edition)',
          'Stone Temple Pilots',
          'E',
          'song-1',
        ],
      )
      // The supersede statement runs **after** the approve: run first it would
      // close the rows being approved along with their competitors.
      expect(vi.mocked(query).mock.calls[4][0]).toContain("status = 'superseded'")
      expect(vi.mocked(query).mock.calls[4][1]).toEqual([
        'admin-1',
        'songs',
        'song-1',
        ['title', 'album', 'artist', 'standard_key'],
      ])
    })

    /** A pending link-row suggestion about link `linkId`. */
    function linkRow(id: string, linkId: string, column: string, value: unknown) {
      return suggestion({ id, target_table: 'song_links', target_id: linkId, target_column: column, value })
    }
    const LINK_A = '11111111-1111-4111-8111-111111111111'
    const LINK_B = '22222222-2222-4222-8222-222222222222'
    const SIBLINGS = [
      { id: LINK_A, song_id: 'song-1', url: 'https://x.example/a' },
      { id: LINK_B, song_id: 'song-1', url: 'https://x.example/b' },
    ]

    it('applies a link-only group row by row, then bumps the timestamp bare', async () => {
      readsGroup([linkRow('r1', LINK_A, 'removed', true), linkRow('r2', LINK_B, 'label', 'Chords')])
      // 3. the sibling read
      vi.mocked(query).mockResolvedValueOnce({ rowCount: 2, rows: SIBLINGS } as never)
      // 4. DELETE, 5. UPDATE label, 6. UPDATE songs, 7. flip, 8. supersede
      vi.mocked(query).mockResolvedValue({ rowCount: 1, rows: [] } as never)

      await reviewCatalogSuggestionGroup('admin-1', 'group-1', 'approve')

      const calls = vi.mocked(query).mock.calls
      expect(calls[3]).toEqual(['DELETE FROM song_links WHERE id = $1', [LINK_A]])
      expect(calls[4]).toEqual(['UPDATE song_links SET label = $2 WHERE id = $1', [LINK_B, 'Chords']])
      // No `songs` column: the inline-array form keeps the SET list valid.
      expect(calls[5]).toEqual(['UPDATE songs SET updated_at = now() WHERE id = $1', ['song-1']])
      expect(calls[6][0]).toContain("status = 'approved'")
      expect(calls[7][0]).toContain('unnest($2::uuid[], $3::text[])')
      expect(calls[7][1]).toEqual([
        'admin-1',
        [LINK_A, LINK_A, LINK_A, LINK_B],
        ['url', 'label', 'removed', 'label'],
      ])
      // The array is never replaced and position never named.
      expect(JSON.stringify(calls)).not.toContain('position')
    })

    // ER5 — the rejected row is flipped before the group approve, the rest land.
    it('rejects the named link rows with the reason while approving the rest', async () => {
      readsGroup([linkRow('r1', LINK_A, 'removed', true), linkRow('r2', LINK_B, 'label', 'Chords')])
      vi.mocked(query).mockResolvedValueOnce({ rowCount: 1, rows: [SIBLINGS[1]] } as never)
      vi.mocked(query).mockResolvedValue({ rowCount: 1, rows: [] } as never)

      await reviewCatalogSuggestionGroup('admin-1', 'group-1', 'approve', {
        reason: 'keep it',
        rejectLinkSuggestionIds: ['r1'],
      })

      const calls = vi.mocked(query).mock.calls
      expect(calls[3][0]).toContain('UPDATE song_links SET label')
      expect(JSON.stringify(calls)).not.toContain('DELETE FROM song_links')
      const reject = calls.find(([sql]) => sql.includes("status = 'rejected'") && sql.includes('ANY($4::uuid[])'))
      expect(reject![1]).toEqual(['admin-1', 'keep it', 'group-1', ['r1']])
      const rejectIndex = calls.indexOf(reject!)
      const approveIndex = calls.findIndex(([sql]) => sql.includes("status = 'approved'"))
      expect(rejectIndex).toBeLessThan(approveIndex)
    })

    it('refuses a rejected id that is not a link row of the group', async () => {
      readsGroup([linkRow('r1', LINK_A, 'removed', true), suggestion({ id: 'col-1' })])
      await expect(
        reviewCatalogSuggestionGroup('admin-1', 'group-1', 'approve', {
          rejectLinkSuggestionIds: ['col-1'],
        }),
      ).rejects.toThrowError(/^Invalid catalog suggestion: /)
      expect(query).toHaveBeenCalledTimes(2)
    })

    // ER6 — the collision is refused with nothing written.
    it('refuses an approved url edit that collides with a sibling, before any write', async () => {
      readsGroup([linkRow('r1', LINK_A, 'url', 'https://x.example/b')])
      vi.mocked(query).mockResolvedValueOnce({ rowCount: 2, rows: SIBLINGS } as never)

      await expect(reviewCatalogSuggestionGroup('admin-1', 'group-1', 'approve')).rejects.toThrowError(
        /^Invalid catalog suggestion: /,
      )
      // admin check, group read, sibling read: no write was issued.
      expect(query).toHaveBeenCalledTimes(3)
    })

    it('rejects a stored value that no longer validates before updating songs', async () => {
      readsGroup([suggestion({ target_column: 'duration_seconds', value: 'abc' })])

      await expect(
        reviewCatalogSuggestionGroup('admin-1', 'group-1', 'approve')
      ).rejects.toThrowError(
        new Error('Invalid catalog suggestion: duration_seconds must be a non-negative integer or null')
      )

      // Only the admin check and the group read ran: no UPDATE was issued, and
      // the transaction was never opened.
      expect(query).toHaveBeenCalledTimes(2)
    })
  })
})

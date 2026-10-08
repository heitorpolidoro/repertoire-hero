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
      expect(sql.match(/\(\$1, 'songs', \$2,/g)).toHaveLength(2)
      expect(params!.slice(1)).toEqual([
        'song-1',
        'user-1',
        null,
        'title',
        '"New Title (2026 Remaster)"',
        'artist',
        '"Artist"',
      ])
    })

    it('carries the submitted reason into the reason column, never as a target_column', async () => {
      vi.mocked(query).mockResolvedValueOnce({ rowCount: 1, rows: [suggestion()] } as never)

      await submitCatalogSuggestion('user-1', 'song-1', { title: 'Plush', reason: 'typo' })

      const [sql, params] = vi.mocked(query).mock.calls[0]
      expect(params![3]).toBe('typo')
      expect(sql.match(/\(\$1, 'songs', \$2,/g)).toHaveLength(1)
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
        expect.stringContaining("WHERE c.status = 'pending'"),
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
        'Incorrect metadata'
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

    it('issues the bare timestamp bump for a group whose only column is links', async () => {
      readsGroup([
        suggestion({
          target_column: 'links',
          value: [{ label: 'Chords', url: 'https://tabs.example/1' }],
        }),
      ])

      // 3. UPDATE songs — no proposed-column clause at all
      vi.mocked(query).mockResolvedValueOnce({ rowCount: 1, rows: [] } as never)
      // 4. the replace-set's DELETE, 5. its INSERT
      vi.mocked(query).mockResolvedValueOnce({ rowCount: 0, rows: [] } as never)
      vi.mocked(query).mockResolvedValueOnce({ rowCount: 1, rows: [] } as never)
      // 6. flip, 7. supersede
      vi.mocked(query).mockResolvedValueOnce({
        rowCount: 1,
        rows: [suggestion({ status: 'approved' })],
      } as never)
      vi.mocked(query).mockResolvedValueOnce({ rowCount: 0, rows: [] } as never)

      await reviewCatalogSuggestionGroup('admin-1', 'group-1', 'approve')

      // The clause list is empty once `links` is partitioned out. Any shape but
      // the inline-array one renders `SET , updated_at = now()` and raises
      // 42601; `songs.links` is never named at all.
      expect(vi.mocked(query).mock.calls[2][0]).toBe(
        'UPDATE songs SET updated_at = now() WHERE id = $1',
      )
      expect(vi.mocked(query).mock.calls[2][1]).toEqual(['song-1'])
      expect(vi.mocked(query).mock.calls[3][0]).toContain('DELETE FROM song_links')
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

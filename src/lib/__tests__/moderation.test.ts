import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  submitSongEdit,
  getPendingSongEdits,
  reviewSongEdit,
} from '../moderation'
import { query } from '@/lib/db'

vi.mock('@/lib/db', () => {
  const query = vi.fn()
  // RH-36: the transaction runs on a client whose `query` is this same mock, so
  // the per-statement expectations below stay statement-for-statement.
  const withTransaction = (fn: (client: { query: typeof query }) => unknown) => fn({ query })
  return { query, pool: { query: vi.fn() }, withTransaction }
})

describe('moderation domain module', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset()
  })

  describe('submitSongEdit', () => {
    it('successfully submits a pending global song edit request', async () => {
      const mockEdit = {
        id: 'edit-1',
        song_id: 'song-1',
        requested_by: 'user-1',
        proposed_data: { title: 'New Title (2026 Remaster)', artist: 'Artist' },
        status: 'pending',
        reviewed_by: null,
        rejection_reason: null,
        created_at: '2026-08-31T12:00:00Z',
        updated_at: '2026-08-31T12:00:00Z',
      }

      vi.mocked(query).mockResolvedValueOnce({
        rowCount: 1,
        rows: [mockEdit],
      } as any)

      const result = await submitSongEdit('user-1', 'song-1', {
        title: 'New Title (2026 Remaster)',
        artist: 'Artist',
      })

      expect(result).toEqual(mockEdit)
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO global_song_edits'),
        ['song-1', 'user-1', JSON.stringify({ title: 'New Title (2026 Remaster)', artist: 'Artist' })]
      )
    })

    it('rejects an invalid payload at submission without touching the database', async () => {
      await expect(
        submitSongEdit('user-1', 'song-1', { duration_seconds: 'abc' })
      ).rejects.toThrowError(new Error('Invalid global song edit: duration_seconds must be a non-negative integer or null'))

      expect(query).not.toHaveBeenCalled()
    })

    it('throws error when database query fails during submission', async () => {
      vi.mocked(query).mockRejectedValueOnce(new Error('DB failure'))

      await expect(
        submitSongEdit('user-1', 'song-1', { title: 'Test' })
      ).rejects.toThrow('Failed to submit global song edit: DB failure')
    })
  })

  describe('getPendingSongEdits', () => {
    it('returns pending edits when user is a system admin', async () => {
      // 1. Admin permission check query
      vi.mocked(query).mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ is_system_admin: true }],
      } as any)

      const mockEdits = [
        {
          id: 'edit-1',
          song_id: 'song-1',
          requested_by: 'user-1',
          proposed_data: { title: 'New Title' },
          status: 'pending',
          reviewed_by: null,
          rejection_reason: null,
          created_at: '2026-08-31T12:00:00Z',
          updated_at: '2026-08-31T12:00:00Z',
          song: { id: 'song-1', title: 'Old Title', artist: 'Artist' },
          requester: { id: 'user-1', email: 'user@example.com', full_name: 'User One' },
        },
      ]

      // 2. Fetch pending edits query
      vi.mocked(query).mockResolvedValueOnce({
        rowCount: 1,
        rows: mockEdits,
      } as any)

      const result = await getPendingSongEdits('admin-1')

      expect(result).toEqual(mockEdits)
      expect(query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('SELECT is_system_admin FROM profiles'),
        ['admin-1']
      )
      expect(query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('WHERE e.status = \'pending\''),
        []
      )
    })

    it('throws Access denied when user is not a system admin', async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ is_system_admin: false }],
      } as any)

      await expect(getPendingSongEdits('regular-user')).rejects.toThrow(
        'Access denied: User is not a system admin'
      )
    })

    it('throws Access denied when user profile is not found', async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rowCount: 0,
        rows: [],
      } as any)

      await expect(getPendingSongEdits('unknown-user')).rejects.toThrow(
        'Access denied: User is not a system admin'
      )
    })
  })

  describe('reviewSongEdit', () => {
    it('throws Access denied when admin user is not system admin', async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ is_system_admin: false }],
      } as any)

      await expect(
        reviewSongEdit('regular-user', 'edit-1', 'approve')
      ).rejects.toThrow('Access denied: User is not a system admin')
    })

    it('throws error when edit request is not found', async () => {
      // 1. Admin check
      vi.mocked(query).mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ is_system_admin: true }],
      } as any)

      // 2. Edit lookup
      vi.mocked(query).mockResolvedValueOnce({
        rowCount: 0,
        rows: [],
      } as any)

      await expect(
        reviewSongEdit('admin-1', 'nonexistent-edit', 'approve')
      ).rejects.toThrow('Global song edit not found')
    })

    it('throws error when edit request is already reviewed', async () => {
      // 1. Admin check
      vi.mocked(query).mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ is_system_admin: true }],
      } as any)

      // 2. Edit lookup
      vi.mocked(query).mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 'edit-1', status: 'approved' }],
      } as any)

      await expect(
        reviewSongEdit('admin-1', 'edit-1', 'approve')
      ).rejects.toThrow('Edit request is already reviewed')
    })

    it('successfully rejects an edit request with a reason', async () => {
      // 1. Admin check
      vi.mocked(query).mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ is_system_admin: true }],
      } as any)

      // 2. Edit lookup
      vi.mocked(query).mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 'edit-1',
            song_id: 'song-1',
            requested_by: 'user-1',
            proposed_data: { title: 'Bad Title' },
            status: 'pending',
          },
        ],
      } as any)

      const rejectedEdit = {
        id: 'edit-1',
        song_id: 'song-1',
        requested_by: 'user-1',
        proposed_data: { title: 'Bad Title' },
        status: 'rejected',
        reviewed_by: 'admin-1',
        rejection_reason: 'Incorrect metadata',
        created_at: '2026-08-31T12:00:00Z',
        updated_at: '2026-08-31T12:05:00Z',
      }

      // 3. Update edit status query
      vi.mocked(query).mockResolvedValueOnce({
        rowCount: 1,
        rows: [rejectedEdit],
      } as any)

      const result = await reviewSongEdit('admin-1', 'edit-1', 'reject', 'Incorrect metadata')

      expect(result).toEqual(rejectedEdit)
      expect(query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining("status = 'rejected'"),
        ['admin-1', 'Incorrect metadata', 'edit-1']
      )
    })

    it('successfully approves an edit request and applies sanitized changes to songs', async () => {
      // 1. Admin check
      vi.mocked(query).mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ is_system_admin: true }],
      } as any)

      // 2. Edit lookup
      vi.mocked(query).mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 'edit-1',
            song_id: 'song-1',
            requested_by: 'user-1',
            proposed_data: {
              title: 'Plush (2017 Remaster)',
              album: 'Core (Super Deluxe Edition)',
              artist: 'Stone Temple Pilots',
              standard_key: 'E',
            },
            status: 'pending',
          },
        ],
      } as any)

      // Transaction statements (RH-36: no BEGIN/COMMIT through the mock any
      // more — `withTransaction` owns them on its own client):
      // 3. UPDATE songs
      vi.mocked(query).mockResolvedValueOnce({ rowCount: 1, rows: [] } as any)

      const approvedEdit = {
        id: 'edit-1',
        song_id: 'song-1',
        requested_by: 'user-1',
        proposed_data: {
          title: 'Plush (2017 Remaster)',
          album: 'Core (Super Deluxe Edition)',
          artist: 'Stone Temple Pilots',
          standard_key: 'E',
        },
        status: 'approved',
        reviewed_by: 'admin-1',
        rejection_reason: null,
        created_at: '2026-08-31T12:00:00Z',
        updated_at: '2026-08-31T12:05:00Z',
      }

      // 4. UPDATE global_song_edits
      vi.mocked(query).mockResolvedValueOnce({ rowCount: 1, rows: [approvedEdit] } as any)

      const result = await reviewSongEdit('admin-1', 'edit-1', 'approve')

      expect(result).toEqual(approvedEdit)

      // Check title was sanitized to 'Plush' and album to 'Core' in songs update query
      expect(query).toHaveBeenNthCalledWith(3, expect.stringContaining('UPDATE songs'), expect.arrayContaining(['Plush', 'Core', 'Stone Temple Pilots', 'E', 'song-1']))
    })

    it('rejects a historical proposed_data that no longer validates before updating songs', async () => {
      // 1. Admin check
      vi.mocked(query).mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ is_system_admin: true }],
      } as any)

      // 2. Edit lookup — the row was written before the payload was validated.
      vi.mocked(query).mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 'edit-1',
            song_id: 'song-1',
            requested_by: 'user-1',
            proposed_data: { duration_seconds: 'abc' },
            status: 'pending',
          },
        ],
      } as any)

      await expect(
        reviewSongEdit('admin-1', 'edit-1', 'approve')
      ).rejects.toThrowError(new Error('Invalid global song edit: duration_seconds must be a non-negative integer or null'))

      // Only the admin check and the edit lookup ran: no UPDATE was issued.
      expect(query).toHaveBeenCalledTimes(2)
    })
  })
})

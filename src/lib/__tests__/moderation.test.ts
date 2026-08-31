import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  submitGlobalSongEdit,
  getPendingGlobalSongEdits,
  reviewGlobalSongEdit,
} from '../moderation'
import { query } from '@/lib/db'

vi.mock('@/lib/db', () => {
  return {
    query: vi.fn(),
    pool: {
      query: vi.fn(),
    },
  }
})

describe('moderation domain module', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset()
  })

  describe('submitGlobalSongEdit', () => {
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

      const result = await submitGlobalSongEdit('user-1', 'song-1', {
        title: 'New Title (2026 Remaster)',
        artist: 'Artist',
      })

      expect(result).toEqual(mockEdit)
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO global_song_edits'),
        ['song-1', 'user-1', JSON.stringify({ title: 'New Title (2026 Remaster)', artist: 'Artist' })]
      )
    })

    it('throws error when database query fails during submission', async () => {
      vi.mocked(query).mockRejectedValueOnce(new Error('DB failure'))

      await expect(
        submitGlobalSongEdit('user-1', 'song-1', { title: 'Test' })
      ).rejects.toThrow('Failed to submit global song edit: DB failure')
    })
  })

  describe('getPendingGlobalSongEdits', () => {
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

      const result = await getPendingGlobalSongEdits('admin-1')

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

      await expect(getPendingGlobalSongEdits('regular-user')).rejects.toThrow(
        'Access denied: User is not a system admin'
      )
    })

    it('throws Access denied when user profile is not found', async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rowCount: 0,
        rows: [],
      } as any)

      await expect(getPendingGlobalSongEdits('unknown-user')).rejects.toThrow(
        'Access denied: User is not a system admin'
      )
    })
  })

  describe('reviewGlobalSongEdit', () => {
    it('throws Access denied when admin user is not system admin', async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ is_system_admin: false }],
      } as any)

      await expect(
        reviewGlobalSongEdit('regular-user', 'edit-1', 'approve')
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
        reviewGlobalSongEdit('admin-1', 'nonexistent-edit', 'approve')
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
        reviewGlobalSongEdit('admin-1', 'edit-1', 'approve')
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

      const result = await reviewGlobalSongEdit('admin-1', 'edit-1', 'reject', 'Incorrect metadata')

      expect(result).toEqual(rejectedEdit)
      expect(query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining("status = 'rejected'"),
        ['admin-1', 'Incorrect metadata', 'edit-1']
      )
    })

    it('successfully approves an edit request and applies sanitized changes to global_songs', async () => {
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

      // Transaction queries:
      // 3. BEGIN
      vi.mocked(query).mockResolvedValueOnce({} as any)
      // 4. UPDATE global_songs
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

      // 5. UPDATE global_song_edits
      vi.mocked(query).mockResolvedValueOnce({ rowCount: 1, rows: [approvedEdit] } as any)
      // 6. COMMIT
      vi.mocked(query).mockResolvedValueOnce({} as any)

      const result = await reviewGlobalSongEdit('admin-1', 'edit-1', 'approve')

      expect(result).toEqual(approvedEdit)

      // Check title was sanitized to 'Plush' and album to 'Core' in global_songs update query
      expect(query).toHaveBeenNthCalledWith(4, expect.stringContaining('UPDATE global_songs'), expect.arrayContaining(['Plush', 'Core', 'Stone Temple Pilots', 'E', 'song-1']))
    })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPlaylist, addSongToPlaylist } from '../playlists'
import { getProfile, updateProfile } from '../profile'
import {
  addSongToRepertoire,
  createAndAddSong,
  updateSongStatus,
  updateSongTags,
  updatePersonalKey,
  removeSongFromRepertoire,
  updateSong,
} from '../songs'
import { getBands, getBandPlaylists } from '../bands'
import { query } from '@/lib/db'

// Mock the db module
vi.mock('@/lib/db', () => {
  return {
    query: vi.fn(),
    pool: {
      query: vi.fn(),
    },
  }
})

// Standard mock error
const mockError = new Error('Mocked Database Error')

let mockCount: number | null = null
let mockSelectError: any = null
let mockInsertError: any = null
let mockData: any = null
let failRepertoireUpdate = false
let playlistsReturnBandId = false

beforeEach(() => {
  mockCount = null
  mockSelectError = null
  mockInsertError = null
  mockData = null
  failRepertoireUpdate = false
  playlistsReturnBandId = false

  vi.mocked(query).mockReset()
  vi.mocked(query).mockImplementation(async (sql: string, params?: any[]) => {
    const normalizedSql = sql.toLowerCase()

    // Support transaction commands without throwing
    if (
      normalizedSql.trim() === 'begin' ||
      normalizedSql.trim() === 'commit' ||
      normalizedSql.trim() === 'rollback'
    ) {
      return { rowCount: 0, rows: [] }
    }

    if (mockSelectError) {
      throw mockSelectError
    }

    // 1. playlists lookup
    if (normalizedSql.includes('from playlists')) {
      if (normalizedSql.includes('band_id =') || normalizedSql.includes('band_id = $')) {
        return { rowCount: mockData ? mockData.length : 0, rows: mockData || [] }
      }
      return {
        rowCount: 1,
        rows: [{ user_id: 'mock-user-id', band_id: playlistsReturnBandId ? 'band-id' : null }],
      }
    }

    // 2. repertoire lookup/check
    if (normalizedSql.includes('from repertoire')) {
      // Return 1 row so it skips repertoire insert by default, or empty if mockData is []
      if (mockData && mockData.length === 0) {
        return { rowCount: 0, rows: [] }
      }
      return { rowCount: 1, rows: [{ id: 'repertoire-id' }] }
    }

    // 3. playlist_songs count
    if (normalizedSql.includes('count(*) as count from playlist_songs')) {
      return { rowCount: 1, rows: [{ count: mockCount ?? 0 }] }
    }

    // 4. insert into playlist_songs
    if (normalizedSql.includes('insert into playlist_songs')) {
      return { rowCount: 1, rows: [{ id: 'playlist-song-id' }] }
    }

    // 5. profiles / getProfile
    if (normalizedSql.includes('from profiles')) {
      return { rowCount: mockData ? 1 : 0, rows: mockData ? [mockData] : [] }
    }

    // 6. global_songs lookup
    if (normalizedSql.includes('from global_songs')) {
      return { rowCount: 0, rows: [] }
    }

    // 7. insert into global_songs
    if (normalizedSql.includes('insert into global_songs')) {
      if (mockInsertError) {
        throw mockInsertError
      }
      return { rowCount: 1, rows: [{ id: 'global-song-id' }] }
    }

    // 8. update repertoire
    if (normalizedSql.includes('update repertoire')) {
      if (failRepertoireUpdate) {
        throw mockError
      }
      return { rowCount: mockData ? mockData.length : 0, rows: mockData || [] }
    }

    // 9. update global_songs
    if (normalizedSql.includes('update global_songs')) {
      return { rowCount: 1, rows: [{ id: 'global-song-id' }] }
    }

    // 10. getBands / getBandPlaylists
    if (normalizedSql.includes('from bands') || normalizedSql.includes('from band_members')) {
      return { rowCount: mockData ? mockData.length : 0, rows: mockData || [] }
    }

    // Default: throw mockError or return empty
    return { rowCount: 0, rows: [] }
  })
})

describe('Supabase Edge Cases', () => {
  describe('playlists.ts edge cases', () => {
    it('addSongToPlaylist handles null count in playlist_songs', async () => {
      mockCount = null
      await expect(addSongToPlaylist('mock-user-id', '1', '2')).resolves.not.toThrow()
    })
  })

  describe('profile.ts edge cases', () => {
    it('getProfile returns null if row not found (PGRST116)', async () => {
      mockSelectError = null
      const profile = await getProfile('mock-user-id')
      expect(profile).toBeNull()
    })
  })

  describe('songs.ts edge cases', () => {
    it('createAndAddSong throws on global song insertion error', async () => {
      mockInsertError = mockError
      await expect(createAndAddSong({ userId: 'mock-user-id' }, { title: 'Song', artist: 'Artist' })).rejects.toThrow('Failed to create and add song: Mocked Database Error')
    })

    it('updateSongStatus throws not found if data is empty', async () => {
      mockData = []
      await expect(updateSongStatus({ userId: 'mock-user-id' }, '1', 'mastered')).rejects.toThrow('Repertoire entry not found or access denied')
    })

    it('updateSongTags throws not found if data is empty', async () => {
      mockData = []
      await expect(updateSongTags({ userId: 'mock-user-id' }, '1', ['tag'])).rejects.toThrow('Repertoire entry not found or access denied')
    })

    it('updatePersonalKey throws not found if data is empty', async () => {
      mockData = []
      await expect(updatePersonalKey({ userId: 'mock-user-id' }, '1', 'Am')).rejects.toThrow('Repertoire entry not found or access denied')
    })

    it('removeSongFromRepertoire throws not found if data is empty', async () => {
      mockData = []
      await expect(removeSongFromRepertoire({ userId: 'mock-user-id' }, '1')).rejects.toThrow('Repertoire entry not found or access denied')
    })

    it('updateSong throws if repertoire update fails but global_songs update succeeds', async () => {
      mockData = []
      failRepertoireUpdate = true

      const mockEntry: any = { id: 'rep-id', song_id: 'song-id' }
      const mockUpdateData: any = {
        title: 'New Title',
        artist: 'New Artist',
        tags: [],
        links: [],
        key: 'C',
        status: 'learning' as const,
      }

      await expect(updateSong({ userId: 'mock-user-id' }, mockEntry, mockUpdateData)).rejects.toThrow('Failed to update song: Mocked Database Error')
    })
  })

  describe('bands.ts edge cases (100% branches)', () => {
    it('getBands returns empty list if data is null', async () => {
      mockData = null
      const bands = await getBands('mock-user-id')
      expect(bands).toEqual([])
    })

    it('getBandPlaylists returns empty list if data is null', async () => {
      mockData = null
      const playlists = await getBandPlaylists('1')
      expect(playlists).toEqual([])
    })
  })
})

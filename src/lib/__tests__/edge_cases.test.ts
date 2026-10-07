import { describe, it, expect, vi, beforeEach } from 'vitest'
import { addSongToPlaylist } from '../playlists'
import { getProfile } from '../profile'
import {
  createAndAddSong,
  updateSongStatus,
  updateSongTags,
  updateSongKey,
  removeSongFromRepertoire,
  updateSong,
} from '../ownerSongs'
import { getBands, getBandPlaylists } from '../bands'
import { query } from '@/lib/db'

// Mock the db module
vi.mock('@/lib/db', () => {
  const query = vi.fn()
  return {
    query,
    pool: {
      query: vi.fn(),
    },
    // RH-36: the transaction runs on a client whose `query` is the same mock,
    // so the dispatcher below still sees every statement of a wrapped write.
    withTransaction: (fn: (client: { query: typeof query }) => unknown) => fn({ query }),
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

/**
 * The two `SELECT ... FROM songs` reads the mocked layer has to tell
 * apart. `resolveOrCreateSongIdentity` looks a song up and must miss, so the
 * insert path runs; `updateSong` reads the row it may fill `FOR UPDATE` and
 * must hit, with every column empty so the fill/refuse split (RH-97) leaves
 * the owner-row UPDATE as the only failure under test.
 */
const songsSelect = (normalizedSql: string) => {
  if (!normalizedSql.includes('for update')) return { rowCount: 0, rows: [] }
  return {
    rowCount: 1,
    rows: [
      {
        id: 'song-id',
        title: '',
        artist: '',
        album: null,
        standard_key: null,
        cover_url: null,
        duration_seconds: null,
        links: [],
      },
    ],
  }
}

beforeEach(() => {
  mockCount = null
  mockSelectError = null
  mockInsertError = null
  mockData = null
  failRepertoireUpdate = false
  playlistsReturnBandId = false

  vi.mocked(query).mockReset()
  vi.mocked(query).mockImplementation(async (sql: string) => {
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

    // 2. owner-row lookup/check — `user_songs` / `band_songs` since RH-124.
    // One pattern, not two branches: this dispatcher is pinned at its current
    // worst complexity by the F20 ratchet and may not grow.
    if (/from (user|band)_songs/.test(normalizedSql)) {
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

    // 6. songs lookup (see `songsSelect` — the FOR UPDATE read
    // RH-97 added is dispatched there, so this function's complexity, pinned
    // by the F20 ratchet at its current worst, does not grow).
    if (normalizedSql.includes('from songs')) {
      return songsSelect(normalizedSql)
    }

    // 7. insert into songs
    if (normalizedSql.includes('insert into songs')) {
      if (mockInsertError) {
        throw mockInsertError
      }
      return { rowCount: 1, rows: [{ id: 'global-song-id' }] }
    }

    // 8. the owner-row UPDATE
    if (/update (user|band)_songs/.test(normalizedSql)) {
      if (failRepertoireUpdate) {
        throw mockError
      }
      return { rowCount: mockData ? mockData.length : 0, rows: mockData || [] }
    }

    // 9. update songs
    if (normalizedSql.includes('update songs')) {
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

describe('Data Layer Edge Cases', () => {
  describe('playlists.ts edge cases', () => {
    it('addSongToPlaylist handles null count in playlist_songs', async () => {
      mockCount = null
      await expect(addSongToPlaylist('1', 'mock-user-id', '2')).resolves.not.toThrow()
    })
  })

  describe('profile.ts edge cases', () => {
    it('getProfile returns null if row not found (PGRST116)', async () => {
      mockSelectError = null
      const profile = await getProfile('mock-user-id')
      expect(profile).toBeNull()
    })
  })

  describe('ownerSongs.ts edge cases', () => {
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

    it('updateSongKey throws not found if data is empty', async () => {
      mockData = []
      await expect(updateSongKey({ userId: 'mock-user-id' }, '1', 'Am')).rejects.toThrow('Repertoire entry not found or access denied')
    })

    it('removeSongFromRepertoire throws not found if data is empty', async () => {
      mockData = []
      await expect(removeSongFromRepertoire({ userId: 'mock-user-id' }, '1')).rejects.toThrow('Repertoire entry not found or access denied')
    })

    it('updateSong throws if the owner-row update fails but the songs update succeeds', async () => {
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
      const playlists = await getBandPlaylists('1', 'mock-user-id')
      expect(playlists).toEqual([])
    })
  })
})

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

// Standard mock error
const mockError = { message: 'Mocked Database Error', code: 'MOCK_ERROR' }

let mockUser: any = { id: 'mock-user-id' }
let mockCount: number | null = null
let mockSelectError: any = null
let mockInsertError: any = null
let mockData: any = null
let failRepertoireUpdate = false

const createChainableMock = () => {
  let currentTable = ''

  const mock: any = {
    auth: {
      getUser: () => Promise.resolve({ data: { user: mockUser }, error: null }),
      updateUser: () => Promise.resolve({ data: {}, error: mockError }),
    },
    from: (table: string) => {
      currentTable = table
      return mock
    },
    select: (columns: string, options?: any) => {
      if (options?.count === 'exact') {
        return {
          eq: () => Promise.resolve({ count: mockCount, error: null }),
        }
      }
      return mock
    },
    order: () => mock,
    eq: () => mock,
    single: () => {
      if (mockSelectError) {
        return Promise.resolve({ data: null, error: mockSelectError })
      }
      if (currentTable === 'global_songs') {
        if (mockInsertError) {
          return Promise.resolve({ data: null, error: mockInsertError })
        }
        return Promise.resolve({ data: { id: 'global-song-id' }, error: null })
      }
      return Promise.resolve({ data: { id: 'repertoire-id' }, error: null })
    },
    insert: () => mock,
    update: () => mock,
    delete: () => mock,
    limit: () => mock,
    ilike: () => mock,
    or: () => mock,
    maybeSingle: () => {
      if (currentTable === 'global_songs') {
        return Promise.resolve({ data: null, error: null }) // no existing song
      }
      if (currentTable === 'repertoire') {
        return Promise.resolve({ data: null, error: null }) // no existing entry
      }
      return Promise.resolve({ data: null, error: null })
    },
    then: (resolve: any) => {
      if (currentTable === 'global_songs') {
        resolve({ data: mockData, error: null, count: null })
      } else if (currentTable === 'repertoire' && failRepertoireUpdate) {
        resolve({ data: null, error: mockError, count: null })
      } else {
        resolve({ data: mockData, error: mockSelectError, count: null })
      }
    },
  }
  return mock
}

const mockClient = createChainableMock()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => mockClient,
}))

describe('Supabase Edge Cases', () => {
  beforeEach(() => {
    mockUser = { id: 'mock-user-id' }
    mockCount = null
    mockSelectError = null
    mockInsertError = null
    mockData = null
    failRepertoireUpdate = false
  })

  describe('playlists.ts edge cases', () => {
    it('createPlaylist throws if user is not authenticated', async () => {
      mockUser = null
      await expect(createPlaylist({ name: 'Test' })).rejects.toThrow('Cannot create playlist: user is not authenticated')
    })

    it('addSongToPlaylist handles null count in playlist_songs', async () => {
      mockCount = null
      // We expect it to succeed with count defaulting to 0, and then trying to insert (which will succeed in mock)
      await expect(addSongToPlaylist('1', '2')).resolves.not.toThrow()
    })
  })

  describe('profile.ts edge cases', () => {
    it('getProfile returns null if user is not authenticated', async () => {
      mockUser = null
      const profile = await getProfile()
      expect(profile).toBeNull()
    })

    it('getProfile returns null if row not found (PGRST116)', async () => {
      mockSelectError = { message: 'Row not found', code: 'PGRST116' }
      const profile = await getProfile()
      expect(profile).toBeNull()
    })

    it('updateProfile throws if user is not authenticated', async () => {
      mockUser = null
      await expect(updateProfile({ full_name: 'Test' })).rejects.toThrow('Not authenticated')
    })
  })

  describe('songs.ts edge cases', () => {
    it('addSongToRepertoire throws if user is not authenticated', async () => {
      mockUser = null
      await expect(addSongToRepertoire('1')).rejects.toThrow('Cannot add song: user is not authenticated')
    })

    it('createAndAddSong throws if user is not authenticated', async () => {
      mockUser = null
      await expect(createAndAddSong({ title: 'Song', artist: 'Artist' })).rejects.toThrow('Cannot create a song: user is not authenticated')
    })

    it('createAndAddSong throws on global song insertion error', async () => {
      mockInsertError = mockError
      await expect(createAndAddSong({ title: 'Song', artist: 'Artist' })).rejects.toThrow('Failed to create global song: Mocked Database Error')
    })

    it('updateSongStatus throws not found if data is empty', async () => {
      mockData = []
      await expect(updateSongStatus('1', 'mastered')).rejects.toThrow('Repertoire entry not found or access denied')
    })

    it('updateSongTags throws not found if data is empty', async () => {
      mockData = []
      await expect(updateSongTags('1', ['tag'])).rejects.toThrow('Repertoire entry not found or access denied')
    })

    it('updatePersonalKey throws not found if data is empty', async () => {
      mockData = []
      await expect(updatePersonalKey('1', 'Am')).rejects.toThrow('Repertoire entry not found or access denied')
    })

    it('removeSongFromRepertoire throws not found if data is empty', async () => {
      mockData = []
      await expect(removeSongFromRepertoire('1')).rejects.toThrow('Repertoire entry not found or access denied')
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

      await expect(updateSong(mockEntry, mockUpdateData)).rejects.toThrow('Failed to update repertoire entry: Mocked Database Error')
    })
  })

  describe('bands.ts edge cases (100% branches)', () => {
    it('getBands returns empty list if data is null', async () => {
      mockData = null
      const bands = await getBands()
      expect(bands).toEqual([])
    })

    it('getBandPlaylists returns empty list if data is null', async () => {
      mockData = null
      const playlists = await getBandPlaylists('1')
      expect(playlists).toEqual([])
    })
  })
})

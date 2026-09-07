import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth-session', () => ({
  getRequiredUserId: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  pool: { query: vi.fn() },
}))

vi.mock('@/lib/playlists', () => ({
  getUserPlaylists: vi.fn(),
  createPlaylist: vi.fn(),
  updatePlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  addSongToPlaylist: vi.fn(),
  removeSongFromPlaylist: vi.fn(),
  getPlaylistWithSongs: vi.fn(),
  assertPlaylistAccess: vi.fn(),
}))

vi.mock('@/lib/bands', () => ({
  assertBandMember: vi.fn(),
}))

import {
  getUserPlaylistsAction,
  createPlaylistAction,
  updatePlaylistAction,
  deletePlaylistAction,
  addSongToPlaylistAction,
  removeSongFromPlaylistAction,
  getPlaylistWithSongsAction,
  getPlaylistDetailsWithEntriesAction,
  getPlaylistEntryIdsAction,
} from '../playlists'
import { getRequiredUserId } from '@/lib/auth-session'
import { query } from '@/lib/db'
import {
  getUserPlaylists,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  addSongToPlaylist,
  removeSongFromPlaylist,
  getPlaylistWithSongs,
  assertPlaylistAccess,
} from '@/lib/playlists'
import { assertBandMember } from '@/lib/bands'

const USER_ID = 'user-1'
const BAND_ID = 'band-1'
const PLAYLIST_ID = 'playlist-1'
const SONG_ID = 'song-1'

const NEW_PLAYLIST = { name: 'Gig night' }
const PATCH = { name: 'Renamed', tags: ['setlist-2026'] }

const LIB_MOCKS = [
  getUserPlaylists,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  addSongToPlaylist,
  removeSongFromPlaylist,
  getPlaylistWithSongs,
  assertPlaylistAccess,
  assertBandMember,
]

/**
 * label → [invocation, expected @/lib/playlists arguments]. Since RH-34 every
 * row resolves the session, and the resolved id is threaded straight after the
 * entity id it authorizes against.
 */
const FORWARDS: Array<[string, () => Promise<unknown>, ReturnType<typeof vi.fn>, unknown[]]> = [
  ['getUserPlaylistsAction', () => getUserPlaylistsAction(), vi.mocked(getUserPlaylists), [USER_ID]],
  [
    'createPlaylistAction',
    () => createPlaylistAction(NEW_PLAYLIST),
    vi.mocked(createPlaylist),
    [USER_ID, NEW_PLAYLIST],
  ],
  [
    'addSongToPlaylistAction',
    () => addSongToPlaylistAction(PLAYLIST_ID, SONG_ID),
    vi.mocked(addSongToPlaylist),
    [PLAYLIST_ID, USER_ID, SONG_ID],
  ],
  [
    'updatePlaylistAction',
    () => updatePlaylistAction(PLAYLIST_ID, PATCH),
    vi.mocked(updatePlaylist),
    [PLAYLIST_ID, USER_ID, PATCH],
  ],
  [
    'deletePlaylistAction',
    () => deletePlaylistAction(PLAYLIST_ID),
    vi.mocked(deletePlaylist),
    [PLAYLIST_ID, USER_ID],
  ],
  [
    'removeSongFromPlaylistAction',
    () => removeSongFromPlaylistAction(PLAYLIST_ID, SONG_ID),
    vi.mocked(removeSongFromPlaylist),
    [PLAYLIST_ID, USER_ID, SONG_ID],
  ],
  [
    'getPlaylistWithSongsAction',
    () => getPlaylistWithSongsAction(PLAYLIST_ID),
    vi.mocked(getPlaylistWithSongs),
    [PLAYLIST_ID, USER_ID],
  ],
]

const dbRow = (position: number, suffix: string) => ({
  position,
  repertoire_id: `rep-${suffix}`,
  song_id: `song-${suffix}`,
  title: `Title ${suffix}`,
  artist: suffix === 'b' ? null : `Artist ${suffix}`,
})

beforeEach(() => {
  vi.mocked(getRequiredUserId).mockReset()
  vi.mocked(getRequiredUserId).mockResolvedValue(USER_ID)
  vi.mocked(query).mockReset()
  LIB_MOCKS.forEach((fn) => vi.mocked(fn).mockReset())
})

describe('playlist action delegation', () => {
  it.each(FORWARDS)('%s hands off to @/lib/playlists', async (_label, run, delegate, args) => {
    delegate.mockResolvedValue('lib-result')

    await expect(run()).resolves.toBe('lib-result')

    expect(delegate).toHaveBeenCalledWith(...args)
    expect(getRequiredUserId).toHaveBeenCalledTimes(1)
  })
})

describe('getPlaylistDetailsWithEntriesAction', () => {
  it('authorizes the playlist and the band context before reading anything', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ name: 'Gig night' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)

    await getPlaylistDetailsWithEntriesAction(PLAYLIST_ID, BAND_ID)

    expect(assertPlaylistAccess).toHaveBeenCalledWith(PLAYLIST_ID, USER_ID)
    expect(assertBandMember).toHaveBeenCalledWith(BAND_ID, USER_ID)
  })

  it('skips the band assertion for a personal owner context', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ name: 'Personal' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)

    await getPlaylistDetailsWithEntriesAction(PLAYLIST_ID, null)

    expect(assertPlaylistAccess).toHaveBeenCalledWith(PLAYLIST_ID, USER_ID)
    expect(assertBandMember).not.toHaveBeenCalled()
  })

  it('propagates the playlist denial without reading the playlist', async () => {
    vi.mocked(assertPlaylistAccess).mockRejectedValueOnce(
      new Error('Access denied: not allowed on this playlist'),
    )

    await expect(getPlaylistDetailsWithEntriesAction(PLAYLIST_ID, null)).rejects.toThrow('Access denied')
    expect(query).not.toHaveBeenCalled()
  })

  it('returns the playlist name and its ordered entries scoped to a band', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ name: 'Gig night' }] } as never)
      .mockResolvedValueOnce({ rows: [dbRow(0, 'a'), dbRow(1, 'b')] } as never)

    const result = await getPlaylistDetailsWithEntriesAction(PLAYLIST_ID, BAND_ID)

    expect(result.name).toBe('Gig night')
    expect(result.entries).toEqual([
      { repertoireId: 'rep-a', songId: 'song-a', title: 'Title a', artist: 'Artist a' },
      { repertoireId: 'rep-b', songId: 'song-b', title: 'Title b', artist: null },
    ])

    const [sql, params] = vi.mocked(query).mock.calls[1]
    expect(sql).toContain('ORDER BY ps.position ASC')
    expect(params).toEqual([BAND_ID, USER_ID, PLAYLIST_ID])
  })

  it.each([
    ['an explicit null bandId', null],
    ['an omitted bandId', undefined],
  ])('passes null as the band parameter for %s so the SQL falls to the user branch', async (_label, bandId) => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ name: 'Personal' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)

    const result = await getPlaylistDetailsWithEntriesAction(PLAYLIST_ID, bandId)

    expect(result.entries).toEqual([])
    expect(vi.mocked(query).mock.calls[1][1]).toEqual([null, USER_ID, PLAYLIST_ID])
  })

  it("falls back to the name 'Playlist' when the playlist row is missing", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)

    const result = await getPlaylistDetailsWithEntriesAction(PLAYLIST_ID)

    expect(result).toEqual({ name: 'Playlist', entries: [] })
  })
})

describe('getPlaylistEntryIdsAction', () => {
  it('returns just the entries of the details payload, dropping the name', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ name: 'Gig night' }] } as never)
      .mockResolvedValueOnce({ rows: [dbRow(0, 'a')] } as never)

    await expect(getPlaylistEntryIdsAction(PLAYLIST_ID, BAND_ID)).resolves.toEqual([
      { repertoireId: 'rep-a', songId: 'song-a', title: 'Title a', artist: 'Artist a' },
    ])
  })
})

/**
 * RH-45 — the playlist actions no longer carry SQL. The detail read and both of
 * its authorization calls moved into `@/lib/playlists`, which this suite
 * already mocked for the other seven actions, so what is asserted here is the
 * forwarding of `(playlistId, userId, bandId)` and nothing else. The
 * `assertPlaylistAccess` / `assertBandMember` ordering now lives in
 * `src/lib/__tests__/playlists.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth-session', () => ({
  getRequiredUserId: vi.fn(),
}))

vi.mock('@/lib/playlists', () => ({
  getUserPlaylists: vi.fn(),
  createPlaylist: vi.fn(),
  updatePlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  addSongToPlaylist: vi.fn(),
  removeSongFromPlaylist: vi.fn(),
  getPlaylistWithSongs: vi.fn(),
  getPlaylistDetailsWithEntries: vi.fn(),
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
} from '../playlists'
import { getRequiredUserId } from '@/lib/auth-session'
import {
  getUserPlaylists,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  addSongToPlaylist,
  removeSongFromPlaylist,
  getPlaylistWithSongs,
  getPlaylistDetailsWithEntries,
} from '@/lib/playlists'

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
  getPlaylistDetailsWithEntries,
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

const entry = (suffix: string) => ({
  repertoireId: `rep-${suffix}`,
  songId: `song-${suffix}`,
  title: `Title ${suffix}`,
  artist: suffix === 'b' ? null : `Artist ${suffix}`,
})

const DETAILS = { name: 'Gig night', entries: [entry('a'), entry('b')] }

beforeEach(() => {
  vi.mocked(getRequiredUserId).mockReset()
  vi.mocked(getRequiredUserId).mockResolvedValue(USER_ID)
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
  it('forwards the playlist id, the resolved user id and the band owner context', async () => {
    vi.mocked(getPlaylistDetailsWithEntries).mockResolvedValue(DETAILS)

    await expect(getPlaylistDetailsWithEntriesAction(PLAYLIST_ID, BAND_ID)).resolves.toEqual(DETAILS)

    expect(getPlaylistDetailsWithEntries).toHaveBeenCalledExactlyOnceWith(
      PLAYLIST_ID,
      USER_ID,
      BAND_ID,
    )
    expect(getRequiredUserId).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['an explicit null bandId', null],
    ['an omitted bandId', undefined],
  ])('forwards %s unchanged, so the lib function takes its personal branch', async (_label, bandId) => {
    vi.mocked(getPlaylistDetailsWithEntries).mockResolvedValue({ name: 'Personal', entries: [] })

    await getPlaylistDetailsWithEntriesAction(PLAYLIST_ID, bandId)

    expect(getPlaylistDetailsWithEntries).toHaveBeenCalledExactlyOnceWith(
      PLAYLIST_ID,
      USER_ID,
      bandId,
    )
  })

  it('propagates a refusal from the lib function instead of swallowing it', async () => {
    vi.mocked(getPlaylistDetailsWithEntries).mockRejectedValue(
      new Error('Access denied: not allowed on this playlist'),
    )

    await expect(getPlaylistDetailsWithEntriesAction(PLAYLIST_ID, null)).rejects.toThrow(
      'Access denied',
    )
  })
})

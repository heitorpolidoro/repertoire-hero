// @vitest-environment jsdom
/**
 * RH-67 — the add-song picker's controller.
 *
 * The pure decisions are covered directly in `src/lib/__tests__/songPicker.test.ts`.
 * What only a hook test can prove is the timing and the wiring: that nothing is
 * searched below two characters, that the search fires once 500 ms after the
 * last keystroke, that an out-of-order response is discarded, and that each add
 * path calls exactly the actions it should and never rejects.
 *
 * `searchSpotify` is the one transport the hook imports rather than receives
 * (it is a client `fetch` in `src/lib`, not a Server Action), so it is mocked at
 * the module boundary; everything else arrives through the injected
 * `SongPickerActions`, so the test builds it by hand and imports nothing from
 * `@/app/`.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useSongPicker, type SongPickerActions, type UseSongPickerOptions } from '@/hooks/useSongPicker'
import { searchSpotify } from '@/lib/spotify'
import type { SpotifyTrack } from '@/lib/spotify'
import type { GlobalSong, PlaylistSong, Repertoire } from '@/types/database'

vi.mock('@/lib/spotify', () => ({ searchSpotify: vi.fn() }))

const searchSpotifyMock = searchSpotify as Mock

afterEach(cleanup)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PLAYLIST_ID = 'playlist-1'

function song(id: string, title: string, artist = 'Led Zeppelin'): GlobalSong {
  return {
    id,
    title,
    artist,
    album: 'IV',
    standard_key: null,
    cover_url: null,
    duration_seconds: null,
    links: [],
    created_at: '2026-01-01T00:00:00.000Z',
  }
}

function track(id: string, title: string, artist = 'Led Zeppelin'): SpotifyTrack {
  return {
    id,
    title,
    artist,
    album: 'IV',
    spotifyUrl: `https://open.spotify.com/track/${id}`,
    previewUrl: null,
    albumArt: 'https://img.example/cover.jpg',
  }
}

function playlistSong(songId: string): PlaylistSong {
  return { id: `ps-${songId}`, playlist_id: PLAYLIST_ID, song_id: songId, position: 0 }
}

function entry(songId: string, title?: string, artist?: string): Repertoire {
  return {
    id: `rep-${songId}`,
    user_id: 'user-1',
    band_id: null,
    song_id: songId,
    personal_key: null,
    status: 'unknown',
    tags: [],
    last_practiced: null,
    lyrics: null,
    song: title ? song(songId, title, artist) : undefined,
  }
}

type ActionSpies = { [K in keyof SongPickerActions]: Mock }

function makeActions(): ActionSpies {
  return {
    searchCatalog: vi.fn().mockResolvedValue([]),
    addToRepertoire: vi.fn().mockResolvedValue(entry('song-1')),
    createAndAddSong: vi.fn().mockResolvedValue(entry('song-1')),
    addSongToPlaylist: vi.fn().mockResolvedValue(undefined),
    getPlaylistWithSongs: vi.fn().mockResolvedValue({ songs: [] }),
  }
}

function setup(overrides: Partial<UseSongPickerOptions> = {}) {
  const actions = (overrides.actions as ActionSpies | undefined) ?? makeActions()
  const onSongsChanged = vi.fn()
  const afterAdd = vi.fn().mockResolvedValue(undefined)
  const initialProps: UseSongPickerOptions = {
    playlistId: PLAYLIST_ID,
    repertoire: new Map(),
    songs: [],
    onSongsChanged,
    afterAdd,
    ...overrides,
    actions,
  }
  const view = renderHook((props: UseSongPickerOptions) => useSongPicker(props), { initialProps })
  return { ...view, actions, onSongsChanged, afterAdd, initialProps }
}

/** Advance the debounce clock and let the searches it started settle. */
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
  await settle()
}

/** Drain the microtask queue through React's act loop. */
async function settle() {
  for (let round = 0; round < 5; round += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  searchSpotifyMock.mockReset()
  searchSpotifyMock.mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------

describe('useSongPicker', () => {
  it('runs no search while the query is shorter than two characters', async () => {
    const { result, actions } = setup()

    act(() => result.current.changeQuery('k'))
    await advance(500)

    expect(actions.searchCatalog).not.toHaveBeenCalled()
    expect(searchSpotifyMock).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
  })

  it('searches once, 500 ms after the last keystroke', async () => {
    const { result, actions } = setup()

    act(() => result.current.changeQuery('ka'))
    await advance(499)
    expect(actions.searchCatalog).not.toHaveBeenCalled()

    act(() => result.current.changeQuery('kash'))
    await advance(500)

    expect(actions.searchCatalog).toHaveBeenCalledTimes(1)
    expect(actions.searchCatalog).toHaveBeenCalledWith('kash')
  })

  it('queries the catalog and Spotify in parallel and exposes both lists', async () => {
    const actions = makeActions()
    actions.searchCatalog.mockResolvedValue([song('song-1', 'Kashmir')])
    searchSpotifyMock.mockResolvedValue([track('sp-1', 'Rock and Roll')])
    const { result } = setup({ actions })

    act(() => result.current.changeQuery('kash'))
    await advance(500)

    expect(actions.searchCatalog).toHaveBeenCalledWith('kash')
    expect(searchSpotifyMock).toHaveBeenCalledWith('kash')
    expect(result.current.catalogResults.map((item) => item.id)).toEqual(['song-1'])
    expect(result.current.spotifyResults.map((item) => item.id)).toEqual(['sp-1'])
    expect(result.current.loading).toBe(false)
  })

  it('keeps the results of the latest query when an earlier search resolves last', async () => {
    const actions = makeActions()
    let resolveFirst: (songs: GlobalSong[]) => void = () => {}
    let resolveSecond: (songs: GlobalSong[]) => void = () => {}
    actions.searchCatalog
      .mockImplementationOnce(() => new Promise<GlobalSong[]>((resolve) => { resolveFirst = resolve }))
      .mockImplementationOnce(() => new Promise<GlobalSong[]>((resolve) => { resolveSecond = resolve }))
    const { result } = setup({ actions })

    act(() => result.current.changeQuery('old'))
    await advance(500)
    act(() => result.current.changeQuery('new'))
    await advance(500)
    expect(actions.searchCatalog).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveSecond([song('song-new', 'Kashmir')])
    })
    await settle()
    await act(async () => {
      resolveFirst([song('song-old', 'Black Dog')])
    })
    await settle()

    expect(result.current.catalogResults.map((item) => item.id)).toEqual(['song-new'])
  })

  it('clears both result lists when the query falls back below two characters', async () => {
    const actions = makeActions()
    actions.searchCatalog.mockResolvedValue([song('song-1', 'Kashmir')])
    searchSpotifyMock.mockResolvedValue([track('sp-1', 'Rock and Roll')])
    const { result } = setup({ actions })

    act(() => result.current.changeQuery('kash'))
    await advance(500)
    expect(result.current.catalogResults).toHaveLength(1)

    act(() => result.current.changeQuery('k'))
    await advance(500)

    expect(result.current.catalogResults).toEqual([])
    expect(result.current.spotifyResults).toEqual([])
  })

  it('hides a catalog result already in the playlist', async () => {
    const actions = makeActions()
    actions.searchCatalog.mockResolvedValue([song('song-1', 'Kashmir'), song('song-2', 'Black Dog')])
    const { result } = setup({ actions, songs: [playlistSong('song-1')] })

    act(() => result.current.changeQuery('kash'))
    await advance(500)

    expect(result.current.catalogResults.map((item) => item.id)).toEqual(['song-2'])
  })

  it('hides a Spotify track the catalog already covers', async () => {
    const actions = makeActions()
    actions.searchCatalog.mockResolvedValue([song('song-1', 'Kashmir')])
    searchSpotifyMock.mockResolvedValue([track('sp-1', 'KASHMIR'), track('sp-2', 'Rock and Roll')])
    const { result } = setup({ actions })

    act(() => result.current.changeQuery('kash'))
    await advance(500)

    expect(result.current.spotifyResults.map((item) => item.id)).toEqual(['sp-2'])
  })

  it('leaves the catalog list empty when the catalog search rejects', async () => {
    const actions = makeActions()
    actions.searchCatalog.mockRejectedValue(new Error('catalog down'))
    searchSpotifyMock.mockResolvedValue([track('sp-1', 'Rock and Roll')])
    const { result } = setup({ actions })

    act(() => result.current.changeQuery('kash'))
    await advance(500)

    expect(result.current.catalogResults).toEqual([])
    expect(result.current.spotifyResults.map((item) => item.id)).toEqual(['sp-1'])
    expect(result.current.loading).toBe(false)
  })

  it('adds a catalog song already in the repertoire straight to the playlist', async () => {
    const actions = makeActions()
    actions.getPlaylistWithSongs.mockResolvedValue({ songs: [playlistSong('song-1')] })
    const { result, onSongsChanged, afterAdd } = setup({
      actions,
      repertoire: new Map([['song-1', entry('song-1', 'Kashmir')]]),
    })

    await act(async () => {
      await result.current.addCatalogSong(song('song-1', 'Kashmir'))
    })

    expect(actions.addToRepertoire).not.toHaveBeenCalled()
    expect(actions.addSongToPlaylist).toHaveBeenCalledWith(PLAYLIST_ID, 'song-1')
    expect(actions.getPlaylistWithSongs).toHaveBeenCalledWith(PLAYLIST_ID)
    expect(onSongsChanged).toHaveBeenCalledWith([playlistSong('song-1')])
    expect(afterAdd).toHaveBeenCalledTimes(1)
    expect(result.current.addingId).toBeNull()
  })

  it('adds a catalog song missing from the repertoire to the repertoire first', async () => {
    const actions = makeActions()
    const { result } = setup({ actions })

    await act(async () => {
      await result.current.addCatalogSong(song('song-1', 'Kashmir'))
    })

    expect(actions.addToRepertoire).toHaveBeenCalledWith('song-1')
    expect(actions.addSongToPlaylist).toHaveBeenCalledWith(PLAYLIST_ID, 'song-1')
    expect(actions.addToRepertoire.mock.invocationCallOrder[0]).toBeLessThan(
      actions.addSongToPlaylist.mock.invocationCallOrder[0],
    )
    expect(result.current.rowErrors).toEqual({})
  })

  it('creates a Spotify track as a song and adds it to the playlist', async () => {
    const actions = makeActions()
    actions.createAndAddSong.mockResolvedValue(entry('song-9'))
    const { result } = setup({ actions })
    const spotifyTrack = track('sp-9', 'Kashmir')

    await act(async () => {
      await result.current.addSpotifyTrack(spotifyTrack)
    })

    expect(actions.createAndAddSong).toHaveBeenCalledWith({
      title: 'Kashmir',
      artist: 'Led Zeppelin',
      album: 'IV',
      cover_url: 'https://img.example/cover.jpg',
      links: [{ label: 'Spotify', url: spotifyTrack.spotifyUrl }],
    })
    expect(actions.addSongToPlaylist).toHaveBeenCalledWith(PLAYLIST_ID, 'song-9')
  })

  it('reuses the existing repertoire entry when the create reports the song is already in the repertoire', async () => {
    const actions = makeActions()
    actions.createAndAddSong.mockRejectedValue(new Error('Song is already in your repertoire'))
    const { result } = setup({
      actions,
      repertoire: new Map([['song-7', entry('song-7', 'Kashmir', 'Led Zeppelin')]]),
    })

    await act(async () => {
      await result.current.addSpotifyTrack(track('sp-7', 'KASHMIR', 'LED ZEPPELIN'))
    })

    expect(actions.addSongToPlaylist).toHaveBeenCalledWith(PLAYLIST_ID, 'song-7')
    expect(result.current.rowErrors).toEqual({})

    // ...and with no entry to reuse, the create's own error is what the row shows.
    await act(async () => {
      await result.current.addSpotifyTrack(track('sp-8', 'Black Dog'))
    })

    expect(actions.addSongToPlaylist).toHaveBeenCalledTimes(1)
    expect(result.current.rowErrors).toEqual({ 'sp-8': 'Song is already in your repertoire' })
  })

  it('records a per-row error when an add fails and clears it on the next attempt', async () => {
    const actions = makeActions()
    actions.addSongToPlaylist.mockRejectedValueOnce(new Error('Playlist is locked'))
    const { result } = setup({ actions, repertoire: new Map([['song-1', entry('song-1', 'Kashmir')]]) })

    let settled = false
    await act(async () => {
      await result.current.addCatalogSong(song('song-1', 'Kashmir')).then(() => {
        settled = true
      })
    })

    expect(settled).toBe(true)
    expect(result.current.rowErrors).toEqual({ 'song-1': 'Playlist is locked' })
    expect(result.current.addingId).toBeNull()

    await act(async () => {
      await result.current.addCatalogSong(song('song-1', 'Kashmir'))
    })

    expect(result.current.rowErrors).toEqual({})
  })
})

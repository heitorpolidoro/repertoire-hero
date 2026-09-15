// @vitest-environment jsdom
/**
 * RH-71 — the controller of `/playlists/[id]`.
 *
 * `/playlists/[id]` is a Server Component now, so there is no load to test: the
 * playlist, its songs and the owner's repertoire arrive as props. What only a
 * hook test can reach is the window between an optimistic edit and the Server
 * Action answering it — the revert asymmetry (a rejected status cycle goes
 * back, a rejected tag write does not) and the owner every write carries.
 *
 * The actions are `vi.fn()`s and `global.fetch` is stubbed, so nothing here
 * imports a Server Action, and the router stays outside: `onRefresh` and
 * `onDeleted` are plain callbacks, which is why no navigation mock is needed.
 */

import { describe, it, expect, vi, afterEach, type Mock } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import {
  usePlaylistDetail,
  type PlaylistDetailActions,
  type UsePlaylistDetailOptions,
} from '@/hooks/usePlaylistDetail'
import type { SongPickerActions } from '@/hooks/useSongPicker'
import type { GlobalSong, Playlist, PlaylistSong, Repertoire } from '@/types/database'

afterEach(cleanup)
afterEach(() => vi.unstubAllGlobals())

function song(songId: string, position: number): PlaylistSong {
  return { id: `ps-${songId}`, playlist_id: 'pl-1', song_id: songId, position }
}

function entry(songId: string, overrides: Partial<Repertoire> = {}): Repertoire {
  return {
    id: `rep-${songId}`,
    user_id: 'u1',
    band_id: null,
    song_id: songId,
    personal_key: null,
    status: 'unknown',
    tags: [],
    last_practiced: null,
    lyrics: null,
    ...overrides,
  }
}

function playlist(overrides: Partial<Playlist> = {}): Playlist {
  return {
    id: 'pl-1',
    user_id: 'u1',
    band_id: null,
    name: 'Setlist',
    description: null,
    cover_url: null,
    spotify_playlist_id: null,
    sync_with_spotify: false,
    last_synced_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    tags: ['rock'],
    songs: [song('s1', 1), song('s2', 2)],
    ...overrides,
  }
}

type MockedActions = PlaylistDetailActions & Record<keyof PlaylistDetailActions, Mock>

function makeActions(overrides: Partial<Record<keyof PlaylistDetailActions, Mock>> = {}) {
  return {
    updatePlaylist: vi.fn().mockResolvedValue(undefined),
    deletePlaylist: vi.fn().mockResolvedValue(undefined),
    removeSongFromPlaylist: vi.fn().mockResolvedValue(undefined),
    updateSongStatus: vi.fn().mockResolvedValue(undefined),
    updateSongTags: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as MockedActions
}

function makePickerActions(overrides: Partial<Record<string, Mock>> = {}) {
  return {
    searchCatalog: vi.fn().mockResolvedValue([]),
    addToRepertoire: vi.fn().mockResolvedValue(entry('s3')),
    createAndAddSong: vi.fn().mockResolvedValue(entry('s3')),
    addSongToPlaylist: vi.fn().mockResolvedValue(undefined),
    getPlaylistWithSongs: vi.fn().mockResolvedValue(playlist()),
    ...overrides,
  } as unknown as SongPickerActions & Record<string, Mock>
}

function setup(options: Partial<UsePlaylistDetailOptions> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }),
  )
  const actions = (options.actions ?? makeActions()) as MockedActions
  const pickerActions = (options.pickerActions ?? makePickerActions()) as ReturnType<
    typeof makePickerActions
  >
  const onRefresh = vi.fn()
  const onDeleted = vi.fn()
  const view = renderHook(() =>
    usePlaylistDetail({
      playlist: options.playlist ?? playlist(),
      repertoire: options.repertoire ?? [entry('s1'), entry('s2')],
      actions,
      pickerActions,
      onRefresh: options.onRefresh ?? onRefresh,
      onDeleted: options.onDeleted ?? onDeleted,
    }),
  )
  return { ...view, actions, pickerActions, onRefresh, onDeleted, fetchMock: fetch as Mock }
}

describe('usePlaylistDetail (RH-71)', () => {
  it('reports the server playlist, songs and repertoire without issuing any request', () => {
    const { result, fetchMock } = setup()

    expect(result.current.playlist.name).toBe('Setlist')
    expect(result.current.songs.map((ps) => ps.song_id)).toEqual(['s1', 's2'])
    expect(result.current.repertoireMap.get('s1')?.id).toBe('rep-s1')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('renames optimistically, calls updatePlaylist and asks for a refresh', async () => {
    const { result, actions, onRefresh } = setup()

    act(() => result.current.dispatch({ type: 'open-rename', name: 'Gig night' }))
    await act(async () => {
      await result.current.rename()
    })

    expect(actions.updatePlaylist).toHaveBeenCalledWith('pl-1', { name: 'Gig night' })
    expect(result.current.playlist.name).toBe('Gig night')
    expect(result.current.panel.kind).toBe('none')
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('reports a rename failure in the error banner', async () => {
    const actions = makeActions({
      updatePlaylist: vi.fn().mockRejectedValue(new Error('Failed to rename: nope')),
    })
    const { result, onRefresh } = setup({ actions })

    act(() => result.current.dispatch({ type: 'open-rename', name: 'Gig night' }))
    await act(async () => {
      await result.current.rename()
    })

    expect(result.current.error).toBe('Failed to rename: nope')
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('removes a song optimistically, pushes to Spotify and asks for a refresh', async () => {
    const { result, actions, onRefresh, fetchMock } = setup({
      playlist: playlist({ sync_with_spotify: true, spotify_playlist_id: 'sp-1' }),
    })

    await act(async () => {
      await result.current.removeSong('s2')
    })

    expect(actions.removeSongFromPlaylist).toHaveBeenCalledWith('pl-1', 's2')
    expect(result.current.songs.map((ps) => ps.song_id)).toEqual(['s1'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onRefresh).toHaveBeenCalledTimes(1)

    // A pull rewrote the playlist server-side, so the row this session was
    // hiding has to be released before the refresh: a song the pull re-imported
    // must be visible again, not masked by the removal that preceded it.
    await act(async () => {
      await result.current.sync.pull()
    })

    expect(result.current.songs.map((ps) => ps.song_id)).toEqual(['s1', 's2'])
  })

  it('restores a removed song and reports the failure when the write rejects', async () => {
    const actions = makeActions({
      removeSongFromPlaylist: vi.fn().mockRejectedValue(new Error('Failed to remove song')),
    })
    const { result, onRefresh } = setup({ actions })

    await act(async () => {
      await result.current.removeSong('s2')
    })

    expect(result.current.songs.map((ps) => ps.song_id)).toEqual(['s1', 's2'])
    expect(result.current.error).toBe('Failed to remove song')
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('cycles a mastery status optimistically and reverts it when the write rejects', async () => {
    let rejectWrite: (err: Error) => void = () => undefined
    const actions = makeActions({
      updateSongStatus: vi.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectWrite = reject
          }),
      ),
    })
    const { result } = setup({ actions })

    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = result.current.cycleStatus('s1')
    })
    // The optimistic window: the badge has already advanced while the Server
    // Action is still in flight, which is what the e2e net observes.
    expect(result.current.repertoireMap.get('s1')?.status).toBe('learning')

    await act(async () => {
      rejectWrite(new Error('Failed to update status'))
      await pending
    })

    expect(result.current.repertoireMap.get('s1')?.status).toBe('unknown')
    expect(result.current.error).toBe('Failed to update status')
  })

  it('carries the playlist band id into the status and the tag writes', async () => {
    const { result, actions } = setup({
      playlist: playlist({ user_id: null, band_id: 'band-1' }),
      repertoire: [entry('s1', { user_id: null, band_id: 'band-1', tags: ['solo'] })],
    })

    await act(async () => {
      await result.current.cycleStatus('s1')
    })
    await act(async () => {
      await result.current.songTagEditor.removeTag('s1', 'solo')
    })

    expect(actions.updateSongStatus).toHaveBeenCalledWith('rep-s1', 'learning', 'band-1')
    expect(actions.updateSongTags).toHaveBeenCalledWith('rep-s1', [], 'band-1')
  })

  it('carries no band id for a personal playlist', async () => {
    const { result, actions } = setup({ repertoire: [entry('s1', { tags: ['solo'] })] })

    await act(async () => {
      await result.current.cycleStatus('s1')
      await result.current.songTagEditor.removeTag('s1', 'solo')
    })

    const [, , statusOwner] = actions.updateSongStatus.mock.calls[0]
    const [, , tagsOwner] = actions.updateSongTags.mock.calls[0]
    expect(statusOwner).toBeNull()
    expect(tagsOwner).toBeNull()
  })

  it('adds a playlist tag optimistically and asks for a refresh after the write', async () => {
    const { result, actions, onRefresh } = setup()

    act(() => result.current.playlistTagEditor.open('pl-1'))
    act(() => result.current.playlistTagEditor.changeDraft('live'))
    await act(async () => {
      await result.current.playlistTagEditor.commitDraft('pl-1')
    })

    expect(result.current.playlist.tags).toEqual(['rock', 'live'])
    expect(actions.updatePlaylist).toHaveBeenCalledWith('pl-1', { tags: ['rock', 'live'] })
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('reports a song tag rejection without reverting the chip', async () => {
    const actions = makeActions({
      updateSongTags: vi
        .fn()
        .mockRejectedValue(new Error('Repertoire entry not found or access denied')),
    })
    const { result } = setup({ actions, repertoire: [entry('s1', { tags: ['solo'] })] })

    act(() => result.current.songTagEditor.open('s1'))
    act(() => result.current.songTagEditor.changeDraft('encore'))
    await act(async () => {
      await result.current.songTagEditor.commitDraft('s1')
    })

    // RH-69 left the rejection un-reverted on purpose; RH-71 keeps it that way.
    expect(result.current.repertoireMap.get('s1')?.tags).toEqual(['solo', 'encore'])
    expect(result.current.error).toBe('Repertoire entry not found or access denied')
  })

  it('records the songs the picker reports and keeps the server rows', async () => {
    const pickerActions = makePickerActions({
      getPlaylistWithSongs: vi
        .fn()
        .mockResolvedValue(playlist({ songs: [song('s1', 1), song('s2', 2), song('s3', 3)] })),
    })
    const { result, onRefresh } = setup({ pickerActions })

    await act(async () => {
      await result.current.picker.addCatalogSong({ id: 's3' } as GlobalSong)
    })

    expect(pickerActions.addSongToPlaylist).toHaveBeenCalledWith('pl-1', 's3')
    expect(result.current.songs.map((ps) => ps.song_id)).toEqual(['s1', 's2', 's3'])
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('reports the deletion to its caller and issues no refresh', async () => {
    const { result, actions, onRefresh, onDeleted } = setup()

    await act(async () => {
      await result.current.remove()
    })

    expect(actions.deletePlaylist).toHaveBeenCalledWith('pl-1')
    expect(onDeleted).toHaveBeenCalledTimes(1)
    expect(onRefresh).not.toHaveBeenCalled()
  })
})

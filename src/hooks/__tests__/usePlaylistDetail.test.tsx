// @vitest-environment jsdom
/**
 * RH-71 — the controller of `/playlists/[id]`.
 *
 * `/playlists/[id]` is a Server Component now, so there is no load to test: the
 * playlist, its songs and the owner's repertoire arrive as props. What only a
 * hook test can reach is the window between an optimistic edit and the Server
 * Action answering it — the revert asymmetry (a rejected status write goes
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
import type { Song, Playlist, PlaylistSong, Repertoire } from '@/types/database'

afterEach(cleanup)
afterEach(() => vi.unstubAllGlobals())

/**
 * One playlist entry, keyed by the **version** it names (RH-125); `song_id` is
 * derived rather than equal, so a lookup by the wrong id cannot pass.
 */
function song(versionId: string, position: number): PlaylistSong {
  return { id: `ps-${versionId}`, playlist_id: 'pl-1', version_id: versionId, position }
}

function entry(versionId: string, overrides: Partial<Repertoire> = {}): Repertoire {
  return {
    id: `rep-${versionId}`,
    user_id: 'u1',
    band_id: null,
    song_id: `song-of-${versionId}`,
    version_id: versionId,
    key: null,
    tuning: null,
    map: null,
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
    reorderPlaylistSongs: vi.fn().mockResolvedValue(undefined),
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
    expect(result.current.songs.map((ps) => ps.version_id)).toEqual(['s1', 's2'])
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

    // RH-125 ER13 — removal is by `(playlist_id, version_id)`: `s2` is the
    // entry's `version_id`, and the row's `song_id` (`song-of-s2`) is not what
    // is sent. The hook hands the lib function exactly what the row names.
    expect(actions.removeSongFromPlaylist).toHaveBeenCalledWith('pl-1', 's2')
    expect(actions.removeSongFromPlaylist).not.toHaveBeenCalledWith('pl-1', 'song-of-s2')
    expect(result.current.songs.map((ps) => ps.version_id)).toEqual(['s1'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onRefresh).toHaveBeenCalledTimes(1)

    // A pull rewrote the playlist server-side, so the row this session was
    // hiding has to be released before the refresh: a song the pull re-imported
    // must be visible again, not masked by the removal that preceded it.
    await act(async () => {
      await result.current.sync.pull()
    })

    expect(result.current.songs.map((ps) => ps.version_id)).toEqual(['s1', 's2'])
  })

  it('restores a removed song and reports the failure when the write rejects', async () => {
    const actions = makeActions({
      removeSongFromPlaylist: vi.fn().mockRejectedValue(new Error('Failed to remove song')),
    })
    const { result, onRefresh } = setup({ actions })

    await act(async () => {
      await result.current.removeSong('s2')
    })

    expect(result.current.songs.map((ps) => ps.version_id)).toEqual(['s1', 's2'])
    expect(result.current.error).toBe('Failed to remove song')
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('writes a mastery status optimistically and reverts it when the write rejects', async () => {
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
      pending = result.current.changeStatus('s1', 'polishing')
    })
    // The optimistic window: the notes have already filled while the Server
    // Action is still in flight, which is what the e2e net observes.
    expect(result.current.repertoireMap.get('s1')?.status).toBe('polishing')

    await act(async () => {
      rejectWrite(new Error('Failed to update status'))
      await pending
    })

    expect(result.current.repertoireMap.get('s1')?.status).toBe('unknown')
    expect(result.current.error).toBe('Failed to update status')
  })

  it('takes a status down, and all the way to unknown, on the status the tap names', async () => {
    const { result, actions } = setup({ repertoire: [entry('s1', { status: 'polishing' })] })

    await act(async () => {
      await result.current.changeStatus('s1', 'unknown')
    })

    expect(actions.updateSongStatus).toHaveBeenCalledWith('rep-s1', 'unknown', null)
    expect(result.current.repertoireMap.get('s1')?.status).toBe('unknown')
  })

  it('carries the playlist band id into the status and the tag writes', async () => {
    const { result, actions } = setup({
      playlist: playlist({ user_id: null, band_id: 'band-1' }),
      repertoire: [entry('s1', { user_id: null, band_id: 'band-1', tags: ['solo'] })],
    })

    await act(async () => {
      await result.current.changeStatus('s1', 'learning')
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
      await result.current.changeStatus('s1', 'learning')
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
      await result.current.picker.addCatalogSong({ id: 's3' } as Song)
    })

    expect(pickerActions.addSongToPlaylist).toHaveBeenCalledWith('pl-1', 's3')
    expect(result.current.songs.map((ps) => ps.version_id)).toEqual(['s1', 's2', 's3'])
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

/**
 * RH-103 — the reorder commands and the reorder mode.
 *
 * Three songs, because the interesting cases are a *middle* row moving either
 * way and the two ends short-circuiting. The playlist auto-syncs so the push is
 * observable as the one `fetch` the controller makes (`pushIfNeeded`), which is
 * how the removal test above reads it too.
 */
describe('usePlaylistDetail reorder (RH-103)', () => {
  const THREE = [song('s1', 1), song('s2', 2), song('s3', 3)]

  /** The visible order, read the way `PlaylistSongList` sorts it. */
  const order = (songs: PlaylistSong[]) =>
    [...songs].sort((a, b) => a.position - b.position).map((ps) => ps.id)

  function setupThree(options: Partial<UsePlaylistDetailOptions> = {}) {
    return setup({
      playlist: playlist({
        songs: THREE,
        sync_with_spotify: true,
        spotify_playlist_id: 'sp-1',
      }),
      repertoire: [entry('s1'), entry('s2'), entry('s3')],
      ...options,
    })
  }

  it('moves a middle row up with the complete new id order, pushes and refreshes (ER10)', async () => {
    const { result, actions, onRefresh, fetchMock } = setupThree()

    await act(async () => {
      await result.current.moveSong('s2', 'up')
    })

    expect(actions.reorderPlaylistSongs).toHaveBeenCalledWith('pl-1', [
      'ps-s2',
      'ps-s1',
      'ps-s3',
    ])
    expect(order(result.current.songs)).toEqual(['ps-s2', 'ps-s1', 'ps-s3'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(result.current.error).toBeNull()
  })

  it('moves a middle row down just as readily (ER10)', async () => {
    const { result, actions } = setupThree()

    await act(async () => {
      await result.current.moveSong('s2', 'down')
    })

    expect(actions.reorderPlaylistSongs).toHaveBeenCalledWith('pl-1', [
      'ps-s1',
      'ps-s3',
      'ps-s2',
    ])
    expect(order(result.current.songs)).toEqual(['ps-s1', 'ps-s3', 'ps-s2'])
  })

  it('restores the previous order and reports the failure when the write rejects (ER10)', async () => {
    const actions = makeActions({
      reorderPlaylistSongs: vi
        .fn()
        .mockRejectedValue(new Error('Failed to reorder playlist songs: nope')),
    })
    const { result, onRefresh } = setupThree({ actions })

    await act(async () => {
      await result.current.moveSong('s2', 'up')
    })

    expect(order(result.current.songs)).toEqual(['ps-s1', 'ps-s2', 'ps-s3'])
    expect(result.current.error).toBe('Failed to reorder playlist songs: nope')
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it.each([
    ['the first row asked to move up', 's1', 'up' as const],
    ['the last row asked to move down', 's3', 'down' as const],
    ['a song that is not in the playlist', 's9', 'up' as const],
  ])('writes nothing for %s (ER10)', async (_label, songId, direction) => {
    const { result, actions, onRefresh, fetchMock } = setupThree()

    await act(async () => {
      await result.current.moveSong(songId, direction)
    })

    expect(actions.reorderPlaylistSongs).toHaveBeenCalledTimes(0)
    expect(fetchMock).toHaveBeenCalledTimes(0)
    expect(onRefresh).not.toHaveBeenCalled()
    expect(result.current.error).toBeNull()
    expect(order(result.current.songs)).toEqual(['ps-s1', 'ps-s2', 'ps-s3'])
  })

  it('forwards the drag order, pushes and refreshes (ER11)', async () => {
    const { result, actions, onRefresh, fetchMock } = setupThree()

    await act(async () => {
      await result.current.reorderSongs(['ps-s3', 'ps-s1', 'ps-s2'])
    })

    expect(actions.reorderPlaylistSongs).toHaveBeenCalledWith('pl-1', [
      'ps-s3',
      'ps-s1',
      'ps-s2',
    ])
    expect(order(result.current.songs)).toEqual(['ps-s3', 'ps-s1', 'ps-s2'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('restores the previous order and reports the failure when the drag write rejects (ER11)', async () => {
    const actions = makeActions({
      reorderPlaylistSongs: vi.fn().mockRejectedValue(new Error('nope')),
    })
    const { result } = setupThree({ actions })

    await act(async () => {
      await result.current.reorderSongs(['ps-s3', 'ps-s1', 'ps-s2'])
    })

    expect(order(result.current.songs)).toEqual(['ps-s1', 'ps-s2', 'ps-s3'])
    expect(result.current.error).toBe('nope')
  })

  it('writes nothing when the given order equals the current one (ER11)', async () => {
    const { result, actions, onRefresh, fetchMock } = setupThree()

    await act(async () => {
      await result.current.reorderSongs(['ps-s1', 'ps-s2', 'ps-s3'])
    })

    expect(actions.reorderPlaylistSongs).toHaveBeenCalledTimes(0)
    expect(fetchMock).toHaveBeenCalledTimes(0)
    expect(onRefresh).not.toHaveBeenCalled()
    expect(result.current.error).toBeNull()
  })

  it('starts out of reorder mode and enters it when asked (ER12)', () => {
    const { result } = setupThree()

    expect(result.current.reordering).toBe(false)

    act(() => result.current.setReordering(true))

    expect(result.current.reordering).toBe(true)
  })

  it('leaves reorder mode as soon as a tag filter is applied (ER12)', () => {
    const { result } = setupThree({ repertoire: [entry('s1', { tags: ['encore'] })] })

    act(() => result.current.setReordering(true))
    act(() => result.current.changeTagFilter('encore'))

    expect(result.current.reordering).toBe(false)

    // And comes back when the filter is cleared, with nothing asking for it.
    act(() => result.current.changeTagFilter(null))

    expect(result.current.reordering).toBe(true)
  })

  it('leaves reorder mode as soon as a non-empty text filter is applied (ER12)', () => {
    const { result } = setupThree()

    act(() => result.current.setReordering(true))
    act(() => result.current.changeSongFilterQuery('kash'))

    expect(result.current.reordering).toBe(false)

    // Whitespace is not a filter — `filterPlaylistSongs` trims it away too.
    act(() => result.current.changeSongFilterQuery('   '))

    expect(result.current.reordering).toBe(true)
  })
})

// @vitest-environment jsdom
/**
 * RH-67 — the add-song picker's controller.
 *
 * The pure decisions are covered directly in `src/lib/__tests__/songPicker.test.ts`
 * and `src/lib/__tests__/songSearchMerge.test.ts`. What only a hook test can
 * prove is the timing and the wiring: that nothing is searched below two
 * characters, that the search fires once 500 ms after the last keystroke, that
 * an out-of-order response is discarded, and — the RH-108 deliverable end to
 * end — that the two searches actually reach **one** merge rather than being
 * merged separately and concatenated. No test of the pure function or of the
 * panel in isolation can make that assertion.
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
import type { SearchVersionCandidate, SongSearchRow } from '@/lib/songSearchMerge'
import type {
  CatalogSearchResult,
  CatalogVersionOption,
  Song,
  PlaylistSong,
  Repertoire,
} from '@/types/database'

vi.mock('@/lib/spotify', () => ({ searchSpotify: vi.fn() }))

const searchSpotifyMock = searchSpotify as Mock

afterEach(cleanup)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PLAYLIST_ID = 'playlist-1'

function song(id: string, title: string, artist = 'Led Zeppelin'): Song {
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
    albumType: null,
    releaseDate: null,
  }
}

function versionOption(
  overrides: Partial<CatalogVersionOption> & Pick<CatalogVersionOption, 'versionId'>,
): CatalogVersionOption {
  return {
    label: null,
    durationSeconds: null,
    createdAt: null,
    albumName: 'IV',
    albumType: null,
    albumCoverUrl: null,
    releaseDate: null,
    ...overrides,
  }
}

function candidate(overrides: Partial<SearchVersionCandidate> = {}): SearchVersionCandidate {
  return {
    versionId: null,
    spotifyTrackId: null,
    rawTitle: 'Kashmir',
    albumName: null,
    albumType: null,
    releaseDate: null,
    label: null,
    durationSeconds: null,
    createdAt: null,
    coverUrl: null,
    spotifyUrl: null,
    ...overrides,
  }
}

/** One merged row, as `mergeSongSearchResults` would have produced it. */
function pickerRow(overrides: Partial<SongSearchRow> = {}): SongSearchRow {
  return {
    id: 'kashmir|led zeppelin',
    title: 'Kashmir',
    artist: 'Led Zeppelin',
    coverUrl: null,
    album: 'IV',
    songId: 'song-1',
    versions: [candidate({ versionId: 'v-song-1' })],
    ...overrides,
  }
}

/**
 * A catalog search result (RH-125): the song plus the representative version the
 * search already computed, named `v-<song id>` so the two ids are never
 * interchangeable in an assertion.
 */
function result_(id: string, title: string, artist = 'Led Zeppelin'): CatalogSearchResult {
  return {
    ...song(id, title, artist),
    version_id: `v-${id}`,
    versions: [versionOption({ versionId: `v-${id}` })],
  }
}

/** One playlist entry, naming the version its song's card would add. */
function playlistSong(songId: string): PlaylistSong {
  return { id: `ps-${songId}`, playlist_id: PLAYLIST_ID, version_id: `v-${songId}`, position: 0 }
}

function entry(songId: string, title?: string, artist?: string): Repertoire {
  return {
    id: `rep-${songId}`,
    user_id: 'user-1',
    band_id: null,
    song_id: songId,
    version_id: `v-${songId}`,
    key: null,
    tuning: null,
    map: null,
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

  it('queries the catalog and Spotify in parallel and exposes one merged list', async () => {
    const actions = makeActions()
    actions.searchCatalog.mockResolvedValue([result_('song-1', 'Kashmir')])
    searchSpotifyMock.mockResolvedValue([track('sp-1', 'Rock and Roll')])
    const { result } = setup({ actions })

    act(() => result.current.changeQuery('kash'))
    await advance(500)

    expect(actions.searchCatalog).toHaveBeenCalledWith('kash')
    expect(searchSpotifyMock).toHaveBeenCalledWith('kash')
    // Catalog-backed row first, reproducing HEAD's catalog-before-Spotify order.
    expect(result.current.results.map((row) => row.id)).toEqual([
      'kashmir|led zeppelin',
      'rock and roll|led zeppelin',
    ])
    expect(result.current.loading).toBe(false)
  })

  /**
   * RH-108 ER4 — the deliverable, end to end.
   *
   * An implementation that merged each source separately and concatenated the
   * two arrays would report two rows here, which is exactly HEAD's defect.
   */
  it('collapses a catalog hit and a suffixed Spotify hit into one row (ER4)', async () => {
    const actions = makeActions()
    actions.searchCatalog.mockResolvedValue([
      {
        ...song('song-1', 'Bad', 'Michael Jackson'),
        version_id: 'v-1',
        versions: [versionOption({ versionId: 'v-1', albumName: 'Bad' })],
      },
    ])
    searchSpotifyMock.mockResolvedValue([
      { ...track('sp-aaa', 'Bad - Remaster 2012', 'Michael Jackson'), album: 'Bad' },
    ])
    const { result } = setup({ actions })

    act(() => result.current.changeQuery('bad'))
    await advance(500)

    expect(result.current.results).toHaveLength(1)
    const [row] = result.current.results
    expect(row.title).toBe('Bad')
    expect(row.versions.map((c) => c.versionId)).toContain('v-1')
    expect(row.versions.map((c) => c.spotifyTrackId)).toContain('sp-aaa')
  })

  /**
   * The same wiring, one step further: when both sources describe the same
   * *recording* the row carries **one** candidate holding both ids. Otherwise
   * RH-112's expanded card lists the recording twice and the add path has two
   * ways to reach one `song_versions` row.
   */
  it('collapses one recording described by both sources into one candidate (ER4)', async () => {
    const actions = makeActions()
    actions.searchCatalog.mockResolvedValue([
      {
        ...song('song-1', 'Bad', 'Michael Jackson'),
        version_id: 'v-1',
        versions: [
          versionOption({ versionId: 'v-1', albumName: 'Bad', label: 'Remaster 2012' }),
        ],
      },
    ])
    searchSpotifyMock.mockResolvedValue([
      { ...track('sp-aaa', 'Bad - Remaster 2012', 'Michael Jackson'), album: 'Bad' },
    ])
    const { result } = setup({ actions })

    act(() => result.current.changeQuery('bad'))
    await advance(500)

    expect(result.current.results).toHaveLength(1)
    expect(result.current.results[0].versions).toHaveLength(1)
    expect(result.current.results[0].versions[0]).toMatchObject({
      versionId: 'v-1',
      spotifyTrackId: 'sp-aaa',
    })
  })

  it('keeps the results of the latest query when an earlier search resolves last', async () => {
    const actions = makeActions()
    type Rows = CatalogSearchResult[]
    let resolveFirst: (songs: Rows) => void = () => {}
    let resolveSecond: (songs: Rows) => void = () => {}
    actions.searchCatalog
      .mockImplementationOnce(() => new Promise<Rows>((resolve) => { resolveFirst = resolve }))
      .mockImplementationOnce(() => new Promise<Rows>((resolve) => { resolveSecond = resolve }))
    const { result } = setup({ actions })

    act(() => result.current.changeQuery('old'))
    await advance(500)
    act(() => result.current.changeQuery('new'))
    await advance(500)
    expect(actions.searchCatalog).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveSecond([result_('song-new', 'Kashmir')])
    })
    await settle()
    await act(async () => {
      resolveFirst([result_('song-old', 'Black Dog')])
    })
    await settle()

    expect(result.current.results.map((row) => row.title)).toEqual(['Kashmir'])
  })

  it('clears the result list when the query falls back below two characters', async () => {
    const actions = makeActions()
    actions.searchCatalog.mockResolvedValue([result_('song-1', 'Kashmir')])
    searchSpotifyMock.mockResolvedValue([track('sp-1', 'Rock and Roll')])
    const { result } = setup({ actions })

    act(() => result.current.changeQuery('kash'))
    await advance(500)
    expect(result.current.results).toHaveLength(2)

    act(() => result.current.changeQuery('k'))
    await advance(500)

    expect(result.current.results).toEqual([])
  })

  it('hides a catalog result already in the playlist', async () => {
    const actions = makeActions()
    actions.searchCatalog.mockResolvedValue([
      result_('song-1', 'Kashmir'),
      result_('song-2', 'Black Dog'),
    ])
    // The playlist holds `v-song-1`, so the filter compares version ids.
    const { result } = setup({ actions, songs: [playlistSong('song-1')] })

    act(() => result.current.changeQuery('kash'))
    await advance(500)

    expect(result.current.results.map((row) => row.songId)).toEqual(['song-2'])
  })


  it('returns a Spotify-only list when the catalog search rejects (ER20)', async () => {
    const actions = makeActions()
    actions.searchCatalog.mockRejectedValue(new Error('catalog down'))
    searchSpotifyMock.mockResolvedValue([track('sp-1', 'Rock and Roll')])
    const { result } = setup({ actions })

    act(() => result.current.changeQuery('kash'))
    await advance(500)

    expect(result.current.results).toHaveLength(1)
    expect(result.current.results[0].versions[0].spotifyTrackId).toBe('sp-1')
    expect(result.current.rowErrors).toEqual({})
    expect(result.current.loading).toBe(false)
  })

  it('returns a complete catalog-only list when the Spotify search rejects (ER20)', async () => {
    const actions = makeActions()
    actions.searchCatalog.mockResolvedValue([
      result_('song-1', 'Kashmir'),
      result_('song-2', 'Black Dog'),
    ])
    searchSpotifyMock.mockRejectedValue(new Error('spotify down'))
    const { result } = setup({ actions })

    act(() => result.current.changeQuery('kash'))
    await advance(500)

    // An unconfigured deployment and a user with no Spotify connection both
    // land here; the route uses app-level client credentials, so the
    // connection is irrelevant to search by construction.
    expect(result.current.results.map((row) => row.songId)).toEqual(['song-2', 'song-1'])
    expect(result.current.rowErrors).toEqual({})
  })

  it('adds a catalog row already in the repertoire straight to the playlist', async () => {
    const actions = makeActions()
    actions.getPlaylistWithSongs.mockResolvedValue({ songs: [playlistSong('song-1')] })
    // The repertoire map is keyed by `version_id` (RH-125).
    const { result, onSongsChanged, afterAdd } = setup({
      actions,
      repertoire: new Map([['v-song-1', entry('song-1', 'Kashmir')]]),
    })

    await act(async () => {
      await result.current.addRow(pickerRow())
    })

    // RH-125 ER13/ER14 — the card's own version goes to the playlist, and the
    // song id is not what is sent.
    expect(actions.addToRepertoire).not.toHaveBeenCalled()
    expect(actions.addSongToPlaylist).toHaveBeenCalledWith(PLAYLIST_ID, 'v-song-1')
    expect(actions.addSongToPlaylist).not.toHaveBeenCalledWith(PLAYLIST_ID, 'song-1')
    expect(actions.getPlaylistWithSongs).toHaveBeenCalledWith(PLAYLIST_ID)
    expect(onSongsChanged).toHaveBeenCalledWith([playlistSong('song-1')])
    expect(afterAdd).toHaveBeenCalledTimes(1)
    expect(result.current.addingId).toBeNull()
  })

  it('adds a catalog row missing from the repertoire to the repertoire first (ER11)', async () => {
    const actions = makeActions()
    const { result } = setup({ actions })

    await act(async () => {
      await result.current.addRow(pickerRow())
    })

    // `addToRepertoire` takes the **song** — it is what resolves the version —
    // and the version it answers with is what reaches the playlist.
    expect(actions.addToRepertoire).toHaveBeenCalledWith('song-1')
    expect(actions.addSongToPlaylist).toHaveBeenCalledWith(PLAYLIST_ID, 'v-song-1')
    expect(actions.addToRepertoire.mock.invocationCallOrder[0]).toBeLessThan(
      actions.addSongToPlaylist.mock.invocationCallOrder[0],
    )
    expect(actions.createAndAddSong).not.toHaveBeenCalled()
    expect(result.current.rowErrors).toEqual({})
  })

  it('takes the catalog branch for a candidate carrying both provider ids (ER11)', async () => {
    const actions = makeActions()
    const { result } = setup({ actions })
    const collapsed = pickerRow({
      versions: [candidate({ versionId: 'v-song-1', spotifyTrackId: 'sp-aaa' })],
    })

    await act(async () => {
      await result.current.addRow(collapsed)
    })

    // The recording already exists locally, which is the point of collapsing.
    // Taking the Spotify branch would push an existing song back through
    // `resolveOrCreateSongIdentity` on every add — a write path.
    expect(actions.createAndAddSong).not.toHaveBeenCalled()
    expect(actions.addSongToPlaylist).toHaveBeenCalledWith(PLAYLIST_ID, 'v-song-1')
  })

  it('adds a version-less catalog row through the repertoire, creating nothing (ER12)', async () => {
    const actions = makeActions()
    actions.addToRepertoire.mockResolvedValue(entry('song-3'))
    const { result } = setup({ actions })
    const seeded = pickerRow({
      id: 'kashmir|led zeppelin',
      songId: 'song-3',
      versions: [],
    })

    await act(async () => {
      await result.current.addRow(seeded)
    })

    // `scripts/seed-catalog.sql` writes `songs` rows and never
    // `song_versions`; `addSongToRepertoire` is what gives such a song its
    // first version. This case is checked before anything reads `versions[0]`.
    expect(actions.addToRepertoire).toHaveBeenCalledWith('song-3')
    expect(actions.addSongToPlaylist).toHaveBeenCalledWith(PLAYLIST_ID, 'v-song-3')
    expect(actions.createAndAddSong).not.toHaveBeenCalled()
    expect(result.current.rowErrors).toEqual({})
  })

  it('records an error rather than throwing for a row with neither a version nor a song', async () => {
    const actions = makeActions()
    const { result } = setup({ actions })

    await act(async () => {
      await result.current.addRow(pickerRow({ songId: null, versions: [] }))
    })

    expect(actions.addToRepertoire).not.toHaveBeenCalled()
    expect(actions.createAndAddSong).not.toHaveBeenCalled()
    expect(result.current.rowErrors['kashmir|led zeppelin']).toBeTruthy()
  })

  /**
   * RH-108 ER9 — all five arguments, as literal values.
   *
   * `title` is the **unsplit** `rawTitle` and not the row's display title:
   * `splitSongTitle` runs inside `resolveOrCreateSongIdentity` and hands the
   * right half to `upsertAlbumAndVersion` as `song_versions.label`, so the
   * display title would write `label: null` for `"Bad - Remaster 2012"` —
   * precisely the stripping RH-122 existed to stop. `links` is the only reason
   * `spotifyUrl` is on the candidate at all; dropping it loses the Spotify URL
   * on every song the picker creates.
   */
  it('threads all five createAndAddSong arguments on the Spotify branch (ER9)', async () => {
    const actions = makeActions()
    actions.createAndAddSong.mockResolvedValue(entry('song-9'))
    const { result } = setup({ actions })
    const row = pickerRow({
      id: 'bad|michael jackson',
      title: 'Bad',
      artist: 'Michael Jackson',
      versions: [
        candidate({
          spotifyTrackId: 'sp-aaa',
          rawTitle: 'Bad - Remaster 2012',
          albumName: 'Bad',
          coverUrl: 'https://img/bad.jpg',
          spotifyUrl: 'https://open.spotify.com/track/sp-aaa',
        }),
      ],
    })

    await act(async () => {
      await result.current.addRow(row)
    })

    expect(actions.createAndAddSong).toHaveBeenCalledTimes(1)
    expect(actions.createAndAddSong).toHaveBeenCalledWith({
      title: 'Bad - Remaster 2012',
      artist: 'Michael Jackson',
      album: 'Bad',
      cover_url: 'https://img/bad.jpg',
      links: [{ label: 'Spotify', url: 'https://open.spotify.com/track/sp-aaa' }],
    })
    expect(actions.addSongToPlaylist).toHaveBeenCalledWith(PLAYLIST_ID, 'v-song-9')
  })

  it('passes undefined, never null, for an absent album or cover', async () => {
    const actions = makeActions()
    actions.createAndAddSong.mockResolvedValue(entry('song-9'))
    const { result } = setup({ actions })

    await act(async () => {
      await result.current.addRow(
        pickerRow({
          songId: null,
          versions: [
            candidate({
              spotifyTrackId: 'sp-aaa',
              rawTitle: 'Kashmir',
              spotifyUrl: 'https://open.spotify.com/track/sp-aaa',
            }),
          ],
        }),
      )
    })

    const payload = actions.createAndAddSong.mock.calls[0][0]
    expect(payload.album).toBeUndefined()
    expect(payload.cover_url).toBeUndefined()
  })

  it('reuses the existing repertoire entry when the create reports the song is already in the repertoire', async () => {
    const actions = makeActions()
    actions.createAndAddSong.mockRejectedValue(new Error('Song is already in your repertoire'))
    const { result } = setup({
      actions,
      repertoire: new Map([['v-song-7', entry('song-7', 'Kashmir', 'Led Zeppelin')]]),
    })

    await act(async () => {
      await result.current.addRow(
        pickerRow({
          id: 'kashmir|led zeppelin',
          songId: null,
          artist: 'LED ZEPPELIN',
          versions: [
            candidate({
              spotifyTrackId: 'sp-7',
              rawTitle: 'KASHMIR - Remaster',
              spotifyUrl: 'https://open.spotify.com/track/sp-7',
            }),
          ],
        }),
      )
    })

    // The recovery reads the **version** the owner already holds for that song.
    expect(actions.addSongToPlaylist).toHaveBeenCalledWith(PLAYLIST_ID, 'v-song-7')
    expect(result.current.rowErrors).toEqual({})

    // ...and with no entry to reuse, the create's own error is what the row shows.
    await act(async () => {
      await result.current.addRow(
        pickerRow({
          id: 'black dog|led zeppelin',
          songId: null,
          title: 'Black Dog',
          versions: [
            candidate({
              spotifyTrackId: 'sp-8',
              rawTitle: 'Black Dog',
              spotifyUrl: 'https://open.spotify.com/track/sp-8',
            }),
          ],
        }),
      )
    })

    expect(actions.addSongToPlaylist).toHaveBeenCalledTimes(1)
    expect(result.current.rowErrors).toEqual({
      'black dog|led zeppelin': 'Song is already in your repertoire',
    })
  })

  it('records a per-row error when an add fails and clears it on the next attempt', async () => {
    const actions = makeActions()
    actions.addSongToPlaylist.mockRejectedValueOnce(new Error('Playlist is locked'))
    const { result } = setup({ actions, repertoire: new Map([['v-song-1', entry('song-1', 'Kashmir')]]) })

    let settled = false
    await act(async () => {
      await result.current.addRow(pickerRow()).then(() => {
        settled = true
      })
    })

    expect(settled).toBe(true)
    // The error is keyed by the **row** id, so a catalog hit and a Spotify hit
    // for one song now share one slot instead of having two.
    expect(result.current.rowErrors).toEqual({ 'kashmir|led zeppelin': 'Playlist is locked' })
    expect(result.current.addingId).toBeNull()

    await act(async () => {
      await result.current.addRow(pickerRow())
    })

    expect(result.current.rowErrors).toEqual({})
  })
})

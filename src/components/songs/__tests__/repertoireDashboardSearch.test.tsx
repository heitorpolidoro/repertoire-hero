// @vitest-environment jsdom
/**
 * RH-151 — the dashboard's "Add to your repertoire" section renders one
 * `SongGroupCard` per song, fed by merged rows, and adds the version the
 * musician picked.
 *
 * `searchSpotify` is the one transport the search imports rather than receives,
 * so it is mocked at the module boundary; the store's server reads are mocked
 * the way `repertoireDashboard.test.tsx` does.
 */
import { describe, it, expect, afterEach, beforeEach, vi, type Mock } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { useBandContextStore } from '@/store/bandContextStore'
import { useRepertoireStore } from '@/store/repertoireStore'
import { searchSpotify, type SpotifyTrack } from '@/lib/spotify'
import type { CatalogSearchResult, CatalogVersionOption } from '@/types/database'
import RepertoireDashboard, { type RepertoireDashboardActions } from '../RepertoireDashboard'

const { getRepertoireAction } = vi.hoisted(() => ({ getRepertoireAction: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }))
vi.mock('@/app/actions/repertoire', () => ({
  getRepertoireAction,
  removeSongAction: vi.fn(),
  updateSongStatusAction: vi.fn(),
}))
vi.mock('@/lib/spotify', () => ({ searchSpotify: vi.fn() }))

const searchSpotifyMock = searchSpotify as Mock

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function version(versionId: string, overrides: Partial<CatalogVersionOption> = {}): CatalogVersionOption {
  return {
    versionId,
    label: null,
    durationSeconds: null,
    createdAt: null,
    albumName: null,
    albumType: null,
    albumCoverUrl: null,
    releaseDate: null,
    ...overrides,
  }
}

function catalogSong(overrides: Partial<CatalogSearchResult>): CatalogSearchResult {
  return {
    id: 'song-1',
    title: 'Bad',
    artist: 'Michael Jackson',
    album: null,
    standard_key: null,
    cover_url: null,
    duration_seconds: null,
    links: [],
    created_at: '2026-01-01T00:00:00.000Z',
    version_id: 'v-album',
    versions: [
      version('v-album', { albumName: 'Bad', albumType: 'album', releaseDate: '1987-08-31' }),
      version('v-live', { albumName: 'Bad Live', albumType: 'compilation', releaseDate: '1989-01-01', label: 'Live' }),
    ],
    ...overrides,
  }
}

function spotifyTrack(overrides: Partial<SpotifyTrack> = {}): SpotifyTrack {
  return {
    id: 'sp-1',
    title: 'Bad - Remaster 2012',
    artist: 'Michael Jackson',
    album: 'Bad 25',
    spotifyUrl: 'https://open.spotify.com/track/sp-1',
    previewUrl: null,
    albumArt: null,
    albumType: 'album',
    releaseDate: '2012-01-01',
    ...overrides,
  }
}

interface Mocks {
  addSong: Mock
  addVersion: Mock
  createAndAddSong: Mock
  searchSongs: Mock
}

function buildActions(catalog: CatalogSearchResult[]): { actions: RepertoireDashboardActions; mocks: Mocks } {
  const mocks: Mocks = {
    addSong: vi.fn().mockResolvedValue(undefined),
    addVersion: vi.fn().mockResolvedValue(undefined),
    createAndAddSong: vi.fn().mockResolvedValue(undefined),
    searchSongs: vi.fn().mockResolvedValue(catalog),
  }
  const actions = {
    ...mocks,
    updateSong: vi.fn(),
    updateSongStatus: vi.fn(),
    updateSongTags: vi.fn(),
    submitCatalogSuggestion: vi.fn(),
    getBandRole: vi.fn(),
  } as unknown as RepertoireDashboardActions
  return { actions, mocks }
}

/** Mounts the dashboard, types a query and lets the 500 ms debounce fire. */
async function searchFor(actions: RepertoireDashboardActions, query = 'bad') {
  vi.useFakeTimers()
  await act(async () => {
    render(<RepertoireDashboard actions={actions} />)
  })
  await act(async () => {
    useRepertoireStore.getState().setSearchQuery(query)
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600)
  })
}

const resultsList = () => screen.getByRole('region', { name: 'Add to your repertoire' })

beforeEach(() => {
  getRepertoireAction.mockReset()
  getRepertoireAction.mockResolvedValue([])
  searchSpotifyMock.mockReset()
  searchSpotifyMock.mockResolvedValue([])
  useBandContextStore.setState({ context: { type: 'user' } })
  useRepertoireStore.setState({ songs: [], searchQuery: '', selectedStatus: null })
})

describe('RepertoireDashboard grouped search results (RH-151)', () => {
  it('adds the picked version from a grouped card', async () => {
    const { actions, mocks } = buildActions([catalogSong({})])
    searchSpotifyMock.mockResolvedValue([spotifyTrack()])
    await searchFor(actions)

    // One card for the catalog song and the Spotify track of the same song.
    const list = within(resultsList())
    expect(list.getAllByText('Bad')).toHaveLength(1)

    // Collapsed `Add` adds versions[0] (the album version).
    await act(async () => {
      fireEvent.click(list.getByRole('button', { name: 'Add' }))
    })
    expect(mocks.addVersion).toHaveBeenCalledExactlyOnceWith('v-album')
    expect(mocks.addSong).not.toHaveBeenCalled()
    expect(mocks.createAndAddSong).not.toHaveBeenCalled()

    // Expanded, the non-representative version's `Add` adds exactly that one.
    mocks.addVersion.mockClear()
    fireEvent.click(list.getByRole('button', { name: 'Show versions' }))
    const liveLine = list.getByText('Live').closest('li') as HTMLElement
    await act(async () => {
      fireEvent.click(within(liveLine).getByRole('button', { name: 'Add' }))
    })
    expect(mocks.addVersion).toHaveBeenCalledExactlyOnceWith('v-live')
    expect(mocks.addSong).not.toHaveBeenCalled()
    expect(mocks.createAndAddSong).not.toHaveBeenCalled()
  })

  it('creates a Spotify-only candidate with the raw title', async () => {
    const { actions, mocks } = buildActions([])
    searchSpotifyMock.mockResolvedValue([spotifyTrack()])
    await searchFor(actions)

    await act(async () => {
      fireEvent.click(within(resultsList()).getByRole('button', { name: 'Add' }))
    })

    expect(mocks.createAndAddSong).toHaveBeenCalledExactlyOnceWith({
      title: 'Bad - Remaster 2012',
      artist: 'Michael Jackson',
      album: 'Bad 25',
      cover_url: undefined,
      links: [{ label: 'Spotify', url: 'https://open.spotify.com/track/sp-1' }],
    })
    expect(mocks.addVersion).not.toHaveBeenCalled()
  })

  it('adds a version-less catalog row by its song id', async () => {
    const { actions, mocks } = buildActions([catalogSong({ version_id: null, versions: [] })])
    await searchFor(actions)

    await act(async () => {
      fireEvent.click(within(resultsList()).getByRole('button', { name: 'Add' }))
    })

    expect(mocks.addSong).toHaveBeenCalledExactlyOnceWith('song-1')
    expect(mocks.addVersion).not.toHaveBeenCalled()
  })

  it('reloads the repertoire after a successful add', async () => {
    const { actions } = buildActions([catalogSong({})])
    await searchFor(actions)
    getRepertoireAction.mockClear()

    await act(async () => {
      fireEvent.click(within(resultsList()).getByRole('button', { name: 'Add' }))
    })

    expect(getRepertoireAction).toHaveBeenCalled()
  })

  it('shows an add failure under the card only, and clears it on retry', async () => {
    const { actions, mocks } = buildActions([
      catalogSong({}),
      catalogSong({ id: 'song-2', title: 'Thriller', version_id: 'v-t', versions: [version('v-t')] }),
    ])
    mocks.addVersion.mockRejectedValueOnce(new Error('boom'))
    await searchFor(actions)

    const cards = within(resultsList()).getAllByRole('listitem')
    const bad = cards.find((li) => within(li).queryByText('Bad')) as HTMLElement
    await act(async () => {
      fireEvent.click(within(bad).getByRole('button', { name: 'Add' }))
    })
    expect(screen.getAllByText('boom')).toHaveLength(1)
    expect(within(bad).getByText('boom')).toBeTruthy()

    await act(async () => {
      fireEvent.click(within(bad).getByRole('button', { name: 'Add' }))
    })
    expect(screen.queryByText('boom')).toBeNull()
  })

  it('words a refused Spotify add as the old dashboard did', async () => {
    const { actions, mocks } = buildActions([])
    searchSpotifyMock.mockResolvedValue([spotifyTrack()])
    mocks.createAndAddSong.mockRejectedValueOnce(new Error('Song is already in your repertoire'))
    await searchFor(actions)

    await act(async () => {
      fireEvent.click(within(resultsList()).getByRole('button', { name: 'Add' }))
    })

    expect(screen.getByText('Already in your repertoire.')).toBeTruthy()
  })

  it('hides a held version but still offers an unheld sibling of the same song', async () => {
    useRepertoireStore.setState({
      songs: [
        {
          id: 'rep-1',
          version_id: 'v-album',
          status: 'unknown',
          song: { id: 'song-1', title: 'Bad', artist: 'Michael Jackson', album: null },
        },
      ] as never,
    })
    getRepertoireAction.mockResolvedValue(useRepertoireStore.getState().songs)
    const { actions, mocks } = buildActions([catalogSong({})])
    await searchFor(actions)

    const list = within(resultsList())
    fireEvent.click(list.getByRole('button', { name: 'Show versions' }))
    // Only the live version is offered: one version line with one `Add`.
    expect(list.getAllByRole('button', { name: 'Add' })).toHaveLength(1)
    await act(async () => {
      fireEvent.click(list.getByRole('button', { name: 'Add' }))
    })
    expect(mocks.addVersion).toHaveBeenCalledExactlyOnceWith('v-live')
  })

  it('hides a song whose only offered rows are held', async () => {
    const held = [
      { id: 'rep-1', version_id: 'v-album', status: 'unknown', song: { title: 'Bad', artist: 'Michael Jackson' } },
      { id: 'rep-2', version_id: 'v-live', status: 'unknown', song: { title: 'Bad', artist: 'Michael Jackson' } },
    ]
    useRepertoireStore.setState({ songs: held as never })
    getRepertoireAction.mockResolvedValue(held)
    const { actions } = buildActions([catalogSong({})])
    searchSpotifyMock.mockResolvedValue([spotifyTrack()])
    await searchFor(actions)

    // RH-152: the section stays (it hosts the manual entry) but offers no card.
    expect(within(resultsList()).queryByRole('button', { name: 'Add' })).toBeNull()
  })
})

describe('RepertoireDashboard source (RH-151)', () => {
  const source = readFileSync(join(__dirname, '..', 'RepertoireDashboard.tsx'), 'utf8')

  it.each(['catalogResults', 'spotifyResults', 'handleAddFrom', 'SongResultItem', 'repertoireKeys'])(
    'no longer contains %s',
    (needle) => {
      expect(source).not.toContain(needle)
    },
  )

  it('has deleted SongResultItem.tsx', () => {
    expect(existsSync(join(__dirname, '..', 'SongResultItem.tsx'))).toBe(false)
  })
})

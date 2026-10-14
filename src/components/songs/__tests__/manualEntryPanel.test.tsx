// @vitest-environment jsdom
/**
 * RH-152 - the dashboard's manual-entry panel under the search results: always
 * present with a long enough query, reduced by a disclosure, and asking before
 * it attaches a new version to a song the catalog already holds.
 */
import { describe, it, expect, afterEach, beforeEach, vi, type Mock } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useBandContextStore } from '@/store/bandContextStore'
import { useRepertoireStore } from '@/store/repertoireStore'
import { searchSpotify } from '@/lib/spotify'
import type { CatalogSearchResult } from '@/types/database'
import RepertoireDashboard, { type RepertoireDashboardActions } from '../RepertoireDashboard'

const { getRepertoireAction } = vi.hoisted(() => ({ getRepertoireAction: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }))
vi.mock('@/app/actions/repertoire', () => ({
  getRepertoireAction,
  removeSongAction: vi.fn(),
  updateSongStatusAction: vi.fn(),
}))
vi.mock('@/lib/spotify', () => ({ searchSpotify: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function catalogSong(id: string, title: string): CatalogSearchResult {
  return {
    id,
    title,
    artist: 'Oasis',
    album: null,
    standard_key: null,
    cover_url: null,
    duration_seconds: null,
    created_at: '2026-01-01T00:00:00.000Z',
    version_id: `v-${id}`,
    versions: [
      {
        versionId: `v-${id}`,
        label: null,
        durationSeconds: null,
        createdAt: null,
        albumName: null,
        albumType: null,
        albumCoverUrl: null,
        releaseDate: null,
      },
    ],
  }
}

interface Mocks {
  createAndAddSong: Mock
  updateSongStatus: Mock
  findCatalogSong: Mock
  addVersion: Mock
}

function buildActions(catalog: CatalogSearchResult[]): { actions: RepertoireDashboardActions; mocks: Mocks } {
  const mocks: Mocks = {
    createAndAddSong: vi.fn().mockResolvedValue({ id: 'rep-new' }),
    updateSongStatus: vi.fn().mockResolvedValue(undefined),
    findCatalogSong: vi.fn().mockResolvedValue(null),
    addVersion: vi.fn().mockResolvedValue(undefined),
  }
  const actions = {
    ...mocks,
    addSong: vi.fn(),
    searchSongs: vi.fn().mockResolvedValue(catalog),
    updateSong: vi.fn(),
    updateSongTags: vi.fn(),
    submitCatalogSuggestion: vi.fn(),
    getBandRole: vi.fn(),
  } as unknown as RepertoireDashboardActions
  return { actions, mocks }
}

async function searchFor(actions: RepertoireDashboardActions, query = 'wonderwall') {
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

const panel = () => screen.getByRole('form', { name: 'Add manually' })
const type = (label: string, value: string) =>
  fireEvent.change(within(panel()).getByLabelText(label), { target: { value } })
const submit = async () => {
  await act(async () => {
    fireEvent.click(within(panel()).getByRole('button', { name: 'Add song' }))
  })
}

beforeEach(() => {
  getRepertoireAction.mockReset()
  getRepertoireAction.mockResolvedValue([])
  ;(searchSpotify as Mock).mockReset()
  ;(searchSpotify as Mock).mockResolvedValue([])
  useBandContextStore.setState({ context: { type: 'user' } })
  useRepertoireStore.setState({ songs: [], searchQuery: '', selectedStatus: null })
})

describe('manual entry panel (RH-152)', () => {
  it('renders manual entry beside results and with no results', async () => {
    const withResults = buildActions([catalogSong('s1', 'Wonderwall'), catalogSong('s2', 'Wonderwall (Cover)')])
    await searchFor(withResults.actions)
    const section = screen.getByRole('region', { name: 'Add to your repertoire' })
    expect(within(section).getAllByRole('button', { name: 'Add' })).toHaveLength(2)
    expect(within(section).getByRole('form', { name: 'Add manually' })).toBeTruthy()
    expect(screen.queryByText(/No matches/)).toBeNull()
    cleanup()

    await searchFor(buildActions([]).actions)
    expect(screen.getByText(/No matches/)).toBeTruthy()
    expect(panel()).toBeTruthy()
    // Title is pre-filled from the query.
    expect((within(panel()).getByLabelText('Title') as HTMLInputElement).value).toBe('wonderwall')
  })

  it('is absent for a query shorter than two characters', async () => {
    await searchFor(buildActions([]).actions, 'w')
    expect(screen.queryByRole('form', { name: 'Add manually' })).toBeNull()
  })

  it('hides key, duration, cover and links until the disclosure opens', async () => {
    await searchFor(buildActions([]).actions)
    for (const label of ['Title', 'Artist', 'Album', 'Status']) {
      expect(within(panel()).getByLabelText(label)).toBeTruthy()
    }
    for (const label of ['Key', 'Duration (m:ss)', 'Cover URL']) {
      expect(within(panel()).queryByLabelText(label)).toBeNull()
    }
    expect(within(panel()).queryByText('Links')).toBeNull()

    fireEvent.click(within(panel()).getByRole('button', { name: 'More details' }))
    for (const label of ['Key', 'Duration (m:ss)', 'Cover URL']) {
      expect(within(panel()).getByLabelText(label)).toBeTruthy()
    }
    expect(within(panel()).getByText('Links')).toBeTruthy()

    // Values survive closing the disclosure.
    type('Key', 'F#m')
    fireEvent.click(within(panel()).getByRole('button', { name: 'More details' }))
    fireEvent.click(within(panel()).getByRole('button', { name: 'More details' }))
    expect((within(panel()).getByLabelText('Key') as HTMLInputElement).value).toBe('F#m')
  })

  it('offers a new version when title and artist exist', async () => {
    const { actions, mocks } = buildActions([])
    mocks.findCatalogSong.mockResolvedValue({ id: 'song-1', title: 'Wonderwall', artist: 'Oasis' })
    await searchFor(actions)
    type('Artist', 'Oasis')
    await submit()

    expect(mocks.findCatalogSong).toHaveBeenCalledWith('wonderwall', 'Oasis')
    expect(mocks.createAndAddSong).not.toHaveBeenCalled()
    expect(within(panel()).getByText(/is already in the catalog/)).toBeTruthy()

    // Decline: nothing written, typed values kept.
    fireEvent.click(within(panel()).getByRole('button', { name: 'Cancel' }))
    expect(within(panel()).queryByText(/is already in the catalog/)).toBeNull()
    expect(mocks.createAndAddSong).not.toHaveBeenCalled()
    expect((within(panel()).getByLabelText('Artist') as HTMLInputElement).value).toBe('Oasis')

    // Accept: exactly one write.
    await submit()
    await act(async () => {
      fireEvent.click(within(panel()).getByRole('button', { name: 'Add as new version' }))
    })
    expect(mocks.createAndAddSong).toHaveBeenCalledExactlyOnceWith({ title: 'wonderwall', artist: 'Oasis' })
    expect(getRepertoireAction).toHaveBeenCalled()
  })

  it('creates a manual song with title, artist, album and status', async () => {
    const { actions, mocks } = buildActions([])
    await searchFor(actions)
    type('Title', 'Champagne Supernova')
    type('Artist', 'Oasis')
    type('Album', 'Morning Glory')
    type('Status', 'learning')
    await submit()

    expect(mocks.createAndAddSong).toHaveBeenCalledExactlyOnceWith({
      title: 'Champagne Supernova',
      artist: 'Oasis',
      album: 'Morning Glory',
    })
    expect(mocks.updateSongStatus).toHaveBeenCalledExactlyOnceWith('rep-new', 'learning')
    expect(mocks.addVersion).not.toHaveBeenCalled()
    // The form resets: the title follows the query again, the artist is empty.
    expect((within(panel()).getByLabelText('Title') as HTMLInputElement).value).toBe('wonderwall')
    expect((within(panel()).getByLabelText('Artist') as HTMLInputElement).value).toBe('')
  })

  it('does not write the default status and requires a title and an artist', async () => {
    const { actions, mocks } = buildActions([])
    await searchFor(actions)
    await submit()
    expect(screen.getByText('Title and artist are required.')).toBeTruthy()
    expect(mocks.findCatalogSong).not.toHaveBeenCalled()

    type('Artist', 'Oasis')
    await submit()
    expect(mocks.createAndAddSong).toHaveBeenCalledTimes(1)
    expect(mocks.updateSongStatus).not.toHaveBeenCalled()
  })

  it('shows a failed add inline once', async () => {
    const { actions, mocks } = buildActions([])
    mocks.createAndAddSong.mockRejectedValue(new Error('Song already in your repertoire'))
    await searchFor(actions)
    type('Artist', 'Oasis')
    await submit()

    expect(screen.getAllByText('Song already in your repertoire')).toHaveLength(1)
  })
})

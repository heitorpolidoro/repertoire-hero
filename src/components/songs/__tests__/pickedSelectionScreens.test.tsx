// @vitest-environment jsdom
/**
 * RH-170 - "Select songs" on both screens: the mode shows the count, a row tap
 * toggles instead of opening the song, the picker screen is the stored origin,
 * and starting from a selection calls no write and no server action.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useBandContextStore } from '@/store/bandContextStore'
import { useRepertoireStore } from '@/store/repertoireStore'
import { clearSongQueue, readSongQueue, writeSongQueue } from '@/lib/songQueue'
import type { Repertoire } from '@/types/database'
import RepertoireDashboard, { type RepertoireDashboardActions } from '../RepertoireDashboard'
import { BandSongPicker } from '../BandSongPicker'

const { getRepertoireAction, removeSongAction, updateSongStatusAction, push } = vi.hoisted(() => ({
  getRepertoireAction: vi.fn(),
  removeSongAction: vi.fn(),
  updateSongStatusAction: vi.fn(),
  push: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/app/actions/repertoire', () => ({ getRepertoireAction, removeSongAction, updateSongStatusAction }))

afterEach(cleanup)
beforeEach(() => {
  clearSongQueue()
  push.mockReset()
  getRepertoireAction.mockReset()
  removeSongAction.mockReset()
  updateSongStatusAction.mockReset()
  useBandContextStore.getState().setUserContext()
  useRepertoireStore.setState({ songs: [], searchQuery: '', selectedStatus: null })
})

function row(id: string, title: string, artist: string): Repertoire {
  return {
    id: `row-${id}`,
    user_id: 'u',
    band_id: null,
    song_id: `s-${id}`,
    version_id: id,
    key: null,
    tuning: null,
    status: 'learning',
    tags: [],
    last_practiced: null,
    lyrics: null,
    map: null,
    song: { title, artist } as Repertoire['song'],
  }
}

const SONGS = [row('v1', 'Hallelujah', 'Cohen'), row('v2', 'Black', 'Pearl Jam'), row('v3', 'Creep', 'Radiohead')]

function dashboardActions() {
  const spies = {
    createAndAddSong: vi.fn(),
    addSong: vi.fn(),
    addVersion: vi.fn(),
    searchSongs: vi.fn(async () => []),
    updateSong: vi.fn(),
    updateSongStatus: vi.fn(),
    updateSongTags: vi.fn(),
    submitCatalogSuggestion: vi.fn(),
    findCatalogSong: vi.fn(),
    getBandRole: vi.fn(async () => 'member'),
    practice: { getCandidates: vi.fn(), getPlaylists: vi.fn(async () => []) },
  }
  return { spies, actions: spies as unknown as RepertoireDashboardActions }
}

describe('RepertoireDashboard "Select songs"', () => {
  it('toggles rows in tap order, numbers them and counts, then stores a personal queue', async () => {
    getRepertoireAction.mockResolvedValue(SONGS)
    const { spies, actions } = dashboardActions()
    render(<RepertoireDashboard actions={actions} />)
    await screen.findByText('Hallelujah')

    fireEvent.click(screen.getByRole('button', { name: 'Select songs' }))
    expect(screen.getByText('0 picked')).toBeTruthy()
    // The bar's "Start practice" replaces RH-168's button while picking, disabled at zero.
    expect((screen.getByRole('button', { name: 'Start practice' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByText('Creep'))
    fireEvent.click(screen.getByText('Hallelujah'))
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByText('2 picked')).toBeTruthy()
    const badges = screen.getAllByTestId('pick-badge').map((b) => b.textContent)
    expect(badges).toEqual(['2', '', '1'])

    fireEvent.click(screen.getByRole('button', { name: 'Start practice' }))

    expect(readSongQueue()).toEqual({
      entries: [
        { versionId: 'v3', title: 'Creep', artist: 'Radiohead' },
        { versionId: 'v1', title: 'Hallelujah', artist: 'Cohen' },
      ],
      owner: { type: 'personal' },
      originHref: '/',
      label: 'Hand-picked selection',
    })
    expect(push).toHaveBeenCalledExactlyOnceWith('/songs/v3/fast-view')
    for (const key of ['createAndAddSong', 'updateSong', 'updateSongStatus', 'updateSongTags', 'submitCatalogSuggestion', 'addSong', 'addVersion'] as const) {
      expect(spies[key]).not.toHaveBeenCalled()
    }
    expect(spies.practice.getCandidates).not.toHaveBeenCalled()
    expect(updateSongStatusAction).not.toHaveBeenCalled()
    expect(removeSongAction).not.toHaveBeenCalled()
    expect(getRepertoireAction).toHaveBeenCalledTimes(1)
  })

  it('keeps picks of rows hidden by a filter, and cancel leaves an existing queue alone', async () => {
    getRepertoireAction.mockResolvedValue(SONGS)
    const existing = {
      entries: [{ versionId: 'x', title: 'X', artist: null }],
      owner: { type: 'personal' as const },
      originHref: '/playlists/p',
      label: 'Gig',
    }
    writeSongQueue(existing)
    render(<RepertoireDashboard actions={dashboardActions().actions} />)
    await screen.findByText('Hallelujah')

    fireEvent.click(screen.getByRole('button', { name: 'Select songs' }))
    fireEvent.click(screen.getByText('Black'))
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Creep' } })
    await waitFor(() => expect(screen.queryByText('Black')).toBeNull())
    expect(screen.getByText('1 picked')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(readSongQueue()).toEqual(existing)
    expect(push).not.toHaveBeenCalled()
    expect(screen.queryByText('1 picked')).toBeNull()
  })

  it('stores a band owner when the dashboard browses a band, with bandId on the href', async () => {
    useBandContextStore.getState().setBandContext('band-9', 'The Wrenches', '#123456')
    getRepertoireAction.mockResolvedValue(SONGS)
    render(<RepertoireDashboard actions={dashboardActions().actions} />)
    await screen.findByText('Hallelujah')
    await act(async () => {})

    fireEvent.click(screen.getByRole('button', { name: 'Select songs' }))
    fireEvent.click(screen.getByText('Black'))
    fireEvent.click(screen.getByRole('button', { name: 'Start practice' }))

    expect(readSongQueue()).toMatchObject({ owner: { type: 'band', bandId: 'band-9' }, originHref: '/' })
    expect(push).toHaveBeenCalledWith('/songs/v2/fast-view?bandId=band-9')
  })
})

describe('BandSongPicker', () => {
  it('toggles instead of opening, shows numbers, and stores a band queue with the band origin', async () => {
    const getBandSongs = vi.fn(async () => SONGS)
    render(<BandSongPicker bandId="b1" actions={{ getBandSongs }} />)
    await screen.findByText('Black')
    expect(screen.getAllByRole('link')[0].getAttribute('href')).toBe('/songs/v1/fast-view?bandId=b1')

    fireEvent.click(screen.getByRole('button', { name: 'Select songs' }))
    const start = screen.getByRole('button', { name: 'Start practice' }) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    expect(screen.queryAllByRole('link')).toHaveLength(0)

    fireEvent.click(screen.getByText('Black'))
    fireEvent.click(screen.getByText('Creep'))
    fireEvent.click(screen.getByText('Black')) // un-pick: Creep becomes 1
    fireEvent.click(screen.getByText('Black')) // re-pick: Black is 2
    expect(screen.getByText('2 picked')).toBeTruthy()
    expect(screen.getAllByTestId('pick-badge').map((b) => b.textContent)).toEqual(['', '2', '1'])

    fireEvent.click(screen.getByRole('button', { name: 'Start practice' }))

    expect(readSongQueue()).toEqual({
      entries: [
        { versionId: 'v3', title: 'Creep', artist: 'Radiohead' },
        { versionId: 'v2', title: 'Black', artist: 'Pearl Jam' },
      ],
      owner: { type: 'band', bandId: 'b1' },
      originHref: '/bands/b1',
      label: 'Hand-picked selection',
    })
    expect(push).toHaveBeenCalledExactlyOnceWith('/songs/v3/fast-view?bandId=b1')
    expect(getBandSongs).toHaveBeenCalledTimes(1)
    expect(removeSongAction).not.toHaveBeenCalled()
    expect(updateSongStatusAction).not.toHaveBeenCalled()
  })

  it('cancel stores no queue', async () => {
    render(<BandSongPicker bandId="b1" actions={{ getBandSongs: async () => SONGS }} />)
    await screen.findByText('Black')
    fireEvent.click(screen.getByRole('button', { name: 'Select songs' }))
    fireEvent.click(screen.getByText('Black'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(readSongQueue()).toBeNull()
    expect(push).not.toHaveBeenCalled()
  })

  it('shows an empty state when the read fails', async () => {
    render(<BandSongPicker bandId="b1" actions={{ getBandSongs: async () => { throw new Error('nope') } }} />)
    expect(await screen.findByText('No songs yet.')).toBeTruthy()
  })
})

// @vitest-environment jsdom
/**
 * RH-172 - "Start practice" on the dashboard in band context: rendered, hidden
 * while the song picker is active, and a start records the band owner with `/`
 * as the origin.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useBandContextStore } from '@/store/bandContextStore'
import { useRepertoireStore } from '@/store/repertoireStore'
import { clearSongQueue, readSongQueue } from '@/lib/songQueue'
import RepertoireDashboard, { type RepertoireDashboardActions } from '../RepertoireDashboard'

const { getRepertoireAction, push } = vi.hoisted(() => ({
  getRepertoireAction: vi.fn(),
  push: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/app/actions/repertoire', () => ({
  getRepertoireAction,
  removeSongAction: vi.fn(),
  updateSongStatusAction: vi.fn(),
}))

afterEach(cleanup)
beforeEach(() => {
  clearSongQueue()
  push.mockReset()
  getRepertoireAction.mockReset()
  getRepertoireAction.mockResolvedValue([])
  useBandContextStore.getState().setBandContext('band-7', 'The Wrenches', '#123456')
  useRepertoireStore.setState({ songs: [], searchQuery: '', selectedStatus: null })
})

function actionsWith(practice: object) {
  return {
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
    practice,
  } as unknown as RepertoireDashboardActions
}

describe('dashboard in band context', () => {
  it('renders Start practice and starts with the band id and "/" as origin', async () => {
    const practice = {
      getCandidates: vi.fn(async () => [
        { versionId: 'v1', title: 'Black', artist: 'Pearl Jam', status: 'unknown', lastPracticed: null },
      ]),
      getPlaylists: vi.fn(async () => [{ id: 'p-1', name: 'Gig' }]),
    }
    render(<RepertoireDashboard actions={actionsWith(practice)} />)
    await act(async () => {})

    fireEvent.click(screen.getByRole('button', { name: 'Start practice' }))
    await waitFor(() => expect(practice.getPlaylists).toHaveBeenCalledWith('band-7'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Gig' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/songs/v1/fast-view?bandId=band-7'))
    expect(practice.getCandidates).toHaveBeenCalledWith({ kind: 'playlist', playlistId: 'p-1' }, 'band-7')
    expect(readSongQueue()).toMatchObject({ owner: { type: 'band', bandId: 'band-7' }, originHref: '/', label: 'Gig' })
  })

  it('offers the whole repertoire in the source menu', async () => {
    const practice = { getCandidates: vi.fn(), getPlaylists: vi.fn(async () => []) }
    render(<RepertoireDashboard actions={actionsWith(practice)} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Start practice' }))
    expect(await screen.findByRole('menuitem', { name: 'Whole repertoire' })).toBeTruthy()
  })

  it('hides the menu button while the song picker is active', async () => {
    const practice = { getCandidates: vi.fn(), getPlaylists: vi.fn(async () => []) }
    render(<RepertoireDashboard actions={actionsWith(practice)} />)
    await act(async () => {})
    expect(screen.getAllByRole('button', { name: 'Start practice' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Start practice' }).getAttribute('aria-haspopup')).toBe('menu')

    fireEvent.click(screen.getByRole('button', { name: 'Select songs' }))

    // Only the picker bar's own Start practice remains (no source menu).
    const buttons = screen.getAllByRole('button', { name: 'Start practice' })
    expect(buttons).toHaveLength(1)
    expect(buttons[0].getAttribute('aria-haspopup')).toBeNull()
  })
})

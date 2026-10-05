// @vitest-environment jsdom
/**
 * RH-77 — TC3: the band-context hydration guard.
 *
 * `src/store/bandContextStore.ts` persists to `localStorage` and rehydrates
 * synchronously at store creation, so a band-mode user's first client render
 * would otherwise carry `{ type: 'band', ... }` while the server rendered the
 * `{ type: 'user' }` default — the exact mismatch this task removes from `/`.
 *
 * `renderToString` runs no effects, so what it returns is precisely the first
 * render. With a band pre-set in the store, that first render must still be
 * the personal variant: the header says `My Repertoire` and the band name
 * appears nowhere.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { useBandContextStore } from '@/store/bandContextStore'
import { useRepertoireStore } from '@/store/repertoireStore'
import RepertoireDashboard, {
  type RepertoireDashboardActions,
} from '../RepertoireDashboard'

// `useRepertoireStore` reaches the server through these three; the dashboard's
// own seven actions arrive injected, so only the store's module needs a mock.
const { getRepertoireAction, removeSongAction, updateSongStatusAction } = vi.hoisted(() => ({
  getRepertoireAction: vi.fn(),
  removeSongAction: vi.fn(),
  updateSongStatusAction: vi.fn(),
}))

vi.mock('@/app/actions/repertoire', () => ({
  getRepertoireAction,
  removeSongAction,
  updateSongStatusAction,
}))

afterEach(cleanup)

const BAND_NAME = 'Quarteto Contramão'

const NOOP_ACTIONS = {
  createAndAddSong: async () => {
    throw new Error('not called in a first render')
  },
  addSong: async () => {
    throw new Error('not called in a first render')
  },
  searchGlobalSongs: async () => [],
  updateSong: async () => {},
  updateSongStatus: async () => {},
  updateSongTags: async () => {},
  submitGlobalSongEdit: async () => {},
} as unknown as RepertoireDashboardActions

describe('RepertoireDashboard first render (RH-77 hydration guard)', () => {
  it('renders the personal variant even with a band in the context store', () => {
    useBandContextStore.getState().setBandContext('band-1', BAND_NAME, '#123456')
    expect(useBandContextStore.getState().context).toEqual({
      type: 'band',
      id: 'band-1',
      name: BAND_NAME,
      color: '#123456',
    })

    const html = renderToString(<RepertoireDashboard actions={NOOP_ACTIONS} />)

    expect(html).toContain('My Repertoire')
    expect(html).not.toContain(BAND_NAME)
  })

  it('renders the personal variant when the band came back from localStorage', async () => {
    // The production shape: `persist` rehydrates at store creation, before any
    // component renders, so the band is in the store from the first read.
    localStorage.setItem(
      'band-context',
      JSON.stringify({ state: { context: { type: 'band', id: 'band-1', name: BAND_NAME } }, version: 0 }),
    )
    vi.resetModules()
    const [{ default: Dashboard }, { useBandContextStore: freshStore }] = await Promise.all([
      import('../RepertoireDashboard'),
      import('@/store/bandContextStore'),
    ])
    expect(freshStore.getState().context).toMatchObject({ type: 'band', name: BAND_NAME })

    const html = renderToString(<Dashboard actions={NOOP_ACTIONS} />)

    expect(html).toContain('My Repertoire')
    expect(html).not.toContain(BAND_NAME)
  })
})

/**
 * RH-96 — the three states of the dashboard's status badge.
 *
 * A band's status is no longer computed from its members, so in band context
 * the badge is the same cycling button personal context has — for a band
 * admin. For a plain member it stays the read-only `<span>`, now captioned with
 * the real reason. The role comes from `actions.getBandRole`, so until it
 * resolves the gate fails closed exactly as the server's does.
 */
describe('RepertoireDashboard status badge (RH-96)', () => {
  const SONG = {
    id: 'rep-1',
    user_id: null,
    band_id: 'band-1',
    song_id: 'song-1',
    status: 'learning',
    tags: [],
    personal_key: null,
    lyrics: null,
    last_practiced: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    song: { id: 'song-1', title: 'Teclado Azul', artist: 'Someone', album: null },
  }

  const READ_ONLY_CAPTION = 'Band status is set by a band admin'
  const ADVANCE_LABEL = 'Status: Learning. Click to advance.'

  const actionsWithRole = (
    role: 'admin' | 'member' | null,
  ): RepertoireDashboardActions =>
    ({
      ...NOOP_ACTIONS,
      getBandRole: vi.fn(async () => {
        if (role === null) throw new Error('Access denied: not a member of this band')
        return role
      }),
    }) as unknown as RepertoireDashboardActions

  const renderDashboard = async (actions: RepertoireDashboardActions) => {
    await act(async () => {
      render(<RepertoireDashboard actions={actions} />)
    })
  }

  beforeEach(() => {
    getRepertoireAction.mockReset()
    updateSongStatusAction.mockReset()
    getRepertoireAction.mockResolvedValue([SONG])
    updateSongStatusAction.mockResolvedValue(undefined)
    useRepertoireStore.setState({ songs: [SONG] as never, searchQuery: '', selectedStatus: null })
    useBandContextStore.getState().setBandContext('band-1', 'Banda Um', '#123456')
  })

  it('gives a band admin the cycling button, and it advances the band row', async () => {
    await renderDashboard(actionsWithRole('admin'))

    const button = await screen.findByLabelText(ADVANCE_LABEL)
    expect(screen.queryByTitle(READ_ONLY_CAPTION)).toBeNull()

    await act(async () => {
      fireEvent.click(button)
    })

    expect(updateSongStatusAction).toHaveBeenCalledExactlyOnceWith('rep-1', 'practicing', 'band-1')
  })

  it('gives a non-admin member a read-only badge and no button', async () => {
    await renderDashboard(actionsWithRole('member'))

    await waitFor(() => {
      expect(screen.getByTitle(READ_ONLY_CAPTION)).toBeTruthy()
    })
    expect(screen.queryByLabelText(ADVANCE_LABEL)).toBeNull()
    expect(updateSongStatusAction).not.toHaveBeenCalled()
  })

  it('fails closed while the role is unknown and when the read refuses', async () => {
    await renderDashboard(actionsWithRole(null))

    expect(screen.getByTitle(READ_ONLY_CAPTION)).toBeTruthy()
    expect(screen.queryByLabelText(ADVANCE_LABEL)).toBeNull()
  })

  it('leaves personal context with its button and asks for no role', async () => {
    useBandContextStore.getState().setUserContext()
    const actions = actionsWithRole('admin')

    await renderDashboard(actions)

    expect(await screen.findByLabelText(ADVANCE_LABEL)).toBeTruthy()
    expect(screen.queryByTitle(READ_ONLY_CAPTION)).toBeNull()
    expect(actions.getBandRole).not.toHaveBeenCalled()
  })
})

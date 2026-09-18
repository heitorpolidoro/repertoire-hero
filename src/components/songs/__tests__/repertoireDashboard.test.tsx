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
import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { useBandContextStore } from '@/store/bandContextStore'
import RepertoireDashboard, {
  type RepertoireDashboardActions,
} from '../RepertoireDashboard'

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

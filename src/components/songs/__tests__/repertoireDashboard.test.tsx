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
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { useBandContextStore } from '@/store/bandContextStore'
import { useRepertoireStore } from '@/store/repertoireStore'
import { ALL_STATUSES, STATUS_CONFIG } from '@/lib/statusConfig'
import { resolveSongFields } from '@/lib/songResolution'
import {
  readSongQueue,
  writeSongQueue,
  SONG_QUEUE_KEY,
  type SongQueue,
} from '@/lib/songQueue'
import type { SongStatus } from '@/types/database'
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
  searchSongs: async () => [],
  updateSong: async () => {},
  updateSongStatus: async () => {},
  updateSongTags: async () => {},
  submitCatalogSuggestion: async () => {},
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
 * RH-96's gating under RH-102's control.
 *
 * A band's status is no longer computed from its members, so in band context a
 * band admin writes it and every other member may not. RH-102 changes what the
 * control *is* — four notes and the stage name, replacing the cycling pill —
 * without touching who may write: an admin gets the notes enabled, anyone else
 * gets the same four notes `disabled`. The role comes from
 * `actions.getBandRole`, so until it resolves the gate fails closed exactly as
 * the server's does.
 */
describe('RepertoireDashboard status notes (RH-96 gating, RH-102 control)', () => {
  const SONG = {
    id: 'rep-1',
    user_id: null,
    band_id: 'band-1',
    song_id: 'song-1',
    status: 'learning',
    tags: [],
    version_id: 'version-1',
    key: null,
    tuning: null,
    map: null,
    lyrics: null,
    last_practiced: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    song: { id: 'song-1', title: 'Teclado Azul', artist: 'Someone', album: null },
  }

  // RH-102 replaced RH-96's `Status: <label>. Click to advance.` button and its
  // read-only pill with the four notes. The admin predicate is unchanged: an
  // admin writes the band row, every other member sees the same four notes
  // disabled. Neither the old caption nor the old label is left anywhere.
  const GONE_CAPTION = 'Band status is computed from all members'
  const GONE_ADMIN_CAPTION = 'Band status is set by a band admin'
  const GONE_ADVANCE_LABEL = 'Status: Learning. Click to advance.'

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

  /** The four notes of the one repertoire row, in order. */
  const rowNotes = () =>
    within(screen.getByRole('group', { name: 'Mastery status' })).getAllByRole(
      'button',
    ) as HTMLButtonElement[]

  beforeEach(() => {
    getRepertoireAction.mockReset()
    updateSongStatusAction.mockReset()
    getRepertoireAction.mockResolvedValue([SONG])
    updateSongStatusAction.mockResolvedValue(undefined)
    useRepertoireStore.setState({ songs: [SONG] as never, searchQuery: '', selectedStatus: null })
    useBandContextStore.getState().setBandContext('band-1', 'Banda Um', '#123456')
  })

  it('shows the note control on the row instead of a pill badge, and no stale caption', async () => {
    await renderDashboard(actionsWithRole('admin'))

    await waitFor(() => expect(rowNotes()).toHaveLength(4))
    expect(rowNotes().map((note) => note.getAttribute('aria-label'))).toEqual([
      'Clear status',
      'Set status to Practicing',
      'Set status to Polishing',
      'Set status to Mastered',
    ])
    expect(screen.queryByText(GONE_CAPTION)).toBeNull()
    expect(screen.queryByTitle(GONE_CAPTION)).toBeNull()
    expect(screen.queryByTitle(GONE_ADMIN_CAPTION)).toBeNull()
    expect(screen.queryByLabelText(GONE_ADVANCE_LABEL)).toBeNull()
  })

  it('lets a band admin tap a note, and writes the band row', async () => {
    await renderDashboard(actionsWithRole('admin'))

    await waitFor(() => expect(rowNotes().every((note) => !note.disabled)).toBe(true))

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Set status to Polishing'))
    })

    expect(updateSongStatusAction).toHaveBeenCalledExactlyOnceWith('rep-1', 'polishing', 'band-1')
  })

  it('also lets a band admin drop the row a stage, which the old button could not', async () => {
    await renderDashboard(actionsWithRole('admin'))

    await waitFor(() => expect(rowNotes().every((note) => !note.disabled)).toBe(true))

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Clear status'))
    })

    expect(updateSongStatusAction).toHaveBeenCalledExactlyOnceWith('rep-1', 'unknown', 'band-1')
  })

  it('gives a non-admin member the same four notes, all disabled', async () => {
    await renderDashboard(actionsWithRole('member'))

    await waitFor(() => {
      expect(rowNotes().every((note) => note.disabled)).toBe(true)
    })
    expect(rowNotes()).toHaveLength(4)
    expect(rowNotes().map((note) => note.getAttribute('aria-label'))).toEqual([
      'Clear status',
      'Set status to Practicing',
      'Set status to Polishing',
      'Set status to Mastered',
    ])

    for (const note of rowNotes()) fireEvent.click(note)
    expect(updateSongStatusAction).not.toHaveBeenCalled()
  })

  it('fails closed while the role is unknown and when the read refuses', async () => {
    await renderDashboard(actionsWithRole(null))

    expect(rowNotes()).toHaveLength(4)
    expect(rowNotes().every((note) => note.disabled)).toBe(true)
  })

  it('leaves personal context writable and asks for no role', async () => {
    useBandContextStore.getState().setUserContext()
    const actions = actionsWithRole('admin')

    await renderDashboard(actions)

    await waitFor(() => expect(rowNotes().every((note) => !note.disabled)).toBe(true))
    expect(actions.getBandRole).not.toHaveBeenCalled()
  })
})

/**
 * RH-102 ER11 — the status *filter* is not the status *control*.
 *
 * `unknown` left `STATUS_ORDER` because it is zero notes filled, not a stage.
 * The filter is the other kind of list: it has to offer every value a row can
 * hold, so it enumerates `ALL_STATUSES` and keeps all five — with
 * `STATUS_CONFIG`'s per-status colours, which only the note control drops.
 */
describe('RepertoireDashboard status filter (RH-102 ER11)', () => {
  beforeEach(() => {
    getRepertoireAction.mockReset()
    getRepertoireAction.mockResolvedValue([])
    useRepertoireStore.setState({ songs: [], searchQuery: '', selectedStatus: null })
    useBandContextStore.getState().setUserContext()
  })

  it('still offers All plus the five statuses, Unknown included, in their colours', async () => {
    await act(async () => {
      render(<RepertoireDashboard actions={NOOP_ACTIONS} />)
    })

    for (const label of ['All', 'Unknown', 'Learning', 'Practicing', 'Polishing', 'Mastered']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }

    // Each chip wears its own `STATUS_CONFIG` colour once selected — the
    // behaviour this task leaves alone, unlike the note control's three greys.
    for (const status of ALL_STATUSES) {
      const cfg = STATUS_CONFIG[status]
      const chip = screen.getByRole('button', { name: cfg.label })
      fireEvent.click(chip)
      expect(screen.getByRole('button', { name: cfg.label }).className).toContain(cfg.bgColor)
    }
  })
})

/**
 * RH-124 ER15 — the dashboard lists a repertoire in both contexts off the new
 * tables.
 *
 * The rows are built the way the server builds them: the three levels of one
 * version go through `resolveSongFields`, the only place either cascade is
 * written, and what the list receives is the resolved row. That is what makes
 * this a test of the new model rather than of a hand-written fixture — the
 * `status` rendered is the owner row's, and the `key` the version's, because
 * the helper decided so.
 *
 * One row per context, because the two are independent holds on the same
 * version: the user's says `Learning`, the band's says `Mastered`, and neither
 * derives from the other (RH-96).
 */
describe('RepertoireDashboard off user_songs and band_songs (RH-124 ER15)', () => {
  const VERSION = { key: 'G', tuning: 'Standard', lyrics: null, map: null }
  const SONG = { lyrics: 'the composition words', map: null }

  const CATALOG = {
    id: 'song-7',
    title: 'Tempo Perdido',
    artist: 'Legião Urbana',
    album: 'Dois',
    standard_key: 'Em',
    cover_url: null,
    duration_seconds: 302,
    links: [],
    created_at: '2026-01-01T00:00:00.000Z',
  }

  /** An owner row as `@/lib/ownerSongRows` folds it, for one context. */
  const resolvedRow = (
    id: string,
    owner: { user_id: string | null; band_id: string | null },
    status: SongStatus,
  ) => ({
    id,
    ...owner,
    song_id: CATALOG.id,
    version_id: 'version-7',
    ...resolveSongFields({
      owner: { status, key: null, tuning: null, lyrics: null, map: null, tags: [], last_practiced: null },
      version: VERSION,
      song: SONG,
    }),
    song: CATALOG,
  })

  const USER_ROW = resolvedRow('user-song-1', { user_id: 'user-1', band_id: null }, 'learning')
  const BAND_ROW = resolvedRow('band-song-1', { user_id: null, band_id: 'band-1' }, 'mastered')

  const adminActions = {
    ...NOOP_ACTIONS,
    getBandRole: vi.fn(async () => 'admin' as const),
  } as unknown as RepertoireDashboardActions

  const renderWith = async (row: unknown) => {
    getRepertoireAction.mockResolvedValue([row])
    useRepertoireStore.setState({ songs: [row] as never, searchQuery: '', selectedStatus: null })
    await act(async () => {
      render(<RepertoireDashboard actions={adminActions} />)
    })
  }

  beforeEach(() => {
    getRepertoireAction.mockReset()
    updateSongStatusAction.mockReset()
  })

  it('lists the user row in personal context with its resolved status', async () => {
    useBandContextStore.getState().setUserContext()

    await renderWith(USER_ROW)

    const row = screen.getByRole('listitem')
    expect(within(row).getByText('Tempo Perdido')).toBeTruthy()
    expect(within(row).getByText('Legião Urbana')).toBeTruthy()
    expect(within(row).getByRole('group', { name: 'Mastery status' }).textContent).toContain(
      'Learning',
    )
  })

  it('lists the band row in band context with its own, different resolved status', async () => {
    useBandContextStore.getState().setBandContext('band-1', 'Banda Um', '#123456')

    await renderWith(BAND_ROW)

    const row = screen.getByRole('listitem')
    expect(within(row).getByText('Tempo Perdido')).toBeTruthy()
    expect(within(row).getByText('Legião Urbana')).toBeTruthy()
    expect(within(row).getByRole('group', { name: 'Mastery status' }).textContent).toContain(
      'Mastered',
    )
  })

  it('resolves the key from the version, not from the catalog standard_key', () => {
    // Not rendered anywhere yet (no screen hosts a key field — RH-102 and
    // RH-118 own that), but it is the field the two-level cascade is about, and
    // the row the dashboard is handed carries it.
    expect(USER_ROW.key).toBe('G')
    expect(USER_ROW.lyrics).toBe('the composition words')
  })
})

/**
 * RH-133 round 2 — the dashboard drops the tab's song queue.
 *
 * `sessionStorage` is tab-wide and dies only with the tab, while a song opened
 * from this list is opened alone: `docs/use-cases.md` § *Walk a queue of songs*
 * says "one song, opened alone | no queue, and no setlist chrome". Without the
 * clear, a playlist walked earlier in the same tab would still be in the store,
 * and the same song reopened from here would come back with that playlist's
 * setlist chrome, its prev/next and its Back target.
 *
 * `usePlaylistNav` also scopes a queue to the route's own version, which covers
 * every *other* song; this clear is what covers the same song, and it is the
 * exported `clearSongQueue`'s one production caller.
 */
describe('RepertoireDashboard and the tab song queue (RH-133)', () => {
  const SONG = {
    id: 'rep-9',
    user_id: 'user-1',
    band_id: null,
    song_id: 'song-9',
    status: 'learning' as SongStatus,
    tags: [],
    version_id: 'version-9',
    key: null,
    tuning: null,
    map: null,
    lyrics: null,
    last_practiced: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    song: { id: 'song-9', title: 'Pais e Filhos', artist: 'Legião Urbana', album: null },
  }

  const STALE_QUEUE: SongQueue = {
    entries: [
      { versionId: 'version-9', title: 'Pais e Filhos', artist: 'Legião Urbana' },
      { versionId: 'version-10', title: 'Eduardo e Mônica', artist: 'Legião Urbana' },
    ],
    owner: { type: 'band', bandId: 'band-stale' },
    originHref: '/playlists/pl-1',
    label: 'Saturday gig',
  }

  beforeEach(async () => {
    sessionStorage.clear()
    getRepertoireAction.mockReset()
    getRepertoireAction.mockResolvedValue([SONG])
    useBandContextStore.getState().setUserContext()
    useRepertoireStore.setState({ songs: [SONG] as never, searchQuery: '', selectedStatus: null })
    await act(async () => {
      render(<RepertoireDashboard actions={NOOP_ACTIONS} />)
    })
  })

  it('clears a queue left over from a playlist when a song is opened from the list', () => {
    writeSongQueue(STALE_QUEUE)
    // The precondition, asserted: the stale queue does hold this very song, so
    // route scoping alone would not drop it.
    expect(readSongQueue()?.entries.map((entry) => entry.versionId)).toContain('version-9')

    fireEvent.click(screen.getByRole('link', { name: /Pais e Filhos/ }))

    expect(readSongQueue()).toBeNull()
    expect(sessionStorage.getItem(SONG_QUEUE_KEY)).toBeNull()
  })

  it('is a no-op when the tab holds no queue at all', () => {
    fireEvent.click(screen.getByRole('link', { name: /Pais e Filhos/ }))

    expect(readSongQueue()).toBeNull()
  })
})

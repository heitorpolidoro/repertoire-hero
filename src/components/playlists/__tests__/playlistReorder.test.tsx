// @vitest-environment jsdom
/**
 * RH-103 — the reorder affordance of `/playlists/[id]`.
 *
 * Two halves, both in the DOM because both are about what the browser decides:
 *
 *  - the *Reorder* toggle, which the header offers only when the caller may
 *    reorder and no filter is narrowing the list (ER14, ER20);
 *  - the reorder-mode row and the drag (ER15–ER19). The gesture is Pointer
 *    Events and CSS `touch-action` with no dependency, so the one thing that
 *    decides whether a press scrolls or drags is *where it landed*: the handle
 *    carries `touch-action: none` and nothing else does. That is asserted here
 *    rather than left to a manual pass on a phone.
 *
 * The rows' geometry is stubbed (`layOutRows`), because jsdom gives every
 * element a zero-sized rect and the drag's whole answer comes from midpoints.
 * The arithmetic those midpoints feed is covered without a DOM in
 * `src/lib/__tests__/playlistReorderDrag.test.ts`.
 */

import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

import { PlaylistDetailView } from '@/components/playlists/PlaylistDetailView'
import {
  PlaylistSongList,
  type PlaylistSongListProps,
} from '@/components/playlists/PlaylistSongList'
import type { PlaylistDetailActions } from '@/hooks/usePlaylistDetail'
import type { OfflineDownloadActions } from '@/hooks/useOfflinePlaylist'
import type { SongPickerActions } from '@/hooks/useSongPicker'
import type { TagEditorController } from '@/hooks/useTagEditor'
import { logger } from '@/lib/logger'
import type { Playlist, PlaylistSong, Repertoire } from '@/types/database'

afterEach(cleanup)

const TITLES = ['Blue Moon', 'Red Sun', 'Green Sky']

function song(index: number): PlaylistSong {
  return {
    id: `ps-s${index + 1}`,
    playlist_id: 'pl-1',
    song_id: `s${index + 1}`,
    position: index + 1,
    song: {
      id: `s${index + 1}`,
      title: TITLES[index],
      artist: 'RH-103 Artist',
      album: null,
      standard_key: null,
      cover_url: null,
      duration_seconds: 215,
      links: [],
      created_at: '2026-01-01T00:00:00.000Z',
    },
  }
}

const SONGS = [song(0), song(1), song(2)]

function entry(songId: string, tags: string[] = []): Repertoire {
  return {
    id: `rep-${songId}`,
    user_id: 'u1',
    band_id: null,
    song_id: songId,
    personal_key: null,
    status: 'learning',
    tags,
    last_practiced: null,
    lyrics: null,
  }
}

function tagEditor(): TagEditorController {
  return {
    openFor: null,
    draft: '',
    inputRef: { current: null },
    open: vi.fn(),
    close: vi.fn(),
    changeDraft: vi.fn(),
    commitDraft: vi.fn(async () => {}),
    removeTag: vi.fn(async () => {}),
  }
}

// ---------------------------------------------------------------------------
// The list, rendered directly: the mode is a prop here, so the row and the
// gesture are reachable without driving the whole island.
// ---------------------------------------------------------------------------

function listProps(overrides: Partial<PlaylistSongListProps> = {}): PlaylistSongListProps {
  return {
    songs: SONGS,
    filteredSongs: SONGS,
    repertoireMap: new Map(SONGS.map((ps) => [ps.song_id, entry(ps.song_id, ['encore'])])),
    playlistId: 'pl-1',
    bandId: null,
    activeTagFilter: null,
    songFilterQuery: '',
    tagEditor: tagEditor(),
    onStatusChange: vi.fn(async () => {}),
    onRemoveSong: vi.fn(async () => {}),
    reordering: false,
    onMoveSong: vi.fn(async () => {}),
    onReorderSongs: vi.fn(async () => {}),
    ...overrides,
  }
}

/** Three 56px rows from y = 100, so the midpoints are 128, 184 and 240. */
const ROW_HEIGHT = 56
const FIRST_ROW_TOP = 100

function layOutRows(rows: HTMLElement[]): void {
  rows.forEach((row, index) => {
    const top = FIRST_ROW_TOP + index * ROW_HEIGHT
    row.getBoundingClientRect = () =>
      ({
        top,
        bottom: top + ROW_HEIGHT,
        height: ROW_HEIGHT,
        left: 0,
        right: 390,
        width: 390,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect
  })
}

const insertionLine = () => document.querySelector('[data-testid="reorder-insertion-line"]')
const liftedRow = () => document.querySelector('[data-dragging="true"]')

/** Renders the list in reorder mode and lays out its rows for the gesture. */
function renderReorderList(overrides: Partial<PlaylistSongListProps> = {}) {
  const props = listProps({ reordering: true, ...overrides })
  render(<PlaylistSongList {...props} />)
  const rows = screen
    .getAllByRole('listitem')
    .filter((row) => row.querySelector('[data-reorder-handle]'))
  layOutRows(rows)
  const handles = rows.map((row) => within(row).getByRole('button', { name: /^Drag / }))
  return { props, rows, handles }
}

describe('reorder mode rows (RH-103)', () => {
  // No global `clearMocks`, and two tests below assert a single `logger.error`
  // call, so the shared mock is reset per test rather than per file.
  beforeEach(() => vi.mocked(logger.error).mockClear())

  it('renders a handle and both arrows per row, with the ends disabled and nothing else (ER15)', () => {
    const { rows } = renderReorderList()

    expect(rows).toHaveLength(3)
    TITLES.forEach((title, index) => {
      const row = within(rows[index])
      expect(row.getByRole('button', { name: `Drag ${title} to reorder` })).toBeDefined()
      expect(row.getByRole('button', { name: `Move ${title} up` })).toBeDefined()
      expect(row.getByRole('button', { name: `Move ${title} down` })).toBeDefined()
    })

    expect(
      within(rows[0]).getByRole('button', { name: 'Move Blue Moon up' }).hasAttribute('disabled'),
    ).toBe(true)
    expect(
      within(rows[0]).getByRole('button', { name: 'Move Blue Moon down' }).hasAttribute('disabled'),
    ).toBe(false)
    expect(
      within(rows[2]).getByRole('button', { name: 'Move Green Sky down' }).hasAttribute('disabled'),
    ).toBe(true)
    expect(
      within(rows[2]).getByRole('button', { name: 'Move Green Sky up' }).hasAttribute('disabled'),
    ).toBe(false)

    // What yields while the mode is on: the duration, the four-note control,
    // the remove button and the tag row. 215s renders as 3:35 the rest of the
    // time.
    expect(screen.queryByText('3:35')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Mastery status' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Remove Blue Moon from playlist$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add tag' })).toBeNull()

    // And the row still says which song it is.
    expect(screen.getByText('Blue Moon')).toBeDefined()
  })

  it('calls the one-place move with the row and the direction (ER15)', () => {
    const { props, rows } = renderReorderList()

    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Move Red Sun up' }))
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Move Red Sun down' }))

    expect(props.onMoveSong).toHaveBeenNthCalledWith(1, 's2', 'up')
    expect(props.onMoveSong).toHaveBeenNthCalledWith(2, 's2', 'down')
  })

  it('routes a rejected one-place move to the logger rather than the console', async () => {
    const cause = new Error('move failed')
    const { rows } = renderReorderList({
      onMoveSong: vi.fn(async () => {
        throw cause
      }),
    })

    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Move Red Sun up' }))
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(1))

    expect(logger.error).toHaveBeenCalledWith(expect.any(String), cause)
  })

  it('renders exactly what RH-102 leaves while the mode is off (ER16)', () => {
    render(<PlaylistSongList {...listProps()} />)

    expect(screen.getAllByText('3:35')).toHaveLength(3)
    expect(screen.getAllByRole('group', { name: 'Mastery status' })).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Remove Blue Moon from playlist' })).toBeDefined()
    expect(screen.getAllByRole('button', { name: 'Add tag' })).toHaveLength(3)

    expect(document.querySelector('[data-reorder-handle]')).toBeNull()
    for (const title of TITLES) {
      expect(screen.queryByRole('button', { name: `Move ${title} up` })).toBeNull()
      expect(screen.queryByRole('button', { name: `Move ${title} down` })).toBeNull()
      expect(screen.queryByRole('button', { name: `Drag ${title} to reorder` })).toBeNull()
    }
  })
})

describe('the reorder drag (RH-103)', () => {
  it('swallows the touch gesture on the handle alone (ER17)', () => {
    const { rows, handles } = renderReorderList()
    const container = screen.getByRole('region', { name: 'Songs in this playlist' })

    expect(handles[0].style.touchAction).toBe('none')
    expect(rows[0].style.touchAction).toBe('pan-y')
    expect(container.style.touchAction).toBe('pan-y')
    expect(rows[0].style.touchAction).not.toBe('none')
    expect(container.style.touchAction).not.toBe('none')
  })

  it('starts no drag from a pointerdown on the row outside the handle (ER17)', () => {
    const { props, rows } = renderReorderList()

    fireEvent.pointerDown(within(rows[0]).getByText('Blue Moon'), {
      pointerId: 1,
      clientY: 128,
    })
    fireEvent.pointerMove(within(rows[0]).getByText('Blue Moon'), {
      pointerId: 1,
      clientY: 200,
    })

    expect(liftedRow()).toBeNull()
    expect(insertionLine()).toBeNull()
    expect(props.onReorderSongs).toHaveBeenCalledTimes(0)
  })

  it('commits the permuted order after a full drag past the next midpoint (ER18)', () => {
    const { props, rows, handles } = renderReorderList()

    fireEvent.pointerDown(handles[0], { pointerId: 1, clientY: 128 })
    fireEvent.pointerMove(handles[0], { pointerId: 1, clientY: 190 })

    expect(insertionLine()).not.toBeNull()
    expect(rows[0].getAttribute('data-dragging')).toBe('true')
    expect(rows[0].style.transform).toContain('translateY')

    fireEvent.pointerUp(handles[0], { pointerId: 1, clientY: 190 })

    expect(props.onReorderSongs).toHaveBeenCalledTimes(1)
    expect(props.onReorderSongs).toHaveBeenCalledWith(['ps-s2', 'ps-s1', 'ps-s3'])
    expect(insertionLine()).toBeNull()
    expect(liftedRow()).toBeNull()
  })

  it('routes a rejected commit to the logger rather than the console', async () => {
    const cause = new Error('commit failed')
    const { handles } = renderReorderList({
      onReorderSongs: vi.fn(async () => {
        throw cause
      }),
    })

    fireEvent.pointerDown(handles[0], { pointerId: 1, clientY: 128 })
    fireEvent.pointerMove(handles[0], { pointerId: 1, clientY: 190 })
    fireEvent.pointerUp(handles[0], { pointerId: 1, clientY: 190 })
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(1))

    expect(logger.error).toHaveBeenCalledWith(expect.any(String), cause)
  })

  it('writes nothing for a drag released where it started (ER18)', () => {
    const { props, handles } = renderReorderList()

    fireEvent.pointerDown(handles[1], { pointerId: 1, clientY: 184 })
    fireEvent.pointerMove(handles[1], { pointerId: 1, clientY: 186 })
    fireEvent.pointerUp(handles[1], { pointerId: 1, clientY: 186 })

    expect(props.onReorderSongs).toHaveBeenCalledTimes(0)
  })

  it('writes nothing when the pointer is cancelled (ER19)', () => {
    const { props, rows, handles } = renderReorderList()

    fireEvent.pointerDown(handles[0], { pointerId: 1, clientY: 128 })
    fireEvent.pointerMove(handles[0], { pointerId: 1, clientY: 190 })
    expect(insertionLine()).not.toBeNull()

    fireEvent.pointerCancel(handles[0], { pointerId: 1, clientY: 190 })

    expect(props.onReorderSongs).toHaveBeenCalledTimes(0)
    expect(insertionLine()).toBeNull()
    expect(liftedRow()).toBeNull()
    expect(rows[0].hasAttribute('data-dragging')).toBe(false)
  })

  it('writes nothing when Escape ends the drag (ER19)', () => {
    const { props, rows, handles } = renderReorderList()

    fireEvent.pointerDown(handles[0], { pointerId: 1, clientY: 128 })
    fireEvent.pointerMove(handles[0], { pointerId: 1, clientY: 190 })
    expect(insertionLine()).not.toBeNull()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(props.onReorderSongs).toHaveBeenCalledTimes(0)
    expect(insertionLine()).toBeNull()
    expect(liftedRow()).toBeNull()
    expect(rows[0].hasAttribute('data-dragging')).toBe(false)

    // The cancelled gesture is really over: a release afterwards writes nothing.
    fireEvent.pointerUp(handles[0], { pointerId: 1, clientY: 190 })
    expect(props.onReorderSongs).toHaveBeenCalledTimes(0)
  })
})

// ---------------------------------------------------------------------------
// The toggle, through the island, so the filter/`canReorder` gate is the real
// one the page ships.
// ---------------------------------------------------------------------------

const DETAIL_ACTIONS = {
  updatePlaylist: vi.fn().mockResolvedValue(undefined),
  deletePlaylist: vi.fn().mockResolvedValue(undefined),
  removeSongFromPlaylist: vi.fn().mockResolvedValue(undefined),
  updateSongStatus: vi.fn().mockResolvedValue(undefined),
  updateSongTags: vi.fn().mockResolvedValue(undefined),
  reorderPlaylistSongs: vi.fn().mockResolvedValue(undefined),
} as unknown as PlaylistDetailActions

const PICKER_ACTIONS = {
  searchCatalog: vi.fn().mockResolvedValue([]),
  addToRepertoire: vi.fn().mockResolvedValue(null),
  createAndAddSong: vi.fn().mockResolvedValue(null),
  addSongToPlaylist: vi.fn().mockResolvedValue(undefined),
  getPlaylistWithSongs: vi.fn().mockResolvedValue(null),
} as unknown as SongPickerActions

const OFFLINE_ACTIONS = {
  getPlaylistDetailsWithEntries: vi.fn().mockResolvedValue({ name: 'Setlist', entries: [] }),
  getSongEntry: vi.fn().mockResolvedValue(null),
  getTabs: vi.fn().mockResolvedValue([]),
} as unknown as OfflineDownloadActions

function playlist(overrides: Partial<Playlist> = {}): Playlist {
  return {
    id: 'pl-1',
    user_id: 'u1',
    band_id: null,
    name: 'Friday Setlist',
    description: null,
    cover_url: null,
    spotify_playlist_id: null,
    sync_with_spotify: false,
    last_synced_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    tags: [],
    songs: SONGS,
    ...overrides,
  }
}

function renderIsland(options: { canReorder?: boolean; playlist?: Playlist } = {}) {
  render(
    <PlaylistDetailView
      playlist={options.playlist ?? playlist()}
      repertoire={SONGS.map((ps) => entry(ps.song_id, ['encore']))}
      currentUserId="u1"
      canReorder={options.canReorder ?? true}
      actions={DETAIL_ACTIONS}
      pickerActions={PICKER_ACTIONS}
      offlineActions={OFFLINE_ACTIONS}
    />,
  )
}

const reorderToggle = () => screen.queryByRole('button', { name: 'Reorder' })

describe('the Reorder toggle (RH-103)', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true })))
  afterEach(() => vi.unstubAllGlobals())

  it('is offered when the caller may reorder and no filter is active (ER14)', () => {
    renderIsland()

    expect(reorderToggle()).not.toBeNull()
  })

  it('is absent while a tag filter is selected (ER14)', () => {
    renderIsland()

    fireEvent.click(screen.getByRole('button', { name: 'encore' }))

    expect(reorderToggle()).toBeNull()
  })

  it('is absent while the text filter is non-empty (ER14)', () => {
    renderIsland()

    fireEvent.change(screen.getByPlaceholderText('Filter playlist by title or artist...'), {
      target: { value: 'moon' },
    })

    expect(reorderToggle()).toBeNull()
  })

  it('is absent when the caller may not reorder (ER14)', () => {
    renderIsland({ canReorder: false })

    expect(reorderToggle()).toBeNull()
  })

  it('turns the rows into reorder rows, and back (ER14)', () => {
    renderIsland()

    fireEvent.click(reorderToggle()!)

    expect(screen.getByRole('button', { name: 'Drag Blue Moon to reorder' })).toBeDefined()
    expect(reorderToggle()).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Done reordering' }))

    expect(screen.queryByRole('button', { name: 'Drag Blue Moon to reorder' })).toBeNull()
    expect(reorderToggle()).not.toBeNull()
  })

  it('offers nothing to a band member and offers the toggle to a band admin (ER20)', () => {
    const band = playlist({ user_id: null, band_id: 'band-1' })

    renderIsland({ playlist: band, canReorder: false })
    expect(reorderToggle()).toBeNull()

    cleanup()

    renderIsland({ playlist: band, canReorder: true })
    expect(reorderToggle()).not.toBeNull()
  })

  it('derives canReorder from the role the page reads on the server (ER20)', () => {
    const page = fs.readFileSync(
      path.resolve(__dirname, '..', '..', '..', 'app', 'playlists', '[id]', 'page.tsx'),
      'utf8',
    )

    // The role comes from `src/lib`, under the session the page already
    // resolved — not from a zustand store, which no server render can read.
    expect(page).toContain('assertBandMember')
    expect(page).toContain('canReorder')
    expect(page).not.toContain('bandContextStore')
  })
})

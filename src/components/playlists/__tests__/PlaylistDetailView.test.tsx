// @vitest-environment jsdom
/**
 * RH-71 — `/playlists/[id]` is a Server Component and this island only renders
 * what the server read.
 *
 * Every test supplies the playlist and the repertoire as props, none of them
 * waits for a load, and one proves mechanically that a plain render issues no
 * request at all — the mount-effect read the page used to run is gone, not
 * relocated into the island. The last one renders the display half of the
 * owner-context decision: a band playlist shows the read-only badge, a
 * personal one shows the cycling button.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
const { replace, refresh } = router

import { PlaylistDetailView } from '../PlaylistDetailView'
import { clearSongQueue, readSongQueue } from '@/lib/songQueue'
import type { PlaylistDetailActions } from '@/hooks/usePlaylistDetail'
import type { OfflineDownloadActions } from '@/hooks/useOfflinePlaylist'
import type { SongPickerActions } from '@/hooks/useSongPicker'
import type { Playlist, PlaylistSong, Repertoire } from '@/types/database'

afterEach(cleanup)
afterEach(() => vi.unstubAllGlobals())

beforeEach(() => {
  clearSongQueue()
  router.push.mockClear()
  replace.mockClear()
  refresh.mockClear()
})

/** Keyed by the **version** it names (RH-125); the song id is derived. */
function song(versionId: string, position: number, title: string): PlaylistSong {
  return {
    id: `ps-${versionId}`,
    playlist_id: 'pl-1',
    version_id: versionId,
    position,
    song: {
      id: `song-of-${versionId}`,
      title,
      artist: 'RH71 Artist',
    } as PlaylistSong['song'],
  }
}

const PERSONAL_OWNER = { user_id: 'u1', band_id: null }

const BLANK_ENTRY = {
  key: null,
  tuning: null,
  map: null,
  status: 'unknown',
  tags: [],
  last_practiced: null,
  lyrics: null,
} as const

const BLANK_PLAYLIST = {
  description: null,
  cover_url: null,
  spotify_playlist_id: null,
  sync_with_spotify: false,
  last_synced_at: null,
  created_at: '2026-02-02T00:00:00Z',
  updated_at: '2026-02-02T00:00:00Z',
  tags: [],
} as const

function entry(versionId: string, overrides: Partial<Repertoire> = {}): Repertoire {
  return {
    ...PERSONAL_OWNER,
    ...BLANK_ENTRY,
    id: `rep-${versionId}`,
    song_id: `song-of-${versionId}`,
    version_id: versionId,
    ...overrides,
  }
}

function playlist(overrides: Partial<Playlist> = {}): Playlist {
  return {
    ...PERSONAL_OWNER,
    ...BLANK_PLAYLIST,
    id: 'pl-1',
    name: 'Friday Setlist',
    songs: [song('s1', 1, 'Blue Moon'), song('s2', 2, 'Red Sun')],
    ...overrides,
  }
}

const ACTIONS = {
  updatePlaylist: vi.fn().mockResolvedValue(undefined),
  deletePlaylist: vi.fn().mockResolvedValue(undefined),
  removeSongFromPlaylist: vi.fn().mockResolvedValue(undefined),
  updateSongStatus: vi.fn().mockResolvedValue(undefined),
  updateSongTags: vi.fn().mockResolvedValue(undefined),
  recordPractice: vi.fn().mockResolvedValue(undefined),
  recordPracticeStatus: vi.fn().mockResolvedValue(undefined),
  reorderPlaylistSongs: vi.fn().mockResolvedValue(undefined),
}

const PICKER_ACTIONS = {
  searchCatalog: vi.fn().mockResolvedValue([]),
  addToRepertoire: vi.fn().mockResolvedValue(entry('s3')),
  createAndAddSong: vi.fn().mockResolvedValue(entry('s3')),
  addSongToPlaylist: vi.fn().mockResolvedValue(undefined),
  getPlaylistWithSongs: vi.fn().mockResolvedValue(playlist()),
}

/**
 * RH-79: the island renders the "Available offline" control, so it needs the
 * download action bundle. Nothing here triggers a download, and the control
 * falls back to the real `OFFLINE_STORE`, whose ports stay unconstructed until
 * a method is called — the store's own suite covers its behaviour.
 */
const OFFLINE_ACTIONS = {
  getPlaylistDetailsWithEntries: vi.fn().mockResolvedValue({ name: 'Rock Night', entries: [] }),
  getSongEntry: vi.fn().mockResolvedValue(null),
  getTabs: vi.fn().mockResolvedValue([]),
} as unknown as OfflineDownloadActions

function setup(props: Partial<React.ComponentProps<typeof PlaylistDetailView>> = {}) {
  for (const action of Object.values(ACTIONS)) action.mockClear()
  render(
    <PlaylistDetailView
      playlist={props.playlist ?? playlist()}
      repertoire={props.repertoire ?? [entry('s1'), entry('s2')]}
      currentUserId={props.currentUserId ?? 'u1'}
      // RH-103 added the reorder mode; its own suite
      // (`playlistReorder.test.tsx`) covers the toggle, so these tests keep
      // rendering the resting screen.
      canReorder={props.canReorder ?? false}
      actions={(props.actions ?? ACTIONS) as unknown as PlaylistDetailActions}
      pickerActions={PICKER_ACTIONS as unknown as SongPickerActions}
      offlineActions={props.offlineActions ?? OFFLINE_ACTIONS}
      practiceActions={props.practiceActions ?? { getCandidates: vi.fn(), getPlaylists: vi.fn() }}
    />,
  )
}

/** RH-172: the header's secondary actions live in the "More actions" menu. */
function openMenuItem(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  fireEvent.click(screen.getByRole('menuitem', { name }))
}

describe('PlaylistDetailView (RH-71)', () => {
  it('renders the playlist name, its songs and its mastery summary from its props', () => {
    setup()

    expect(screen.getByRole('heading', { name: 'Friday Setlist' })).toBeDefined()
    expect(screen.getByText('Blue Moon')).toBeDefined()
    expect(screen.getByText('Red Sun')).toBeDefined()
    expect(screen.getByText('Playlist level')).toBeDefined()
  })

  it('issues no network request while rendering', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    setup()

    expect(screen.getByRole('heading', { name: 'Friday Setlist' })).toBeDefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('renders the error banner and dismisses it', async () => {
    setup({
      actions: {
        ...ACTIONS,
        removeSongFromPlaylist: vi.fn().mockRejectedValue(new Error('Nope, not removed')),
      } as unknown as PlaylistDetailActions,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Remove Red Sun from playlist' }))
    await waitFor(() => expect(screen.getByText('Nope, not removed')).toBeDefined())

    fireEvent.click(screen.getByText('✕'))
    await waitFor(() => expect(screen.queryByText('Nope, not removed')).toBeNull())
  })

  it('filters the song list by the in-playlist text filter', () => {
    setup()

    const filter = screen.getByPlaceholderText('Filter playlist by title or artist...')
    fireEvent.change(filter, { target: { value: 'Blue' } })

    expect(screen.getByText('Blue Moon')).toBeDefined()
    expect(screen.queryByText('Red Sun')).toBeNull()
  })

  it('renders the add-song panel only while the picker panel is open', () => {
    setup()

    expect(screen.queryByPlaceholderText('Search catalog and Spotify…')).toBeNull()

    openMenuItem('Add songs')
    expect(screen.getByPlaceholderText('Search catalog and Spotify…')).toBeDefined()

    openMenuItem('Add songs')
    expect(screen.queryByPlaceholderText('Search catalog and Spotify…')).toBeNull()
  })

  describe('Start practice (RH-172)', () => {
    // s1 is overdue and s2 was practised yesterday, so the due order is s1, s2.
    const DAY = 86_400_000
    const candidate = (versionId: string, title: string) => ({
      versionId,
      title,
      artist: 'RH71 Artist',
      status: versionId === 's1' ? ('learning' as const) : ('mastered' as const),
      lastPracticed: new Date(Date.now() - (versionId === 's1' ? 10 : 1) * DAY).toISOString(),
    })

    it('is a top-level header button on a playlist with songs, not a menu item', () => {
      setup()

      const start = screen.getByRole('button', { name: 'Start practice' })
      expect(start.getAttribute('aria-haspopup')).toBeNull()
      expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Start practice' })).toBe(start)
    })

    it('is not rendered on a playlist with no songs', () => {
      setup({ playlist: playlist({ songs: [] }), repertoire: [] })

      expect(screen.queryByRole('button', { name: 'Start practice' })).toBeNull()
    })

    it('starts a personal session from this playlist and opens Fast View on the first song', async () => {
      const getCandidates = vi.fn().mockResolvedValue([candidate('s2', 'Red Sun'), candidate('s1', 'Blue Moon')])
      setup({ practiceActions: { getCandidates, getPlaylists: vi.fn() } })

      fireEvent.click(screen.getByRole('button', { name: 'Start practice' }))

      await waitFor(() => expect(router.push).toHaveBeenCalledWith('/songs/s1/fast-view'))
      expect(getCandidates).toHaveBeenCalledWith({ kind: 'playlist', playlistId: 'pl-1' }, null)
      expect(readSongQueue()).toMatchObject({
        owner: { type: 'personal' },
        originHref: '/playlists/pl-1',
        label: 'Friday Setlist',
      })
      expect(readSongQueue()?.entries.map((e) => e.versionId)).toEqual(['s1', 's2'])
    })

    it('starts a band playlist with the band owner and bandId on the Fast View href', async () => {
      const getCandidates = vi.fn().mockResolvedValue([candidate('s2', 'Red Sun')])
      setup({
        playlist: playlist({ user_id: null, band_id: 'band-1' }),
        practiceActions: { getCandidates, getPlaylists: vi.fn() },
      })

      fireEvent.click(screen.getByRole('button', { name: 'Start practice' }))

      await waitFor(() => expect(router.push).toHaveBeenCalledWith('/songs/s2/fast-view?bandId=band-1'))
      expect(getCandidates).toHaveBeenCalledWith({ kind: 'playlist', playlistId: 'pl-1' }, 'band-1')
      expect(readSongQueue()).toMatchObject({
        owner: { type: 'band', bandId: 'band-1' },
        originHref: '/playlists/pl-1',
      })
    })
  })

  it('passes the server-resolved user id to the playlist tag bar', () => {
    setup({ currentUserId: 'u1' })
    expect(screen.getByRole('button', { name: 'Add tag to playlist' })).toBeDefined()

    cleanup()
    // The bar gates a personal playlist on ownership, so a different id hides it.
    setup({ currentUserId: 'someone-else' })
    expect(screen.queryByRole('button', { name: 'Add tag to playlist' })).toBeNull()
  })

  it('refreshes the route after a successful rename', async () => {
    setup()

    openMenuItem('Rename playlist')
    fireEvent.change(screen.getByRole('textbox', { name: 'Playlist name' }), {
      target: { value: 'Saturday Setlist' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(ACTIONS.updatePlaylist).toHaveBeenCalledWith('pl-1', { name: 'Saturday Setlist' })
  })

  it('navigates to the playlist list after the playlist is deleted', async () => {
    setup()

    openMenuItem('Delete playlist')
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/playlists'))
    expect(ACTIONS.deletePlaylist).toHaveBeenCalledWith('pl-1')
  })

  /**
   * RH-99 ER5 — this island is the route's offline composition root: it makes
   * the single `useOfflineStatus()` call and hands the result down as a prop.
   * `navigator.onLine` is faked here (and only here) because what is under test
   * is precisely that this component reads it; `OfflineDownloadButton`'s own
   * suite drives the prop directly.
   */
  it('supplies the offline signal to the offline download control', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    setup()

    const control = await screen.findByRole('button', { name: /available offline/i })
    expect(control.hasAttribute('disabled')).toBe(true)
    onLine.mockRestore()
  })

  it('leaves the offline download control enabled while online', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    setup()

    const control = await screen.findByRole('button', { name: /available offline/i })
    expect(control.hasAttribute('disabled')).toBe(false)
    onLine.mockRestore()
  })

  it('keeps the note control read-only on a band playlist and writable on a personal one', () => {
    setup({
      playlist: playlist({ user_id: null, band_id: 'band-1' }),
      repertoire: [
        entry('s1', { user_id: null, band_id: 'band-1' }),
        entry('s2', { user_id: null, band_id: 'band-1' }),
      ],
    })

    const bandNotes = screen
      .getAllByRole('group', { name: 'Mastery status' })
      .flatMap((group) => within(group).getAllByRole('button')) as HTMLButtonElement[]
    expect(bandNotes).toHaveLength(8)
    expect(bandNotes.every((note) => note.disabled)).toBe(true)
    expect(screen.queryByTitle('Band status is set by a band admin')).toBeNull()
    expect(screen.queryByText(/Click to advance/)).toBeNull()

    cleanup()
    setup()
    const personalNotes = screen
      .getAllByRole('group', { name: 'Mastery status' })
      .flatMap((group) => within(group).getAllByRole('button')) as HTMLButtonElement[]
    expect(personalNotes).toHaveLength(8)
    expect(personalNotes.some((note) => note.disabled)).toBe(false)
  })
})

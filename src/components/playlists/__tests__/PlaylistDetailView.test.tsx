// @vitest-environment jsdom
/**
 * RH-71 — `/playlists/[id]` is a Server Component and this island only renders
 * what the server read.
 *
 * Every test supplies the playlist and the repertoire as props, none of them
 * waits for a load, and one proves mechanically that a plain render issues no
 * request at all — the mount-effect read the page used to run is gone, not
 * relocated into the island. The last one renders the display half of the
 * owner-context decision: a band playlist shows the read-only aggregate badge,
 * a personal one shows the cycling button.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
const { replace, refresh } = router

import { PlaylistDetailView } from '../PlaylistDetailView'
import type { PlaylistDetailActions } from '@/hooks/usePlaylistDetail'
import type { SongPickerActions } from '@/hooks/useSongPicker'
import type { Playlist, PlaylistSong, Repertoire } from '@/types/database'

afterEach(cleanup)
afterEach(() => vi.unstubAllGlobals())

beforeEach(() => {
  replace.mockClear()
  refresh.mockClear()
})

function song(songId: string, position: number, title: string): PlaylistSong {
  return {
    id: `ps-${songId}`,
    playlist_id: 'pl-1',
    song_id: songId,
    position,
    song: {
      id: songId,
      title,
      artist: 'RH71 Artist',
    } as PlaylistSong['song'],
  }
}

const PERSONAL_OWNER = { user_id: 'u1', band_id: null }

const BLANK_ENTRY = {
  personal_key: null,
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

function entry(songId: string, overrides: Partial<Repertoire> = {}): Repertoire {
  return { ...PERSONAL_OWNER, ...BLANK_ENTRY, id: `rep-${songId}`, song_id: songId, ...overrides }
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
}

const PICKER_ACTIONS = {
  searchCatalog: vi.fn().mockResolvedValue([]),
  addToRepertoire: vi.fn().mockResolvedValue(entry('s3')),
  createAndAddSong: vi.fn().mockResolvedValue(entry('s3')),
  addSongToPlaylist: vi.fn().mockResolvedValue(undefined),
  getPlaylistWithSongs: vi.fn().mockResolvedValue(playlist()),
}

function setup(props: Partial<React.ComponentProps<typeof PlaylistDetailView>> = {}) {
  for (const action of Object.values(ACTIONS)) action.mockClear()
  render(
    <PlaylistDetailView
      playlist={props.playlist ?? playlist()}
      repertoire={props.repertoire ?? [entry('s1'), entry('s2')]}
      currentUserId={props.currentUserId ?? 'u1'}
      actions={(props.actions ?? ACTIONS) as unknown as PlaylistDetailActions}
      pickerActions={PICKER_ACTIONS as unknown as SongPickerActions}
    />,
  )
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

    fireEvent.click(screen.getByRole('button', { name: 'Add songs' }))
    expect(screen.getByPlaceholderText('Search catalog and Spotify…')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Add songs' }))
    expect(screen.queryByPlaceholderText('Search catalog and Spotify…')).toBeNull()
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

    fireEvent.click(screen.getByRole('button', { name: 'Rename playlist' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Playlist name' }), {
      target: { value: 'Saturday Setlist' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(ACTIONS.updatePlaylist).toHaveBeenCalledWith('pl-1', { name: 'Saturday Setlist' })
  })

  it('navigates to the playlist list after the playlist is deleted', async () => {
    setup()

    fireEvent.click(screen.getByRole('button', { name: 'Delete playlist' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/playlists'))
    expect(ACTIONS.deletePlaylist).toHaveBeenCalledWith('pl-1')
  })

  it('renders the band aggregate badge instead of the status button for a band playlist', () => {
    setup({
      playlist: playlist({ user_id: null, band_id: 'band-1' }),
      repertoire: [
        entry('s1', { user_id: null, band_id: 'band-1' }),
        entry('s2', { user_id: null, band_id: 'band-1' }),
      ],
    })

    expect(screen.getAllByTitle('Band status is computed from all members')).toHaveLength(2)
    expect(
      screen.queryByRole('button', { name: 'Status: Unknown. Click to advance.' }),
    ).toBeNull()

    cleanup()
    setup()
    expect(
      screen.getAllByRole('button', { name: 'Status: Unknown. Click to advance.' }),
    ).toHaveLength(2)
  })
})

// @vitest-environment jsdom
/**
 * RH-68 — the playlist song list, its rows and the identity block inside them.
 *
 * `PlaylistSongList` decides nothing: the page hands it the songs, the filtered
 * songs, the repertoire map, the per-song tag state and six callbacks, and the
 * list renders them. So everything here is plain props and `vi.fn()` — no
 * Server Action, no fetch, no `@/app/` import.
 *
 * `PlaylistSongRow` and `PlaylistSongIdentity` are only reachable through the
 * list in the running app, so they are covered through it here too. Between
 * them these tests pin the locators `e2e/playlist-detail.spec.ts` uses on this
 * slice: the `Songs in this playlist` region, one `listitem` per song, the
 * `Status: <label>. Click to advance.` button, `Remove <title> from playlist`,
 * a button named exactly `Add tag`, the `new tag` placeholder rendered for one
 * row at a time, `Remove tag <tag>` per chip, `No songs yet` and
 * `No songs matching "<query>".`.
 */

import { createRef } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { PlaylistSongList, type PlaylistSongListProps } from '@/components/playlists/PlaylistSongList'
import type { PlaylistSong, Repertoire, SongStatus } from '@/types/database'

afterEach(cleanup)

function playlistSong(
  songId: string,
  overrides: { position?: number; title?: string; duration?: number | null } = {},
): PlaylistSong {
  return {
    id: `ps-${songId}`,
    playlist_id: 'playlist-1',
    song_id: songId,
    position: overrides.position ?? 0,
    song: {
      id: songId,
      title: overrides.title ?? 'Kashmir',
      artist: 'Led Zeppelin',
      album: 'Physical Graffiti',
      standard_key: null,
      cover_url: null,
      duration_seconds: overrides.duration === undefined ? null : overrides.duration,
      links: [],
      created_at: '2026-01-01T00:00:00.000Z',
    },
  }
}

function entry(songId: string, status: SongStatus, tags: string[] = []): Repertoire {
  return {
    id: `rep-${songId}`,
    user_id: 'user-1',
    band_id: null,
    song_id: songId,
    personal_key: null,
    status,
    tags,
    last_practiced: null,
    lyrics: null,
  }
}

function props(overrides: Partial<PlaylistSongListProps> = {}): PlaylistSongListProps {
  const songs = overrides.songs ?? [playlistSong('song-1')]
  return {
    songs,
    filteredSongs: overrides.filteredSongs ?? songs,
    repertoireMap: new Map(),
    playlistId: 'playlist-1',
    bandId: null,
    activeTagFilter: null,
    songFilterQuery: '',
    addingTagForSong: null,
    newTagInput: '',
    tagInputRef: createRef<HTMLInputElement>(),
    onStatusCycle: vi.fn().mockResolvedValue(undefined),
    onRemoveSong: vi.fn().mockResolvedValue(undefined),
    onAddTag: vi.fn().mockResolvedValue(undefined),
    onRemoveTag: vi.fn().mockResolvedValue(undefined),
    onEditTagsFor: vi.fn(),
    onTagInputChange: vi.fn(),
    ...overrides,
  }
}

/** The list — `<section aria-label="Songs in this playlist">`, as the e2e net locates it. */
function songList(): HTMLElement {
  return screen.getByRole('region', { name: 'Songs in this playlist' })
}

describe('PlaylistSongList', () => {
  it('renders the empty state when the playlist holds no songs', () => {
    render(<PlaylistSongList {...props({ songs: [], filteredSongs: [] })} />)

    expect(within(songList()).getByText(/No songs yet/)).toBeDefined()
    expect(within(songList()).queryAllByRole('listitem')).toHaveLength(0)
  })

  it('renders the no-match state naming the active tag when the tag filter hides every song', () => {
    render(
      <PlaylistSongList
        {...props({ filteredSongs: [], activeTagFilter: 'encore' })}
      />,
    )

    expect(within(songList()).getByText('No songs tagged #encore.')).toBeDefined()
    expect(within(songList()).queryAllByRole('listitem')).toHaveLength(0)
  })

  it('renders the no-match state quoting the query when the text filter hides every song', () => {
    render(<PlaylistSongList {...props({ filteredSongs: [], songFilterQuery: 'zzz' })} />)

    expect(within(songList()).getByText('No songs matching "zzz".')).toBeDefined()
  })

  it('renders one list item per filtered song inside the Songs in this playlist region', () => {
    const songs = [
      playlistSong('song-1', { title: 'Kashmir' }),
      playlistSong('song-2', { title: 'Black Dog', position: 1 }),
    ]
    render(<PlaylistSongList {...props({ songs, filteredSongs: [songs[0]] })} />)

    const rows = within(songList()).getAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('Kashmir')
    expect(within(songList()).queryByText('Black Dog')).toBeNull()
  })

  it('orders the rows by playlist position', () => {
    const songs = [
      playlistSong('song-1', { title: 'Kashmir', position: 2 }),
      playlistSong('song-2', { title: 'Black Dog', position: 0 }),
      playlistSong('song-3', { title: 'Roxanne', position: 1 }),
    ]
    render(<PlaylistSongList {...props({ songs })} />)

    const rows = within(songList()).getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Black Dog'),
      expect.stringContaining('Roxanne'),
      expect.stringContaining('Kashmir'),
    ])
  })

  it('links a row that has a repertoire entry to that entry Fast View, carrying the band id', () => {
    render(
      <PlaylistSongList
        {...props({
          repertoireMap: new Map([['song-1', entry('song-1', 'learning')]]),
          bandId: 'band-9',
        })}
      />,
    )

    const link = within(songList()).getByRole('link', { name: /Kashmir/ })
    expect(link.getAttribute('href')).toBe(
      '/songs/rep-song-1/fast-view?returnTo=/playlists/playlist-1&bandId=band-9',
    )
  })

  it('renders a row without a repertoire entry with no link', () => {
    render(<PlaylistSongList {...props()} />)

    const row = within(songList()).getByRole('listitem')
    expect(within(row).queryByRole('link')).toBeNull()
    expect(within(row).getByText('Kashmir')).toBeDefined()
  })

  it('renders the song duration when the song carries one', () => {
    const withDuration = playlistSong('song-1', { duration: 515 })
    const withoutDuration = playlistSong('song-2', { title: 'Black Dog', position: 1 })
    render(<PlaylistSongList {...props({ songs: [withDuration, withoutDuration] })} />)

    const [first, second] = within(songList()).getAllByRole('listitem')
    expect(within(first).getByText('8:35')).toBeDefined()
    expect(within(second).queryByText(/^\d+:\d\d$/)).toBeNull()
  })

  it('renders the status as a button that calls onStatusCycle in personal mode', () => {
    const listProps = props({
      repertoireMap: new Map([['song-1', entry('song-1', 'unknown')]]),
    })
    render(<PlaylistSongList {...listProps} />)

    const row = within(songList()).getByRole('listitem')
    const status = within(row).getByRole('button', {
      name: 'Status: Unknown. Click to advance.',
      exact: true,
    })

    fireEvent.click(status)
    expect(listProps.onStatusCycle).toHaveBeenCalledWith('song-1')
  })

  it('renders the status as a read-only badge with no button in band mode', () => {
    const listProps = props({
      repertoireMap: new Map([['song-1', entry('song-1', 'unknown')]]),
      bandId: 'band-9',
    })
    render(<PlaylistSongList {...listProps} />)

    const row = within(songList()).getByRole('listitem')
    expect(
      within(row).queryByRole('button', { name: /Click to advance/ }),
    ).toBeNull()
    expect(within(row).getByText('Unknown')).toBeDefined()
  })

  it('calls onRemoveSong with the song id when the remove button is clicked', () => {
    const listProps = props()
    render(<PlaylistSongList {...listProps} />)

    const row = within(songList()).getByRole('listitem')
    fireEvent.click(
      within(row).getByRole('button', { name: 'Remove Kashmir from playlist' }),
    )

    expect(listProps.onRemoveSong).toHaveBeenCalledWith('song-1')
  })

  it('renders one Remove tag button per tag and calls onRemoveTag when it is clicked', () => {
    const listProps = props({
      repertoireMap: new Map([['song-1', entry('song-1', 'learning', ['encore', 'fast'])]]),
    })
    render(<PlaylistSongList {...listProps} />)

    const row = within(songList()).getByRole('listitem')
    expect(within(row).getAllByRole('button', { name: /^Remove tag / })).toHaveLength(2)

    fireEvent.click(within(row).getByRole('button', { name: 'Remove tag encore' }))
    expect(listProps.onRemoveTag).toHaveBeenCalledWith('song-1', 'encore')
  })

  it('renders the tag input only for the song named by addingTagForSong', () => {
    const songs = [
      playlistSong('song-1', { title: 'Kashmir' }),
      playlistSong('song-2', { title: 'Black Dog', position: 1 }),
    ]
    const listProps = props({ songs, addingTagForSong: 'song-2' })
    render(<PlaylistSongList {...listProps} />)

    expect(screen.getAllByPlaceholderText('new tag')).toHaveLength(1)

    const [first, second] = within(songList()).getAllByRole('listitem')
    expect(within(first).getByRole('button', { name: 'Add tag', exact: true })).toBeDefined()
    expect(within(first).queryByPlaceholderText('new tag')).toBeNull()
    expect(within(second).getByPlaceholderText('new tag')).toBeDefined()

    fireEvent.click(within(first).getByRole('button', { name: 'Add tag', exact: true }))
    expect(listProps.onEditTagsFor).toHaveBeenCalledWith('song-1')
  })

  it('calls onAddTag with the row song id and the typed tag when Enter is pressed', () => {
    const listProps = props({ addingTagForSong: 'song-1', newTagInput: 'encore' })
    render(<PlaylistSongList {...listProps} />)

    const input = screen.getByPlaceholderText('new tag')
    fireEvent.change(input, { target: { value: 'encores' } })
    expect(listProps.onTagInputChange).toHaveBeenCalledWith('encores')

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(listProps.onAddTag).toHaveBeenCalledWith('song-1', 'encore')

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(listProps.onEditTagsFor).toHaveBeenCalledWith(null)
  })
})

// @vitest-environment jsdom
/**
 * RH-68 — the playlist song list, its rows and the identity block inside them.
 *
 * `PlaylistSongList` decides nothing: the page hands it the songs, the filtered
 * songs, the repertoire map, two callbacks and (since RH-69) the one tag
 * editing controller every row shares. So everything here is plain props and
 * `vi.fn()` — no Server Action, no fetch, no `@/app/` import.
 *
 * `PlaylistSongRow` and `PlaylistSongIdentity` are only reachable through the
 * list in the running app, so they are covered through it here too. Between
 * them these tests pin the locators `e2e/playlist-detail.spec.ts` uses on this
 * slice: the `Songs in this playlist` region, one `listitem` per song, the
 * `Mastery status` group and its four outcome-named note buttons (RH-102),
 * `Remove <title> from playlist`,
 * a button named exactly `Add tag`, the `new tag` placeholder rendered for one
 * row at a time, `Remove tag <tag>` per chip, `No songs yet` and
 * `No songs matching "<query>".`.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { PlaylistSongList, type PlaylistSongListProps } from '@/components/playlists/PlaylistSongList'
import { readSongQueue } from '@/lib/songQueue'
import type { TagEditorController } from '@/hooks/useTagEditor'
import type { PlaylistSong, Repertoire, SongStatus } from '@/types/database'

afterEach(cleanup)

beforeEach(() => {
  sessionStorage.clear()
})

/**
 * One row, keyed by the **version** it names (RH-125). `song.id` is derived, so
 * a repertoire map keyed by the song id cannot pass for one keyed by version.
 */
function playlistSong(
  versionId: string,
  overrides: { position?: number; title?: string; duration?: number | null; label?: string } = {},
): PlaylistSong {
  return {
    id: `ps-${versionId}`,
    playlist_id: 'playlist-1',
    version_id: versionId,
    position: overrides.position ?? 0,
    label: overrides.label ?? null,
    song: {
      id: `song-of-${versionId}`,
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

function entry(versionId: string, status: SongStatus, tags: string[] = []): Repertoire {
  return {
    id: `rep-${versionId}`,
    user_id: 'user-1',
    band_id: null,
    song_id: `song-of-${versionId}`,
    version_id: versionId,
    key: null,
    tuning: null,
    map: null,
    status,
    tags,
    last_practiced: null,
    lyrics: null,
  }
}

/** A stub `TagEditorController`: the row calls it, `useTagEditor`'s test drives it. */
function tagEditor(openFor: string | null = null, draft = '') {
  return {
    openFor,
    draft,
    inputRef: { current: null },
    open: vi.fn(),
    close: vi.fn(),
    changeDraft: vi.fn(),
    commitDraft: vi.fn(async () => {}),
    removeTag: vi.fn(async () => {}),
  } satisfies TagEditorController
}

function props(overrides: Partial<PlaylistSongListProps> = {}): PlaylistSongListProps {
  const songs = overrides.songs ?? [playlistSong('song-1')]
  return {
    songs,
    filteredSongs: overrides.filteredSongs ?? songs,
    repertoireMap: new Map(),
    playlistId: 'playlist-1',
    queueLabel: 'Saturday gig',
    bandId: null,
    activeTagFilter: null,
    songFilterQuery: '',
    tagEditor: tagEditor(),
    // RH-103 added the reorder mode; `playlistReorder.test.tsx` covers it, so
    // every case here renders the resting row.
    reordering: false,
    onMoveSong: vi.fn(async () => {}),
    onReorderSongs: vi.fn(async () => {}),
    onStatusChange: vi.fn().mockResolvedValue(undefined),
    onRemoveSong: vi.fn().mockResolvedValue(undefined),
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

  it('links a row to its version Fast View, carrying the band id and no return parameter', () => {
    render(
      <PlaylistSongList
        {...props({
          repertoireMap: new Map([['song-1', entry('song-1', 'learning')]]),
          bandId: 'band-9',
        })}
      />,
    )

    const link = within(songList()).getByRole('link', { name: /Kashmir/ })
    // The entry's `version_id`, never the owner row's id (RH-132 ER15).
    expect(link.getAttribute('href')).toBe('/songs/song-1/fast-view?bandId=band-9')
  })

  /**
   * RH-132 ER15 — a row the owner holds no repertoire entry for is still a
   * link.
   *
   * Fast View is version-addressed and takes its owner from `?bandId=`, so such
   * a row opens at version defaults, read-only. It used to render as a dead
   * identity line, which is the state this inverts. The mastery status still
   * reads `unknown` and the tag row is still empty — that is what the absent
   * entry means, and it is unchanged.
   */
  it('links a row with no repertoire entry too, to the same version address', () => {
    render(<PlaylistSongList {...props({ bandId: 'band-9' })} />)

    const row = within(songList()).getByRole('listitem')
    const link = within(row).getByRole('link', { name: /Kashmir/ })
    expect(link.getAttribute('href')).toBe('/songs/song-1/fast-view?bandId=band-9')
    expect(within(row).getByText('Kashmir')).toBeDefined()
  })

  it('omits the bandId from the link outside a band context', () => {
    render(<PlaylistSongList {...props()} />)

    const link = within(songList()).getByRole('link', { name: /Kashmir/ })
    expect(link.getAttribute('href')).toBe('/songs/song-1/fast-view')
  })

  it('renders the song duration when the song carries one', () => {
    const withDuration = playlistSong('song-1', { duration: 515 })
    const withoutDuration = playlistSong('song-2', { title: 'Black Dog', position: 1 })
    render(<PlaylistSongList {...props({ songs: [withDuration, withoutDuration] })} />)

    const [first, second] = within(songList()).getAllByRole('listitem')
    expect(within(first).getByText('8:35')).toBeDefined()
    expect(within(second).queryByText(/^\d+:\d\d$/)).toBeNull()
  })

  // RH-102: the pill badge is four notes and the stage name. A tap names the
  // status it wants, in either direction, instead of advancing one step.
  it('renders the four-note control and reports the tapped status in personal mode', () => {
    const listProps = props({
      repertoireMap: new Map([['song-1', entry('song-1', 'unknown')]]),
    })
    render(<PlaylistSongList {...listProps} />)

    const row = within(songList()).getByRole('listitem')
    const group = within(row).getByRole('group', { name: 'Mastery status' })
    expect(within(group).getAllByRole('button')).toHaveLength(4)
    expect(group.textContent).toContain('Unknown')
    expect(within(row).queryByText('Click to advance')).toBeNull()

    fireEvent.click(within(row).getByLabelText('Set status to Polishing'))
    expect(listProps.onStatusChange).toHaveBeenCalledWith('song-1', 'polishing')
  })

  it('drops a status through the current note, which the old badge could not', () => {
    const listProps = props({
      repertoireMap: new Map([['song-1', entry('song-1', 'polishing')]]),
    })
    render(<PlaylistSongList {...listProps} />)

    const row = within(songList()).getByRole('listitem')
    fireEvent.click(within(row).getByLabelText('Drop status to Practicing'))

    expect(listProps.onStatusChange).toHaveBeenCalledWith('song-1', 'practicing')
  })

  it('keeps the four notes disabled in band mode, with their names intact', () => {
    const listProps = props({
      repertoireMap: new Map([['song-1', entry('song-1', 'unknown')]]),
      bandId: 'band-9',
    })
    render(<PlaylistSongList {...listProps} />)

    const row = within(songList()).getByRole('listitem')
    const group = within(row).getByRole('group', { name: 'Mastery status' })
    const notes = within(group).getAllByRole('button') as HTMLButtonElement[]

    expect(notes).toHaveLength(4)
    expect(notes.every((note) => note.disabled)).toBe(true)
    expect(notes[0].getAttribute('aria-label')).toBe('Set status to Learning')
    expect(group.textContent).toContain('Unknown')

    for (const note of notes) fireEvent.click(note)
    expect(listProps.onStatusChange).not.toHaveBeenCalled()
    expect(within(row).queryByTitle('Band status is set by a band admin')).toBeNull()
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

  it('renders one Remove tag button per tag and calls the tag editor when it is clicked', () => {
    const editor = tagEditor()
    const listProps = props({
      repertoireMap: new Map([['song-1', entry('song-1', 'learning', ['encore', 'fast'])]]),
      tagEditor: editor,
    })
    render(<PlaylistSongList {...listProps} />)

    const row = within(songList()).getByRole('listitem')
    expect(within(row).getAllByRole('button', { name: /^Remove tag / })).toHaveLength(2)

    fireEvent.click(within(row).getByRole('button', { name: 'Remove tag encore' }))
    expect(editor.removeTag).toHaveBeenCalledWith('song-1', 'encore')
  })

  it('renders the tag input only for the song the tag editor is open for', () => {
    const songs = [
      playlistSong('song-1', { title: 'Kashmir' }),
      playlistSong('song-2', { title: 'Black Dog', position: 1 }),
    ]
    const editor = tagEditor('song-2')
    render(<PlaylistSongList {...props({ songs, tagEditor: editor })} />)

    expect(screen.getAllByPlaceholderText('new tag')).toHaveLength(1)

    const [first, second] = within(songList()).getAllByRole('listitem')
    expect(within(first).getByRole('button', { name: 'Add tag', exact: true })).toBeDefined()
    expect(within(first).queryByPlaceholderText('new tag')).toBeNull()
    expect(within(second).getByPlaceholderText('new tag')).toBeDefined()

    fireEvent.click(within(first).getByRole('button', { name: 'Add tag', exact: true }))
    expect(editor.open).toHaveBeenCalledWith('song-1')
  })

  it('commits the tag editor draft for that row when Enter is pressed', () => {
    const editor = tagEditor('song-1', 'encore')
    render(<PlaylistSongList {...props({ tagEditor: editor })} />)

    const input = screen.getByPlaceholderText('new tag')
    fireEvent.change(input, { target: { value: 'encores' } })
    expect(editor.changeDraft).toHaveBeenCalledWith('encores')

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(editor.commitDraft).toHaveBeenCalledWith('song-1')

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(editor.close).toHaveBeenCalledTimes(1)
  })
})

/**
 * RH-125 ER18 — two takes of one song are distinguishable in the list.
 *
 * This is the whole user-visible point of the re-key: a playlist can now hold
 * the studio take and the live take of one song, and without the version's
 * label the two rows would be character-for-character identical. The label is
 * drawn by `PlaylistSongIdentity`, which both the resting row and the reorder
 * row share.
 */
describe('two versions of one song (RH-125 ER18)', () => {
  const studio = playlistSong('v-studio', {
    position: 1,
    title: 'Bad',
    label: 'Album Version',
  })
  const live = playlistSong('v-live', {
    position: 2,
    title: 'Bad',
    label: 'Live at Wembley',
  })

  it('renders both rows, each carrying its own version label', () => {
    render(<PlaylistSongList {...props({ songs: [studio, live] })} />)

    const rows = within(songList()).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    // The same title twice — which is exactly why the label has to be there.
    expect(within(songList()).getAllByText('Bad')).toHaveLength(2)
    expect(within(rows[0]).getByText('Album Version')).toBeDefined()
    expect(within(rows[1]).getByText('Live at Wembley')).toBeDefined()
  })

  it('draws no label line for an unlabelled recording', () => {
    const unlabelled = playlistSong('v-plain', { position: 1, title: 'Bad' })

    render(<PlaylistSongList {...props({ songs: [unlabelled] })} />)

    const row = within(songList()).getAllByRole('listitem')[0]
    expect(within(row).getByText('Bad')).toBeDefined()
    expect(within(row).queryByText('Album Version')).toBeNull()
  })

  it('keys each row on its own entry, so neither take replaces the other', () => {
    const entries = new Map([
      ['v-studio', entry('v-studio', 'mastered', ['encore'])],
      ['v-live', entry('v-live', 'learning', ['soundcheck'])],
    ])

    render(
      <PlaylistSongList {...props({ songs: [studio, live], repertoireMap: entries })} />,
    )

    const rows = within(songList()).getAllByRole('listitem')
    // Each row reads its own owner row through its own `version_id`: the tags
    // differ, which a song-keyed map could not produce.
    expect(within(rows[0]).getByText('encore')).toBeDefined()
    expect(within(rows[1]).getByText('soundcheck')).toBeDefined()
  })
})

/**
 * RH-133 ER10 — the queue a row click writes is the **playlist**, not the view.
 *
 * The list holds two lists: `songs`, every song of the playlist, and
 * `filteredSongs`, what survived the page's tag and text filters — and it
 * renders the second. Writing the variable already in scope on the render line
 * is the obvious mistake, and it ships a setlist that silently shortens to
 * whatever text was left in the filter box, mid-gig. So the length asserted
 * below is derived from the fixture and the excluded song is named: a
 * subset-length assertion would pass the broken version.
 */
describe('the song queue a row click writes (RH-133 ER10)', () => {
  const SONGS = [
    playlistSong('v-1', { title: 'Kashmir', position: 0 }),
    playlistSong('v-2', { title: 'Black Dog', position: 1 }),
    playlistSong('v-3', { title: 'Roxanne', position: 2 }),
  ]

  /** The filter leaves one row of three on screen. */
  function renderFiltered(overrides: Partial<PlaylistSongListProps> = {}) {
    return render(
      <PlaylistSongList
        {...props({
          songs: SONGS,
          filteredSongs: [SONGS[0]],
          songFilterQuery: 'kash',
          ...overrides,
        })}
      />,
    )
  }

  function openRow(name: RegExp) {
    fireEvent.click(within(songList()).getByRole('link', { name }))
  }

  it('stores every song of the playlist, not the filtered view', () => {
    renderFiltered()
    expect(within(songList()).getAllByRole('listitem')).toHaveLength(1)

    openRow(/Kashmir/)

    const queue = readSongQueue()
    expect(queue).not.toBeNull()
    expect(queue?.entries).toHaveLength(SONGS.length)
    // A song the filter excluded is in the queue — which is the whole point.
    expect(queue?.entries.map((entry) => entry.versionId)).toContain('v-3')
  })

  it('stores the playlist in playlist order, whatever order the prop arrives in', () => {
    render(
      <PlaylistSongList
        {...props({ songs: [SONGS[2], SONGS[0], SONGS[1]], filteredSongs: [SONGS[0]] })}
      />,
    )

    openRow(/Kashmir/)

    expect(readSongQueue()?.entries.map((entry) => entry.versionId)).toEqual(['v-1', 'v-2', 'v-3'])
  })

  it('records the playlist as the origin and its label, with no band context', () => {
    renderFiltered()

    openRow(/Kashmir/)

    expect(readSongQueue()).toMatchObject({
      originHref: '/playlists/playlist-1',
      label: 'Saturday gig',
      owner: { type: 'personal' },
    })
  })

  it('records the band as the queue owner on a band playlist', () => {
    renderFiltered({ bandId: 'band-9' })

    openRow(/Kashmir/)

    expect(readSongQueue()?.owner).toEqual({ type: 'band', bandId: 'band-9' })
  })

  it('stores only the three navigation fields per entry', () => {
    renderFiltered()

    openRow(/Kashmir/)

    for (const entry of readSongQueue()?.entries ?? []) {
      expect(Object.keys(entry).sort()).toEqual(['artist', 'title', 'versionId'])
    }
    expect(readSongQueue()?.entries[0]).toEqual({
      versionId: 'v-1',
      title: 'Kashmir',
      artist: 'Led Zeppelin',
    })
  })

  /**
   * RH-133 round 2 — `song` is optional on `PlaylistSong`, and an entry whose
   * catalog row did not join has neither of the two strings a setlist row
   * draws. Storing it would draw a blank, unidentifiable line, so it is the one
   * thing the writer leaves out.
   */
  it('leaves out a row whose catalog song did not join, and nothing else', () => {
    const unjoined: PlaylistSong = { ...playlistSong('v-4', { position: 3 }), song: undefined }
    const songs = [...SONGS, unjoined]
    render(<PlaylistSongList {...props({ songs, filteredSongs: [SONGS[0]] })} />)

    openRow(/Kashmir/)

    const entries = readSongQueue()?.entries ?? []
    expect(entries.map((entry) => entry.versionId)).toEqual(['v-1', 'v-2', 'v-3'])
    expect(entries).toHaveLength(songs.length - 1)
    expect(entries.map((entry) => entry.title)).not.toContain('')
  })

  /**
   * RH-133 round 3 — the predicate is `Boolean(ps.song)`, not
   * `ps.song !== undefined`. The declared type is `song?: Song`, but the join
   * arrives as JSON off the wire, where a missing relation is as likely to be
   * `null`; an undefined-only check would let that through and store the blank
   * row the test above exists to prevent.
   */
  it('leaves out a row whose catalog song came back null', () => {
    const nullJoin = { ...playlistSong('v-4', { position: 3 }), song: null } as unknown as PlaylistSong
    const songs = [...SONGS, nullJoin]
    render(<PlaylistSongList {...props({ songs, filteredSongs: SONGS })} />)

    openRow(/Kashmir/)

    const entries = readSongQueue()?.entries ?? []
    expect(entries.map((entry) => entry.versionId)).toEqual(['v-1', 'v-2', 'v-3'])
    expect(entries).toHaveLength(songs.length - 1)
  })
})

// @vitest-environment jsdom
/**
 * RH-67 — the add-song panel and the header button that opens it.
 *
 * `SongPicker` holds no decision of its own: it renders whatever
 * `SongPickerController` reports, so the controller here is built by hand — no
 * Server Action, no fetch, no `@/app/` import. The four panel states are
 * covered, plus the locator contract `e2e/playlist-detail.spec.ts` depends on:
 * a placeholder beginning `Search catalog and Spotify`, a `ul` carrying
 * `aria-live="polite"` whose children are `listitem`s, a button named exactly
 * `Add` per row, and a button named `Add songs` carrying `aria-pressed`.
 *
 * The last of those four lives on `SongPickerToggle`, which the *page* renders,
 * not `SongPicker` — so this file renders it directly rather than reaching for
 * it through the panel.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { SongPicker } from '@/components/playlists/SongPicker'
import { SongPickerToggle } from '@/components/playlists/SongPickerToggle'
import type { SongPickerController } from '@/lib/songPicker'
import type { SpotifyTrack } from '@/lib/spotify'
import type { GlobalSong } from '@/types/database'

afterEach(cleanup)

function song(id: string, title: string): GlobalSong {
  return {
    id,
    title,
    artist: 'Led Zeppelin',
    album: 'IV',
    standard_key: null,
    cover_url: null,
    duration_seconds: null,
    links: [],
    created_at: '2026-01-01T00:00:00.000Z',
  }
}

function track(id: string, title: string): SpotifyTrack {
  return {
    id,
    title,
    artist: 'Led Zeppelin',
    album: 'IV',
    spotifyUrl: `https://open.spotify.com/track/${id}`,
    previewUrl: null,
    albumArt: null,
  }
}

function controller(overrides: Partial<SongPickerController> = {}): SongPickerController {
  return {
    query: '',
    loading: false,
    addingId: null,
    rowErrors: {},
    catalogResults: [],
    spotifyResults: [],
    changeQuery: vi.fn(),
    addCatalogSong: vi.fn().mockResolvedValue(undefined),
    addSpotifyTrack: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

/** The result list the e2e net locates as `ul[aria-live="polite"]`. */
function resultList(): HTMLElement {
  const list = document.querySelector('ul[aria-live="polite"]')
  expect(list, 'the panel must render a ul[aria-live="polite"]').not.toBeNull()
  return list as HTMLElement
}

describe('SongPicker', () => {
  it('renders a search input whose placeholder names the catalog and Spotify', () => {
    render(<SongPicker picker={controller({ query: 'kash' })} />)

    const input = screen.getByPlaceholderText(/^Search catalog and Spotify/)
    expect(input).toHaveProperty('value', 'kash')

    fireEvent.change(input, { target: { value: 'kashmir' } })
    expect(screen.getByPlaceholderText(/^Search catalog and Spotify/)).toBeDefined()
  })

  it('focuses the search input when the panel mounts', () => {
    render(<SongPicker picker={controller()} />)

    expect(document.activeElement).toBe(screen.getByPlaceholderText(/^Search catalog and Spotify/))
  })

  it('prompts the user to type while the query is below two characters', () => {
    render(<SongPicker picker={controller({ query: 'k' })} />)

    expect(within(resultList()).getByText('Type to search…')).toBeDefined()
    expect(within(resultList()).queryByText('No results')).toBeNull()
  })

  it('renders the searching state while the controller reports loading', () => {
    render(<SongPicker picker={controller({ query: 'kash', loading: true })} />)

    expect(within(resultList()).getByText(/Searching…/)).toBeDefined()
    expect(within(resultList()).queryByText('No results')).toBeNull()
  })

  it('renders the no-results state when both result lists are empty', () => {
    render(<SongPicker picker={controller({ query: 'kash' })} />)

    expect(within(resultList()).getByText('No results')).toBeDefined()
  })

  it('renders one list item per catalog result and per Spotify result', () => {
    render(
      <SongPicker
        picker={controller({
          query: 'kash',
          catalogResults: [song('song-1', 'Kashmir')],
          spotifyResults: [track('sp-1', 'Rock and Roll'), track('sp-2', 'Black Dog')],
        })}
      />,
    )

    const rows = within(resultList()).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Kashmir'),
      expect.stringContaining('Rock and Roll'),
      expect.stringContaining('Black Dog'),
    ])
    for (const row of rows) {
      expect(within(row).getByRole('button', { name: 'Add' })).toBeDefined()
    }
  })

  it('calls the controller add command for the clicked catalog row', () => {
    const picker = controller({ query: 'kash', catalogResults: [song('song-1', 'Kashmir')] })
    render(<SongPicker picker={picker} />)

    const row = within(resultList()).getByRole('listitem')
    fireEvent.click(within(row).getByRole('button', { name: 'Add' }))

    expect(picker.addCatalogSong).toHaveBeenCalledWith(song('song-1', 'Kashmir'))
    expect(picker.addSpotifyTrack).not.toHaveBeenCalled()
  })

  it('calls the controller add command for the clicked Spotify row', () => {
    const picker = controller({ query: 'kash', spotifyResults: [track('sp-1', 'Rock and Roll')] })
    render(<SongPicker picker={picker} />)

    const row = within(resultList()).getByRole('listitem')
    fireEvent.click(within(row).getByRole('button', { name: 'Add' }))

    expect(picker.addSpotifyTrack).toHaveBeenCalledWith(track('sp-1', 'Rock and Roll'))
    expect(picker.addCatalogSong).not.toHaveBeenCalled()
  })

  it("disables the Add button of the row being added and shows that row's error", () => {
    render(
      <SongPicker
        picker={controller({
          query: 'kash',
          addingId: 'song-1',
          rowErrors: { 'song-1': 'Playlist is locked' },
          catalogResults: [song('song-1', 'Kashmir'), song('song-2', 'Black Dog')],
        })}
      />,
    )

    const [busyRow, idleRow] = within(resultList()).getAllByRole('listitem')

    const busyButton = within(busyRow).getByRole('button', { name: 'Adding…' })
    expect(busyButton).toHaveProperty('disabled', true)
    expect(within(busyRow).getByText('Playlist is locked')).toBeDefined()

    const idleButton = within(idleRow).getByRole('button', { name: 'Add' })
    expect(idleButton).toHaveProperty('disabled', false)
    expect(within(idleRow).queryByText('Playlist is locked')).toBeNull()
  })

  it('renders the Add songs toggle with its pressed state and calls back when clicked', () => {
    const onToggle = vi.fn()
    const { rerender } = render(<SongPickerToggle open={false} onToggle={onToggle} />)

    const toggle = screen.getByRole('button', { name: 'Add songs' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledTimes(1)

    rerender(<SongPickerToggle open onToggle={onToggle} />)
    expect(screen.getByRole('button', { name: 'Add songs' }).getAttribute('aria-pressed')).toBe('true')
  })
})

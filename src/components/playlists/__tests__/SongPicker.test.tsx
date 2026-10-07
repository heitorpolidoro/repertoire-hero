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
import type { SearchVersionCandidate, SongSearchRow } from '@/lib/songSearchMerge'

afterEach(cleanup)

function candidate(overrides: Partial<SearchVersionCandidate> = {}): SearchVersionCandidate {
  return {
    versionId: null,
    spotifyTrackId: null,
    rawTitle: 'Kashmir',
    albumName: 'IV',
    albumType: null,
    releaseDate: null,
    label: null,
    durationSeconds: null,
    createdAt: null,
    coverUrl: null,
    spotifyUrl: null,
    ...overrides,
  }
}

/** One merged row, keyed by its group key exactly as the merge produces it. */
function row(id: string, title: string, overrides: Partial<SongSearchRow> = {}): SongSearchRow {
  return {
    id,
    title,
    artist: 'Led Zeppelin',
    coverUrl: null,
    album: 'IV',
    songId: `song-${id}`,
    versions: [candidate({ versionId: `v-${id}`, rawTitle: title })],
    ...overrides,
  }
}

function controller(overrides: Partial<SongPickerController> = {}): SongPickerController {
  return {
    query: '',
    loading: false,
    addingId: null,
    rowErrors: {},
    results: [],
    changeQuery: vi.fn(),
    addRow: vi.fn().mockResolvedValue(undefined),
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

  it('renders the no-results state when the merged list is empty', () => {
    render(<SongPicker picker={controller({ query: 'kash' })} />)

    expect(within(resultList()).getByText('No results')).toBeDefined()
  })

  it('renders one list item per merged row', () => {
    render(
      <SongPicker
        picker={controller({
          query: 'kash',
          results: [
            row('kashmir|led zeppelin', 'Kashmir'),
            row('rock and roll|led zeppelin', 'Rock and Roll'),
            row('black dog|led zeppelin', 'Black Dog'),
          ],
        })}
      />,
    )

    const rows = within(resultList()).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Kashmir'),
      expect.stringContaining('Rock and Roll'),
      expect.stringContaining('Black Dog'),
    ])
    for (const item of rows) {
      expect(within(item).getByRole('button', { name: 'Add' })).toBeDefined()
    }
  })

  /**
   * RH-108 ER5 — the panel draws **one** row for a song both sources know.
   *
   * At HEAD the same two search hits produced two listitems and two `Add`
   * buttons, adjacent and near-identical, with nothing saying which to press.
   */
  it('renders exactly one listitem and one Add button for a merged row (ER5)', () => {
    const merged = row('bad|michael jackson', 'Bad', {
      artist: 'Michael Jackson',
      songId: 'song-1',
      versions: [
        candidate({
          versionId: 'v-1',
          spotifyTrackId: 'sp-aaa',
          rawTitle: 'Bad',
          albumName: 'Bad',
          spotifyUrl: 'https://open.spotify.com/track/sp-aaa',
        }),
      ],
    })

    render(<SongPicker picker={controller({ query: 'bad', results: [merged] })} />)

    expect(within(resultList()).getAllByRole('listitem')).toHaveLength(1)
    expect(within(resultList()).getAllByRole('button', { name: 'Add' })).toHaveLength(1)
  })

  it('calls addRow with the clicked row', () => {
    const merged = row('kashmir|led zeppelin', 'Kashmir')
    const picker = controller({ query: 'kash', results: [merged] })
    render(<SongPicker picker={picker} />)

    const item = within(resultList()).getByRole('listitem')
    fireEvent.click(within(item).getByRole('button', { name: 'Add' }))

    expect(picker.addRow).toHaveBeenCalledWith(merged)
  })

  /**
   * RH-108 ER24 — the album line carries the year, and nothing else is added.
   *
   * The operator's answer to this task's open question is **B**: no "in
   * catalog" tag and no affordance distinguishing a catalog-backed row from a
   * Spotify-only one. The information is internal — it makes no difference to
   * a musician whether the app already knew the song — and a new affordance on
   * the row belongs with RH-112's card.
   */
  it("renders the representative candidate's year beside the album (ER24)", () => {
    const merged = row('bad|michael jackson', 'Bad', {
      album: 'Bad',
      versions: [
        candidate({ versionId: 'v-1', albumName: 'Bad', releaseDate: '1987-08-31' }),
      ],
    })

    render(<SongPicker picker={controller({ query: 'bad', results: [merged] })} />)

    const item = within(resultList()).getByRole('listitem')
    expect(item.textContent).toContain('Bad')
    expect(item.textContent).toContain('1987')
  })

  it('renders no year when the representative candidate has no release date', () => {
    const merged = row('kashmir|led zeppelin', 'Kashmir')

    render(<SongPicker picker={controller({ query: 'kash', results: [merged] })} />)

    const item = within(resultList()).getByRole('listitem')
    expect(item.textContent).toContain('IV')
    expect(item.textContent).not.toContain('·')
  })

  it('draws a catalog-backed row and a Spotify-only row with the same elements (ER24)', () => {
    const catalogRow = row('bad|michael jackson', 'Bad', {
      versions: [candidate({ versionId: 'v-1', albumName: 'Bad' })],
    })
    const spotifyRow = row('thriller|michael jackson', 'Thriller', {
      songId: null,
      versions: [candidate({ spotifyTrackId: 'sp-aaa', albumName: 'Bad' })],
    })

    render(
      <SongPicker picker={controller({ query: 'bad', results: [catalogRow, spotifyRow] })} />,
    )

    const [catalogItem, spotifyItem] = within(resultList()).getAllByRole('listitem')
    const shape = (el: HTMLElement) =>
      [...el.querySelectorAll('*')].map((node) => node.tagName).join(',')
    // Identical element shapes: no badge, no tag, no extra line on either. The
    // literal a catalog affordance would carry is asserted absent from the
    // whole of `src/components/` by `songSearchMergeGuards.test.ts`, which is
    // why it is not spelled here.
    expect(shape(spotifyItem)).toBe(shape(catalogItem))
  })

  it("disables the Add button of the row being added and shows that row's error", () => {
    render(
      <SongPicker
        picker={controller({
          query: 'kash',
          addingId: 'kashmir|led zeppelin',
          rowErrors: { 'kashmir|led zeppelin': 'Playlist is locked' },
          results: [
            row('kashmir|led zeppelin', 'Kashmir'),
            row('black dog|led zeppelin', 'Black Dog'),
          ],
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

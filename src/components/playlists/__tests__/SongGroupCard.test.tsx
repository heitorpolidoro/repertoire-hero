// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { SongGroupCard } from '@/components/playlists/SongGroupCard'
import type { SearchVersionCandidate, SongSearchRow } from '@/lib/songSearchMerge'

afterEach(cleanup)

function cand(overrides: Partial<SearchVersionCandidate> = {}): SearchVersionCandidate {
  return {
    versionId: 'v1',
    spotifyTrackId: null,
    rawTitle: 'Bad',
    albumName: 'Bad',
    albumType: 'album',
    releaseDate: '1987-08-31',
    label: null,
    durationSeconds: 257,
    createdAt: null,
    coverUrl: null,
    spotifyUrl: null,
    ...overrides,
  }
}

const versions = [
  cand({ versionId: 'v1' }),
  cand({ versionId: 'v2', albumName: 'Bad 25', releaseDate: '2012', label: 'Remaster 2012' }),
  cand({ versionId: 'v3', albumName: 'Bad (single)', albumType: 'single', releaseDate: null }),
]

function makeRow(overrides: Partial<SongSearchRow> = {}): SongSearchRow {
  return {
    id: 'bad|michael jackson',
    title: 'Bad',
    artist: 'Michael Jackson',
    coverUrl: null,
    album: 'Bad',
    songId: 's1',
    versions,
    ...overrides,
  }
}

function renderCard(row = makeRow(), props: { adding?: boolean; error?: string } = {}) {
  const onAdd = vi.fn()
  render(
    <ul>
      <SongGroupCard row={row} adding={props.adding ?? false} error={props.error} onAdd={onAdd} />
    </ul>,
  )
  return onAdd
}

const expand = () => fireEvent.click(screen.getByRole('button', { name: 'Show versions' }))

describe('SongGroupCard', () => {
  it('collapsed: shows the representative version and adds exactly it', () => {
    const onAdd = renderCard()
    expect(screen.getByText('Bad · 1987')).toBeDefined()
    expect(screen.getAllByRole('button', { name: 'Add' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd.mock.calls[0][0].versions[0]).toBe(versions[0])
  })

  it('expanding removes the card-level Add and lists one Add per version', () => {
    renderCard()
    expand()
    expect(screen.getByRole('button', { name: 'Hide versions' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByRole('button', { name: 'Add' })).toHaveLength(3)
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })

  it('adds exactly the clicked version', () => {
    const onAdd = renderCard()
    expand()
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[1])
    expect(onAdd.mock.calls[0][0].versions).toEqual([versions[1]])
  })

  it('lists a single-type version and marks none above the others', () => {
    renderCard()
    expand()
    const items = within(screen.getAllByRole('list')[1]).getAllByRole('listitem')
    expect(items[2].textContent).toContain('Bad (single)')
    expect(new Set(items.map((li) => li.className)).size).toBe(1)
    expect(document.body.textContent).not.toMatch(/default|recommended|representative|in\s+catalog/i)
  })

  it('renders the line as album · year · duration with the label as a subtitle', () => {
    renderCard(makeRow({ versions: [cand({ label: 'Remaster 2012' })] }))
    expand()
    expect(screen.getByText('Bad · 1987 · 4:17')).toBeDefined()
    expect(screen.getByTestId('version-label').textContent).toBe('Remaster 2012')
  })

  it('shows only the label when album, year and duration are all missing', () => {
    renderCard(
      makeRow({
        versions: [cand({ albumName: null, releaseDate: null, durationSeconds: null, label: 'Live' })],
      }),
    )
    expand()
    expect(screen.getByTestId('version-label').textContent).toBe('Live')
  })

  it('a version-less row has no expander and adds the row as is', () => {
    const row = makeRow({ versions: [], album: null })
    const onAdd = renderCard(row)
    expect(screen.queryByRole('button', { name: 'Show versions' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onAdd).toHaveBeenCalledWith(row)
  })

  it('disables every Add while adding and shows the row error once', () => {
    renderCard(makeRow(), { adding: true, error: 'Playlist is full' })
    expand()
    for (const b of screen.getAllByRole('button', { name: 'Adding…' })) {
      expect((b as HTMLButtonElement).disabled).toBe(true)
    }
    expect(screen.getAllByText('Playlist is full')).toHaveLength(1)
  })

  it('draws a cover image when there is one', () => {
    renderCard(makeRow({ coverUrl: 'https://img.test/c.jpg' }))
    expect(document.querySelector('img')).not.toBeNull()
  })
})

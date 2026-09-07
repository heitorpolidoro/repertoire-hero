// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SetlistPill } from '../SetlistPill'
import { SetlistSelect } from '../SetlistSelect'
import { PlaylistPrevArrow } from '../PlaylistPrevArrow'
import { SwipeHint } from '../SwipeHint'
import { computePlaylistNav, type PlaylistEntry } from '@/lib/playlistNav'

afterEach(cleanup)

const TRACKS: PlaylistEntry[] = [
  { repertoireId: 'ct-1', songId: 'trk-1', title: 'Gimme Shelter', artist: 'The Rolling Stones' },
  { repertoireId: 'ct-2', songId: 'trk-2', title: 'Hey Joe', artist: 'Jimi Hendrix' },
  { repertoireId: 'ct-3', songId: 'trk-3', title: 'Immigrant Song', artist: null },
]

function navAt(index: number) {
  return computePlaylistNav(TRACKS, TRACKS[index].repertoireId, 'pl-controls', 'Open mic')
}

describe('SetlistPill', () => {
  it('renders nothing when there is no playlist navigation', () => {
    const { container } = render(<SetlistPill nav={null} onOpen={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows the Setlist (X/Y) label and opens the drawer when pressed', () => {
    const onOpen = vi.fn()
    render(<SetlistPill nav={navAt(1)} onOpen={onOpen} />)

    const button = screen.getByRole('button')
    expect(button.textContent).toMatch(/Setlist \(\d+\/\d+\)/)
    expect(button.textContent).toContain('Setlist (2/3)')
    expect(button.className).toContain('lg:hidden')

    fireEvent.click(button)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})

describe('SetlistSelect', () => {
  it('renders nothing without a navigation or without entries', () => {
    const { container, unmount } = render(
      <SetlistSelect nav={null} entries={TRACKS} currentRepertoireId="ct-2" onSelect={vi.fn()} />,
    )
    expect(container.innerHTML).toBe('')
    unmount()

    const empty = render(
      <SetlistSelect nav={navAt(1)} entries={[]} currentRepertoireId="ct-2" onSelect={vi.fn()} />,
    )
    expect(empty.container.innerHTML).toBe('')
  })

  it('lists every entry as "N. Title - Artist" and preselects the current one', () => {
    render(
      <SetlistSelect nav={navAt(1)} entries={TRACKS} currentRepertoireId="ct-2" onSelect={vi.fn()} />,
    )

    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('ct-2')
    const options = screen.getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual([
      '1. Gimme Shelter - The Rolling Stones',
      '2. Hey Joe - Jimi Hendrix',
      '3. Immigrant Song ',
    ])
  })

  it('selects the chosen entry and ignores a re-selection of the current one', () => {
    const onSelect = vi.fn()
    render(
      <SetlistSelect nav={navAt(1)} entries={TRACKS} currentRepertoireId="ct-2" onSelect={onSelect} />,
    )

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'ct-2' } })
    expect(onSelect).not.toHaveBeenCalled()

    fireEvent.change(select, { target: { value: 'ct-3' } })
    expect(onSelect).toHaveBeenCalledWith('ct-3')
  })
})

describe('PlaylistPrevArrow', () => {
  it('renders nothing when there is no previous entry', () => {
    const { container } = render(<PlaylistPrevArrow prevId={null} onNavigate={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders a Previous song button that calls onNavigate', () => {
    const onNavigate = vi.fn()
    render(<PlaylistPrevArrow prevId="ct-1" onNavigate={onNavigate} />)

    const button = screen.getByRole('button', { name: 'Previous song' })
    expect(button.getAttribute('aria-label')).toBe('Previous song')
    expect(button.className).toContain('hidden lg:flex')

    fireEvent.click(button)
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })
})

describe('SwipeHint', () => {
  it('renders nothing when there is no playlist navigation', () => {
    const { container } = render(<SwipeHint nav={null} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows both hints and the position counter in the middle of a setlist', () => {
    render(<SwipeHint nav={navAt(1)} />)

    expect(screen.getByText('← prev')).toBeDefined()
    expect(screen.getByText('next →')).toBeDefined()
    expect(screen.getByText('2 / 3')).toBeDefined()
  })

  it('hides the prev hint on the first entry and the next hint on the last', () => {
    const { unmount } = render(<SwipeHint nav={navAt(0)} />)
    expect(screen.queryByText('← prev')).toBeNull()
    expect(screen.getByText('next →')).toBeDefined()
    unmount()

    render(<SwipeHint nav={navAt(2)} />)
    expect(screen.getByText('← prev')).toBeDefined()
    expect(screen.queryByText('next →')).toBeNull()
  })
})

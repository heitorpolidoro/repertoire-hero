// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SetlistDrawer } from '../SetlistDrawer'
import { computePlaylistNav, type PlaylistEntry } from '@/lib/playlistNav'

afterEach(cleanup)

const SHEET_ENTRIES: PlaylistEntry[] = [
  { repertoireId: 'dr-a', songId: 'sng-a', title: 'Africa', artist: 'Toto' },
  { repertoireId: 'dr-b', songId: 'sng-b', title: 'Bohemian Rhapsody', artist: 'Queen' },
  { repertoireId: 'dr-c', songId: 'sng-c', title: 'Coda', artist: null },
]

const NAV = computePlaylistNav(SHEET_ENTRIES, 'dr-b', 'pl-drawer', 'Saturday gig')

function renderDrawer(props: Partial<React.ComponentProps<typeof SetlistDrawer>> = {}) {
  const onClose = vi.fn()
  const onSelect = vi.fn()
  const utils = render(
    <SetlistDrawer
      open
      nav={NAV}
      entries={SHEET_ENTRIES}
      currentRepertoireId="dr-b"
      onClose={onClose}
      onSelect={onSelect}
      {...props}
    />,
  )
  return { ...utils, onClose, onSelect }
}

describe('SetlistDrawer', () => {
  it('renders nothing when it is closed', () => {
    const { container } = renderDrawer({ open: false })
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when there is no playlist navigation', () => {
    const { container } = renderDrawer({ nav: null })
    expect(container.innerHTML).toBe('')
  })

  it('shows the playlist name and one row per entry', () => {
    renderDrawer()

    expect(screen.getByText('Saturday gig')).toBeDefined()
    expect(screen.getByText('Africa')).toBeDefined()
    expect(screen.getByText('Bohemian Rhapsody')).toBeDefined()
    expect(screen.getByText('Coda')).toBeDefined()
    // Three rows plus the close button.
    expect(screen.getAllByRole('button')).toHaveLength(4)
  })

  it('closes on the backdrop click and on the close button', () => {
    const { container, onClose } = renderDrawer()

    const backdrop = container.querySelector('.bg-black\\/40')
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop as Element)
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('✕'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('closes the drawer and selects the entry when a row is clicked', () => {
    const { onClose, onSelect } = renderDrawer()

    fireEvent.click(screen.getByText('Coda'))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('dr-c')
  })
})

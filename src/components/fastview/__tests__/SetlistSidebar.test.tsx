// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SetlistSidebar } from '../SetlistSidebar'
import { computePlaylistNav, type PlaylistEntry } from '@/lib/playlistNav'

afterEach(cleanup)

const COLUMN_SONGS: PlaylistEntry[] = [
  { repertoireId: 'sb-1', songId: 'tune-1', title: 'Dazed and Confused', artist: 'Led Zeppelin' },
  { repertoireId: 'sb-2', songId: 'tune-2', title: 'Europa', artist: 'Santana' },
  { repertoireId: 'sb-3', songId: 'tune-3', title: 'Freebird', artist: null },
]

const NAV = computePlaylistNav(COLUMN_SONGS, 'sb-2', 'pl-sidebar', 'Sunday matinee')

function renderSidebar(props: Partial<React.ComponentProps<typeof SetlistSidebar>> = {}) {
  const onSelect = vi.fn()
  const utils = render(
    <SetlistSidebar
      nav={NAV}
      entries={COLUMN_SONGS}
      currentRepertoireId="sb-2"
      onSelect={onSelect}
      {...props}
    />,
  )
  return { ...utils, onSelect }
}

describe('SetlistSidebar', () => {
  it('renders nothing when there is no playlist navigation', () => {
    const { container, unmount } = renderSidebar({ nav: null })
    expect(container.innerHTML).toBe('')
    unmount()

    const empty = renderSidebar({ entries: [] })
    expect(empty.container.innerHTML).toBe('')
  })

  it('carries the desktop sidebar classes required by AGENTS.md', () => {
    const { container } = renderSidebar()

    const aside = container.querySelector('aside')
    expect(aside).not.toBeNull()
    for (const className of [
      'w-80',
      'shrink-0',
      'border-l',
      'border-gray-200',
      'bg-white',
      'sticky',
      'top-0',
      'h-screen',
    ]) {
      expect(aside?.getAttribute('class')).toContain(className)
    }
    expect(aside?.getAttribute('class')).toContain('hidden lg:flex')
  })

  it('shows the playlist name, the position counter and one row per entry', () => {
    renderSidebar()

    expect(screen.getByText('Sunday matinee')).toBeDefined()
    expect(screen.getByText('2 / 3')).toBeDefined()
    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(screen.getByText(/NOW/)).toBeDefined()
  })

  it('calls onSelect with the clicked entry', () => {
    const { onSelect } = renderSidebar()

    fireEvent.click(screen.getByText('Dazed and Confused'))
    expect(onSelect).toHaveBeenCalledWith('sb-1')
  })
})

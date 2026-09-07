// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SetlistRow } from '../SetlistRow'
import type { PlaylistEntry } from '@/lib/playlistNav'

afterEach(cleanup)

const ENTRY: PlaylistEntry = {
  repertoireId: 'rep-2',
  songId: 'song-2',
  title: 'Rosanna',
  artist: 'Toto',
}

function renderRow(props: Partial<React.ComponentProps<typeof SetlistRow>> = {}) {
  const onSelect = vi.fn()
  const utils = render(
    <SetlistRow index={1} entry={ENTRY} isCurrent={false} variant="drawer" onSelect={onSelect} {...props} />,
  )
  return { ...utils, onSelect }
}

describe('SetlistRow', () => {
  it('renders the one-based position, title and artist', () => {
    renderRow()

    expect(screen.getByText('2.')).toBeDefined()
    expect(screen.getByText('Rosanna')).toBeDefined()
    expect(screen.getByText('Toto')).toBeDefined()
  })

  it('omits the artist line when the entry has none', () => {
    renderRow({ entry: { ...ENTRY, artist: null } })

    expect(screen.getByText('Rosanna')).toBeDefined()
    expect(screen.queryByText('Toto')).toBeNull()
  })

  it('marks the current entry with the NOW badge and does not call onSelect for it', () => {
    const { onSelect } = renderRow({ isCurrent: true })

    expect(screen.getByText(/NOW/)).toBeDefined()
    fireEvent.click(screen.getByRole('button'))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('calls onSelect with the repertoire id of a non-current entry', () => {
    const { onSelect } = renderRow()

    expect(screen.queryByText(/NOW/)).toBeNull()
    fireEvent.click(screen.getByRole('button'))
    expect(onSelect).toHaveBeenCalledWith('rep-2')
  })

  it('adds the sidebar-only ring class only in the sidebar variant', () => {
    const { unmount } = renderRow({ isCurrent: true, variant: 'sidebar' })
    expect(screen.getByRole('button').className).toContain('ring-1 ring-emerald-400/20')
    unmount()

    renderRow({ isCurrent: true, variant: 'drawer' })
    expect(screen.getByRole('button').className).not.toContain('ring-emerald-400/20')
    cleanup()

    renderRow({ variant: 'sidebar' })
    expect(screen.getByRole('button').className).toContain('hover:border-gray-200')
    cleanup()

    renderRow({ variant: 'drawer' })
    expect(screen.getByRole('button').className).not.toContain('hover:border-gray-200')
  })
})

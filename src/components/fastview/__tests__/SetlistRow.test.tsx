// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SetlistRow } from '../SetlistRow'
import type { PlaylistEntry } from '@/lib/playlistNav'

afterEach(cleanup)

const ENTRY: PlaylistEntry = {
  repertoireId: 'rep-2',
  versionId: 'v-rep-2',
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

/**
 * RH-125 — an entry whose owner holds no repertoire row.
 *
 * Fast View is still addressed by the owner row's id (re-addressing it by
 * version is RH-109), so such an entry has nowhere to navigate to. It is
 * rendered all the same: the setlist read returns every entry of the playlist
 * now, and hiding one used to collapse the whole setlist. The mockup's chosen
 * option (`docs/tasks/RH-126-mock.html`, B) is a muted *Not in repertoire*
 * chip on a row that does not invite a tap.
 */
describe('an entry with no repertoire row (RH-125)', () => {
  const UNADDRESSABLE: PlaylistEntry = {
    repertoireId: null,
    versionId: 'v-rep-9',
    songId: 'song-9',
    title: 'Spoonman',
    artist: 'Soundgarden',
  }

  it('renders the song, disabled, and says why', () => {
    renderRow({ entry: UNADDRESSABLE })
    const button = screen.getByRole('button') as HTMLButtonElement

    expect(button.textContent).toContain('Spoonman')
    expect(button.textContent).toContain('Soundgarden')
    expect(button.textContent).toContain('Not in repertoire')
    expect(button.disabled).toBe(true)
  })

  it('selects nothing when it is clicked', () => {
    const { onSelect } = renderRow({ entry: UNADDRESSABLE })

    fireEvent.click(screen.getByRole('button'))

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('never shows the NOW badge, even if it were marked current', () => {
    // Unreachable in the app — the route param is an owner row id — asserted so
    // a future `?? ''` cannot make a null entry read as the current one.
    renderRow({ entry: UNADDRESSABLE, isCurrent: true })

    expect(screen.getByRole('button').textContent).not.toContain('NOW')
  })
})

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SetlistSidebar } from '../SetlistSidebar'
import { computePlaylistNav, type PlaylistEntry } from '@/lib/playlistNav'

afterEach(cleanup)

const COLUMN_SONGS: PlaylistEntry[] = [
  { repertoireId: 'sb-1', versionId: 'v-sb-1', songId: 'tune-1', title: 'Dazed and Confused', artist: 'Led Zeppelin' },
  { repertoireId: 'sb-2', versionId: 'v-sb-2', songId: 'tune-2', title: 'Europa', artist: 'Santana' },
  { repertoireId: 'sb-3', versionId: 'v-sb-3', songId: 'tune-3', title: 'Freebird', artist: null },
]

const NAV = computePlaylistNav(COLUMN_SONGS, 'v-sb-2', 'Sunday matinee')

function renderSidebar(props: Partial<React.ComponentProps<typeof SetlistSidebar>> = {}) {
  const onSelect = vi.fn()
  const utils = render(
    <SetlistSidebar
      nav={NAV}
      entries={COLUMN_SONGS}
      currentVersionId="v-sb-2"
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

  /**
   * RH-133 ER11 — the renamed label is rendered, not merely spelled.
   *
   * `nav.queueLabel` replaced the old playlist-specific name field, so a queue
   * that is not a playlist can name itself. A rename nothing renders would
   * surface only as a type error, which no gate command runs.
   */
  it('shows "Play setlist" only when it is wired, and taps through to onPlay (RH-167)', () => {
    expect(renderSidebar().container.textContent).not.toContain('Play setlist')
    cleanup()

    const onPlay = vi.fn()
    renderSidebar({ onPlay })
    fireEvent.click(screen.getByRole('button', { name: /Play setlist/ }))
    expect(onPlay).toHaveBeenCalledTimes(1)
  })

  it('renders the queueLabel of the queue it was given', () => {
    const nav = { ...(NAV as NonNullable<typeof NAV>), queueLabel: 'Practice session' }
    renderSidebar({ nav })

    expect(screen.getByText('Practice session')).toBeDefined()
    expect(screen.queryByText('Sunday matinee')).toBeNull()
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
    expect(onSelect).toHaveBeenCalledWith('v-sb-1')
  })

  describe('active track and viewed song markers (RH-199)', () => {
    it('keeps NOW on active track and shows Play on viewed row when they differ', () => {
      const onPlay = vi.fn()
      const onSelect = vi.fn()

      renderSidebar({
        currentVersionId: 'v-sb-2',
        activeVersionId: 'v-sb-1',
        onPlay,
        onSelect,
      })

      // Active track (Dazed and Confused) has NOW
      const activeRow = screen.getByText('Dazed and Confused').closest('button')
      expect(activeRow?.textContent).toContain('NOW')

      // Viewed row (Europa) has Play button and no NOW
      const viewedRow = screen.getByText('Europa').closest('button')
      expect(viewedRow?.textContent).not.toContain('NOW')

      const playButton = screen.getByRole('button', { name: 'Play from Europa' })
      expect(playButton).toBeDefined()

      // Exactly one NOW in the panel
      expect(screen.getAllByText(/NOW/)).toHaveLength(1)

      // Clicking Play button calls onPlay, and does not call onSelect
      fireEvent.click(playButton)
      expect(onPlay).toHaveBeenCalledTimes(1)
      expect(onSelect).not.toHaveBeenCalled()
    })

    it('shows NOW on viewed row and no Play button when viewed song is active track', () => {
      renderSidebar({
        currentVersionId: 'v-sb-2',
        activeVersionId: 'v-sb-2',
        onPlay: vi.fn(),
      })

      const viewedRow = screen.getByText('Europa').closest('button')
      expect(viewedRow?.textContent).toContain('NOW')
      expect(screen.queryByRole('button', { name: /Play from/ })).toBeNull()
      expect(screen.getAllByText(/NOW/)).toHaveLength(1)
    })

    it('shows NOW on viewed row and no Play button when player is idle/stopped (activeVersionId is null)', () => {
      renderSidebar({
        currentVersionId: 'v-sb-2',
        activeVersionId: null,
        onPlay: vi.fn(),
      })

      const viewedRow = screen.getByText('Europa').closest('button')
      expect(viewedRow?.textContent).toContain('NOW')
      expect(screen.queryByRole('button', { name: /Play from/ })).toBeNull()
      expect(screen.getAllByText(/NOW/)).toHaveLength(1)
    })
  })

  /** RH-196 — offline marks, with the counter still over the whole queue. */
  it('disables and marks the entries not on this device and keeps the full position counter', () => {
    const available = new Set(['v-sb-2', 'v-sb-3'])
    const { onSelect } = renderSidebar({
      nav: computePlaylistNav(COLUMN_SONGS, 'v-sb-2', 'Sunday matinee', available),
      availableVersionIds: available,
    })

    expect(screen.getByText('2 / 3')).toBeDefined()
    const dazed = screen.getByText('Dazed and Confused').closest('button') as HTMLButtonElement
    expect(dazed.disabled).toBe(true)
    expect(dazed.textContent).toContain('Not on this device')
    fireEvent.click(dazed)
    expect(onSelect).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Freebird'))
    expect(onSelect).toHaveBeenCalledWith('v-sb-3')
  })

  it('marks nothing online', () => {
    renderSidebar({ availableVersionIds: null })

    expect(screen.queryByText('Not on this device')).toBeNull()
    expect(screen.getAllByRole('button').every((button) => !(button as HTMLButtonElement).disabled)).toBe(true)
  })
})

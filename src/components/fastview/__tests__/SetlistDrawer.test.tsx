// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SetlistDrawer } from '../SetlistDrawer'
import { computePlaylistNav, type PlaylistEntry } from '@/lib/playlistNav'

afterEach(cleanup)

const SHEET_ENTRIES: PlaylistEntry[] = [
  { repertoireId: 'dr-a', versionId: 'v-dr-a', songId: 'sng-a', title: 'Africa', artist: 'Toto' },
  { repertoireId: 'dr-b', versionId: 'v-dr-b', songId: 'sng-b', title: 'Bohemian Rhapsody', artist: 'Queen' },
  { repertoireId: 'dr-c', versionId: 'v-dr-c', songId: 'sng-c', title: 'Coda', artist: null },
]

const NAV = computePlaylistNav(SHEET_ENTRIES, 'v-dr-b', 'Saturday gig')

function renderDrawer(props: Partial<React.ComponentProps<typeof SetlistDrawer>> = {}) {
  const onClose = vi.fn()
  const onSelect = vi.fn()
  const utils = render(
    <SetlistDrawer
      open
      nav={NAV}
      entries={SHEET_ENTRIES}
      currentVersionId="v-dr-b"
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

  /** RH-133 ER11 — the renamed label is rendered, not merely spelled. */
  it('renders the queueLabel of the queue it was given', () => {
    const nav = { ...(NAV as NonNullable<typeof NAV>), queueLabel: 'Hand-picked set' }
    renderDrawer({ nav })

    expect(screen.getByText('Hand-picked set')).toBeDefined()
    expect(screen.queryByText('Saturday gig')).toBeNull()
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
    expect(onSelect).toHaveBeenCalledWith('v-dr-c')
  })

  /**
   * RH-132 ER4 — the current-row highlight survives the rename.
   *
   * `SetlistPanel` used to compare `entry.repertoireId === currentRepertoireId`.
   * With a version id in the prop that comparison is permanently false, so no
   * row would ever be marked current. The second entry below holds **no owner
   * row**, which is exactly the case RH-132 makes reachable, and the pill is
   * asserted specifically: `SetlistRow` guarded it on `repertoireId` too, so a
   * fix that only drops the grey class leaves the current song with no pill.
   */
  it('marks exactly the current row, by version id, even with no owner row', () => {
    const gapped: PlaylistEntry[] = [
      SHEET_ENTRIES[0],
      { repertoireId: null, versionId: 'v-dr-x', songId: 'sng-x', title: 'Spoonman', artist: 'Soundgarden' },
      SHEET_ENTRIES[2],
    ]
    renderDrawer({
      entries: gapped,
      currentVersionId: 'v-dr-x',
      nav: computePlaylistNav(gapped, 'v-dr-x', 'Saturday gig'),
    })

    // Exactly one ▶ NOW pill in the whole panel, and it is on the second row.
    const pills = screen.getAllByText(/NOW/)
    expect(pills).toHaveLength(1)
    const currentRow = screen.getByText('Spoonman').closest('button')
    expect(currentRow?.textContent).toContain('NOW')
    expect(currentRow?.className).toContain('bg-emerald-50')

    for (const title of ['Africa', 'Coda']) {
      const row = screen.getByText(title).closest('button')
      expect(row?.textContent).not.toContain('NOW')
      expect(row?.className).not.toContain('bg-emerald-50')
    }
  })

  describe('active track and viewed song markers (RH-199)', () => {
    it('keeps NOW on active track and shows Play on viewed row when they differ', () => {
      const callOrder: string[] = []
      const onClose = vi.fn(() => callOrder.push('close'))
      const onSelect = vi.fn()

      renderDrawer({
        currentVersionId: 'v-dr-b',
        activeVersionId: 'v-dr-a',
        onPlay: vi.fn(() => callOrder.push('play')),
        onClose,
        onSelect,
      })

      // Active track (Africa) has NOW
      const activeRow = screen.getByText('Africa').closest('button')
      expect(activeRow?.textContent).toContain('NOW')

      // Viewed row (Bohemian Rhapsody) has Play button and no NOW
      const viewedRow = screen.getByText('Bohemian Rhapsody').closest('button')
      expect(viewedRow?.textContent).not.toContain('NOW')

      const playButton = screen.getByRole('button', { name: 'Play from Bohemian Rhapsody' })
      expect(playButton).toBeDefined()

      // Exactly one NOW in the panel
      expect(screen.getAllByText(/NOW/)).toHaveLength(1)

      // Clicking Play button closes drawer before calling onPlay, and does not call onSelect
      fireEvent.click(playButton)
      expect(callOrder).toEqual(['close', 'play'])
      expect(onSelect).not.toHaveBeenCalled()
    })

    it('shows NOW on viewed row and no Play button when viewed song is active track', () => {
      renderDrawer({
        currentVersionId: 'v-dr-b',
        activeVersionId: 'v-dr-b',
        onPlay: vi.fn(),
      })

      const viewedRow = screen.getByText('Bohemian Rhapsody').closest('button')
      expect(viewedRow?.textContent).toContain('NOW')
      expect(screen.queryByRole('button', { name: /Play from/ })).toBeNull()
      expect(screen.getAllByText(/NOW/)).toHaveLength(1)
    })

    it('shows NOW on viewed row and no Play button when player is idle/stopped (activeVersionId is null)', () => {
      renderDrawer({
        currentVersionId: 'v-dr-b',
        activeVersionId: null,
        onPlay: vi.fn(),
      })

      const viewedRow = screen.getByText('Bohemian Rhapsody').closest('button')
      expect(viewedRow?.textContent).toContain('NOW')
      expect(screen.queryByRole('button', { name: /Play from/ })).toBeNull()
      expect(screen.getAllByText(/NOW/)).toHaveLength(1)
    })
  })

  /** RH-196 — offline, the songs not on this device are disabled and marked. */
  it('disables and marks the entries not on this device, and selects none of them', () => {
    const { onSelect, onClose } = renderDrawer({ availableVersionIds: new Set(['v-dr-a', 'v-dr-b']) })

    const coda = screen.getByText('Coda').closest('button') as HTMLButtonElement
    expect(coda.disabled).toBe(true)
    expect(coda.textContent).toContain('Not on this device')
    expect(screen.getAllByText('Not on this device')).toHaveLength(1)
    fireEvent.click(coda)
    expect(onSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    const africa = screen.getByText('Africa').closest('button') as HTMLButtonElement
    expect(africa.disabled).toBe(false)
  })

  it('marks nothing without an availability set (online)', () => {
    renderDrawer({ availableVersionIds: null })

    expect(screen.queryByText('Not on this device')).toBeNull()
  })
})

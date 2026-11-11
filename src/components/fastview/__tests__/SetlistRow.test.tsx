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

  it('calls onSelect with the version id of a non-current entry', () => {
    const { onSelect } = renderRow()

    expect(screen.queryByText(/NOW/)).toBeNull()
    fireEvent.click(screen.getByRole('button'))
    expect(onSelect).toHaveBeenCalledWith('v-rep-2')
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

  describe('marker rendering (RH-199)', () => {
    it('renders the NOW badge when marker is now, even on a non-current row', () => {
      const { onSelect } = renderRow({ isCurrent: false, marker: 'now' })

      expect(screen.getByText(/NOW/)).toBeDefined()
      expect(screen.queryByRole('button', { name: /Play from/ })).toBeNull()
      fireEvent.click(screen.getByRole('button'))
      expect(onSelect).toHaveBeenCalledWith('v-rep-2')
    })

    it('renders Play button on viewed song when marker is play and onPlay is wired', () => {
      const onPlay = vi.fn()
      const { onSelect } = renderRow({ isCurrent: true, marker: 'play', onPlay })

      expect(screen.queryByText(/NOW/)).toBeNull()
      const playButton = screen.getByRole('button', { name: 'Play from Rosanna' })
      expect(playButton).toBeDefined()
      expect(playButton.textContent).toContain('Play')

      fireEvent.click(playButton)
      expect(onPlay).toHaveBeenCalledTimes(1)
      expect(onSelect).not.toHaveBeenCalled()
    })

    it('renders no Play button when marker is play but onPlay is not wired', () => {
      renderRow({ isCurrent: true, marker: 'play', onPlay: undefined })

      expect(screen.queryByText(/NOW/)).toBeNull()
      expect(screen.queryByRole('button', { name: /Play from/ })).toBeNull()
    })

    it('renders neither NOW nor Play button when marker is null', () => {
      renderRow({ isCurrent: false, marker: null })

      expect(screen.queryByText(/NOW/)).toBeNull()
      expect(screen.queryByRole('button', { name: /Play from/ })).toBeNull()
    })
  })
})

/**
 * RH-132 ER4 — an entry whose owner holds no repertoire row is a target.
 *
 * Fast View is addressed by `song_versions.id` now and the owner comes from the
 * page's `?bandId=`, so a version the owner holds no row for has an address
 * like any other: the row is interactive, it selects by `versionId`, and it can
 * be the current song and carry the ▶ NOW pill.
 *
 * **The muted *Not in repertoire* chip stays** — it is still true, and it is the
 * information the RH-126 mockup chose option B for. Only the dead/grey,
 * `disabled`, "Not in this repertoire yet" state goes.
 */
describe('an entry with no repertoire row (RH-132 ER4)', () => {
  const NO_OWNER_ROW: PlaylistEntry = {
    repertoireId: null,
    versionId: 'v-rep-9',
    songId: 'song-9',
    title: 'Spoonman',
    artist: 'Soundgarden',
  }

  it('renders the song, enabled, and still says it is not in the repertoire', () => {
    renderRow({ entry: NO_OWNER_ROW })
    const button = screen.getByRole('button') as HTMLButtonElement

    expect(button.textContent).toContain('Spoonman')
    expect(button.textContent).toContain('Soundgarden')
    expect(button.textContent).toContain('Not in repertoire')
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('title')).toBeNull()
  })

  it('selects it by its version id when it is clicked', () => {
    const { onSelect } = renderRow({ entry: NO_OWNER_ROW })

    fireEvent.click(screen.getByRole('button'))

    expect(onSelect).toHaveBeenCalledWith('v-rep-9')
  })

  it('shows the NOW pill when it is the current song', () => {
    // The state RH-132 makes reachable: the pill used to be guarded on
    // `repertoireId`, so the current song had the highlight and no pill.
    renderRow({ entry: NO_OWNER_ROW, isCurrent: true })

    expect(screen.getByRole('button').textContent).toContain('NOW')
  })

  it('takes the current-row highlight classes, not a dead/grey state', () => {
    renderRow({ entry: NO_OWNER_ROW, isCurrent: true })

    const className = screen.getByRole('button').className
    expect(className).toContain('bg-emerald-50')
    expect(className).not.toContain('cursor-not-allowed')
    expect(className).not.toContain('text-gray-400 border-gray-100 cursor-not-allowed')
  })
})

/** RH-196 — offline, a song not on this device is a disabled, marked row. */
describe('an entry not on this device (RH-196)', () => {
  it('renders a disabled, muted row with the Not on this device chip and never selects', () => {
    const { onSelect } = renderRow({ unavailable: true })
    const button = screen.getByRole('button') as HTMLButtonElement

    expect(button.disabled).toBe(true)
    expect(button.className).toContain('bg-gray-50 text-gray-400 border-gray-100')
    const chip = screen.getByText('Not on this device')
    expect(chip.className).toContain('border-dashed')
    expect(button.textContent).toContain('Rosanna')
    expect(button.textContent).toContain('Toto')

    fireEvent.click(button)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('shows only the device chip, not the repertoire one', () => {
    renderRow({ unavailable: true, entry: { ...ENTRY, repertoireId: null } })

    expect(screen.getByText('Not on this device')).toBeDefined()
    expect(screen.queryByText('Not in repertoire')).toBeNull()
  })

  it('renders an available row exactly as before', () => {
    renderRow({ unavailable: false })
    const button = screen.getByRole('button') as HTMLButtonElement

    expect(button.disabled).toBe(false)
    expect(screen.queryByText('Not on this device')).toBeNull()
  })
})

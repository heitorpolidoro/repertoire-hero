// @vitest-environment jsdom
/**
 * RH-172 - the playlist header's "More actions" menu and the delete modal it
 * opens. The header gets a plain panel value and a `vi.fn()` dispatch, so a
 * small stateful wrapper plays the page's reducer where the flow needs it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { useReducer } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PlaylistDetailHeader } from '@/components/playlists/PlaylistDetailHeader'
import { NO_PANEL, playlistPanelReducer } from '@/lib/playlistPanels'
import type { Playlist } from '@/types/database'

afterEach(cleanup)

const PLAYLIST = {
  id: 'pl',
  user_id: 'u',
  band_id: null,
  name: 'Set one',
  cover_url: null,
  spotify_playlist_id: null,
  sync_with_spotify: false,
  last_synced_at: null,
} as unknown as Playlist

interface Options {
  canReorder?: boolean
  reordering?: boolean
  withReview?: boolean
  startPractice?: boolean
  onDelete?: () => Promise<void>
}

function Harness({ options, spies }: { options: Options; spies: Record<string, ReturnType<typeof vi.fn>> }) {
  const [panel, dispatch] = useReducer(playlistPanelReducer, NO_PANEL)
  return (
    <div>
      <button type="button">outside</button>
      <PlaylistDetailHeader
        playlist={PLAYLIST}
        panel={panel}
        dispatch={(action) => {
          spies.dispatch(action)
          dispatch(action)
        }}
        syncing={false}
        onRename={vi.fn()}
        onDelete={options.onDelete ?? spies.onDelete}
        onSync={vi.fn()}
        canReorder={options.canReorder ?? true}
        reordering={options.reordering ?? false}
        onToggleReorder={spies.onToggleReorder}
        onReviewPractice={options.withReview === false ? undefined : spies.onReviewPractice}
        startPractice={options.startPractice ? <button type="button">Start practice</button> : undefined}
      />
    </div>
  )
}

function setup(options: Options = {}) {
  const spies = {
    dispatch: vi.fn(),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onToggleReorder: vi.fn(),
    onReviewPractice: vi.fn(),
  }
  render(<Harness options={options} spies={spies} />)
  return spies
}

const dots = () => screen.getByRole('button', { name: 'More actions' })
const open = () => fireEvent.click(dots())
const ACTIONS = ['Reorder', 'Review practice', 'Add songs', 'Rename playlist', 'Delete playlist']

describe('the header "More actions" menu', () => {
  it('is closed by default and none of the five actions is a top-level button', () => {
    setup()

    expect(screen.queryByRole('menu')).toBeNull()
    expect(dots().getAttribute('aria-haspopup')).toBe('menu')
    expect(dots().getAttribute('aria-expanded')).toBe('false')
    for (const name of ACTIONS) expect(screen.queryByRole('button', { name })).toBeNull()
  })

  it('lists the five actions as menuitems when opened, and none as a button', () => {
    setup()
    open()

    expect(dots().getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual(ACTIONS)
    for (const name of ACTIONS) expect(screen.queryByRole('button', { name })).toBeNull()
  })

  it('toggles closed on a second click of the dots button', () => {
    setup()
    open()
    open()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it.each([
    ['Reorder', 'onToggleReorder', undefined],
    ['Review practice', 'onReviewPractice', undefined],
    ['Add songs', 'dispatch', { type: 'toggle-picker' }],
    ['Rename playlist', 'dispatch', { type: 'open-rename', name: 'Set one' }],
  ])('runs "%s" and closes the menu', (name, spy, arg) => {
    const spies = setup()
    open()

    fireEvent.click(screen.getByRole('menuitem', { name }))

    const fn = spies[spy as keyof typeof spies]
    if (arg) expect(fn).toHaveBeenCalledWith(arg)
    else expect(fn).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes on Escape and on an outside click', () => {
    setup()
    open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()

    open()
    fireEvent.mouseDown(screen.getByRole('button', { name: 'outside' }))
    expect(screen.queryByRole('menu')).toBeNull()

    open()
    fireEvent.mouseDown(screen.getByRole('menu'))
    expect(screen.getByRole('menu')).toBeDefined()
  })

  it('leaves "Reorder" out when canReorder is false and "Review practice" out without a callback', () => {
    setup({ canReorder: false, withReview: false })
    open()

    expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual([
      'Add songs',
      'Rename playlist',
      'Delete playlist',
    ])
  })

  it('shows a top-level "Done reordering" and no "Reorder" item while reordering', () => {
    const spies = setup({ reordering: true })

    fireEvent.click(screen.getByRole('button', { name: 'Done reordering' }))
    expect(spies.onToggleReorder).toHaveBeenCalledTimes(1)
    open()
    expect(screen.queryByRole('menuitem', { name: 'Reorder' })).toBeNull()
  })

  it('renders the start slot in the action group, outside the menu', () => {
    setup({ startPractice: true })
    open()

    const start = screen.getByRole('button', { name: 'Start practice' })
    expect(screen.getByRole('menu').contains(start)).toBe(false)
  })

  it('hides the whole action group, dots included, while renaming', () => {
    setup()
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename playlist' }))

    expect(screen.getByRole('textbox', { name: 'Playlist name' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull()
  })
})

describe('the delete modal', () => {
  function openDialog(options: Options = {}) {
    const spies = setup(options)
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete playlist' }))
    return spies
  }

  it('closes the menu and opens a labelled modal dialog with focus on No', () => {
    openDialog()

    expect(screen.queryByRole('menu')).toBeNull()
    const dialog = screen.getByRole('dialog', { name: 'Delete playlist' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.textContent).toContain('This deletes the playlist. Its songs stay in your repertoire.')
    expect(screen.getByRole('button', { name: 'Yes, delete' })).toBeDefined()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'No' }))
  })

  it('No deletes nothing and returns focus to the dots button', () => {
    const spies = openDialog()

    fireEvent.click(screen.getByRole('button', { name: 'No' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(spies.onDelete).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(dots())
  })

  it('Escape deletes nothing', () => {
    const spies = openDialog()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(spies.onDelete).not.toHaveBeenCalled()
  })

  it('a backdrop click deletes nothing, a click inside the card does not close it', () => {
    const spies = openDialog()

    fireEvent.click(screen.getByRole('dialog'))
    expect(screen.getByRole('dialog')).toBeDefined()

    fireEvent.click(screen.getByTestId('delete-backdrop'))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(spies.onDelete).not.toHaveBeenCalled()
  })

  it('Yes, delete calls the delete once and shows Deleting while it is pending', () => {
    const spies = openDialog({ onDelete: () => new Promise<void>(() => {}) })
    const pending = vi.fn()
    void pending

    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))

    expect(screen.getByRole('status').textContent).toContain('Deleting')
    expect(screen.queryByRole('button', { name: 'Yes, delete' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'No' })).toBeNull()
    // Escape and the backdrop are ignored while it runs.
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByTestId('delete-backdrop'))
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(spies.dispatch).not.toHaveBeenCalledWith({ type: 'close' })
  })

  it('calls the supplied delete exactly once on Yes, delete', () => {
    const spies = openDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))
    expect(spies.onDelete).toHaveBeenCalledTimes(1)
  })
})

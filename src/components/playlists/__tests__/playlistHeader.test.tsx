// @vitest-environment jsdom
/**
 * RH-70 — the sticky header of `/playlists/[id]` and the Spotify strip inside
 * it. Two small sibling surfaces of the same page share one test file, the way
 * `src/components/ui/__tests__/feedbackSurfaces.test.tsx` and
 * `src/components/playlists/__tests__/tagBars.test.tsx` already do.
 *
 * Neither component decides anything: the header is handed a plain
 * `PlaylistPanel` value and a `vi.fn()` dispatch, and the rename and delete
 * arrive as callbacks the page bound, so nothing here imports a Server Action.
 *
 * Between them these tests pin every locator the e2e net reaches for on this
 * slice — the `<h1>` whose accessible name is the playlist name, a link named
 * `Back to playlists`, buttons named `Add songs`, `Rename playlist`,
 * `Delete playlist`, `Save`, `Cancel`, `Yes`, `No` and `Sync with Spotify`, and
 * a textbox named `Playlist name` — plus the focus-on-open that replaced the
 * page's deleted focus effect.
 */

import { describe, it, expect, vi, afterEach, type Mock } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PlaylistDetailHeader } from '@/components/playlists/PlaylistDetailHeader'
import { PlaylistSpotifyStrip } from '@/components/playlists/PlaylistSpotifyStrip'
import { NO_PANEL, type PlaylistPanel } from '@/lib/playlistPanels'
import type { Playlist } from '@/types/database'

afterEach(cleanup)

/** A personal playlist with no cover and no Spotify link: the plainest header. */
const PLAIN: Playlist = {
  id: 'playlist-70',
  user_id: 'owner-9',
  band_id: null,
  name: 'Set one',
  description: 'Opening set',
  cover_url: null,
  spotify_playlist_id: null,
  sync_with_spotify: false,
  last_synced_at: null,
  created_at: '2026-09-10T09:00:00.000Z',
  updated_at: '2026-09-10T09:30:00.000Z',
  tags: ['gig'],
}

function playlist(overrides: Partial<Playlist> = {}): Playlist {
  return { ...PLAIN, ...overrides }
}

type HeaderOverrides = {
  playlist?: Playlist
  panel?: PlaylistPanel
  syncing?: boolean
}

function renderHeader(overrides: HeaderOverrides = {}) {
  const dispatch: Mock = vi.fn()
  const onRename: Mock = vi.fn().mockResolvedValue(undefined)
  const onDelete: Mock = vi.fn().mockResolvedValue(undefined)
  const onSync: Mock = vi.fn().mockResolvedValue(undefined)
  const view = render(
    <PlaylistDetailHeader
      playlist={overrides.playlist ?? playlist()}
      panel={overrides.panel ?? NO_PANEL}
      dispatch={dispatch}
      syncing={overrides.syncing ?? false}
      onRename={onRename}
      onDelete={onDelete}
      onSync={onSync}
    />,
  )
  return { ...view, dispatch, onRename, onDelete, onSync }
}

/** The linked playlist the strip renders for. */
const LINKED = { spotify_playlist_id: 'spotify-1' }

describe('PlaylistDetailHeader', () => {
  it('renders the playlist name as a heading and a back link to the playlists page', () => {
    renderHeader()

    expect(screen.getByRole('heading', { name: 'Set one' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Back to playlists' }).getAttribute('href')).toBe(
      '/playlists',
    )
  })

  it('renders the cover image only when the playlist carries one', () => {
    const { container, unmount } = renderHeader()
    expect(container.querySelector('img')).toBeNull()
    unmount()

    const withCover = renderHeader({
      playlist: playlist({ cover_url: 'https://example.test/cover.jpg' }),
    })
    expect(withCover.container.querySelector('img')).not.toBeNull()
  })

  it('dispatches open-rename with the current name when Rename playlist is clicked', () => {
    const { dispatch } = renderHeader()

    fireEvent.click(screen.getByRole('button', { name: 'Rename playlist' }))

    expect(dispatch).toHaveBeenCalledWith({ type: 'open-rename', name: 'Set one' })
  })

  it('focuses the rename input as soon as it renders', () => {
    renderHeader({ panel: { kind: 'rename', draft: 'Set one' } })

    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Playlist name' }))
  })

  it('renders the draft in the input and dispatches what is typed', () => {
    const { dispatch } = renderHeader({ panel: { kind: 'rename', draft: 'Set one' } })
    const input = screen.getByRole('textbox', { name: 'Playlist name' }) as HTMLInputElement

    expect(input.value).toBe('Set one')
    fireEvent.change(input, { target: { value: 'Set two' } })

    expect(dispatch).toHaveBeenCalledWith({ type: 'change-rename-draft', draft: 'Set two' })
  })

  it('commits the rename on Enter and on the Save button', () => {
    const { onRename } = renderHeader({ panel: { kind: 'rename', draft: 'Set two' } })

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Playlist name' }), { key: 'Enter' })
    expect(onRename).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onRename).toHaveBeenCalledTimes(2)
  })

  it('closes the rename panel on Escape and on Cancel', () => {
    const { dispatch } = renderHeader({ panel: { kind: 'rename', draft: 'Set two' } })

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Playlist name' }), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'close' })
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'close' })
  })

  it('renders no action buttons while the rename panel is open', () => {
    renderHeader({ panel: { kind: 'rename', draft: 'Set one' } })

    expect(screen.queryByRole('button', { name: 'Add songs' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Rename playlist' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete playlist' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Set one' })).toBeNull()
  })

  it('toggles the add-song panel and reports it pressed while it is open', () => {
    const { dispatch, unmount } = renderHeader()
    const toggle = screen.getByRole('button', { name: 'Add songs' })

    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(dispatch).toHaveBeenCalledWith({ type: 'toggle-picker' })
    unmount()

    renderHeader({ panel: { kind: 'picker' } })
    expect(screen.getByRole('button', { name: 'Add songs' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
  })

  it('asks Sure? and calls the delete only after Yes', () => {
    const { dispatch, onDelete, unmount } = renderHeader()

    fireEvent.click(screen.getByRole('button', { name: 'Delete playlist' }))
    expect(dispatch).toHaveBeenCalledWith({ type: 'open-delete-confirm' })
    expect(onDelete).not.toHaveBeenCalled()
    unmount()

    const armed = renderHeader({ panel: { kind: 'delete-confirm' } })
    expect(screen.getByText('Sure?')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    expect(armed.onDelete).toHaveBeenCalledTimes(1)
  })

  it('closes the delete confirmation on No', () => {
    const { dispatch, onDelete } = renderHeader({ panel: { kind: 'delete-confirm' } })

    fireEvent.click(screen.getByRole('button', { name: 'No' }))

    expect(dispatch).toHaveBeenCalledWith({ type: 'close' })
    expect(onDelete).not.toHaveBeenCalled()
  })
})

describe('PlaylistSpotifyStrip', () => {
  function renderStrip(overrides: { playlist?: Playlist; syncing?: boolean } = {}) {
    const onSync: Mock = vi.fn().mockResolvedValue(undefined)
    const view = render(
      <PlaylistSpotifyStrip
        playlist={overrides.playlist ?? playlist(LINKED)}
        syncing={overrides.syncing ?? false}
        onSync={onSync}
      />,
    )
    return { ...view, onSync }
  }

  it('renders no Spotify strip for a playlist that is not linked', () => {
    renderStrip({ playlist: playlist({ spotify_playlist_id: null }) })

    expect(screen.queryByRole('button', { name: 'Sync with Spotify' })).toBeNull()
  })

  it('renders the auto-sync label and the last-synced suffix only when they apply', () => {
    const { unmount } = renderStrip()
    expect(screen.getByText('Synced with Spotify')).toBeDefined()
    expect(screen.queryByText(/ago|just now/)).toBeNull()
    unmount()

    renderStrip({
      playlist: playlist({
        ...LINKED,
        sync_with_spotify: true,
        last_synced_at: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
      }),
    })
    expect(screen.getByText('Auto-sync on')).toBeDefined()
    expect(screen.getByText(/2h ago/)).toBeDefined()
  })

  it('disables the Sync button while a sync is in flight', () => {
    const { onSync } = renderStrip({ syncing: true })
    const button = screen.getByRole('button', { name: 'Sync with Spotify' }) as HTMLButtonElement

    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onSync).not.toHaveBeenCalled()
  })

  it('calls onSync when the Sync button is clicked', () => {
    const { onSync } = renderStrip()

    fireEvent.click(screen.getByRole('button', { name: 'Sync with Spotify' }))

    expect(onSync).toHaveBeenCalledTimes(1)
  })
})

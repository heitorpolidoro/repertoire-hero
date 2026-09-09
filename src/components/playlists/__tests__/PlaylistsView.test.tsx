// @vitest-environment jsdom
/**
 * RH-63 — `/playlists` is a Server Component and this island only renders what
 * the server read. The suite is written against that contract: every test
 * supplies the list as a prop, none of them waits for a load, and the last one
 * proves mechanically that no network request is issued while rendering — the
 * mount-effect read of `/api/spotify/playlists` is gone, not relocated.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
const { push, refresh } = router

import { PlaylistsView, type PlaylistsViewActions } from '../PlaylistsView'
import type { Playlist } from '@/types/database'

afterEach(cleanup)

beforeEach(() => {
  push.mockClear()
  refresh.mockClear()
})

const PLAYLISTS = [
  { id: 'p1', name: 'Setlist A', band_id: null, songs: [], tags: [] },
  { id: 'p2', name: 'Setlist B', band_id: null, songs: [], tags: [] },
  {
    id: 'p3',
    name: 'Band setlist',
    band_id: 'band-1',
    band: { id: 'band-1', name: 'The Rolling Stones' },
    songs: [],
    tags: [],
  },
] as unknown as Playlist[]

function makeActions(overrides: Partial<PlaylistsViewActions> = {}) {
  return {
    createPlaylist: vi.fn().mockResolvedValue({ id: 'p9' }),
    updatePlaylist: vi.fn().mockResolvedValue(undefined),
    deletePlaylist: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as PlaylistsViewActions & {
    createPlaylist: ReturnType<typeof vi.fn>
    updatePlaylist: ReturnType<typeof vi.fn>
    deletePlaylist: ReturnType<typeof vi.fn>
  }
}

function setup(props: Partial<React.ComponentProps<typeof PlaylistsView>> = {}) {
  const actions = (props.actions ?? makeActions()) as ReturnType<typeof makeActions>
  render(
    <PlaylistsView
      playlists={props.playlists ?? PLAYLISTS}
      initialError={props.initialError ?? null}
      spotifyConnected={props.spotifyConnected ?? false}
      actions={actions}
    />,
  )
  return { actions }
}

describe('PlaylistsView', () => {
  it('renders one card per playlist from its props, grouped by owner', () => {
    setup()

    // Each card is an <li> carrying role="button" ("Open <name>"), so the cards
    // are counted by that role rather than by listitem.
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(3)
    expect(screen.getByText('Setlist A')).toBeDefined()
    expect(screen.getByText('Setlist B')).toBeDefined()
    expect(screen.getByText('Band setlist')).toBeDefined()
    expect(screen.getByText('My playlists')).toBeDefined()
    expect(screen.getByLabelText('Band: The Rolling Stones')).toBeDefined()
  })

  it('renders the empty state when the playlist list prop is empty', () => {
    setup({ playlists: [] })

    expect(screen.getByText('No playlists yet')).toBeDefined()
    expect(screen.queryAllByRole('button', { name: /^Open / })).toHaveLength(0)
  })

  it('renders the initialError prop in the page error banner', () => {
    setup({ initialError: 'Failed to fetch playlists: connection refused' })

    const banner = screen.getByRole('alert')
    expect(banner.textContent).toContain('Failed to fetch playlists: connection refused')
  })

  it('deletes a playlist through the injected action and removes its card', async () => {
    const { actions } = setup()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Setlist A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))

    await waitFor(() => expect(actions.deletePlaylist).toHaveBeenCalledWith('p1'))
    expect(screen.queryByText('Setlist A')).toBeNull()
    expect(screen.getByText('Setlist B')).toBeDefined()
  })

  it('refreshes the router after a successful delete', async () => {
    const { actions } = setup()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Setlist B' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))

    await waitFor(() => expect(actions.deletePlaylist).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  })

  it('renames a playlist through the injected action and shows the new name', async () => {
    const { actions } = setup()

    fireEvent.click(screen.getByRole('button', { name: 'Rename Setlist A' }))
    fireEvent.change(screen.getByDisplayValue('Setlist A'), {
      target: { value: 'Wedding gig' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(actions.updatePlaylist).toHaveBeenCalledWith('p1', { name: 'Wedding gig' }),
    )
    expect(screen.getByText('Wedding gig')).toBeDefined()
    expect(screen.queryByText('Setlist A')).toBeNull()
  })

  it('surfaces a delete failure in the error banner and keeps the card', async () => {
    const actions = makeActions({
      deletePlaylist: vi.fn().mockRejectedValue(new Error('Access denied')),
    })
    setup({ actions })

    fireEvent.click(screen.getByRole('button', { name: 'Delete Setlist A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Access denied'))
    expect(screen.getByText('Setlist A')).toBeDefined()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('issues no network request while rendering the list', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    setup()

    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(3)
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

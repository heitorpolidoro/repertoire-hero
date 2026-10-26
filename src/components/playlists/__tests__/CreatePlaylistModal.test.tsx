// @vitest-environment jsdom
/**
 * RH-63 — the create/import modal is the one island that still reads the band
 * context, and the only place that talks to Spotify.
 *
 * Two things are pinned mechanically here. First, the Spotify playlist list is
 * requested from the `From Spotify` tab button's handler and nowhere else — no
 * mount effect, on the page or on the modal. Second, the active band context
 * reaches both of its destinations without the server render ever reading it:
 * the `band_id` of the import request (the import tests set the zustand store
 * and read the field back out of the parsed request body), and, since RH-184,
 * the owner handed to `onCreate` alongside the name, which the page turns into
 * a band or a personal create. In band context the dialog also names that
 * owner in its `#new-playlist-owner` description.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

import { CreatePlaylistModal } from '../CreatePlaylistModal'
import { useBandContextStore } from '@/store/bandContextStore'
import type { SpotifyPlaylist } from '@/types/database'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const SPOTIFY_PLAYLISTS: SpotifyPlaylist[] = [
  {
    id: 'sp-1',
    name: 'Road trip',
    description: null,
    cover_url: null,
    total_tracks: 12,
    owner: 'heitor',
  },
]

type FetchStub = ReturnType<typeof vi.fn>

/** Answers the list route with `SPOTIFY_PLAYLISTS` and the import route with `importResponse`. */
function stubFetch(
  options: {
    list?: unknown
    importOk?: boolean
    importBody?: unknown
  } = {},
): FetchStub {
  const fetchSpy = vi.fn(async (url: string) => {
    if (url.includes('/import')) {
      return {
        ok: options.importOk ?? true,
        status: options.importOk === false ? 500 : 200,
        json: async () => options.importBody ?? { ok: true },
      }
    }
    return {
      ok: true,
      status: 200,
      json: async () => options.list ?? SPOTIFY_PLAYLISTS,
    }
  })
  vi.stubGlobal('fetch', fetchSpy)
  return fetchSpy
}

function setup(props: Partial<React.ComponentProps<typeof CreatePlaylistModal>> = {}) {
  const onClose = props.onClose ?? vi.fn()
  const onCreate = props.onCreate ?? vi.fn().mockResolvedValue(undefined)
  const onImported = props.onImported ?? vi.fn().mockResolvedValue(undefined)
  render(
    <CreatePlaylistModal
      spotifyConnected={props.spotifyConnected ?? true}
      onClose={onClose}
      onCreate={onCreate}
      onImported={onImported}
    />,
  )
  return { onClose, onCreate, onImported }
}

/** Opens the Spotify tab and waits for the fetched row to appear. */
async function openSpotifyTab() {
  fireEvent.click(screen.getByRole('button', { name: 'From Spotify' }))
  await screen.findByText('Road trip')
}

/** Selects the fetched playlist and confirms the import. */
async function confirmImport() {
  fireEvent.click(screen.getByRole('button', { name: 'Import' }))
  const confirm = await screen.findByRole('button', { name: 'Import' })
  fireEvent.click(confirm)
}

beforeEach(() => {
  useBandContextStore.setState({ context: { type: 'user' } })
})

/** Types a padded name and presses Create. */
function submitName(name = '  Gig setlist  ') {
  fireEvent.change(screen.getByLabelText('Playlist name'), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
}

function enterBandContext() {
  useBandContextStore.setState({
    context: { type: 'band', id: 'band-7', name: 'The Rolling Stones' },
  })
}

describe('CreatePlaylistModal', () => {
  it('creates a playlist through the injected action and closes the modal', async () => {
    const { onCreate, onClose } = setup()

    submitName()

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Gig setlist', null))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('passes the active band id to onCreate when the context is a band (RH-184)', async () => {
    enterBandContext()
    const { onCreate, onClose } = setup()

    submitName()

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Gig setlist', 'band-7'))
    expect(onCreate).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('names the active band in the owner cue, as the dialog description, on both tabs', async () => {
    stubFetch()
    enterBandContext()
    setup()

    const dialog = screen.getByRole('dialog', { name: 'New Playlist' })
    const cue = screen.getByTestId('new-playlist-owner')
    expect(cue.id).toBe('new-playlist-owner')
    expect(cue.textContent).toContain('Band playlist for The Rolling Stones')
    expect(dialog.getAttribute('aria-describedby')).toBe('new-playlist-owner')
    expect(screen.getByRole('dialog', { description: 'Band playlist for The Rolling Stones' })).toBe(dialog)

    await openSpotifyTab()

    expect(screen.getByTestId('new-playlist-owner').textContent).toContain(
      'Band playlist for The Rolling Stones',
    )
    expect(dialog.getAttribute('aria-describedby')).toBe('new-playlist-owner')
  })

  it('renders no owner cue and no description in personal context', () => {
    setup()

    expect(screen.queryByTestId('new-playlist-owner')).toBeNull()
    expect(document.getElementById('new-playlist-owner')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'New Playlist' }).hasAttribute('aria-describedby')).toBe(false)
  })

  it('keeps the dialog open and shows the message when onCreate rejects', async () => {
    enterBandContext()
    const onCreate = vi.fn().mockRejectedValue(new Error('Access denied: not a member of this band'))
    const { onClose } = setup({ onCreate })

    submitName()

    await waitFor(() =>
      expect(screen.getByText('Access denied: not a member of this band')).toBeDefined(),
    )
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'New Playlist' })).toBeDefined()
  })

  it('does not request the Spotify playlist list until the From Spotify tab is opened', () => {
    const fetchSpy = stubFetch()

    setup()

    expect(screen.getByRole('button', { name: 'From Spotify' })).toBeDefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('requests the Spotify playlist list once when the From Spotify tab is opened', async () => {
    const fetchSpy = stubFetch()
    setup()

    await openSpotifyTab()
    fireEvent.click(screen.getByRole('button', { name: 'New playlist' }))
    fireEvent.click(screen.getByRole('button', { name: 'From Spotify' }))
    await screen.findByText('Road trip')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/spotify/playlists')
  })

  it('disables the From Spotify tab when the server reports no Spotify connection', () => {
    const fetchSpy = stubFetch()
    setup({ spotifyConnected: false })

    const tab = screen.getByRole('button', { name: 'From Spotify' }) as HTMLButtonElement
    expect(tab.disabled).toBe(true)

    fireEvent.click(tab)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(screen.queryByText('Road trip')).toBeNull()
  })

  it('imports a Spotify playlist into the active band when the context is a band', async () => {
    const fetchSpy = stubFetch()
    useBandContextStore.setState({
      context: { type: 'band', id: 'band-7', name: 'The Rolling Stones' },
    })
    const { onImported } = setup()

    await openSpotifyTab()
    await confirmImport()

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2))
    const [url, init] = fetchSpy.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('/api/spotify/playlists/sp-1/import')
    expect(JSON.parse(String(init.body)).band_id).toBe('band-7')
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1))
  })

  it('imports a Spotify playlist with no band id when the context is personal', async () => {
    const fetchSpy = stubFetch()
    setup()

    await openSpotifyTab()
    await confirmImport()

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2))
    const [, init] = fetchSpy.mock.calls[1] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as { band_id?: string; sync_with_spotify: boolean }
    expect(body.band_id).toBeUndefined()
    expect(body.sync_with_spotify).toBe(false)
  })

  it('surfaces an import failure inside the pending import row', async () => {
    stubFetch({ importOk: false, importBody: { error: 'Spotify rate limit reached' } })
    const { onClose } = setup()

    await openSpotifyTab()
    await confirmImport()

    await waitFor(() => expect(screen.getByText('Spotify rate limit reached')).toBeDefined())
    expect(screen.getByText('Import “Road trip”?')).toBeDefined()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on Escape', () => {
    const { onClose } = setup()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

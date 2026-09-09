// @vitest-environment jsdom
/**
 * RH-63 — the create/import modal is the one island that still reads the band
 * context, and the only place that talks to Spotify.
 *
 * Two things are pinned mechanically here. First, the Spotify playlist list is
 * requested from the `From Spotify` tab button's handler and nowhere else — no
 * mount effect, on the page or on the modal. Second, the active band context
 * still reaches its single destination, the `band_id` of the import request,
 * without ever being transported to the server: the two import tests set the
 * zustand store and read the field back out of the parsed request body.
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

describe('CreatePlaylistModal', () => {
  it('creates a playlist through the injected action and closes the modal', async () => {
    const { onCreate, onClose } = setup()

    fireEvent.change(screen.getByLabelText('Playlist name'), {
      target: { value: '  Gig setlist  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Gig setlist'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
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

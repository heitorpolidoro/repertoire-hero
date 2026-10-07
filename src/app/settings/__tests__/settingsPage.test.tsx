// @vitest-environment jsdom
/**
 * RH-129 §F — `/settings` still resolves its Spotify connection state.
 *
 * The page's mount effect called a `useCallback`'d loader whose body set state,
 * and `react-hooks/set-state-in-effect` follows the callback. The remedy inlines
 * the load as an async function defined inside the effect, with an `alive` guard
 * on the write. That is a real rewrite of the load path, and the failure it can
 * produce is silent: a botched guard leaves `spotifyConnected` at `null`
 * forever, so the page shows the "Checking Spotify connection..." spinner and
 * nothing else. Hence the third assertion in both cases below.
 *
 * `OfflineStorageSection` is mocked out: it reaches IndexedDB through
 * `useOfflineLibrary` and is exercised for real in its own suite. The subject
 * here is the Spotify region.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

vi.mock('@/components/settings/OfflineStorageSection', () => ({
  OfflineStorageSection: () => null,
}))

import SettingsPage from '../page'

const SPINNER = 'Checking Spotify connection...'
const AUTHORIZE_HREF = '/api/auth/spotify/authorize'

function stubFetch(body: unknown) {
  const fetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  })
  vi.stubGlobal('fetch', fetchSpy)
  return fetchSpy
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SettingsPage Spotify region (RH-129)', () => {
  it('offers the authorize link as a plain document request when Spotify is not connected', async () => {
    stubFetch({ connected: false })

    render(<SettingsPage />)

    const region = await screen.findByRole('region', { name: 'Spotify connection' })
    expect(region.textContent).toContain('Connect your Spotify account')

    // A plain `<a href>`, deliberately: the destination is a route handler that
    // sets an httpOnly state cookie and redirects off-origin, so it needs a
    // document request and cannot be a `next/link` client transition.
    const link = screen.getByRole('link', { name: 'Connect Spotify' })
    expect(link.getAttribute('href')).toBe(AUTHORIZE_HREF)

    await waitFor(() => {
      expect(screen.queryByText(SPINNER)).toBeNull()
    })
  })

  it('reports the connection when the playlists endpoint answers with an array', async () => {
    stubFetch([{ id: 'playlist-1', name: 'Gig setlist' }])

    render(<SettingsPage />)

    const region = await screen.findByRole('region', { name: 'Spotify connection' })
    expect(region.textContent).toContain('Connected to Spotify')
    expect(screen.queryByRole('link', { name: 'Connect Spotify' })).toBeNull()

    await waitFor(() => {
      expect(screen.queryByText(SPINNER)).toBeNull()
    })
  })

  it('shows the spinner until the load settles', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))

    render(<SettingsPage />)

    expect(screen.getByText(SPINNER)).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Spotify connection' })).toBeNull()
  })

  it('treats a failed load as not connected rather than leaving the spinner up', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    render(<SettingsPage />)

    expect(await screen.findByRole('link', { name: 'Connect Spotify' })).toBeDefined()
    expect(screen.queryByText(SPINNER)).toBeNull()
  })
})

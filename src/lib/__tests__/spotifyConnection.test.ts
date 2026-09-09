/**
 * RH-63 — the cheap row-existence check that replaces the page's mount-time
 * `fetch('/api/spotify/playlists')` for the `spotifyConnected` flag alone.
 *
 * The point of the last test is architectural: `getSpotifyAccessToken` may POST
 * to `accounts.spotify.com` to refresh a near-expiry token, and the server
 * render of `/playlists` must never block on that HTTP round trip.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ query: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { query } from '@/lib/db'
import { logger } from '@/lib/logger'
import { hasSpotifyConnection } from '@/lib/spotifyConnection'

const queryMock = vi.mocked(query)
const USER_ID = 'user-1'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('hasSpotifyConnection', () => {
  it('reports a connection when the tokens table has a row for the user', async () => {
    queryMock.mockResolvedValue({ rowCount: 1, rows: [{ one: 1 }] } as never)

    await expect(hasSpotifyConnection(USER_ID)).resolves.toBe(true)

    expect(queryMock).toHaveBeenCalledTimes(1)
    const [sql, params] = queryMock.mock.calls[0]
    expect(sql).toContain('spotify_tokens')
    expect(params).toEqual([USER_ID])
  })

  it('reports no connection when the tokens table has no row for the user', async () => {
    queryMock.mockResolvedValue({ rowCount: 0, rows: [] } as never)

    await expect(hasSpotifyConnection(USER_ID)).resolves.toBe(false)
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('reports no connection and logs the failure when the query throws', async () => {
    queryMock.mockRejectedValue(new Error('relation "spotify_tokens" does not exist'))

    await expect(hasSpotifyConnection(USER_ID)).resolves.toBe(false)

    expect(logger.error).toHaveBeenCalledTimes(1)
    const [message, err, context] = vi.mocked(logger.error).mock.calls[0]
    expect(message).toContain('Spotify connection')
    expect(err).toBeInstanceOf(Error)
    expect(context).toEqual({ userId: USER_ID })
  })

  it('never performs a token refresh request', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    queryMock.mockResolvedValue({ rowCount: 1, rows: [{ one: 1 }] } as never)

    await hasSpotifyConnection(USER_ID)

    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

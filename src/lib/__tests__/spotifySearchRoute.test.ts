/**
 * RH-108 ER21 — `/api/spotify/search`'s contract, unchanged by this task.
 *
 * This task re-points the route's `SpotifyTrack` at the one declaration in
 * `@/lib/spotify` and projects two new album fields from the upstream payload.
 * Everything else about the handler has to stay exactly as it was, and the four
 * answers worth pinning are the ones a caller can see: the `401`, the `400`, and
 * both `200 []` degradation paths — the unconfigured deployment and the upstream
 * failure. Without this file none of them is executed by any test: `src/app/api/**`
 * sits outside the coverage gate, and the existing Spotify suites mock
 * `/api/spotify/search` at the client `fetch` boundary rather than calling the
 * handler.
 *
 * No database and no network: `getRequiredUserId` is mocked, `fetch` is a spy,
 * and `primarySpotifyArtist` runs for real because it is the RH-95 reduction
 * the projection depends on.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth-session', () => ({ getRequiredUserId: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

import { getRequiredUserId } from '@/lib/auth-session'
import { logger } from '@/lib/logger'
import { GET } from '@/app/api/spotify/search/route'

const authMock = getRequiredUserId as Mock

/** The route reads `request.nextUrl`, so the URL has to be a real one. */
function request(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/spotify/search${query}`)
}

const ORIGINAL_ID = process.env.SPOTIFY_CLIENT_ID
const ORIGINAL_SECRET = process.env.SPOTIFY_CLIENT_SECRET

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue('user-1')
  process.env.SPOTIFY_CLIENT_ID = 'test-client-id'
  process.env.SPOTIFY_CLIENT_SECRET = 'test-client-secret'
})

afterEach(() => {
  vi.restoreAllMocks()
  process.env.SPOTIFY_CLIENT_ID = ORIGINAL_ID
  process.env.SPOTIFY_CLIENT_SECRET = ORIGINAL_SECRET
})

describe('GET /api/spotify/search (RH-108 ER21)', () => {
  it('answers 401 when the caller is not authenticated', async () => {
    authMock.mockRejectedValue(new Error('no session'))

    const response = await GET(request('?q=bad'))

    // This handler owns its authorization: `src/proxy.ts` is not a boundary.
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Not authenticated', code: 401 })
  })

  it('answers 400 when q is absent or blank', async () => {
    for (const query of ['', '?q=', '?q=%20%20']) {
      const response = await GET(request(query))

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: 'Missing required query parameter: q',
        code: 400,
      })
    }
  })

  it('answers 200 with an empty list when SPOTIFY_CLIENT_ID is unset', async () => {
    delete process.env.SPOTIFY_CLIENT_ID
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const response = await GET(request('?q=bad'))

    // Graceful degradation: an unconfigured deployment produces a complete
    // catalog-only picker list rather than a failing panel.
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('answers 200 with an empty list when the upstream call fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('spotify down'))

    const response = await GET(request('?q=bad'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
    expect(logger.error).toHaveBeenCalledWith('[spotify/search]', expect.any(Error))
  })

  it('projects albumType and releaseDate alongside the fields it already returned', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.includes('accounts.spotify.com')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 })),
        )
      }
      // `limit=8`, unchanged by this task.
      expect(url).toContain('limit=8')
      return Promise.resolve(
        new Response(
          JSON.stringify({
            tracks: {
              items: [
                {
                  id: 'sp-aaa',
                  name: 'Bad - Remaster 2012',
                  artists: [{ name: 'Michael Jackson' }, { name: 'Someone Else' }],
                  external_urls: { spotify: 'https://open.spotify.com/track/sp-aaa' },
                  preview_url: null,
                  album: {
                    name: 'Bad',
                    images: [{ url: 'https://img/large.jpg', width: 640, height: 640 }],
                    album_type: 'album',
                    release_date: '1987-08-31',
                  },
                },
              ],
            },
          }),
        ),
      )
    })

    const response = await GET(request('?q=bad'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([
      {
        id: 'sp-aaa',
        title: 'Bad - Remaster 2012',
        // RH-95's reduction, so a search result matches the catalog row the
        // playlist sync would have created.
        artist: 'Michael Jackson',
        album: 'Bad',
        spotifyUrl: 'https://open.spotify.com/track/sp-aaa',
        previewUrl: null,
        albumArt: 'https://img/large.jpg',
        albumType: 'album',
        releaseDate: '1987-08-31',
      },
    ])
  })

  it('answers null for both new fields when Spotify omits them, and throws nothing', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (String(input).includes('accounts.spotify.com')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 })),
        )
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            tracks: {
              items: [
                {
                  id: 'sp-bbb',
                  name: 'Kashmir',
                  artists: [{ name: 'Led Zeppelin' }],
                  external_urls: { spotify: 'https://open.spotify.com/track/sp-bbb' },
                  preview_url: null,
                  album: { name: 'Physical Graffiti', images: [] },
                },
              ],
            },
          }),
        ),
      )
    })

    const [projected] = (await (await GET(request('?q=kashmir'))).json()) as Array<
      Record<string, unknown>
    >

    expect(projected.albumType).toBeNull()
    expect(projected.releaseDate).toBeNull()
    expect(projected.albumArt).toBeNull()
  })
})

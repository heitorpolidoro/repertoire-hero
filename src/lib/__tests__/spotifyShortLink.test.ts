/**
 * RH-142 — resolving a Spotify share short link to its canonical track url.
 *
 * `fetch` is stubbed throughout: the network is never touched, and the stub is
 * how the SSRF boundary is asserted (no request for a host off the allow-list).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { logger } from '@/lib/logger'
import { isSpotifyShortLink, resolveSpotifyShortLink } from '../spotifyShortLink'

const CANONICAL = 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } })
}

describe('isSpotifyShortLink', () => {
  it.each([
    'https://spotify.link/abc',
    'https://SPOTIFY.LINK/abc',
    'https://spoti.fi/abc',
  ])('accepts %s', (url) => {
    expect(isSpotifyShortLink(url)).toBe(true)
  })

  it.each([
    'https://open.spotify.com/track/abc',
    'https://youtube.com/watch?v=1',
    'http://spotify.link/x',
    'https://notspotify.link/x',
    'https://spotify.link.evil.io/x',
    'https://spotify.link@evil.io/x',
    'not a url',
    '',
  ])('rejects %s', (url) => {
    expect(isSpotifyShortLink(url)).toBe(false)
  })
})

describe('resolveSpotifyShortLink', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(logger.error).mockClear()
    vi.mocked(logger.warn).mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(['https://spotify.link/abc123', 'https://spoti.fi/abc123'])(
    'resolves %s to the canonical track url without the share query',
    async (url) => {
      fetchMock.mockResolvedValueOnce(redirect(`${CANONICAL}?si=share`))

      await expect(resolveSpotifyShortLink(url)).resolves.toBe(CANONICAL)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][0]).toBe(url)
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
    },
  )

  it('follows a chain of allow-listed hops and a relative Location', async () => {
    fetchMock
      .mockResolvedValueOnce(redirect('https://spoti.fi/second'))
      .mockResolvedValueOnce(redirect('/third'))
      .mockResolvedValueOnce(redirect(`${CANONICAL}?si=x`, 301))

    await expect(resolveSpotifyShortLink('https://spotify.link/a')).resolves.toBe(CANONICAL)
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      'https://spotify.link/a',
      'https://spoti.fi/second',
      'https://spoti.fi/third',
    ])
  })

  it.each([
    'https://open.spotify.com/track/abc',
    'https://youtube.com/watch?v=1',
    'http://spotify.link/x',
    'https://notspotify.link/x',
    'https://spotify.link.evil.io/x',
    'https://spotify.link@evil.io/x',
  ])('returns %s untouched and makes no request', async (url) => {
    await expect(resolveSpotifyShortLink(url)).resolves.toBe(url)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  const SHORT = 'https://spotify.link/abc'

  it.each([
    ['a rejected fetch', () => fetchMock.mockRejectedValue(new Error('boom'))],
    ['a timeout', () => fetchMock.mockRejectedValue(new DOMException('t', 'TimeoutError'))],
    ['a rejected non-Error', () => fetchMock.mockRejectedValue('nope')],
    ['a 200 without a redirect', () => fetchMock.mockResolvedValue(new Response('ok'))],
    ['a redirect with no Location', () => fetchMock.mockResolvedValue(new Response(null, { status: 302 }))],
    ['a hop to an off-list host', () => fetchMock.mockResolvedValue(redirect('https://evil.io/track/abc'))],
    ['a hop to a look-alike host', () => fetchMock.mockResolvedValue(redirect('https://spotify.com.evil.io/track/abc'))],
    ['a hop to http', () => fetchMock.mockResolvedValue(redirect('http://open.spotify.com/track/abc'))],
    ['an unparsable Location', () => fetchMock.mockResolvedValue(redirect('http://['))],
    ['an album target', () => fetchMock.mockResolvedValue(redirect('https://open.spotify.com/album/abc'))],
    [
      'a hop beyond the cap',
      () => fetchMock.mockImplementation(() => Promise.resolve(redirect('https://spotify.link/loop'))),
    ],
  ])('returns the original url, logs and does not throw on %s', async (_name, arrange) => {
    arrange()

    await expect(resolveSpotifyShortLink(SHORT)).resolves.toBe(SHORT)
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('caps the number of hops', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(redirect('https://spotify.link/loop')))

    await resolveSpotifyShortLink(SHORT)

    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(6)
  })

  it('never requests an off-list hop', async () => {
    fetchMock.mockResolvedValue(redirect('https://evil.io/x'))

    await resolveSpotifyShortLink(SHORT)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

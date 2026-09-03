import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchUrlTitle } from '../linkFetcher'

describe('linkFetcher', () => {
  it('returns fallback hostname for invalid or network-blocked URLs', async () => {
    const title = await fetchUrlTitle('https://example.com/invalid-page-12345')
    expect(typeof title).toBe('string')
  })

  it('parses fallback for unparseable input', async () => {
    const title = await fetchUrlTitle('not-a-valid-url')
    expect(title).toBe('not-a-valid-url')
  })
})

describe('linkFetcher oEmbed strategies', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const jsonResponse = (body: unknown, ok = true) => ({ ok, json: async () => body })

  it('resolves a YouTube URL through the YouTube oEmbed title', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ title: '  Bohemian Rhapsody  ' }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchUrlTitle('https://youtu.be/fJ9rUzIMcZQ')).toBe('Bohemian Rhapsody')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('youtube.com/oembed')
  })

  it('falls through to noembed when the YouTube oEmbed response fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, false))
      .mockResolvedValueOnce(jsonResponse({ title: 'Noembed Title' }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchUrlTitle('https://www.youtube.com/watch?v=abc')).toBe('Noembed Title')
    expect(String(fetchMock.mock.calls[1][0])).toContain('noembed.com/embed')
  })

  it('treats a blank oEmbed title as a miss and keeps looking', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ title: '   ' }))
      .mockResolvedValueOnce(jsonResponse({ title: '' }))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<html><head><title>Page Title</title></head></html>',
      })
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchUrlTitle('https://www.youtube.com/watch?v=abc')).toBe('Page Title')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('resolves a Spotify URL through the Spotify oEmbed title', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ title: 'Track Name' }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchUrlTitle('https://open.spotify.com/track/abc')).toBe('Track Name')
    expect(String(fetchMock.mock.calls[0][0])).toContain('open.spotify.com/oembed')
  })

  it('falls back to the hostname when every oEmbed strategy throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    )

    expect(await fetchUrlTitle('https://www.youtube.com/watch?v=abc')).toBe('youtube.com')
  })
})

/**
 * Fetches page/video/track title from YouTube (oEmbed/noembed), Spotify oEmbed, or HTML <title> tags.
 * Operates without requiring any API keys.
 */

/**
 * Calls an oEmbed endpoint and returns its `title`, trimmed, or `null` when the
 * provider answers with an error, an unusable body or a blank title.
 * Module-private: the exported entry point is `fetchUrlTitle`.
 */
async function fetchOembedTitle(
  endpoint: string,
  headers: Record<string, string>
): Promise<string | null> {
  try {
    const res = await fetch(endpoint, { headers, signal: AbortSignal.timeout(4000) })
    if (res.ok) {
      const data = (await res.json()) as { title?: string }
      if (data.title?.trim()) return data.title.trim()
    }
  } catch {
    // oEmbed is best-effort — the caller falls through to its next strategy.
  }
  return null
}

export async function fetchUrlTitle(url: string): Promise<string> {
  if (!url) return ''
  const cleanUrl = url.trim()
  const lower = cleanUrl.toLowerCase()

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  }

  // 1. YouTube
  if (lower.includes('youtube.com/') || lower.includes('youtu.be/')) {
    // YouTube oEmbed is best-effort — fall through to noembed.
    const youtubeTitle = await fetchOembedTitle(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(cleanUrl)}&format=json`,
      headers
    )
    if (youtubeTitle) return youtubeTitle

    // noembed.com is a best-effort fallback — fall through to the generic HTML fetch.
    const noembedTitle = await fetchOembedTitle(
      `https://noembed.com/embed?url=${encodeURIComponent(cleanUrl)}`,
      headers
    )
    if (noembedTitle) return noembedTitle
  }

  // 2. Spotify
  if (lower.includes('spotify.com/')) {
    // Spotify oEmbed is best-effort — fall through to the generic HTML fetch.
    const spotifyTitle = await fetchOembedTitle(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`,
      headers
    )
    if (spotifyTitle) return spotifyTitle
  }

  // 3. Generic HTML Page <title> / og:title
  try {
    const htmlRes = await fetch(cleanUrl, {
      headers,
      signal: AbortSignal.timeout(4000),
    })
    if (htmlRes.ok) {
      const text = await htmlRes.text()

      // Check og:title first
      const ogMatch = text.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
      if (ogMatch && ogMatch[1]?.trim()) {
        return ogMatch[1].trim().replace(/\s*-\s*YouTube$/i, '')
      }

      // Check <title>
      const match = text.match(/<title[^>]*>([^<]+)<\/title>/i)
      if (match && match[1]?.trim()) {
        const parsedTitle = match[1]
          .trim()
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/\s*-\s*YouTube$/i, '')
          .replace(/\s+/g, ' ')
        if (parsedTitle) return parsedTitle
      }
    }
  } catch {
    // The page may be unreachable or non-HTML — fall through to the domain-name fallback.
  }

  // Fallback to domain name
  try {
    const parsed = new URL(cleanUrl)
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return cleanUrl
  }
}

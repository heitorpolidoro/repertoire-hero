/**
 * Fetches page/video/track title from YouTube oEmbed, Spotify oEmbed, or HTML <title> tags.
 * Operates without requiring any API keys.
 */

export async function fetchUrlTitle(url: string): Promise<string> {
  if (!url) return ''
  const cleanUrl = url.trim()
  const lower = cleanUrl.toLowerCase()

  try {
    // 1. YouTube oEmbed
    if (lower.includes('youtube.com/') || lower.includes('youtu.be/')) {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(cleanUrl)}&format=json`,
        { signal: AbortSignal.timeout(4000) }
      )
      if (res.ok) {
        const data = (await res.json()) as { title?: string }
        if (data.title?.trim()) return data.title.trim()
      }
    }

    // 2. Spotify oEmbed
    if (lower.includes('spotify.com/')) {
      const res = await fetch(
        `https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`,
        { signal: AbortSignal.timeout(4000) }
      )
      if (res.ok) {
        const data = (await res.json()) as { title?: string }
        if (data.title?.trim()) return data.title.trim()
      }
    }

    // 3. Generic HTML Page <title>
    const htmlRes = await fetch(cleanUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(4000),
    })
    if (htmlRes.ok) {
      const text = await htmlRes.text()
      const match = text.match(/<title[^>]*>([^<]+)<\/title>/i)
      if (match && match[1]?.trim()) {
        const parsedTitle = match[1]
          .trim()
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/\s+/g, ' ')
        if (parsedTitle) return parsedTitle
      }
    }
  } catch {
    // Fallback if network request fails or times out
  }

  // Fallback to domain name
  try {
    const parsed = new URL(cleanUrl)
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return cleanUrl
  }
}

/**
 * RH-163 — the video behind a song's own YouTube link, as a privacy-enhanced
 * embed url. Pure and client-safe. The embed url never carries `autoplay`.
 */
import type { SongLink } from '@/types/database'

const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/
const PATH_PREFIXES = ['shorts', 'embed', 'live']
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'])

function validId(candidate: string | null | undefined): string | null {
  return candidate && VIDEO_ID.test(candidate) ? candidate : null
}

/** The video id in a youtube url, or `null` (channel, playlist-only, malformed, other host). */
export function youtubeVideoId(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // Not a url at all: no embed.
    return null
  }
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (parsed.hostname === 'youtu.be') return validId(segments[0])
  if (!YOUTUBE_HOSTS.has(parsed.hostname)) return null
  if (segments[0] === 'watch') return validId(parsed.searchParams.get('v'))
  if (PATH_PREFIXES.includes(segments[0])) return validId(segments[1])
  return null
}

export function youtubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}`
}

/** The id behind the first `provider = 'youtube'` link; `null` when it does not parse. */
export function pickYoutubeVideoId(links: SongLink[]): string | null {
  const first = links.find((link) => link.provider === 'youtube')
  return first ? youtubeVideoId(first.url) : null
}

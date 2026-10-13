/**
 * RH-142 — resolving the Spotify share short links (`spotify.link`,
 * `spoti.fi`) to the canonical track url, once, when a link is saved.
 *
 * The mobile share sheet produces urls that carry no track id and sit on a
 * host that is not `spotify.com`, so the push could never use them. Resolving
 * at write time keeps the push (`spotifyPushUris`) free of network calls.
 *
 * The allow-list below is the SSRF boundary: a musician chooses the url, so
 * only `https` urls on exactly these two hosts are ever requested, and every
 * redirect hop is checked again before it is followed. No `@/lib/db` import:
 * the module is client-safe and unit-testable.
 */

import { logger } from '@/lib/logger'
import { spotifyTrackUriFromUrl } from '@/lib/spotifyTrackUri'

const SHORT_LINK_HOSTS = new Set(['spotify.link', 'spoti.fi'])
const MAX_REQUESTS = 5
const TIMEOUT_MS = 4000

/** `true` only for an `https` url whose host is exactly a Spotify short-link host. */
export function isSpotifyShortLink(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'https:' &&
      parsed.username === '' &&
      parsed.password === '' &&
      SHORT_LINK_HOSTS.has(parsed.hostname.toLowerCase())
    )
  } catch {
    return false
  }
}

/** The next hop's absolute url, or `null` when the response is not a usable redirect. */
function nextHop(res: Response, base: string): string | null {
  const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
  if (!location) return null
  try {
    return new URL(location, base).toString()
  } catch {
    return null
  }
}

/** The canonical track url when `url` names a track, else `null`. */
function canonicalTrackUrl(url: string): string | null {
  const uri = new URL(url).protocol === 'https:' ? spotifyTrackUriFromUrl(url) : null
  return uri ? `https://open.spotify.com/track/${uri.slice('spotify:track:'.length)}` : null
}

async function followToTrack(start: string): Promise<string> {
  let current = start
  for (let request = 0; request < MAX_REQUESTS; request++) {
    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const next = nextHop(res, current)
    if (!next) throw new Error(`not a redirect (status ${res.status})`)

    const canonical = canonicalTrackUrl(next)
    if (canonical) return canonical
    // Only another short-link hop is ever requested; anything else (an album,
    // an off-list host, plain http) ends the resolution.
    if (!isSpotifyShortLink(next)) throw new Error(`redirect left the allow-list or names no track: ${new URL(next).origin}`)
    current = next
  }
  throw new Error('too many redirects')
}

/**
 * The canonical `https://open.spotify.com/track/<id>` for a Spotify short
 * link, or `url` unchanged when it is not a short link or cannot be resolved.
 * Never throws: a failure is logged and the link is stored as typed.
 */
export async function resolveSpotifyShortLink(url: string): Promise<string> {
  if (!isSpotifyShortLink(url)) return url
  try {
    return await followToTrack(url)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.warn('Could not resolve Spotify short link; storing it as typed', {
      url,
      reason: err.message,
    })
    return url
  }
}

/**
 * RH-135 — recognising a song's Spotify **track** link from its URL alone.
 *
 * The Spotify push used to pick a song's link by the lowercase label
 * "spotify" (`src/app/api/spotify/playlists/[id]/sync/route.ts`). No writer in
 * `src/` produces that spelling: the pull writes the song's own **title**
 * (`findOrCreateSong`), the picker and the dashboard write `'Spotify'`, and the
 * Fast View links section writes whatever the musician typed. So `uris` came
 * out empty for every song and the push reported success having sent nothing.
 *
 * A label is a human-typed display string and can never be a provider
 * discriminator. The URL can, so the rule lives here, as a pure function with
 * no DB, no `fetch` and no React — which is also what makes it unit-testable:
 * the route file it is called from is an App Router handler, whose export
 * surface Next.js restricts to HTTP methods and route-segment config.
 *
 * RH-110 Part 2 later replaces this host check with a derived `provider`
 * column on a `song_links` table; keeping it in one module of its own keeps
 * that replacement to one file.
 */

import type { SongLink } from '@/types/database'

/**
 * The track-id capture, unchanged from the push loop this module replaces.
 * Applied to the **pathname**, so a `?si=…` share query or a `#fragment`
 * cannot contribute characters to the id.
 */
const TRACK_PATH_RE = /track\/([A-Za-z0-9]+)/

/** Spotify serves track links over the web, never over another protocol. */
const WEB_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * `true` only for `spotify.com` itself and its subdomains (`open.`, `play.`,
 * `www.`). Equality-or-suffix rather than `includes('spotify.com')`, so
 * `notspotify.com` and `spotify.com.evil.io` are both rejected.
 */
function isSpotifyHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  // A label is required before the dot. `'.spotify.com'.endsWith('.spotify.com')`
  // is true, so the suffix test alone accepts the empty-label host
  // `https://.spotify.com/track/<id>` — unresolvable, and so no worse than a
  // plain `open.spotify.com` link, but it is not a Spotify host and this
  // function's whole job is to say which hosts are.
  if (host.startsWith('.')) return false
  return host === 'spotify.com' || host.endsWith('.spotify.com')
}

/**
 * The `spotify:track:<id>` URI for a Spotify **track** URL, or `null` for
 * anything else — a malformed URL, a non-web protocol, a look-alike host, or a
 * Spotify album/playlist/artist link that names no track.
 *
 * Deliberately out of scope (RH-135): the `spotify:track:<id>` URI scheme, and
 * the `spotify.link` / `spoti.fi` short links the mobile share sheet produces.
 * Both answer `null`, which is the per-song skip that already existed — such a
 * song contributes nothing to the push rather than failing it. Resolving a
 * short link would mean a network round trip per song inside the push loop.
 */
export function spotifyTrackUriFromUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // Not a URL at all. A stored link is free-text (the additive edit branch
    // runs a bare UPDATE with no url validation), so this is reachable.
    return null
  }

  if (!WEB_PROTOCOLS.has(parsed.protocol)) return null
  if (!isSpotifyHost(parsed.hostname)) return null

  const match = TRACK_PATH_RE.exec(parsed.pathname)
  return match ? `spotify:track:${match[1]}` : null
}

/**
 * The first Spotify track URI among a song's links, or `null` if it has none.
 *
 * `links` is `PlaylistVersionLinksRow.links` — nullable, because the `songs`
 * row may carry no links at all. The search is over **every** link, not the
 * first one whose label matched, so a Spotify link sitting behind a lyrics or
 * tab link is now found.
 */
export function spotifyTrackUriFromLinks(links: SongLink[] | null): string | null {
  for (const link of links ?? []) {
    const uri = spotifyTrackUriFromUrl(link.url)
    if (uri) return uri
  }
  return null
}

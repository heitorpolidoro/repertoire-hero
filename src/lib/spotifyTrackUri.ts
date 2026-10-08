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
 * RH-136 added the derived `provider` column on `song_links`, and RH-137 keyed
 * the push's query off it. This host check **stays**: the column decides which
 * rows the query returns, this function decides whether a returned url names a
 * track, and the two are defence in depth rather than one replacing the other.
 */

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
 * The uri list the Spotify push sends, over the rows of the provider-keyed
 * query (RH-137) — its **single** entry point, called once from the route and
 * nowhere else.
 *
 * **At most one uri per playlist entry**, and it is the first url in the row's
 * array that yields a track uri. The array arrives already ordered by the
 * canonical read order `position, created_at, id`
 * ({@link spotifyLinkUrlsJson}), so this is the first-non-null-wins rule the
 * label-keyed loop and then `spotifyTrackUriFromLinks` already applied, carried
 * over rather than reinvented — and it is load-bearing in both directions:
 *
 * - resolving `urls[0]` alone would drop a song whose links are
 *   `[album-url, track-url]`, an ordering the Fast View editor and the song
 *   picker both reach because they append in paste order;
 * - one uri per url would send a song holding two Spotify track urls twice,
 *   which `UNIQUE (song_id, url)` does not prevent.
 *
 * A row contributing no uri — no `provider = 'spotify'` link, or none of them
 * naming a track — is skipped and does not fail the push. Entry order is the
 * query's `ORDER BY ps.position`.
 *
 * It lives in `src/lib` rather than in the route because `src/app/api/**` is
 * outside the coverage gate and an App Router handler's export surface is
 * restricted by Next.js to HTTP methods and route-segment config, so the route
 * cannot export a testable helper.
 */
export function spotifyPushUris(rows: readonly { spotify_urls: string[] | null }[]): string[] {
  const uris: string[] = []
  for (const row of rows) {
    // `?? []` rather than trusting the shape: the query wraps the aggregate in
    // `COALESCE(…, '[]'::json)` so today's only caller cannot deliver null, but
    // this function's predecessor took a nullable column for exactly this
    // reason. A future caller shaping its own rows should get a skipped song,
    // not a TypeError inside the push loop.
    for (const url of row.spotify_urls ?? []) {
      const uri = spotifyTrackUriFromUrl(url)
      if (uri) {
        uris.push(uri)
        break
      }
    }
  }
  return uris
}

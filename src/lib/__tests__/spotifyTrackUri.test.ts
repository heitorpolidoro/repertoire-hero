/**
 * RH-135 — the URL-host rule that replaces the Spotify push's label match.
 *
 * The bug this guards against survived a full suite because every test that
 * exercised the push wrote the link's label in exactly the lowercase spelling
 * the reader wanted — a spelling no writer in `src/` produces. So this file
 * asserts on URLs alone: the label is never consulted, and these cases name
 * every row of the URL-shape table in `docs/tasks/RH-136-spec.md` (4).
 */

import { describe, expect, it } from 'vitest'
import { spotifyPushUris, spotifyTrackUriFromUrl } from '@/lib/spotifyTrackUri'

describe('spotifyTrackUriFromUrl', () => {
  it('accepts the open.spotify.com track URL every writer produces', () => {
    expect(spotifyTrackUriFromUrl('https://open.spotify.com/track/abc123')).toBe(
      'spotify:track:abc123',
    )
  })

  it('accepts the legacy play.spotify.com web-player host', () => {
    expect(spotifyTrackUriFromUrl('https://play.spotify.com/track/abc123')).toBe(
      'spotify:track:abc123',
    )
  })

  it('accepts the bare spotify.com apex host', () => {
    expect(spotifyTrackUriFromUrl('https://spotify.com/track/abc123')).toBe('spotify:track:abc123')
  })

  it('rejects the empty-label host .spotify.com', () => {
    // `'.spotify.com'.endsWith('.spotify.com')` is true, so a suffix test alone
    // lets this through. It is not a Spotify host.
    expect(spotifyTrackUriFromUrl('https://.spotify.com/track/abc123')).toBeNull()
  })

  it('ignores a ?si= share query, matching on the pathname', () => {
    expect(spotifyTrackUriFromUrl('https://www.spotify.com/track/abc123?si=xyz')).toBe(
      'spotify:track:abc123',
    )
  })

  it('ignores a #fragment, matching on the pathname', () => {
    expect(spotifyTrackUriFromUrl('https://open.spotify.com/track/abc123#x')).toBe(
      'spotify:track:abc123',
    )
  })

  // The two cases above pass whether the regex reads `pathname` or `href`:
  // `[A-Za-z0-9]+` stops at `?` and `#` on its own, so they assert the
  // restriction by name and not by behaviour. These two are the ones that
  // separate the implementations — a `track/` segment living in the query or
  // the fragment must not be read as a track id.
  it('does not read a track/ segment out of a #fragment', () => {
    expect(spotifyTrackUriFromUrl('https://open.spotify.com/album/x#track/abc')).toBeNull()
  })

  it('does not read a track/ segment out of a query string', () => {
    expect(spotifyTrackUriFromUrl('https://open.spotify.com/album/x?u=track/abc')).toBeNull()
  })

  it('accepts a plain http: Spotify URL', () => {
    expect(spotifyTrackUriFromUrl('http://open.spotify.com/track/abc123')).toBe(
      'spotify:track:abc123',
    )
  })

  it('rejects the spotify: URI scheme (out of scope, skipped as before)', () => {
    expect(spotifyTrackUriFromUrl('spotify:track:abc123')).toBeNull()
  })

  it('rejects a spotify.link short share link (known follow-up gap)', () => {
    expect(spotifyTrackUriFromUrl('https://spotify.link/abc123')).toBeNull()
  })

  it('rejects an album URL — there is no track to push', () => {
    expect(spotifyTrackUriFromUrl('https://open.spotify.com/album/abc123')).toBeNull()
  })

  it('rejects a look-alike host by suffix, not substring: notspotify.com', () => {
    expect(spotifyTrackUriFromUrl('https://notspotify.com/track/abc123')).toBeNull()
  })

  it('rejects a host that merely contains spotify.com: spotify.com.evil.io', () => {
    expect(spotifyTrackUriFromUrl('https://spotify.com.evil.io/track/abc123')).toBeNull()
  })

  it('returns null for an empty string rather than throwing', () => {
    expect(() => spotifyTrackUriFromUrl('')).not.toThrow()
    expect(spotifyTrackUriFromUrl('')).toBeNull()
  })

  it('returns null for a malformed URL rather than throwing', () => {
    expect(() => spotifyTrackUriFromUrl('not a url')).not.toThrow()
    expect(spotifyTrackUriFromUrl('not a url')).toBeNull()
  })

  it('rejects a non-http(s) protocol on an otherwise valid Spotify host', () => {
    expect(spotifyTrackUriFromUrl('ftp://open.spotify.com/track/abc123')).toBeNull()
  })

  it('rejects a track path with no id', () => {
    expect(spotifyTrackUriFromUrl('https://open.spotify.com/track/')).toBeNull()
  })

  it('is case-insensitive about the hostname', () => {
    expect(spotifyTrackUriFromUrl('https://OPEN.SPOTIFY.COM/track/abc123')).toBe(
      'spotify:track:abc123',
    )
  })
})

/**
 * RH-137 — the push's single uri entry point, over the rows of the
 * provider-keyed query.
 *
 * One uri per playlist entry at most, and it is the **first url in the row's
 * array that yields a track uri** — the array arrives in the canonical read
 * order `position, created_at, id`, so "first that resolves" is "first the
 * musician pasted that is a track".
 */
describe('spotifyPushUris', () => {
  it('answers the uris in row order', () => {
    expect(
      spotifyPushUris([
        { spotify_urls: ['https://open.spotify.com/track/first1'] },
        { spotify_urls: ['https://open.spotify.com/track/second2'] },
      ]),
    ).toEqual(['spotify:track:first1', 'spotify:track:second2'])
  })

  it('skips a row whose spotify-url array is empty, without failing the push', () => {
    // A song with no `provider = 'spotify'` row: the per-song skip RH-135
    // established, kept intact.
    expect(
      spotifyPushUris([
        { spotify_urls: ['https://open.spotify.com/track/first1'] },
        { spotify_urls: [] },
        { spotify_urls: ['https://open.spotify.com/track/second2'] },
      ]),
    ).toEqual(['spotify:track:first1', 'spotify:track:second2'])
  })

  it('skips a Spotify url that names no track', () => {
    expect(spotifyPushUris([{ spotify_urls: ['https://open.spotify.com/album/abc123'] }])).toEqual(
      [],
    )
  })

  it('takes the track url sitting behind an album url, not the first url', () => {
    // Both urls are `provider = 'spotify'`, and this ordering is reachable:
    // the Fast View editor (`SongLinksEditor.tsx`) and the song picker
    // (`useSongPicker.ts`) append in whatever order the musician pastes.
    // Resolving `urls[0]` alone would drop this song from the playlist while
    // the route answered HTTP 200 — RH-135's defect class, recurring per song.
    expect(
      spotifyPushUris([
        {
          spotify_urls: [
            'https://open.spotify.com/album/abc',
            'https://open.spotify.com/track/xyz',
          ],
        },
      ]),
    ).toEqual(['spotify:track:xyz'])
  })

  it('contributes exactly one uri for a row holding two track urls', () => {
    // Never one uri per url: the song would be sent to Spotify twice, and
    // `UNIQUE (song_id, url)` prevents only identical urls, not two distinct
    // track urls on one song.
    const uris = spotifyPushUris([
      {
        spotify_urls: [
          'https://open.spotify.com/track/first1',
          'https://open.spotify.com/track/second2',
        ],
      },
    ])

    expect(uris).toHaveLength(1)
    expect(uris).toEqual(['spotify:track:first1'])
  })
})

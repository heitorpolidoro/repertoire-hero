'use client'

import { useEffect, useState } from 'react'
import type { SongLink } from '@/types/database'
import { spotifyTrackUriFromUrl } from '@/lib/spotifyTrackUri'
import { decidePlayback, type PlaybackFacts } from '@/lib/spotifyPlayback'
import { loadPlaybackFacts, playTrack } from '@/lib/spotifyWebPlayback'

export interface SpotifyPlayerProps {
  links: SongLink[]
  /** The page's offline signal. */
  offline?: boolean
  /** Injection seams for tests; the defaults talk to the real route and SDK. */
  loadFacts?: () => Promise<PlaybackFacts>
  play?: (trackUri: string) => Promise<void>
}

const NOTE = 'text-sm text-gray-600 bg-white border border-gray-200 rounded-xl px-4 py-3'

/** The first of the song's links that names a Spotify track, or null. */
function firstTrackUri(links: SongLink[]): string | null {
  for (const link of links) {
    const uri = spotifyTrackUriFromUrl(link.url)
    if (uri) return uri
  }
  return null
}

/**
 * RH-164 — plays the song's own linked Spotify track. What it shows is decided
 * by `decidePlayback`; playback is requested only from the button's click, never
 * on mount, song change or token arrival.
 */
export function SpotifyPlayer({ links, offline = false, loadFacts = loadPlaybackFacts, play = playTrack }: SpotifyPlayerProps) {
  const trackUri = firstTrackUri(links)
  const [facts, setFacts] = useState<PlaybackFacts | null>(null)
  const [error, setError] = useState<string | null>(null)
  const wantsFacts = trackUri !== null && !offline

  useEffect(() => {
    if (!wantsFacts) return
    let cancelled = false
    loadFacts().then(
      (f) => !cancelled && setFacts(f),
      () => !cancelled && setFacts({ connected: false, scope: null, premium: false }),
    )
    return () => {
      cancelled = true
    }
  }, [wantsFacts, loadFacts])

  const decision = decidePlayback({ trackUri, offline, facts })

  switch (decision.kind) {
    case 'hidden':
    case 'loading':
      return null
    case 'offline':
      return <p className={NOTE}>No connection: playback unavailable</p>
    case 'reconnect':
      return (
        // eslint-disable-next-line @next/next/no-html-link-for-pages -- an API route that redirects off-site: needs a full navigation, not client routing
        <a href="/api/auth/spotify/authorize" className={`${NOTE} block font-medium text-emerald-700`}>
          Re-connect Spotify (new permissions)
        </a>
      )
    case 'premium-required':
      return <p className={NOTE}>Spotify Premium is required to play here</p>
    case 'ready':
      return (
        <section aria-label="Spotify player" className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              setError(null)
              play(decision.trackUri).catch((e: unknown) =>
                setError(e instanceof Error ? e.message : 'Playback failed'),
              )
            }}
            className="self-start rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            &#9654; Play on Spotify
          </button>
          {error && (
            <p role="alert" className="text-xs text-red-700">
              {error}
            </p>
          )}
        </section>
      )
  }
}

import {
  pauseSpotify,
  playTrack,
  resumeSpotify,
  subscribeSpotifyState,
  type SpotifyPlayerState,
} from '@/lib/spotifyWebPlayback'
import type { EngineFactory } from './types'

/** A track that finished: stopped at 0 with itself already in the played list. */
export function spotifyTrackEnded(state: SpotifyPlayerState): boolean {
  const current = state.track_window.current_track
  return state.paused && state.position === 0 && state.track_window.previous_tracks.some((t) => t.id === current.id)
}

/**
 * Drives the Spotify Web Playback SDK instance (held by `spotifyWebPlayback`,
 * created on the first `play`). Subscribing to its state connects nothing.
 */
export const createSpotifyEngine: EngineFactory = (events) => {
  let trackUri: string | null = null
  let startedUri: string | null = null

  const unsubscribe = subscribeSpotifyState((state) => {
    if (!state || startedUri === null) return
    if (spotifyTrackEnded(state)) events.ended()
    else if (state.paused) events.paused()
    else events.playing()
  })

  return {
    async load(source) {
      if (source.kind !== 'spotify') throw new Error('Not a Spotify source')
      trackUri = source.trackUri
    },
    async play() {
      if (!trackUri) throw new Error('Nothing loaded')
      if (startedUri === trackUri) return resumeSpotify()
      await playTrack(trackUri)
      startedUri = trackUri
    },
    pause: () => pauseSpotify(),
    dispose() {
      unsubscribe()
      pauseSpotify()
    },
  }
}

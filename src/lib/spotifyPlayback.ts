/**
 * RH-164 — what the Fast View Spotify player shows, as a pure decision.
 *
 * Three inputs: the track uri behind the song's own link (`null` means no
 * player, short links included), the user's connection facts, and whether the
 * browser is offline. The component only renders the result.
 */

/** The scopes the Web Playback SDK needs on top of the four import scopes. */
export const PLAYBACK_SCOPES = ['streaming', 'user-read-playback-state', 'user-modify-playback-state'] as const

/** What `/api/spotify/playback-token` says about the signed-in user (token excluded). */
export interface PlaybackFacts {
  connected: boolean
  /** The scope string recorded at consent; `null` for a row that predates RH-164. */
  scope: string | null
  premium: boolean
}

type PlaybackDecision =
  | { kind: 'hidden' }
  | { kind: 'loading' }
  | { kind: 'offline' }
  | { kind: 'reconnect' }
  | { kind: 'premium-required' }
  | { kind: 'ready'; trackUri: string }

export function hasPlaybackScopes(scope: string | null): boolean {
  const granted = new Set((scope ?? '').split(/\s+/))
  return PLAYBACK_SCOPES.every((s) => granted.has(s))
}

interface PlaybackInputs {
  trackUri: string | null
  offline: boolean
  facts: PlaybackFacts | null
}

export function decidePlayback({ trackUri, offline, facts }: PlaybackInputs): PlaybackDecision {
  if (!trackUri) return { kind: 'hidden' }
  if (offline) return { kind: 'offline' }
  if (!facts) return { kind: 'loading' }
  if (!facts.connected || !hasPlaybackScopes(facts.scope)) return { kind: 'reconnect' }
  if (!facts.premium) return { kind: 'premium-required' }
  return { kind: 'ready', trackUri }
}

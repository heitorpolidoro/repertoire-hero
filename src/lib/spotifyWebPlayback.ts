import type { PlaybackFacts } from '@/lib/spotifyPlayback'

/**
 * RH-164 — the browser side of Spotify playback: the facts fetch and the Web
 * Playback SDK driver. Nothing here runs until `SpotifyPlayer` calls it, and
 * `playTrack` only runs from the play button's click handler.
 */

interface TokenResponse extends PlaybackFacts {
  token: string | null
}

async function fetchPlayback(): Promise<TokenResponse> {
  const res = await fetch('/api/spotify/playback-token', { cache: 'no-store' })
  if (!res.ok) throw new Error(`Playback token request failed (${res.status})`)
  return (await res.json()) as TokenResponse
}

export async function loadPlaybackFacts(): Promise<PlaybackFacts> {
  const { connected, scope, premium } = await fetchPlayback()
  return { connected, scope, premium }
}

async function freshToken(): Promise<string> {
  const { token } = await fetchPlayback()
  if (!token) throw new Error('Spotify is not connected')
  return token
}

interface SdkPlayer {
  connect(): Promise<boolean>
  activateElement(): Promise<void>
  addListener<T>(event: string, cb: (payload: T) => void): void
  pause?(): Promise<void>
  resume?(): Promise<void>
}

/** The slice of the SDK's `player_state_changed` payload the setlist player reads (RH-167). */
export interface SpotifyPlayerState {
  paused: boolean
  position: number
  track_window: { current_track: { id: string }; previous_tracks: { id: string }[] }
}
type StateListener = (state: SpotifyPlayerState | null) => void
const stateListeners = new Set<StateListener>()
let sdkPlayer: SdkPlayer | null = null

/** Listens to the SDK player's state (RH-167); nothing is connected by subscribing. */
export function subscribeSpotifyState(listener: StateListener): () => void {
  stateListeners.add(listener)
  return () => void stateListeners.delete(listener)
}

/** Pauses / resumes the connected SDK device, if there is one (RH-167). */
export function pauseSpotify(): void {
  void sdkPlayer?.pause?.()
}
export function resumeSpotify(): Promise<void> {
  return sdkPlayer?.resume?.() ?? Promise.resolve()
}
interface SdkWindow {
  Spotify?: { Player: new (opts: { name: string; getOAuthToken: (cb: (t: string) => void) => void }) => SdkPlayer }
  onSpotifyWebPlaybackSDKReady?: () => void
}

function loadSdk(): Promise<void> {
  const w = window as unknown as SdkWindow
  if (w.Spotify) return Promise.resolve()
  return new Promise((resolve, reject) => {
    w.onSpotifyWebPlaybackSDKReady = () => resolve()
    const script = document.createElement('script')
    script.src = 'https://sdk.scdn.co/spotify-player.js'
    script.onerror = () => reject(new Error('Could not load the Spotify player'))
    document.body.appendChild(script)
  })
}

let deviceId: Promise<string> | null = null

function connectPlayer(): Promise<string> {
  deviceId ??= loadSdk().then(
    () =>
      new Promise<string>((resolve, reject) => {
        const Player = (window as unknown as SdkWindow).Spotify!.Player
        const player = new Player({
          name: 'Repertoire Hero',
          getOAuthToken: (cb) => void freshToken().then(cb, () => undefined),
        })
        sdkPlayer = player
        player.addListener<SpotifyPlayerState | null>('player_state_changed', (state) =>
          stateListeners.forEach((listener) => listener(state)),
        )
        player.addListener<{ device_id: string }>('ready', ({ device_id }) => resolve(device_id))
        player.addListener<unknown>('initialization_error', () => reject(new Error('Spotify player is not supported here')))
        player.addListener<unknown>('authentication_error', () => reject(new Error('Spotify authentication failed')))
        player.addListener<unknown>('account_error', () => reject(new Error('Spotify Premium is required to play here')))
        void player.activateElement()
        player.connect().then((ok) => ok || reject(new Error('Could not connect the Spotify player')), reject)
      }),
  )
  deviceId.catch(() => {
    deviceId = null
  })
  return deviceId
}

/** Starts the track on this browser's SDK device. Call only from a user tap. */
export async function playTrack(trackUri: string): Promise<void> {
  const device = await connectPlayer()
  const token = await freshToken()
  const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(device)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: [trackUri] }),
  })
  if (!res.ok) throw new Error(`Spotify refused to play (${res.status})`)
}

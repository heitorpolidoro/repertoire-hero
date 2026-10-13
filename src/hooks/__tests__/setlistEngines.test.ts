// @vitest-environment jsdom
/** RH-167 - the YouTube and Spotify engines against fake provider APIs (no SDK, no network). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineEvents } from '../setlistEngines/types'

const sdk = vi.hoisted(() => ({
  playTrack: vi.fn(),
  pauseSpotify: vi.fn(),
  resumeSpotify: vi.fn(),
  unsubscribe: vi.fn(),
  listener: null as null | ((s: unknown) => void),
}))
vi.mock('@/lib/spotifyWebPlayback', () => ({
  playTrack: sdk.playTrack,
  pauseSpotify: sdk.pauseSpotify,
  resumeSpotify: sdk.resumeSpotify,
  subscribeSpotifyState: (l: (s: unknown) => void) => {
    sdk.listener = l
    return sdk.unsubscribe
  },
}))

const events = (): EngineEvents => ({ ended: vi.fn(), error: vi.fn(), playing: vi.fn(), paused: vi.fn() })

describe('youtubeEngine', () => {
  type Opts = {
    playerVars: Record<string, number>
    host: string
    events: { onReady: () => void; onStateChange: (e: { data: number }) => void; onError: (e: { data: number }) => void }
  }
  let opts: Opts
  const player = {
    cueVideoById: vi.fn(),
    loadVideoById: vi.fn(),
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
    destroy: vi.fn(),
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    ;(window as unknown as { YT: unknown }).YT = {
      Player: class {
        constructor(_el: HTMLElement, o: Opts) {
          opts = o
          queueMicrotask(o.events.onReady)
          return player as never
        }
      },
    }
  })
  afterEach(() => {
    delete (window as unknown as { YT?: unknown }).YT
    document.body.innerHTML = ''
  })

  async function setup() {
    const { createYoutubeEngine } = await import('../setlistEngines/youtubeEngine')
    const host = document.createElement('div')
    document.body.appendChild(host)
    const ev = events()
    const engine = createYoutubeEngine(ev, { audio: () => null, youtube: () => host })!
    return { engine, ev, host }
  }

  it('creates the nocookie player lazily on load, with no autoplay, and cues later videos', async () => {
    const { engine, host } = await setup()
    expect(player.cueVideoById).not.toHaveBeenCalled()
    await engine.load({ kind: 'youtube', videoId: 'abcdefghijk' })
    expect(opts.host).toBe('https://www.youtube-nocookie.com')
    expect(opts.playerVars).not.toHaveProperty('autoplay')
    expect(host.children).toHaveLength(1)
    await engine.load({ kind: 'youtube', videoId: 'second12345' })
    expect(player.cueVideoById).toHaveBeenLastCalledWith('second12345')
    expect(host.children).toHaveLength(1)
  })

  it('resolves play on the playing state and reports state changes', async () => {
    const { engine, ev } = await setup()
    await engine.load({ kind: 'youtube', videoId: 'abcdefghijk' })
    const started = engine.play()
    expect(player.playVideo).toHaveBeenCalled()
    opts.events.onStateChange({ data: 1 })
    await expect(started).resolves.toBeUndefined()
    opts.events.onStateChange({ data: 2 })
    opts.events.onStateChange({ data: 0 })
    expect(ev.playing).toHaveBeenCalled()
    expect(ev.paused).toHaveBeenCalled()
    expect(ev.ended).toHaveBeenCalled()
  })

  it('rejects a pending play and reports an error on a YouTube error', async () => {
    const { engine, ev } = await setup()
    await engine.load({ kind: 'youtube', videoId: 'abcdefghijk' })
    const started = engine.play()
    opts.events.onError({ data: 150 })
    await expect(started).rejects.toThrow()
    expect(ev.error).toHaveBeenCalled()
  })

  it('pauses, disposes, and refuses play before load and a foreign source', async () => {
    const { engine } = await setup()
    await expect(engine.play()).rejects.toThrow('Nothing loaded')
    await expect(engine.load({ kind: 'file', url: 'u' })).rejects.toThrow()
    await engine.load({ kind: 'youtube', videoId: 'abcdefghijk' })
    engine.pause()
    expect(player.pauseVideo).toHaveBeenCalled()
    engine.dispose()
    expect(player.destroy).toHaveBeenCalled()
  })

  it('has no engine without a host node', async () => {
    const { createYoutubeEngine } = await import('../setlistEngines/youtubeEngine')
    expect(createYoutubeEngine(events(), { audio: () => null, youtube: () => null })).toBeNull()
  })

  it('loads the IFrame API script only when it is first needed', async () => {
    delete (window as unknown as { YT?: unknown }).YT
    const { engine } = await setup()
    expect(document.querySelector('script')).toBeNull()
    const loading = engine.load({ kind: 'youtube', videoId: 'abcdefghijk' })
    await vi.waitFor(() => expect(document.querySelector('script')?.src).toBe('https://www.youtube.com/iframe_api'))
    const w = window as unknown as { YT?: unknown; onYouTubeIframeAPIReady?: () => void }
    w.YT = { Player: class { constructor(_e: HTMLElement, o: Opts) { opts = o; queueMicrotask(o.events.onReady); return player as never } } }
    w.onYouTubeIframeAPIReady?.()
    await loading
  })
})

describe('spotifyEngine', () => {
  const state = (over: object) => ({
    paused: false,
    position: 1000,
    track_window: { current_track: { id: 't' }, previous_tracks: [] },
    ...over,
  })

  async function setup() {
    const { createSpotifyEngine } = await import('../setlistEngines/spotifyEngine')
    const ev = events()
    const engine = createSpotifyEngine(ev, { audio: () => null, youtube: () => null })!
    return { engine, ev }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    sdk.playTrack.mockResolvedValue(undefined)
    sdk.resumeSpotify.mockResolvedValue(undefined)
  })

  it('detects a finished track from the SDK state', async () => {
    const { spotifyTrackEnded } = await import('../setlistEngines/spotifyEngine')
    expect(spotifyTrackEnded(state({ paused: true, position: 0, track_window: { current_track: { id: 't' }, previous_tracks: [{ id: 't' }] } }))).toBe(true)
    expect(spotifyTrackEnded(state({ paused: true, position: 0 }))).toBe(false)
    expect(spotifyTrackEnded(state({}))).toBe(false)
  })

  it('starts the track on play, resumes it afterwards, and refuses play before load', async () => {
    const { engine } = await setup()
    await expect(engine.play()).rejects.toThrow('Nothing loaded')
    await expect(engine.load({ kind: 'youtube', videoId: 'x' })).rejects.toThrow()
    await engine.load({ kind: 'spotify', trackUri: 'spotify:track:abc' })
    expect(sdk.playTrack).not.toHaveBeenCalled()
    await engine.play()
    expect(sdk.playTrack).toHaveBeenCalledWith('spotify:track:abc')
    await engine.play()
    expect(sdk.resumeSpotify).toHaveBeenCalled()
    expect(sdk.playTrack).toHaveBeenCalledTimes(1)
  })

  it('maps SDK states to events only once playback was started', async () => {
    const { engine, ev } = await setup()
    await engine.load({ kind: 'spotify', trackUri: 'spotify:track:abc' })
    sdk.listener?.(state({}))
    expect(ev.playing).not.toHaveBeenCalled()
    await engine.play()
    sdk.listener?.(null)
    sdk.listener?.(state({}))
    sdk.listener?.(state({ paused: true }))
    sdk.listener?.(state({ paused: true, position: 0, track_window: { current_track: { id: 't' }, previous_tracks: [{ id: 't' }] } }))
    expect(ev.playing).toHaveBeenCalledTimes(1)
    expect(ev.paused).toHaveBeenCalledTimes(1)
    expect(ev.ended).toHaveBeenCalledTimes(1)
  })

  it('pauses and unsubscribes on dispose', async () => {
    const { engine } = await setup()
    engine.pause()
    engine.dispose()
    expect(sdk.pauseSpotify).toHaveBeenCalledTimes(2)
    expect(sdk.unsubscribe).toHaveBeenCalled()
  })
})

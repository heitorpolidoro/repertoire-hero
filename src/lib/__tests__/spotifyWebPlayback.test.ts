// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Listener = (p: { device_id: string }) => void
const listeners: Record<string, Listener> = {}
let connectResult = true
class FakePlayer {
  constructor(public opts: { getOAuthToken: (cb: (t: string) => void) => void }) {
    FakePlayer.last = this
  }
  static last: FakePlayer
  addListener(event: string, cb: Listener) {
    listeners[event] = cb
  }
  activateElement() {
    return Promise.resolve()
  }
  connect() {
    if (connectResult) queueMicrotask(() => listeners.ready({ device_id: 'dev1' }))
    return Promise.resolve(connectResult)
  }
}

const fetchMock = vi.fn()
beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  connectResult = true
  ;(window as unknown as { Spotify?: unknown }).Spotify = { Player: FakePlayer }
})

const tokenOk = { ok: true, json: async () => ({ connected: true, scope: 's', premium: true, token: 'tok' }) }

describe('loadPlaybackFacts', () => {
  it('returns the facts without the token', async () => {
    fetchMock.mockResolvedValue(tokenOk)
    const { loadPlaybackFacts } = await import('../spotifyWebPlayback')
    expect(await loadPlaybackFacts()).toEqual({ connected: true, scope: 's', premium: true })
  })
  it('throws on a failed request', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    const { loadPlaybackFacts } = await import('../spotifyWebPlayback')
    await expect(loadPlaybackFacts()).rejects.toThrow('500')
  })
})

describe('setlist player hooks into the SDK (RH-167)', () => {
  it('forwards player_state_changed to subscribers and pauses / resumes the connected device', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.includes('/me/player/play') ? { ok: true } : tokenOk))
    const mod = await import('../spotifyWebPlayback')
    const seen = vi.fn()
    const off = mod.subscribeSpotifyState(seen)
    mod.pauseSpotify()
    await expect(mod.resumeSpotify()).resolves.toBeUndefined()
    await mod.playTrack('spotify:track:abc')
    const pause = vi.fn().mockResolvedValue(undefined)
    const resume = vi.fn().mockResolvedValue(undefined)
    Object.assign(FakePlayer.last, { pause, resume })
    listeners.player_state_changed({ paused: false } as never)
    expect(seen).toHaveBeenCalledWith({ paused: false })
    mod.pauseSpotify()
    await mod.resumeSpotify()
    expect(pause).toHaveBeenCalled()
    expect(resume).toHaveBeenCalled()
    off()
    listeners.player_state_changed({ paused: true } as never)
    expect(seen).toHaveBeenCalledTimes(1)
  })
})

describe('playTrack', () => {
  it('connects the SDK device and PUTs the track to it', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.includes('/me/player/play') ? { ok: true } : tokenOk))
    const { playTrack } = await import('../spotifyWebPlayback')
    await playTrack('spotify:track:abc')
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/me/player/play'))!
    expect(call[0]).toContain('device_id=dev1')
    expect(call[1].method).toBe('PUT')
    expect(JSON.parse(call[1].body)).toEqual({ uris: ['spotify:track:abc'] })
    // the SDK's token callback is served by the same route
    const cb = vi.fn()
    FakePlayer.last.opts.getOAuthToken(cb)
    await vi.waitFor(() => expect(cb).toHaveBeenCalledWith('tok'))
  })
  it('throws when Spotify refuses to play', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.includes('/me/player/play') ? { ok: false, status: 403 } : tokenOk))
    const { playTrack } = await import('../spotifyWebPlayback')
    await expect(playTrack('spotify:track:abc')).rejects.toThrow('403')
  })
  it('throws when not connected', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ connected: false, token: null }) })
    const { playTrack } = await import('../spotifyWebPlayback')
    await expect(playTrack('spotify:track:abc')).rejects.toThrow('not connected')
  })
  it('throws when the SDK cannot connect', async () => {
    connectResult = false
    fetchMock.mockResolvedValue(tokenOk)
    const { playTrack } = await import('../spotifyWebPlayback')
    await expect(playTrack('spotify:track:abc')).rejects.toThrow('connect')
  })
})

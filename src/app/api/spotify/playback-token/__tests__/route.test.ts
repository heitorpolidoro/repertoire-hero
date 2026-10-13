import { describe, it, expect, vi, beforeEach } from 'vitest'

const getRequiredUserId = vi.fn()
const getSpotifyAccessToken = vi.fn()
const getSpotifyGrantedScope = vi.fn()
vi.mock('@/lib/auth-session', () => ({ getRequiredUserId: () => getRequiredUserId() }))
vi.mock('@/lib/spotifyAuth', () => ({
  getSpotifyAccessToken: (id: string) => getSpotifyAccessToken(id),
  getSpotifyGrantedScope: (id: string) => getSpotifyGrantedScope(id),
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))

import { GET } from '../route'

const fetchMock = vi.fn()
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  getRequiredUserId.mockResolvedValue('u1')
})

describe('GET /api/spotify/playback-token', () => {
  it('401s without a session', async () => {
    getRequiredUserId.mockRejectedValue(new Error('Not authenticated'))
    expect((await GET()).status).toBe(401)
  })
  it('reports not connected when there is no token', async () => {
    getSpotifyAccessToken.mockResolvedValue(null)
    const res = await GET()
    expect(await res.json()).toEqual({ connected: false, scope: null, premium: false, token: null })
  })
  it('returns the token, scope and Premium status, uncached', async () => {
    getSpotifyAccessToken.mockResolvedValue('tok')
    getSpotifyGrantedScope.mockResolvedValue('streaming')
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ product: 'premium' }) })
    const res = await GET()
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ connected: true, scope: 'streaming', premium: true, token: 'tok' })
  })
  it('treats a free account or a failed profile fetch as non-Premium', async () => {
    getSpotifyAccessToken.mockResolvedValue('tok')
    getSpotifyGrantedScope.mockResolvedValue(null)
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ product: 'free' }) })
    expect((await (await GET()).json()).premium).toBe(false)
    fetchMock.mockResolvedValueOnce({ ok: false })
    expect((await (await GET()).json()).premium).toBe(false)
    fetchMock.mockRejectedValueOnce(new Error('net'))
    expect((await (await GET()).json()).premium).toBe(false)
  })
})

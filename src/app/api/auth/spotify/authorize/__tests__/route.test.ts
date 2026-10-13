import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({ cookies: async () => ({ set: vi.fn() }) }))

import { GET } from '../route'

beforeEach(() => {
  process.env.SPOTIFY_CLIENT_ID = 'cid'
  process.env.SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:3000/api/auth/spotify/callback'
})

describe('GET /api/auth/spotify/authorize', () => {
  it('requests the four existing scopes plus the three playback scopes', async () => {
    const res = await GET()
    const url = new URL(res.headers.get('location') as string)
    expect(url.searchParams.get('scope')?.split(' ').sort()).toEqual(
      [
        'playlist-read-private',
        'playlist-modify-public',
        'playlist-modify-private',
        'user-read-private',
        'streaming',
        'user-read-playback-state',
        'user-modify-playback-state',
      ].sort(),
    )
  })
})

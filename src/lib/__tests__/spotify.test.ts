import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { createClient as createOriginalClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

const skip = !SERVICE_ROLE_KEY || !ANON_KEY

// Mock Supabase server and client creation to use a shared mock client
const mockTestClient = createOriginalClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const admin = createOriginalClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

let activeServerClient: any = mockTestClient

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => Promise.resolve(activeServerClient),
}))

vi.mock('@/lib/supabase/admin', async () => {
  const { createClient: createAdminOriginal } = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const adminClient = createAdminOriginal(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return { createAdminClient: () => adminClient }
})

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => mockTestClient,
}))

vi.mock('@/lib/auth-session', () => ({
  getRequiredUserId: vi.fn(),
}))

// Mock logger to avoid printing expected errors during tests
vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

// Save original fetch
const originalFetch = global.fetch

// Import functions and route handlers after mocks
import { getSpotifyAccessToken } from '../spotifyAuth'
import { searchSpotify } from '../spotify'
import { POST as importPOST } from '@/app/api/spotify/playlists/[id]/import/route'
import { POST as syncPOST } from '@/app/api/spotify/playlists/[id]/sync/route'
import * as authSession from '@/lib/auth-session'

describe.skipIf(skip)('Spotify Integration and Sync tests', () => {
  const suffix = Date.now()
  const USER_A = { email: `test-spotify-a-${suffix}@example.com`, password: 'password123' }
  const USER_B = { email: `test-spotify-b-${suffix}@example.com`, password: 'password123' }

  let userAId: string
  let userBId: string
  let bandId: string

  // Keep track of resources to clean them up cleanly
  const createdPlaylists: string[] = []
  const createdSongs: string[] = []
  const createdBands: string[] = []

  let fetchSpy: any

  beforeAll(async () => {
    // Preventively clean up Songs A and B to avoid constraint violations in test reruns
    await admin.from('global_songs').delete().ilike('title', 'Song A')
    await admin.from('global_songs').delete().ilike('title', 'Song B')

    // 1. Create User A
    const { data: { user: a }, error: errA } = await admin.auth.admin.createUser({
      email: USER_A.email,
      password: USER_A.password,
      email_confirm: true,
    })
    if (errA) throw errA
    userAId = a!.id

    // 2. Create User B
    const { data: { user: b }, error: errB } = await admin.auth.admin.createUser({
      email: USER_B.email,
      password: USER_B.password,
      email_confirm: true,
    })
    if (errB) throw errB
    userBId = b!.id

    // 3. Create a Band
    const { data: band, error: bandErr } = await admin
      .from('bands')
      .insert({
        name: `Spotify Test Band ${suffix}`,
        invite_code: `SPOTIFY${suffix.toString().slice(-5)}`,
      })
      .select('id')
      .single()
    if (bandErr) throw bandErr
    bandId = band!.id
    createdBands.push(bandId)

    // Add User A (admin) and User B (member) to band_members
    const { error: membersErr } = await admin.from('band_members').insert([
      { band_id: bandId, user_id: userAId, role: 'admin' },
      { band_id: bandId, user_id: userBId, role: 'member' },
    ])
    if (membersErr) throw membersErr
  })

  afterAll(async () => {
    // Sign out any active sessions on the mock client
    await mockTestClient.auth.signOut()

    // Restore fetch spy
    if (fetchSpy) fetchSpy.mockRestore()
    global.fetch = originalFetch

    // 1. Delete playlist songs links
    if (createdPlaylists.length > 0) {
      await admin.from('playlist_songs').delete().in('playlist_id', createdPlaylists)
      await admin.from('playlists').delete().in('id', createdPlaylists)
    }

    // 2. Delete band members and bands
    if (createdBands.length > 0) {
      await admin.from('band_members').delete().in('band_id', createdBands)
      await admin.from('bands').delete().in('id', createdBands)
    }

    // 3. Delete repertoires
    if (userAId) {
      await admin.from('repertoire').delete().eq('user_id', userAId)
    }
    if (userBId) {
      await admin.from('repertoire').delete().eq('user_id', userBId)
    }
    if (createdBands.length > 0) {
      await admin.from('repertoire').delete().in('band_id', createdBands)
    }

    // 4. Delete spotify tokens
    if (userAId) {
      await admin.from('spotify_tokens').delete().eq('user_id', userAId)
    }
    if (userBId) {
      await admin.from('spotify_tokens').delete().eq('user_id', userBId)
    }

    // 5. Delete global songs
    if (createdSongs.length > 0) {
      await admin.from('global_songs').delete().in('id', createdSongs)
    }

    // 6. Delete users
    if (userAId) {
      await admin.auth.admin.deleteUser(userAId)
    }
    if (userBId) {
      await admin.auth.admin.deleteUser(userBId)
    }
  })

  beforeEach(() => {
    activeServerClient = mockTestClient

    // Setup selective fetch mock
    fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input.url

      // Mock ONLY external Spotify calls or internal api search calls
      if (url.includes('spotify.com') || url.includes('/api/spotify/search')) {
        if (url.includes('/api/token')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              access_token: 'new-refreshed-access-token',
              expires_in: 3600,
              refresh_token: 'new-refresh-token',
            }),
          } as any)
        }
        
        if (url.includes('/playlists/spotify-playlist-123?')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              name: 'My Spotify Hits',
              description: 'Awesome songs',
              images: [{ url: 'https://spotify.com/album.png' }],
            }),
          } as any)
        }

        if (url.includes('/playlists/band-playlist-123?')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              name: 'Band Heavy Tracks',
              description: 'Setlist heavy',
              images: [{ url: 'https://spotify.com/band-album.png' }],
            }),
          } as any)
        }

        if (url.includes('/tracks?')) {
          if (url.includes('spotify-playlist-123')) {
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({
                items: [
                  {
                    track: {
                      id: 'spotify-track-a',
                      name: 'Song A',
                      duration_ms: 180000,
                      artists: [{ name: 'Artist A' }],
                      album: { name: 'Album A', images: [{ url: 'https://spotify.com/art-a.png' }] },
                      external_urls: { spotify: 'https://open.spotify.com/track/spotify-track-a' },
                    },
                  },
                ],
                next: null,
              }),
            } as any)
          }

          if (url.includes('band-playlist-123')) {
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({
                items: [
                  {
                    track: {
                      id: 'spotify-track-b',
                      name: 'Song B',
                      duration_ms: 240000,
                      artists: [{ name: 'Artist B' }],
                      album: { name: 'Album B', images: [{ url: 'https://spotify.com/art-b.png' }] },
                      external_urls: { spotify: 'https://open.spotify.com/track/spotify-track-b' },
                    },
                  },
                ],
                next: null,
              }),
            } as any)
          }

          if (url.includes('spotify-linked-123')) {
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({
                items: [
                  {
                    track: {
                      id: 'spotify-track-b',
                      name: 'Sync Song B',
                      duration_ms: 200000,
                      artists: [{ name: 'Sync Artist B' }],
                      album: { name: 'Album B', images: [] },
                      external_urls: { spotify: 'https://open.spotify.com/track/spotify-track-b' },
                    },
                  },
                ],
                next: null,
              }),
            } as any)
          }
        }

        if (url.includes('/api/spotify/search')) {
          const mockTracks = [
            {
              id: '123',
              title: 'Title',
              artist: 'Artist',
              album: 'Album',
              spotifyUrl: 'https://spotify.com/123',
              previewUrl: null,
              albumArt: null,
            },
          ]
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockTracks),
          } as any)
        }

        // Generic HTTP PUT/POST mock for PUSH batching
        return Promise.resolve({ ok: true } as any)
      }

      // Delegate all other calls (Supabase DB, Auth API, etc.) to the original fetch
      return originalFetch(input, init)
    })
  })

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore()
    activeServerClient = mockTestClient
  })

  describe('spotifyAuth.ts -> getSpotifyAccessToken', () => {
    beforeEach(async () => {
      // Ensure we delete any existing token row for User A before each test
      await admin.from('spotify_tokens').delete().eq('user_id', userAId)
      // Set environment variables for credentials
      process.env.SPOTIFY_CLIENT_ID = 'test-client-id'
      process.env.SPOTIFY_CLIENT_SECRET = 'test-client-secret'
    })

    it('should return null when the user has not connected their Spotify account', async () => {
      // Sign in mockClient as User A
      const { error } = await mockTestClient.auth.signInWithPassword(USER_A)
      expect(error).toBeNull()

      const token = await getSpotifyAccessToken(userAId)
      expect(token).toBeNull()
    })

    it('should return the active token directly from the database if it is still valid', async () => {
      // Insert a valid token in the DB (expiry is 1 hour in the future)
      const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString()
      const { error: insertErr } = await admin.from('spotify_tokens').insert({
        user_id: userAId,
        access_token: 'valid-access-token',
        refresh_token: 'valid-refresh-token',
        expires_at: expiresAt,
      })
      expect(insertErr).toBeNull()

      const { error } = await mockTestClient.auth.signInWithPassword(USER_A)
      expect(error).toBeNull()

      const token = await getSpotifyAccessToken(userAId)
      expect(token).toBe('valid-access-token')

      // Assert that fetch was NOT called for Spotify
      const spotifyCalls = fetchSpy.mock.calls.filter((call: any) => {
        const url = typeof call[0] === 'string' ? call[0] : call[0].url
        return url.includes('spotify.com')
      })
      expect(spotifyCalls).toHaveLength(0)
    })

    it('should refresh the token automatically when it is within the buffer or expired', async () => {
      // Insert an expired token in the DB (expiry is 10 seconds in the past)
      const expiresAt = new Date(Date.now() - 10 * 1000).toISOString()
      const { error: insertErr } = await admin.from('spotify_tokens').insert({
        user_id: userAId,
        access_token: 'expired-access-token',
        refresh_token: 'valid-refresh-token',
        expires_at: expiresAt,
      })
      expect(insertErr).toBeNull()

      const { error } = await mockTestClient.auth.signInWithPassword(USER_A)
      expect(error).toBeNull()

      const token = await getSpotifyAccessToken(userAId)
      expect(token).toBe('new-refreshed-access-token')

      // Assert that fetch was called for Spotify accounts API
      const spotifyCalls = fetchSpy.mock.calls.filter((call: any) => {
        const url = typeof call[0] === 'string' ? call[0] : call[0].url
        return url.includes('accounts.spotify.com/api/token')
      })
      expect(spotifyCalls).toHaveLength(1)

      // Verify the refreshed token is persisted in the database
      const { data: row } = await admin
        .from('spotify_tokens')
        .select('*')
        .eq('user_id', userAId)
        .single()
      expect(row).not.toBeNull()
      expect(row!.access_token).toBe('new-refreshed-access-token')
      expect(row!.refresh_token).toBe('new-refresh-token')
      const newExpiry = new Date(row!.expires_at).getTime()
      expect(newExpiry).toBeGreaterThan(Date.now() + 3500 * 1000)
    })

    it('should return null and log an error when refresh call to Spotify fails', async () => {
      // Expired token
      const expiresAt = new Date(Date.now() - 10 * 1000).toISOString()
      await admin.from('spotify_tokens').insert({
        user_id: userAId,
        access_token: 'expired-access-token',
        refresh_token: 'bad-refresh-token',
        expires_at: expiresAt,
      })

      const { error } = await mockTestClient.auth.signInWithPassword(USER_A)
      expect(error).toBeNull()

      // Override global fetch mock for this specific failure case
      fetchSpy.mockImplementation((input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input.url
        if (url.includes('accounts.spotify.com/api/token')) {
          return Promise.resolve({
            ok: false,
            status: 400,
          } as any)
        }
        return originalFetch(input, init)
      })

      const token = await getSpotifyAccessToken(userAId)
      expect(token).toBeNull()
    })

    it('should return null when client credentials are missing', async () => {
      // Expired token
      const expiresAt = new Date(Date.now() - 10 * 1000).toISOString()
      await admin.from('spotify_tokens').insert({
        user_id: userAId,
        access_token: 'expired-access-token',
        refresh_token: 'valid-refresh-token',
        expires_at: expiresAt,
      })

      const { error } = await mockTestClient.auth.signInWithPassword(USER_A)
      expect(error).toBeNull()

      // Delete credentials
      delete process.env.SPOTIFY_CLIENT_ID
      delete process.env.SPOTIFY_CLIENT_SECRET

      const token = await getSpotifyAccessToken(userAId)
      expect(token).toBeNull()
    })
  })

  describe('spotify.ts -> searchSpotify', () => {
    it('should return empty list when query is too short', async () => {
      const results = await searchSpotify('a')
      expect(results).toEqual([])
    })

    it('should fetch from API endpoint and return Spotify tracks', async () => {
      const results = await searchSpotify('test query')
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Title')
    })

    it('should return empty list on network or API failure', async () => {
      // Override fetchSpy to fail for search endpoint
      fetchSpy.mockImplementation((input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input.url
        if (url.includes('/api/spotify/search')) {
          return Promise.reject(new Error('Network error'))
        }
        return originalFetch(input, init)
      })

      const results = await searchSpotify('test query')
      expect(results).toEqual([])
    })
  })

  describe('POST /api/spotify/playlists/[id]/import', () => {
    beforeEach(async () => {
      // Mock auth session to return User A's ID for route handlers
      vi.mocked(authSession.getRequiredUserId).mockResolvedValue(userAId)

      // Setup token for User A
      await admin.from('spotify_tokens').delete().eq('user_id', userAId)
      await admin.from('spotify_tokens').insert({
        user_id: userAId,
        access_token: 'import-access-token',
        refresh_token: 'import-refresh-token',
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      })
    })

    it('should import a playlist and add songs to the user repertoire (UC4.1)', async () => {
      const { error: authErr } = await mockTestClient.auth.signInWithPassword(USER_A)
      expect(authErr).toBeNull()

      const request = new NextRequest(
        new URL('http://localhost/api/spotify/playlists/spotify-playlist-123/import'),
        {
          method: 'POST',
          body: JSON.stringify({ sync_with_spotify: true }),
        }
      )

      const response = await importPOST(request, {
        params: Promise.resolve({ id: 'spotify-playlist-123' }),
      })

      expect(response.status).toBe(201)
      const data = await response.json()
      expect(data.name).toBe('My Spotify Hits')
      expect(data.spotify_playlist_id).toBe('spotify-playlist-123')
      expect(data.sync_with_spotify).toBe(true)
      
      createdPlaylists.push(data.id)

      // Verify the song was created in global_songs
      const { data: song } = await admin
        .from('global_songs')
        .select('*')
        .ilike('title', 'Song A')
        .single()
      
      expect(song).not.toBeNull()
      createdSongs.push(song!.id)

      // Verify it was added to User A's repertoire
      const { data: rep } = await admin
        .from('repertoire')
        .select('*')
        .eq('user_id', userAId)
        .eq('song_id', song!.id)
        .single()
      
      expect(rep).not.toBeNull()
      expect(rep!.status).toBe('unknown')
    })

    it('should propagate imported songs to all band members when importing a band playlist (UC4.1)', async () => {
      // User A (admin) imports
      const { error: authErr } = await mockTestClient.auth.signInWithPassword(USER_A)
      expect(authErr).toBeNull()

      // Enable admin service role client temporarily to simulate server-side administrative propagation
      activeServerClient = admin
      // Mock getUser on admin client to return User A so token and user queries inside the route succeed
      const getUserSpy = vi.spyOn(admin.auth, 'getUser').mockResolvedValue({
        data: { user: { id: userAId } as any },
        error: null,
      })

      const request = new NextRequest(
        new URL('http://localhost/api/spotify/playlists/band-playlist-123/import'),
        {
          method: 'POST',
          body: JSON.stringify({ band_id: bandId, sync_with_spotify: true }),
        }
      )

      const response = await importPOST(request, {
        params: Promise.resolve({ id: 'band-playlist-123' }),
      })

      // Restore back to normal client
      activeServerClient = mockTestClient
      getUserSpy.mockRestore()

      expect(response.status).toBe(201)
      const data = await response.json()
      expect(data.band_id).toBe(bandId)
      createdPlaylists.push(data.id)

      // Find created song
      const { data: song } = await admin
        .from('global_songs')
        .select('*')
        .ilike('title', 'Song B')
        .single()
      
      expect(song).not.toBeNull()
      createdSongs.push(song!.id)

      // 1. Verify in Band Repertoire
      const { data: bandRep } = await admin
        .from('repertoire')
        .select('*')
        .eq('band_id', bandId)
        .eq('song_id', song!.id)
        .single()
      expect(bandRep).not.toBeNull()

      // 2. Verify in User A repertoire (admin)
      const { data: repA } = await admin
        .from('repertoire')
        .select('*')
        .eq('user_id', userAId)
        .eq('song_id', song!.id)
        .single()
      expect(repA).not.toBeNull()

      // 3. Verify propagated in User B repertoire (member)
      const { data: repB } = await admin
        .from('repertoire')
        .select('*')
        .eq('user_id', userBId)
        .eq('song_id', song!.id)
        .single()
      expect(repB).not.toBeNull()
    })
  })

  describe('POST /api/spotify/playlists/[id]/sync', () => {
    let localPlaylistId: string
    let songIdA: string
    let songIdB: string

    beforeAll(async () => {
      // Clean up previous runs if any to prevent unique key constraint violations (title, album)
      await admin.from('global_songs').delete().ilike('title', 'Sync Song A')
      await admin.from('global_songs').delete().ilike('title', 'Sync Song B')

      // 1. Create global songs with Spotify links and exact albums matching the Spotify mock
      const { data: songA, error: errA } = await admin
        .from('global_songs')
        .insert({
          title: 'Sync Song A',
          artist: 'Sync Artist A',
          album: 'Album A',
          links: [{ label: 'spotify', url: 'https://open.spotify.com/track/spotify-track-a' }],
        })
        .select('id')
        .single()
      if (errA) console.error('INSERT SONGA ERR:', errA)
      songIdA = songA!.id
      createdSongs.push(songIdA)

      const { data: songB, error: errB } = await admin
        .from('global_songs')
        .insert({
          title: 'Sync Song B',
          artist: 'Sync Artist B',
          album: 'Album B',
          links: [{ label: 'spotify', url: 'https://open.spotify.com/track/spotify-track-b' }],
        })
        .select('id')
        .single()
      if (errB) console.error('INSERT SONGB ERR:', errB)
      songIdB = songB!.id
      createdSongs.push(songIdB)
    })

    beforeEach(async () => {
      // Mock auth session to return User A's ID for route handlers
      vi.mocked(authSession.getRequiredUserId).mockResolvedValue(userAId)

      // Setup token for User A
      await admin.from('spotify_tokens').delete().eq('user_id', userAId)
      await admin.from('spotify_tokens').insert({
        user_id: userAId,
        access_token: 'sync-access-token',
        refresh_token: 'sync-refresh-token',
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      })

      // Create a local playlist linked to Spotify
      const { data: playlist } = await admin
        .from('playlists')
        .insert({
          user_id: userAId,
          name: 'Local Playlist for Sync',
          spotify_playlist_id: 'spotify-linked-123',
          sync_with_spotify: true,
        })
        .select('id')
        .single()
      localPlaylistId = playlist!.id
      createdPlaylists.push(localPlaylistId)

      // Add only Song A initially to local playlist
      await admin.from('playlist_songs').insert({
        playlist_id: localPlaylistId,
        song_id: songIdA,
        position: 1,
      })

      // Add both to User A's repertoire
      await admin.from('repertoire').upsert([
        { user_id: userAId, song_id: songIdA, status: 'learning' },
        { user_id: userAId, song_id: songIdB, status: 'practicing' },
      ])
    })

    it('should pull tracks from Spotify: add new ones, remove obsolete ones, but keep them in the repertoire (UC4.2)', async () => {
      const { error: authErr } = await mockTestClient.auth.signInWithPassword(USER_A)
      expect(authErr).toBeNull()

      const request = new NextRequest(
        new URL(`http://localhost/api/spotify/playlists/${localPlaylistId}/sync`),
        {
          method: 'POST',
          body: JSON.stringify({ direction: 'pull' }),
        }
      )

      const response = await syncPOST(request, {
        params: Promise.resolve({ id: localPlaylistId }),
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      
      // Pull should add 1 (Song B) and remove 1 (Song A) from the local playlist songs
      expect(data.added).toBe(1)
      expect(data.removed).toBe(1)

      // Verify playlist contents: should now have only Song B
      const { data: localSongs } = await admin
        .from('playlist_songs')
        .select('song_id')
        .eq('playlist_id', localPlaylistId)
      
      expect(localSongs).toHaveLength(1)
      expect(localSongs![0].song_id).toBe(songIdB)

      // SECURITY CRITICAL EDGE CASE check: Song A is removed from the playlist,
      // but MUST REMAIN in the user's repertoire
      const { data: repA } = await admin
        .from('repertoire')
        .select('*')
        .eq('user_id', userAId)
        .eq('song_id', songIdA)
        .single()
      
      expect(repA).not.toBeNull()
      expect(repA!.status).toBe('learning') // Unmodified status
    })

    it('should push tracks to Spotify and handle batching (> 100 songs) (UC4.3)', async () => {
      const { error: authErr } = await mockTestClient.auth.signInWithPassword(USER_A)
      expect(authErr).toBeNull()

      // Let's create a large playlist with 105 songs to trigger batching
      const { data: playlist } = await admin
        .from('playlists')
        .insert({
          user_id: userAId,
          name: 'Large Local Playlist',
          spotify_playlist_id: 'large-spotify-id',
          sync_with_spotify: true,
        })
        .select('id')
        .single()
      createdPlaylists.push(playlist!.id)

      // Create 105 mock songs in global_songs in bulk to avoid DB overhead
      const bulkSongs = Array.from({ length: 105 }).map((_, i) => ({
        title: `Bulk Song ${i}`,
        artist: 'Bulk Artist',
        links: [{ label: 'spotify', url: `https://open.spotify.com/track/bulktrackid${i}` }],
      }))

      const { data: insertedSongs, error: songErr } = await admin
        .from('global_songs')
        .insert(bulkSongs)
        .select('id')
      
      expect(songErr).toBeNull()
      expect(insertedSongs).toHaveLength(105)
      createdSongs.push(...insertedSongs!.map(s => s.id))

      // Add to playlist_songs in bulk
      const bulkPlaylistSongs = insertedSongs!.map((s, idx) => ({
        playlist_id: playlist!.id,
        song_id: s.id,
        position: idx + 1,
      }))

      const { error: playlistSongsErr } = await admin
        .from('playlist_songs')
        .insert(bulkPlaylistSongs)
      expect(playlistSongsErr).toBeNull()

      // Monitor fetch calls to verify batching.
      // Expect 1 PUT call (first 100 tracks) and 1 POST call (remaining 5 tracks).
      let putCall: any = null
      let postCall: any = null

      fetchSpy.mockImplementation((url: any, options: any) => {
        if (url.includes('/v1/playlists/large-spotify-id/tracks')) {
          if (options.method === 'PUT') {
            putCall = { url, body: JSON.parse(options.body) }
            return Promise.resolve({ ok: true } as any)
          }
          if (options.method === 'POST') {
            postCall = { url, body: JSON.parse(options.body) }
            return Promise.resolve({ ok: true } as any)
          }
        }
        return originalFetch(url, options)
      })

      const request = new NextRequest(
        new URL(`http://localhost/api/spotify/playlists/${playlist!.id}/sync`),
        {
          method: 'POST',
          body: JSON.stringify({ direction: 'push' }),
        }
      )

      const response = await syncPOST(request, {
        params: Promise.resolve({ id: playlist!.id }),
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.added).toBe(105)

      // Verify batching assertions
      expect(putCall).not.toBeNull()
      expect(putCall.body.uris).toHaveLength(100) // First batch
      expect(putCall.body.uris[0]).toBe('spotify:track:bulktrackid0')

      expect(postCall).not.toBeNull()
      expect(postCall.body.uris).toHaveLength(5) // Remaining 5 tracks
      expect(postCall.body.uris[0]).toBe('spotify:track:bulktrackid100')
    })
  })
})

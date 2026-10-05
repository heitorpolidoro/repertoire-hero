import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createTestUserWithGoTrue, deleteTestUserWithGoTrue } from './test-helpers'
import { query } from '@/lib/db'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

const skip = !RUN_DB_TESTS

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

/**
 * The one repeated write in this file: a `spotify_tokens` row for a user. Spelt
 * out here rather than through a generic table helper (the repo has no ORM).
 */
async function insertSpotifyToken(
  userId: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: string,
): Promise<void> {
  await query(
    'INSERT INTO spotify_tokens (user_id, access_token, refresh_token, expires_at) VALUES ($1, $2, $3, $4)',
    [userId, accessToken, refreshToken, expiresAt],
  )
}

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
    await query("DELETE FROM songs WHERE title ILIKE 'Song A'")
    await query("DELETE FROM songs WHERE title ILIKE 'Song B'")

    // Create the Better Auth user + profile rows the FK constraints need
    ;({ userId: userAId } = await createTestUserWithGoTrue({ email: USER_A.email, password: USER_A.password }))
    ;({ userId: userBId } = await createTestUserWithGoTrue({ email: USER_B.email, password: USER_B.password }))

    // 3. Create a Band
    const band = await query<{ id: string }>(
      'INSERT INTO bands (name, invite_code) VALUES ($1, $2) RETURNING id',
      [`Spotify Test Band ${suffix}`, `SPOTIFY${suffix.toString().slice(-5)}`],
    )
    bandId = band.rows[0].id
    createdBands.push(bandId)

    // Add User A (admin) and User B (member) to band_members
    await query(
      `INSERT INTO band_members (band_id, user_id, role)
       VALUES ($1, $2, 'admin'), ($1, $3, 'member')`,
      [bandId, userAId, userBId],
    )
  })

  afterAll(async () => {
    // Restore fetch spy
    if (fetchSpy) fetchSpy.mockRestore()
    global.fetch = originalFetch

    // 1. Delete playlist songs links
    if (createdPlaylists.length > 0) {
      await query('DELETE FROM playlist_songs WHERE playlist_id = ANY($1)', [createdPlaylists])
      await query('DELETE FROM playlists WHERE id = ANY($1)', [createdPlaylists])
    }

    // 2. Delete band members and bands
    if (createdBands.length > 0) {
      await query('DELETE FROM band_members WHERE band_id = ANY($1)', [createdBands])
      await query('DELETE FROM bands WHERE id = ANY($1)', [createdBands])
    }

    // 3. Delete repertoires
    if (userAId) {
      await query('DELETE FROM repertoire WHERE user_id = $1', [userAId])
    }
    if (userBId) {
      await query('DELETE FROM repertoire WHERE user_id = $1', [userBId])
    }
    if (createdBands.length > 0) {
      await query('DELETE FROM repertoire WHERE band_id = ANY($1)', [createdBands])
    }

    // 4. Delete spotify tokens
    if (userAId) {
      await query('DELETE FROM spotify_tokens WHERE user_id = $1', [userAId])
    }
    if (userBId) {
      await query('DELETE FROM spotify_tokens WHERE user_id = $1', [userBId])
    }

    // 5. Delete global songs
    if (createdSongs.length > 0) {
      await query('DELETE FROM songs WHERE id = ANY($1)', [createdSongs])
    }

    // 6. Delete users
    if (userAId) await deleteTestUserWithGoTrue(userAId)
    if (userBId) await deleteTestUserWithGoTrue(userBId)
  })

  beforeEach(() => {
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

      // Delegate all other calls (the Postgres driver, etc.) to the original fetch
      return originalFetch(input, init)
    })
  })

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore()
  })

  describe('spotifyAuth.ts -> getSpotifyAccessToken', () => {
    beforeEach(async () => {
      // Ensure we delete any existing token row for User A before each test
      await query('DELETE FROM spotify_tokens WHERE user_id = $1', [userAId])
      // Set environment variables for credentials
      process.env.SPOTIFY_CLIENT_ID = 'test-client-id'
      process.env.SPOTIFY_CLIENT_SECRET = 'test-client-secret'
    })

    it('should return null when the user has not connected their Spotify account', async () => {
      const token = await getSpotifyAccessToken(userAId)
      expect(token).toBeNull()
    })

    it('should return the active token directly from the database if it is still valid', async () => {
      // Insert a valid token in the DB (expiry is 1 hour in the future)
      const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString()
      await insertSpotifyToken(userAId, 'valid-access-token', 'valid-refresh-token', expiresAt)

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
      await insertSpotifyToken(userAId, 'expired-access-token', 'valid-refresh-token', expiresAt)

      const token = await getSpotifyAccessToken(userAId)
      expect(token).toBe('new-refreshed-access-token')

      // Assert that fetch was called for Spotify accounts API
      const spotifyCalls = fetchSpy.mock.calls.filter((call: any) => {
        const url = typeof call[0] === 'string' ? call[0] : call[0].url
        return url.includes('accounts.spotify.com/api/token')
      })
      expect(spotifyCalls).toHaveLength(1)

      // Verify the refreshed token is persisted in the database
      const tokenRows = await query<{ access_token: string; refresh_token: string; expires_at: string }>(
        'SELECT access_token, refresh_token, expires_at FROM spotify_tokens WHERE user_id = $1',
        [userAId],
      )
      expect(tokenRows.rows).toHaveLength(1)
      const row = tokenRows.rows[0]
      expect(row.access_token).toBe('new-refreshed-access-token')
      expect(row.refresh_token).toBe('new-refresh-token')
      const newExpiry = new Date(row.expires_at).getTime()
      expect(newExpiry).toBeGreaterThan(Date.now() + 3500 * 1000)
    })

    it('should return null and log an error when refresh call to Spotify fails', async () => {
      // Expired token
      const expiresAt = new Date(Date.now() - 10 * 1000).toISOString()
      await insertSpotifyToken(userAId, 'expired-access-token', 'bad-refresh-token', expiresAt)

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
      await insertSpotifyToken(userAId, 'expired-access-token', 'valid-refresh-token', expiresAt)

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
      await query('DELETE FROM spotify_tokens WHERE user_id = $1', [userAId])
      await insertSpotifyToken(
        userAId,
        'import-access-token',
        'import-refresh-token',
        new Date(Date.now() + 3600 * 1000).toISOString(),
      )
    })

    it('should import a playlist and add songs to the user repertoire (UC4.1)', async () => {
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

      // Verify the song was created in songs
      const songRows = await query<{ id: string }>(
        "SELECT id FROM songs WHERE title ILIKE 'Song A'",
      )
      expect(songRows.rows).toHaveLength(1)
      const songId = songRows.rows[0].id
      createdSongs.push(songId)

      // Verify it was added to User A's repertoire
      const repRows = await query<{ status: string }>(
        'SELECT status FROM repertoire WHERE user_id = $1 AND song_id = $2',
        [userAId, songId],
      )
      expect(repRows.rows).toHaveLength(1)
      expect(repRows.rows[0].status).toBe('unknown')
    })

    it('should propagate imported songs to all band members when importing a band playlist (UC4.1)', async () => {
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

      expect(response.status).toBe(201)
      const data = await response.json()
      expect(data.band_id).toBe(bandId)
      createdPlaylists.push(data.id)

      // Find created song
      const songRows = await query<{ id: string }>(
        "SELECT id FROM songs WHERE title ILIKE 'Song B'",
      )
      expect(songRows.rows).toHaveLength(1)
      const songId = songRows.rows[0].id
      createdSongs.push(songId)

      // 1. Verify in Band Repertoire
      const bandRep = await query('SELECT id FROM repertoire WHERE band_id = $1 AND song_id = $2', [bandId, songId])
      expect(bandRep.rows).toHaveLength(1)

      // 2. Verify in User A repertoire (admin)
      const repA = await query('SELECT id FROM repertoire WHERE user_id = $1 AND song_id = $2', [userAId, songId])
      expect(repA.rows).toHaveLength(1)

      // 3. Verify propagated in User B repertoire (member)
      const repB = await query('SELECT id FROM repertoire WHERE user_id = $1 AND song_id = $2', [userBId, songId])
      expect(repB.rows).toHaveLength(1)
    })
  })

  describe('POST /api/spotify/playlists/[id]/sync', () => {
    let localPlaylistId: string
    let songIdA: string
    let songIdB: string

    beforeAll(async () => {
      // Clean up previous runs if any to prevent unique key constraint violations (title, album)
      await query("DELETE FROM songs WHERE title ILIKE 'Sync Song A'")
      await query("DELETE FROM songs WHERE title ILIKE 'Sync Song B'")

      // 1. Create global songs with Spotify links and exact albums matching the Spotify mock
      const songA = await query<{ id: string }>(
        `INSERT INTO songs (title, artist, album, links)
         VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
        [
          'Sync Song A',
          'Sync Artist A',
          'Album A',
          JSON.stringify([{ label: 'spotify', url: 'https://open.spotify.com/track/spotify-track-a' }]),
        ],
      )
      songIdA = songA.rows[0].id
      createdSongs.push(songIdA)

      const songB = await query<{ id: string }>(
        `INSERT INTO songs (title, artist, album, links)
         VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
        [
          'Sync Song B',
          'Sync Artist B',
          'Album B',
          JSON.stringify([{ label: 'spotify', url: 'https://open.spotify.com/track/spotify-track-b' }]),
        ],
      )
      songIdB = songB.rows[0].id
      createdSongs.push(songIdB)
    })

    beforeEach(async () => {
      // Mock auth session to return User A's ID for route handlers
      vi.mocked(authSession.getRequiredUserId).mockResolvedValue(userAId)

      // Setup token for User A
      await query('DELETE FROM spotify_tokens WHERE user_id = $1', [userAId])
      await insertSpotifyToken(
        userAId,
        'sync-access-token',
        'sync-refresh-token',
        new Date(Date.now() + 3600 * 1000).toISOString(),
      )

      // Create a local playlist linked to Spotify
      const playlist = await query<{ id: string }>(
        `INSERT INTO playlists (user_id, name, spotify_playlist_id, sync_with_spotify)
         VALUES ($1, $2, $3, true) RETURNING id`,
        [userAId, 'Local Playlist for Sync', 'spotify-linked-123'],
      )
      localPlaylistId = playlist.rows[0].id
      createdPlaylists.push(localPlaylistId)

      // Add only Song A initially to local playlist
      await query(
        'INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES ($1, $2, 1)',
        [localPlaylistId, songIdA],
      )

      // Add both to User A's repertoire
      await query(
        `INSERT INTO repertoire (user_id, song_id, status)
         VALUES ($1, $2, 'learning'), ($1, $3, 'practicing')
         ON CONFLICT (user_id, song_id) WHERE user_id IS NOT NULL
         DO UPDATE SET status = EXCLUDED.status`,
        [userAId, songIdA, songIdB],
      )
    })

    it('should pull tracks from Spotify: add new ones, remove obsolete ones, but keep them in the repertoire (UC4.2)', async () => {
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
      const localSongs = await query<{ song_id: string }>(
        'SELECT song_id FROM playlist_songs WHERE playlist_id = $1',
        [localPlaylistId],
      )
      expect(localSongs.rows).toHaveLength(1)
      expect(localSongs.rows[0].song_id).toBe(songIdB)

      // SECURITY CRITICAL EDGE CASE check: Song A is removed from the playlist,
      // but MUST REMAIN in the user's repertoire
      const repA = await query<{ status: string }>(
        'SELECT status FROM repertoire WHERE user_id = $1 AND song_id = $2',
        [userAId, songIdA],
      )
      expect(repA.rows).toHaveLength(1)
      expect(repA.rows[0].status).toBe('learning') // Unmodified status
    })

    it('should push tracks to Spotify and handle batching (> 100 songs) (UC4.3)', async () => {
      // Let's create a large playlist with 105 songs to trigger batching
      const largePlaylist = await query<{ id: string }>(
        `INSERT INTO playlists (user_id, name, spotify_playlist_id, sync_with_spotify)
         VALUES ($1, $2, $3, true) RETURNING id`,
        [userAId, 'Large Local Playlist', 'large-spotify-id'],
      )
      const largePlaylistId = largePlaylist.rows[0].id
      createdPlaylists.push(largePlaylistId)

      // Create 105 mock songs in songs in bulk to avoid DB overhead
      const bulkTitles = Array.from({ length: 105 }, (_, i) => `Bulk Song ${i}`)
      const bulkLinks = bulkTitles.map((_, i) =>
        JSON.stringify([{ label: 'spotify', url: `https://open.spotify.com/track/bulktrackid${i}` }]),
      )

      const insertedSongs = await query<{ id: string }>(
        `INSERT INTO songs (title, artist, links)
         SELECT t, 'Bulk Artist', l::jsonb
         FROM unnest($1::text[], $2::text[]) AS s(t, l)
         RETURNING id`,
        [bulkTitles, bulkLinks],
      )
      expect(insertedSongs.rows).toHaveLength(105)
      const bulkSongIds = insertedSongs.rows.map((r) => r.id)
      createdSongs.push(...bulkSongIds)

      // Add to playlist_songs in bulk
      await query(
        `INSERT INTO playlist_songs (playlist_id, song_id, position)
         SELECT $1, s, ordinality FROM unnest($2::uuid[]) WITH ORDINALITY AS t(s, ordinality)`,
        [largePlaylistId, bulkSongIds],
      )

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
        new URL(`http://localhost/api/spotify/playlists/${largePlaylistId}/sync`),
        {
          method: 'POST',
          body: JSON.stringify({ direction: 'push' }),
        }
      )

      const response = await syncPOST(request, {
        params: Promise.resolve({ id: largePlaylistId }),
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

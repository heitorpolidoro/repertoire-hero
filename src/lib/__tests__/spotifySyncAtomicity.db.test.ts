/**
 * RH-36 — the Spotify pull resync driven end to end against the real database.
 *
 * Only the session, the Spotify token and `fetch` are mocked, as in
 * `spotifyPlaylistRouteAuthz.db.test.ts`; everything else is the real handler
 * writing real rows. Two findings are covered: F9 (the delete-then-insert
 * resync had no transaction, so a failing re-insert emptied the playlist) and
 * F19 (`ensureInRepertoire` now seeds the band and every member with two
 * statements instead of a per-member fan-out).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// The only mocked seams — everything else is the real handler on real rows.
vi.mock('@/lib/auth-session', () => ({ getRequiredUserId: vi.fn() }))
vi.mock('@/lib/spotifyAuth', () => ({ getSpotifyAccessToken: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { POST as syncPOST } from '@/app/api/spotify/playlists/[id]/sync/route'
import { createBand } from '@/lib/bands'
import { query } from '@/lib/db'
import { getSpotifyAccessToken } from '@/lib/spotifyAuth'
import { getRequiredUserId } from '@/lib/auth-session'
import { createAdminTestClient, createTestUser, deleteTestUser } from '@/lib/__tests__/test-helpers'

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const admin = createAdminTestClient()

const TRACK_TITLE = 'RH-36 Track'
const TRACK_ARTIST = 'RH-36 Track Artist'

const oneTrackPage = {
  items: [
    {
      track: {
        id: 'rh36track1',
        name: TRACK_TITLE,
        duration_ms: 180000,
        artists: [{ name: TRACK_ARTIST }],
        album: { name: 'RH-36 Album', images: [] as Array<{ url: string }> },
        external_urls: { spotify: 'https://open.spotify.com/track/rh36track1' },
      },
    },
  ],
  next: null,
}

describe.skipIf(!SERVICE_ROLE_KEY)('the Spotify pull resync (real database)', () => {
  const suffix = Date.now()

  let ownerId: string
  let memberOneId: string
  let memberTwoId: string
  let bandId: string
  let playlistId: string
  let bandPlaylistId: string
  let songOneId: string
  let songTwoId: string

  let fetchSpy: ReturnType<typeof vi.spyOn>

  /** Triggers installed by the running test, dropped in afterEach. */
  const installedTriggers: string[] = []

  const asUser = (userId: string) => {
    vi.mocked(getRequiredUserId).mockResolvedValue(userId)
  }

  const one = async (sql: string, params: unknown[] = []) => {
    const res = await query(sql, params as never)
    return res.rows[0]
  }

  const callSync = (id: string) =>
    syncPOST(
      new NextRequest(new URL(`http://localhost/api/spotify/playlists/${id}/sync`), {
        method: 'POST',
        body: JSON.stringify({ direction: 'pull' }),
      }),
      { params: Promise.resolve({ id }) },
    )

  beforeAll(async () => {
    await query(
      `CREATE OR REPLACE FUNCTION rh36_sync_raise() RETURNS trigger AS $fn$
       BEGIN RAISE EXCEPTION 'RH-36 injected insert failure'; END;
       $fn$ LANGUAGE plpgsql`,
    )

    ownerId = await createTestUser(admin, { email: `rh36-sync-owner-${suffix}@example.com` })
    memberOneId = await createTestUser(admin, { email: `rh36-sync-m1-${suffix}@example.com` })
    memberTwoId = await createTestUser(admin, { email: `rh36-sync-m2-${suffix}@example.com` })

    bandId = await createBand(ownerId, `RH-36 Sync Band ${suffix}`, null, null)
    for (const member of [memberOneId, memberTwoId]) {
      await query("INSERT INTO band_members (band_id, user_id, role) VALUES ($1, $2, 'member')", [
        bandId,
        member,
      ])
    }

    const songOne = await one(
      'INSERT INTO global_songs (title, artist) VALUES ($1, $2) RETURNING id',
      [`RH-36 Existing One ${suffix}`, 'RH-36 Artist'],
    )
    songOneId = songOne.id as string
    const songTwo = await one(
      'INSERT INTO global_songs (title, artist) VALUES ($1, $2) RETURNING id',
      [`RH-36 Existing Two ${suffix}`, 'RH-36 Artist'],
    )
    songTwoId = songTwo.id as string

    const personal = await one(
      `INSERT INTO playlists (user_id, name, spotify_playlist_id, sync_with_spotify)
       VALUES ($1, $2, 'rh36-spotify-p', true) RETURNING id`,
      [ownerId, `RH-36 Personal Playlist ${suffix}`],
    )
    playlistId = personal.id as string
    await query(
      'INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES ($1, $2, 1), ($1, $3, 2)',
      [playlistId, songOneId, songTwoId],
    )

    const bandPlaylist = await one(
      `INSERT INTO playlists (band_id, name, spotify_playlist_id, sync_with_spotify)
       VALUES ($1, $2, 'rh36-spotify-pb', true) RETURNING id`,
      [bandId, `RH-36 Band Playlist ${suffix}`],
    )
    bandPlaylistId = bandPlaylist.id as string
  })

  beforeEach(() => {
    vi.mocked(getSpotifyAccessToken).mockResolvedValue('rh36-access-token')

    fetchSpy?.mockRestore()
    fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(oneTrackPage),
      } as Response),
    )
  })

  afterEach(async () => {
    while (installedTriggers.length > 0) {
      const name = installedTriggers.pop()!
      await query(`DROP TRIGGER IF EXISTS ${name} ON playlist_songs`)
    }
  })

  afterAll(async () => {
    fetchSpy?.mockRestore()

    if (bandId) await query('DELETE FROM bands WHERE id = $1', [bandId])
    for (const user of [ownerId, memberOneId, memberTwoId]) {
      if (user) await deleteTestUser(admin, user)
    }
    for (const song of [songOneId, songTwoId]) {
      if (song) await query('DELETE FROM global_songs WHERE id = $1', [song])
    }
    await query('DELETE FROM global_songs WHERE title = $1 AND artist = $2', [
      TRACK_TITLE,
      TRACK_ARTIST,
    ])
    await query('DROP FUNCTION IF EXISTS rh36_sync_raise() CASCADE')
  })

  it('a failing playlist_songs insert leaves the original playlist rows intact', async () => {
    await query(
      `CREATE TRIGGER rh36_fail_playlist_songs BEFORE INSERT ON playlist_songs
       FOR EACH ROW WHEN (NEW.playlist_id = '${playlistId}') EXECUTE FUNCTION rh36_sync_raise()`,
    )
    installedTriggers.push('rh36_fail_playlist_songs')

    asUser(ownerId)

    const response = await callSync(playlistId)
    expect(response.status).toBe(500)

    // The DELETE that precedes the re-insert is rolled back with it, so the
    // playlist still holds exactly what it held before the sync.
    const rows = await query(
      'SELECT song_id, position FROM playlist_songs WHERE playlist_id = $1 ORDER BY position',
      [playlistId],
    )
    expect(rows.rows).toEqual([
      { song_id: songOneId, position: 1 },
      { song_id: songTwoId, position: 2 },
    ])

    const playlist = await one('SELECT last_synced_at FROM playlists WHERE id = $1', [playlistId])
    expect(playlist.last_synced_at).toBeNull()
  })

  it('seeds the band row and every member repertoire row on a pull', async () => {
    asUser(ownerId)

    const response = await callSync(bandPlaylistId)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ added: 1, removed: 0 })

    const song = await one('SELECT id FROM global_songs WHERE title = $1 AND artist = $2', [
      TRACK_TITLE,
      TRACK_ARTIST,
    ])
    const syncedSongId = song.id as string

    const bandRows = await one(
      'SELECT count(*)::int AS count FROM repertoire WHERE song_id = $1 AND band_id = $2',
      [syncedSongId, bandId],
    )
    expect(bandRows.count).toBe(1)

    const memberRows = await one(
      'SELECT count(*)::int AS count FROM repertoire WHERE song_id = $1 AND user_id IS NOT NULL',
      [syncedSongId],
    )
    expect(memberRows.count).toBe(3)
  })
})

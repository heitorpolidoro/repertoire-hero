/**
 * RH-35 — the three `/api/spotify/playlists/[id]/*` route handlers driven as a
 * hostile caller, against the real database.
 *
 * Only the session, the Spotify token and `fetch` are mocked: every refusal is
 * asserted together with a read-back of the rows the call would have written,
 * and with the fetch spy proving no outbound Spotify traffic happened either.
 * The sync resync is now atomic (RH-36 wrapped its delete-then-insert in
 * `withTransaction`), but atomicity is not authorization: a refusal must still
 * happen *before* the first statement, which is exactly what these read-backs
 * pin. `transactionAtomicity.db.test.ts` covers the rollback behaviour itself.
 *
 * Fixture: users A, B, C; band Y with A as admin and B as member; band Z with C
 * alone; personal playlist P owned by A (one song, linked to Spotify); band
 * playlist PB owned by band Y (empty, linked to Spotify).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth-session', () => ({ getRequiredUserId: vi.fn() }))
vi.mock('@/lib/spotifyAuth', () => ({ getSpotifyAccessToken: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

import { createAdminTestClient, createTestUser, deleteTestUser } from '@/lib/__tests__/test-helpers'
import { getRequiredUserId } from '@/lib/auth-session'
import { getSpotifyAccessToken } from '@/lib/spotifyAuth'
import { createBand } from '@/lib/bands'
import { query } from '@/lib/db'
import { POST as syncPOST } from '@/app/api/spotify/playlists/[id]/sync/route'
import { POST as importPOST } from '@/app/api/spotify/playlists/[id]/import/route'
import { GET as tracksGET } from '@/app/api/spotify/playlists/[id]/tracks/route'

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const admin = createAdminTestClient()

/** Well-formed, but names nothing. */
const ABSENT_UUID = '00000000-0000-0000-0000-0000000000ff'
const TRACK_TITLE = 'RH-35 Track'
const TRACK_ARTIST = 'RH-35 Artist'

const metadataDocument = {
  name: 'RH-35 Spotify Fixture',
  description: null,
  images: [] as Array<{ url: string }>,
}

const oneTrackPage = {
  items: [
    {
      track: {
        id: 'rh35track1',
        name: TRACK_TITLE,
        duration_ms: 180000,
        artists: [{ name: TRACK_ARTIST }],
        album: { name: 'RH-35 Album', images: [] as Array<{ url: string }> },
        external_urls: { spotify: 'https://open.spotify.com/track/rh35track1' },
      },
    },
  ],
  next: null,
}

describe.skipIf(!SERVICE_ROLE_KEY)('spotify playlist routes refuse foreign resources (real database)', () => {
  const suffix = Date.now()

  let userAId: string
  let userBId: string
  let userCId: string
  let bandYId: string
  let bandZId: string
  let playlistId: string
  let bandPlaylistId: string
  let songOneId: string

  let fetchSpy: ReturnType<typeof vi.spyOn>

  const asUser = (userId: string) => {
    vi.mocked(getRequiredUserId).mockResolvedValue(userId)
  }

  /** Number of outbound Spotify calls recorded since the last `mockClear()`. */
  const spotifyCallCount = () =>
    fetchSpy.mock.calls.filter(([input]) => String(input).includes('api.spotify.com')).length

  const playlistEntries = async (id: string) => {
    const res = await query(
      'SELECT song_id, position FROM playlist_songs WHERE playlist_id = $1 ORDER BY position',
      [id],
    )
    return res.rows
  }

  const playlistStamps = async (id: string) => {
    const res = await query('SELECT last_synced_at, updated_at FROM playlists WHERE id = $1', [id])
    return res.rows[0]
  }

  const countRows = async (sql: string, params: unknown[]) => {
    const res = await query(sql, params as never)
    return res.rows[0].count as number
  }

  const syncRequest = (id: string, direction: 'pull' | 'push') =>
    new NextRequest(new URL(`http://localhost/api/spotify/playlists/${id}/sync`), {
      method: 'POST',
      body: JSON.stringify({ direction }),
    })

  const callSync = (id: string, direction: 'pull' | 'push') =>
    syncPOST(syncRequest(id, direction), { params: Promise.resolve({ id }) })

  const callImport = (id: string, body: Record<string, unknown>) =>
    importPOST(
      new NextRequest(new URL(`http://localhost/api/spotify/playlists/${id}/import`), {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    )

  beforeAll(async () => {
    userAId = await createTestUser(admin, { email: `rh35-a-${suffix}@example.com` })
    userBId = await createTestUser(admin, { email: `rh35-b-${suffix}@example.com` })
    userCId = await createTestUser(admin, { email: `rh35-c-${suffix}@example.com` })

    bandYId = await createBand(userAId, `RH-35 Band Y ${suffix}`, null, null)
    await query("INSERT INTO band_members (band_id, user_id, role) VALUES ($1, $2, 'member')", [
      bandYId,
      userBId,
    ])
    bandZId = await createBand(userCId, `RH-35 Band Z ${suffix}`, null, null)

    const song = await query(
      'INSERT INTO global_songs (title, artist) VALUES ($1, $2) RETURNING id',
      [`RH-35 Fixture Song ${suffix}`, TRACK_ARTIST],
    )
    songOneId = song.rows[0].id as string

    const personal = await query(
      `INSERT INTO playlists (user_id, name, spotify_playlist_id, sync_with_spotify, last_synced_at)
       VALUES ($1, $2, 'rh35-spotify-p', true, now() - interval '1 day') RETURNING id`,
      [userAId, `RH-35 Personal Playlist ${suffix}`],
    )
    playlistId = personal.rows[0].id as string
    await query('INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES ($1, $2, 1)', [
      playlistId,
      songOneId,
    ])

    const bandPlaylist = await query(
      `INSERT INTO playlists (band_id, name, spotify_playlist_id, sync_with_spotify)
       VALUES ($1, $2, 'rh35-spotify-pb', true) RETURNING id`,
      [bandYId, `RH-35 Band Playlist ${suffix}`],
    )
    bandPlaylistId = bandPlaylist.rows[0].id as string
  })

  afterAll(async () => {
    fetchSpy?.mockRestore()

    for (const band of [bandYId, bandZId]) {
      if (band) await query('DELETE FROM bands WHERE id = $1', [band])
    }
    for (const user of [userAId, userBId, userCId]) {
      if (user) await deleteTestUser(admin, user)
    }
    if (songOneId) await query('DELETE FROM global_songs WHERE id = $1', [songOneId])
    await query('DELETE FROM global_songs WHERE title = $1 AND artist = $2', [
      TRACK_TITLE,
      TRACK_ARTIST,
    ])
  })

  beforeEach(() => {
    vi.mocked(getSpotifyAccessToken).mockResolvedValue('rh35-access-token')

    // Answers by URL shape: the import route reads a metadata document and a
    // tracks page, and they are different documents — `playlists.name` is NOT
    // NULL and comes from the metadata one.
    fetchSpy?.mockRestore()
    fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(typeof input === 'object' && 'url' in input ? input.url : input)
      let body: unknown = {}
      if (url.includes('?fields=name,description,images')) {
        body = metadataDocument
      } else if (new URL(url).pathname.endsWith('/tracks')) {
        body = oneTrackPage
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response)
    })
  })

  describe('a hostile caller cannot sync a playlist that is not theirs', () => {
    it.each([
      ['a personal playlist owned by someone else', () => playlistId],
      ['a playlist owned by a band the caller is not in', () => bandPlaylistId],
      ['a well-formed id that names nothing', () => ABSENT_UUID],
    ])('pull against %s answers the same 404 and writes nothing', async (_label, targetId) => {
      const entriesBefore = await playlistEntries(playlistId)
      const stampsBefore = await playlistStamps(playlistId)
      const bandEntriesBefore = await countRows(
        'SELECT count(*)::int AS count FROM playlist_songs WHERE playlist_id = $1',
        [bandPlaylistId],
      )
      asUser(userCId)
      fetchSpy.mockClear()

      const response = await callSync(targetId(), 'pull')

      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'Playlist not found', code: 404 })

      expect(await playlistEntries(playlistId)).toEqual(entriesBefore)
      expect(entriesBefore).toHaveLength(1)
      expect(entriesBefore[0]).toEqual({ song_id: songOneId, position: 1 })
      expect(await playlistStamps(playlistId)).toEqual(stampsBefore)
      expect(
        await countRows('SELECT count(*)::int AS count FROM playlist_songs WHERE playlist_id = $1', [
          bandPlaylistId,
        ]),
      ).toBe(bandEntriesBefore)
      expect(bandEntriesBefore).toBe(0)
      expect(spotifyCallCount()).toBe(0)
    })

    it('push is refused before the victim setlist is read or sent to Spotify', async () => {
      const stampsBefore = await playlistStamps(playlistId)
      asUser(userCId)
      fetchSpy.mockClear()

      const response = await callSync(playlistId, 'push')

      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'Playlist not found', code: 404 })
      expect(spotifyCallCount()).toBe(0)
      expect(await playlistStamps(playlistId)).toEqual(stampsBefore)
    })
  })

  describe('a hostile caller cannot import into a band they are not in', () => {
    it.each([
      ['an existing band the caller is not a member of', () => bandYId],
      ['a well-formed band id that names nothing', () => ABSENT_UUID],
    ])('import with %s answers the same 404 and creates nothing', async (_label, targetBandId) => {
      const playlistsBefore = await countRows(
        'SELECT count(*)::int AS count FROM playlists WHERE band_id = $1',
        [bandYId],
      )
      const bandRepertoireBefore = await countRows(
        'SELECT count(*)::int AS count FROM repertoire WHERE band_id = $1',
        [bandYId],
      )
      const memberRepertoireBefore = await countRows(
        'SELECT count(*)::int AS count FROM repertoire WHERE user_id = $1',
        [userBId],
      )
      asUser(userCId)
      fetchSpy.mockClear()

      const response = await callImport('rh35-spotify-import', {
        sync_with_spotify: true,
        band_id: targetBandId(),
      })

      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'Band not found', code: 404 })

      expect(
        await countRows('SELECT count(*)::int AS count FROM playlists WHERE band_id = $1', [bandYId]),
      ).toBe(playlistsBefore)
      expect(
        await countRows('SELECT count(*)::int AS count FROM repertoire WHERE band_id = $1', [bandYId]),
      ).toBe(bandRepertoireBefore)
      expect(
        await countRows('SELECT count(*)::int AS count FROM repertoire WHERE user_id = $1', [userBId]),
      ).toBe(memberRepertoireBefore)
      expect(spotifyCallCount()).toBe(0)
    })
  })

  it('the tracks route touches no local row, even when handed a local playlist id', async () => {
    const entriesBefore = await playlistEntries(playlistId)
    const stampsBefore = await playlistStamps(playlistId)
    const callerPlaylistsBefore = await countRows(
      'SELECT count(*)::int AS count FROM playlists WHERE user_id = $1',
      [userCId],
    )
    asUser(userCId)

    await tracksGET(
      new NextRequest(new URL(`http://localhost/api/spotify/playlists/${playlistId}/tracks`)),
      { params: Promise.resolve({ id: playlistId }) },
    )

    expect(await playlistEntries(playlistId)).toEqual(entriesBefore)
    expect(await playlistStamps(playlistId)).toEqual(stampsBefore)
    expect(
      await countRows('SELECT count(*)::int AS count FROM playlists WHERE user_id = $1', [userCId]),
    ).toBe(callerPlaylistsBefore)
  })

  describe('the authorized paths are unchanged', () => {
    it('the owner still pulls their own playlist', async () => {
      const stampsBefore = await playlistStamps(playlistId)
      asUser(userAId)

      const response = await callSync(playlistId, 'pull')
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.error).toBeUndefined()
      expect(typeof body.added).toBe('number')
      expect(typeof body.removed).toBe('number')

      const entries = await playlistEntries(playlistId)
      expect(entries).toHaveLength(1)
      expect(entries[0].position).toBe(1)
      const song = await query('SELECT title FROM global_songs WHERE id = $1', [entries[0].song_id])
      expect(song.rows[0].title).toBe(TRACK_TITLE)

      const stampsAfter = await playlistStamps(playlistId)
      expect(stampsAfter.last_synced_at).not.toBeNull()
      expect(stampsAfter.last_synced_at.getTime()).toBeGreaterThan(
        stampsBefore.last_synced_at.getTime(),
      )
    })

    it('a band member still pulls the band playlist', async () => {
      asUser(userBId)

      const response = await callSync(bandPlaylistId, 'pull')
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(typeof body.added).toBe('number')
      expect(typeof body.removed).toBe('number')
      expect(
        await countRows('SELECT count(*)::int AS count FROM playlist_songs WHERE playlist_id = $1', [
          bandPlaylistId,
        ]),
      ).toBe(1)
    })

    it('a personal import with no band_id still creates a personal playlist', async () => {
      asUser(userAId)

      const response = await callImport('rh35-spotify-import-a', { sync_with_spotify: false })
      const body = await response.json()

      expect(response.status).toBe(201)
      expect(body.user_id).toBe(userAId)
      expect(body.band_id).toBeNull()
    })

    it('a member importing into their own band still creates a band playlist', async () => {
      asUser(userBId)

      const response = await callImport('rh35-spotify-import-b', {
        sync_with_spotify: false,
        band_id: bandYId,
      })
      const body = await response.json()

      expect(response.status).toBe(201)
      expect(body.band_id).toBe(bandYId)
      expect(body.user_id).toBeNull()
    })
  })
})

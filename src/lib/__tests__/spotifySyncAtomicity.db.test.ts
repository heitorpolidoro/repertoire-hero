/**
 * RH-36 — the Spotify pull resync driven end to end against the real database.
 *
 * Only the session, the Spotify token and `fetch` are mocked, as in
 * `spotifyPlaylistRouteAuthz.db.test.ts`; everything else is the real handler
 * writing real rows. Two findings are covered: F9 (the delete-then-insert
 * resync had no transaction, so a failing re-insert emptied the playlist) and
 * F19, as RH-126 settled it (`ensureInRepertoire` seeds the band's row with one
 * statement and no member row at all).
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
import {
  OWNER_SONG_FROM,
  createTestUser,
  deleteTestUser,
  representativeVersionId,
} from '@/lib/__tests__/test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''
const TRACK_TITLE = 'RH-36 Track'
const TRACK_ARTIST = 'RH-36 Track Artist'

/**
 * RH-126 — each test pulls its own distinct track, so a "no row for this song"
 * assertion never depends on test order or on what another test seeded. Since
 * RH-139 the repertoire seeding runs inside the same transaction as the
 * `playlist_songs` rewrite, so a failing insert leaves no repertoire row either.
 */
const BAND_TRACK_TITLE = 'RH-36 Band Track'
const BAND_TRACK_ARTIST = 'RH-36 Band Track Artist'

const oneTrackPageFor = (id: string, name: string, artist: string) => ({
  items: [
    {
      track: {
        id,
        name,
        duration_ms: 180000,
        artists: [{ name: artist }],
        album: { name: 'RH-36 Album', images: [] as Array<{ url: string }> },
        external_urls: { spotify: `https://open.spotify.com/track/${id}` },
      },
    },
  ],
  next: null,
})

const FAIL_PERSONAL_TITLE = 'RH-139 Personal Fail Track'
const FAIL_BAND_TITLE = 'RH-139 Band Fail Track'
const OK_PERSONAL_TITLE = 'RH-139 Personal Ok Track'
const RH139_ARTIST = 'RH-139 Track Artist'
const failPersonalPage = oneTrackPageFor('rh139failp', FAIL_PERSONAL_TITLE, RH139_ARTIST)
const failBandPage = oneTrackPageFor('rh139failb', FAIL_BAND_TITLE, RH139_ARTIST)
const okPersonalPage = oneTrackPageFor('rh139okp', OK_PERSONAL_TITLE, RH139_ARTIST)

const oneTrackPage = oneTrackPageFor('rh36track1', TRACK_TITLE, TRACK_ARTIST)
const bandTrackPage = oneTrackPageFor('rh36bandtrack1', BAND_TRACK_TITLE, BAND_TRACK_ARTIST)

describe.skipIf(!RUN_DB_TESTS)('the Spotify pull resync (real database)', () => {
  const suffix = Date.now()

  let ownerId: string
  let memberOneId: string
  let memberTwoId: string
  let bandId: string
  let playlistId: string
  let bandPlaylistId: string
  let songOneId: string
  let songTwoId: string
  let versionOneId: string
  let versionTwoId: string

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

  const mockPage = (page: unknown) =>
    fetchSpy.mockImplementation(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(page) } as Response),
    )

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

    ownerId = await createTestUser({ email: `rh36-sync-owner-${suffix}@example.com` })
    memberOneId = await createTestUser({ email: `rh36-sync-m1-${suffix}@example.com` })
    memberTwoId = await createTestUser({ email: `rh36-sync-m2-${suffix}@example.com` })

    bandId = await createBand(ownerId, `RH-36 Sync Band ${suffix}`, null, null)
    for (const member of [memberOneId, memberTwoId]) {
      await query("INSERT INTO band_members (band_id, user_id, role) VALUES ($1, $2, 'member')", [
        bandId,
        member,
      ])
    }

    const songOne = await one(
      'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id',
      [`RH-36 Existing One ${suffix}`, 'RH-36 Artist'],
    )
    songOneId = songOne.id as string
    const songTwo = await one(
      'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id',
      [`RH-36 Existing Two ${suffix}`, 'RH-36 Artist'],
    )
    songTwoId = songTwo.id as string

    const personal = await one(
      `INSERT INTO playlists (user_id, name, spotify_playlist_id, sync_with_spotify)
       VALUES ($1, $2, 'rh36-spotify-p', true) RETURNING id`,
      [ownerId, `RH-36 Personal Playlist ${suffix}`],
    )
    playlistId = personal.id as string
    // RH-125: a playlist entry names a version, so each song's representative
    // one is resolved first.
    versionOneId = await representativeVersionId(songOneId)
    versionTwoId = await representativeVersionId(songTwoId)
    await query(
      'INSERT INTO playlist_songs (playlist_id, version_id, position) VALUES ($1, $2, 1), ($1, $3, 2)',
      [playlistId, versionOneId, versionTwoId],
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
      if (user) await deleteTestUser(user)
    }
    for (const song of [songOneId, songTwoId]) {
      if (song) await query('DELETE FROM songs WHERE id = $1', [song])
    }
    await query('DELETE FROM songs WHERE title = $1 AND artist = $2', [
      TRACK_TITLE,
      TRACK_ARTIST,
    ])
    await query('DELETE FROM songs WHERE title = $1 AND artist = $2', [
      BAND_TRACK_TITLE,
      BAND_TRACK_ARTIST,
    ])
    await query('DELETE FROM songs WHERE artist = $1', [RH139_ARTIST])
    await query('DROP FUNCTION IF EXISTS rh36_sync_raise() CASCADE')
  })

  it('a failing playlist_songs insert leaves the original playlist rows intact', async () => {
    await query(
      `CREATE TRIGGER rh36_fail_playlist_songs BEFORE INSERT ON playlist_songs
       FOR EACH ROW WHEN (NEW.playlist_id = '${playlistId}') EXECUTE FUNCTION rh36_sync_raise()`,
    )
    installedTriggers.push('rh36_fail_playlist_songs')

    asUser(ownerId)
    mockPage(failPersonalPage)

    const response = await callSync(playlistId)
    expect(response.status).toBe(500)

    // RH-139: the repertoire seeding rolls back with the playlist rewrite.
    const pulled = await query('SELECT id FROM songs WHERE title = $1 AND artist = $2', [
      FAIL_PERSONAL_TITLE,
      RH139_ARTIST,
    ])
    expect(pulled.rows).toHaveLength(1)
    const heldPersonally = await one(
      `SELECT count(*)::int AS count FROM ${OWNER_SONG_FROM.user}
       WHERE v.song_id = $1 AND o.user_id = $2`,
      [pulled.rows[0].id, ownerId],
    )
    expect(heldPersonally.count).toBe(0)

    // The DELETE that precedes the re-insert is rolled back with it, so the
    // playlist still holds exactly what it held before the sync.
    const rows = await query(
      'SELECT version_id, position FROM playlist_songs WHERE playlist_id = $1 ORDER BY position',
      [playlistId],
    )
    expect(rows.rows).toEqual([
      { version_id: versionOneId, position: 1 },
      { version_id: versionTwoId, position: 2 },
    ])

    const playlist = await one('SELECT last_synced_at FROM playlists WHERE id = $1', [playlistId])
    expect(playlist.last_synced_at).toBeNull()
  })

  it('seeds the band row and no member row on a pull', async () => {
    asUser(ownerId)
    fetchSpy.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(bandTrackPage),
      } as Response),
    )

    const response = await callSync(bandPlaylistId)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ added: 1, removed: 0 })

    const song = await one('SELECT id FROM songs WHERE title = $1 AND artist = $2', [
      BAND_TRACK_TITLE,
      BAND_TRACK_ARTIST,
    ])
    const syncedSongId = song.id as string

    const bandRows = await one(
      `SELECT count(*)::int AS count FROM ${OWNER_SONG_FROM.band}
       WHERE v.song_id = $1 AND o.band_id = $2`,
      [syncedSongId, bandId],
    )
    expect(bandRows.count).toBe(1)

    // RH-126: counted over every user, not just the admin who pulled. The band
    // has three members and none of them holds the song personally — a pull
    // into a band playlist is a band write and nothing else.
    const memberRows = await one(
      `SELECT count(*)::int AS count FROM ${OWNER_SONG_FROM.user} WHERE v.song_id = $1`,
      [syncedSongId],
    )
    expect(memberRows.count).toBe(0)
  })

  it('a failing playlist_songs insert on a band pull leaves no band_songs row', async () => {
    await query(
      `CREATE TRIGGER rh139_fail_band_playlist_songs BEFORE INSERT ON playlist_songs
       FOR EACH ROW WHEN (NEW.playlist_id = '${bandPlaylistId}') EXECUTE FUNCTION rh36_sync_raise()`,
    )
    installedTriggers.push('rh139_fail_band_playlist_songs')

    asUser(ownerId)
    mockPage(failBandPage)

    const response = await callSync(bandPlaylistId)
    expect(response.status).toBe(500)

    const pulled = await query('SELECT id FROM songs WHERE title = $1 AND artist = $2', [
      FAIL_BAND_TITLE,
      RH139_ARTIST,
    ])
    expect(pulled.rows).toHaveLength(1)
    const bandRows = await one(
      `SELECT count(*)::int AS count FROM ${OWNER_SONG_FROM.band}
       WHERE v.song_id = $1 AND o.band_id = $2`,
      [pulled.rows[0].id, bandId],
    )
    expect(bandRows.count).toBe(0)
  })

  it('a successful personal pull seeds the caller row and answers added/removed', async () => {
    asUser(ownerId)
    mockPage(okPersonalPage)

    const response = await callSync(playlistId)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ added: 1, removed: 2 })

    const song = await one('SELECT id FROM songs WHERE title = $1 AND artist = $2', [
      OK_PERSONAL_TITLE,
      RH139_ARTIST,
    ])
    const held = await one(
      `SELECT count(*)::int AS count FROM ${OWNER_SONG_FROM.user}
       WHERE v.song_id = $1 AND o.user_id = $2`,
      [song.id, ownerId],
    )
    expect(held.count).toBe(1)
  })
})

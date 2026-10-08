/**
 * RH-135 — the Spotify push actually sends the playlist's track URIs.
 *
 * The defect this suite exists for: the push read a song's Spotify link by the
 * lowercase label "spotify", a spelling **no writer in `src/` produces**, so
 * `uris` was built empty for every song and the route answered success having
 * pushed nothing. Three fixtures in `spotify.test.ts` hid it by writing that
 * exact label into a `songs.links` SQL fixture themselves — the test supplied
 * the input in the one form the reader wanted.
 *
 * So this suite never writes a links column by hand. Every song it pushes gets
 * its link through a **real write path**, and the assertion is on the outbound
 * `PUT .../tracks` body. RH-136 moved a link out of the `songs.links` column
 * and into `song_links` rows, so the suite covers **all four** paths by which a
 * Spotify url reaches a song, because each one would have gone silently empty
 * on its own: `findOrCreateSong` (the Spotify pull), `createAndAddSong` (the
 * song picker, `src/hooks/useSongPicker.ts:197`), `applySongLinkUpdate` (the
 * Fast View link editor) and `updateSong` (the song form).
 *
 * RH-137 then keyed the route's query off `song_links.provider`, so these four
 * cases now read the rows the four writers wrote, with no column and no bridge
 * trigger in between. They are unchanged by that re-key — assertion for
 * assertion — which is what makes them the discriminating end-to-end check:
 * every one of them went through a real write path, so a push that resolved
 * nothing would show up here and nowhere else.
 *
 * Only the session, the Spotify token and `fetch` are mocked, as in
 * `spotifySyncAtomicity.db.test.ts`; everything else is the real handler
 * writing real rows.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// The only mocked seams — everything else is the real handler on real rows.
vi.mock('@/lib/auth-session', () => ({ getRequiredUserId: vi.fn() }))
vi.mock('@/lib/spotifyAuth', () => ({ getSpotifyAccessToken: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { POST as syncPOST } from '@/app/api/spotify/playlists/[id]/sync/route'
import { query } from '@/lib/db'
import { createAndAddSong, updateSong } from '@/lib/ownerSongs'
import { findOrCreateSong } from '@/lib/spotifyPlaylistSync'
import { applySongLinkUpdate } from '@/lib/songs'
import { getSpotifyAccessToken } from '@/lib/spotifyAuth'
import { getRequiredUserId } from '@/lib/auth-session'
import {
  createTestUser,
  deleteTestUser,
  representativeVersionId,
} from '@/lib/__tests__/test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

/** The two track ids whose URIs must reach Spotify, and the ignored third. */
const TRACK_ID_A = 'rh135pulledtrackaaa'
const TRACK_ID_B = 'rh135pickedtrackbbb'
/** Added through the Fast View link editor, the third write path (RH-136). */
const TRACK_ID_D = 'rh136fastviewtrackd'
/** Added through the song form's catalog fill, the fourth writer (RH-136). */
const TRACK_ID_E = 'rh136songformtracke'

const SPOTIFY_PLAYLIST_ID = 'rh135-spotify-playlist'

interface PutCall {
  url: string
  body: { uris?: unknown }
}

describe.skipIf(!RUN_DB_TESTS)('the Spotify push (real database, real write paths)', () => {
  const suffix = Date.now()

  const TITLE_A = `RH-135 Pulled Song ${suffix}`
  const TITLE_B = `RH-135 Picked Song ${suffix}`
  const TITLE_C = `RH-135 Lyrics Only Song ${suffix}`
  const TITLE_D = `RH-136 Fast View Song ${suffix}`
  const TITLE_E = `RH-136 Song Form Song ${suffix}`
  const ARTIST = `RH-135 Artist ${suffix}`

  let ownerId: string
  let versionAId: string
  let versionBId: string
  let versionCId: string
  let versionDId: string
  let versionEId: string
  const createdSongIds: string[] = []
  const createdPlaylistIds: string[] = []

  let fetchSpy: ReturnType<typeof vi.spyOn>
  let putCalls: PutCall[]
  let postCalls: PutCall[]

  /** A playlist linked to Spotify, holding `versionIds` in the order given. */
  const seedPlaylist = async (name: string, versionIds: string[]): Promise<string> => {
    const res = await query<{ id: string }>(
      `INSERT INTO playlists (user_id, name, spotify_playlist_id, sync_with_spotify)
       VALUES ($1, $2, $3, true) RETURNING id`,
      [ownerId, name, SPOTIFY_PLAYLIST_ID],
    )
    const playlistId = res.rows[0].id
    createdPlaylistIds.push(playlistId)
    for (const [index, versionId] of versionIds.entries()) {
      await query(
        'INSERT INTO playlist_songs (playlist_id, version_id, position) VALUES ($1, $2, $3)',
        [playlistId, versionId, index + 1],
      )
    }
    return playlistId
  }

  const callPush = (id: string) =>
    syncPOST(
      new NextRequest(new URL(`http://localhost/api/spotify/playlists/${id}/sync`), {
        method: 'POST',
        body: JSON.stringify({ direction: 'push' }),
      }),
      { params: Promise.resolve({ id }) },
    )

  beforeAll(async () => {
    ownerId = await createTestUser({ email: `rh135-push-owner-${suffix}@example.com` })

    // Song A — the Spotify pull's write path. `findOrCreateSong` stores the
    // link labelled with the song's own **title**, never 'spotify'.
    const songA = await findOrCreateSong({
      spotifyTrackId: TRACK_ID_A,
      title: TITLE_A,
      artist: ARTIST,
      album: 'RH-135 Album A',
      albumArt: null,
      spotifyUrl: `https://open.spotify.com/track/${TRACK_ID_A}`,
      durationSeconds: 180,
    })
    createdSongIds.push(songA.songId)
    versionAId = songA.versionId

    // Song B — the song picker's write path, with the payload shape
    // `src/hooks/useSongPicker.ts:197` builds for a Spotify candidate.
    const songB = await createAndAddSong(
      { userId: ownerId },
      {
        title: TITLE_B,
        artist: ARTIST,
        album: 'RH-135 Album B',
        links: [{ label: 'Spotify', url: `https://open.spotify.com/track/${TRACK_ID_B}` }],
      },
    )
    createdSongIds.push(songB.song_id)
    versionBId = await representativeVersionId(songB.song_id)

    // Song C — same write path, but its only link is not a Spotify URL.
    const songC = await createAndAddSong(
      { userId: ownerId },
      {
        title: TITLE_C,
        artist: ARTIST,
        album: 'RH-135 Album C',
        links: [{ label: 'Lyrics', url: 'https://genius.com/x' }],
      },
    )
    createdSongIds.push(songC.song_id)
    versionCId = await representativeVersionId(songC.song_id)

    // Song D — the Fast View add-link path (`applySongLinkUpdate`), the third
    // way a Spotify url reaches a song. It is here because RH-136 moved the
    // links write off `songs.links` while the push still read that column, so
    // until RH-137 only the reverse bridge trigger kept this path pushable.
    // Since RH-137 the push reads the `song_links` row this writer created
    // directly. Either way, a regression here is this song's `uris` entry going
    // missing while the push answers 200 with `{added: 1}` — success, having
    // pushed one track of two.
    const songD = await createAndAddSong(
      { userId: ownerId },
      { title: TITLE_D, artist: ARTIST, album: 'RH-135 Album D' },
    )
    createdSongIds.push(songD.song_id)
    versionDId = await representativeVersionId(songD.song_id)
    await applySongLinkUpdate(ownerId, songD.song_id, [
      { label: 'Fast View Added', url: `https://open.spotify.com/track/${TRACK_ID_D}` },
    ])

    // Song E — the song form's write path (`updateSong` -> `applyCatalogFill`),
    // the fourth and last links writer. Created with no links, so the proposed
    // link is a *fill* rather than a refused overwrite.
    const songE = await createAndAddSong(
      { userId: ownerId },
      { title: TITLE_E, artist: ARTIST, album: 'RH-135 Album E' },
    )
    createdSongIds.push(songE.song_id)
    versionEId = await representativeVersionId(songE.song_id)
    await updateSong({ userId: ownerId }, songE, {
      title: TITLE_E,
      artist: ARTIST,
      key: null,
      status: songE.status,
      tags: [],
      links: [{ label: 'Song Form Added', url: `https://open.spotify.com/track/${TRACK_ID_E}` }],
    })
  })

  beforeEach(() => {
    vi.mocked(getRequiredUserId).mockResolvedValue(ownerId)
    vi.mocked(getSpotifyAccessToken).mockResolvedValue('rh135-access-token')

    putCalls = []
    postCalls = []
    fetchSpy?.mockRestore()
    fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((input: unknown, init?: unknown) => {
      const url = typeof input === 'string' ? input : String((input as { url: string }).url)
      const options = (init ?? {}) as { method?: string; body?: string }
      const call: PutCall = { url, body: JSON.parse(options.body ?? '{}') }
      if (options.method === 'PUT') putCalls.push(call)
      if (options.method === 'POST') postCalls.push(call)
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response)
    })
  })

  afterAll(async () => {
    fetchSpy?.mockRestore()

    if (createdPlaylistIds.length > 0) {
      await query('DELETE FROM playlist_songs WHERE playlist_id = ANY($1)', [createdPlaylistIds])
      await query('DELETE FROM playlists WHERE id = ANY($1)', [createdPlaylistIds])
    }
    if (ownerId) await deleteTestUser(ownerId)
    if (createdSongIds.length > 0) {
      await query('DELETE FROM songs WHERE id = ANY($1)', [createdSongIds])
      // The albums the real write paths invented along the way. Deleting the
      // songs cascades to `song_versions` but leaves these behind, and they
      // accumulate one set per run (`catalogVersions.db.test.ts` cleans its
      // own for the same reason). Scoped to albums no surviving version
      // references, so a concurrent suite's album is never touched.
      await query(
        `DELETE FROM albums a
          WHERE a.name LIKE $1
            AND NOT EXISTS (SELECT 1 FROM song_versions v WHERE v.album_id = a.id)`,
        [`RH-135 Album%`],
      )
    }
  })

  it('sends the track URIs of songs created through the real write paths, in playlist position order', async () => {
    const playlistId = await seedPlaylist(`RH-135 Push Playlist ${suffix}`, [
      versionAId,
      versionBId,
    ])

    const response = await callPush(playlistId)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ added: 2, removed: 0 })

    const put = putCalls.find((call) =>
      call.url.includes(`https://api.spotify.com/v1/playlists/${SPOTIFY_PLAYLIST_ID}/tracks`),
    )
    expect(put).toBeDefined()
    expect(put!.body.uris).toEqual([`spotify:track:${TRACK_ID_A}`, `spotify:track:${TRACK_ID_B}`])
    expect(postCalls).toHaveLength(0)
  })

  it('skips a song whose only link is a non-Spotify URL without failing the push', async () => {
    // Song C sits *between* A and B, so a skip that shifted the order would
    // show up in the assertion as well as in the length.
    const playlistId = await seedPlaylist(`RH-135 Push Playlist With Gap ${suffix}`, [
      versionAId,
      versionCId,
      versionBId,
    ])

    const response = await callPush(playlistId)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ added: 2, removed: 0 })

    const put = putCalls.find((call) =>
      call.url.includes(`https://api.spotify.com/v1/playlists/${SPOTIFY_PLAYLIST_ID}/tracks`),
    )
    expect(put).toBeDefined()
    expect(put!.body.uris).toEqual([`spotify:track:${TRACK_ID_A}`, `spotify:track:${TRACK_ID_B}`])
  })

  it('sends the track URI of a link added through the Fast View editor', async () => {
    const playlistId = await seedPlaylist(`RH-136 Push Playlist Fast View ${suffix}`, [
      versionAId,
      versionDId,
    ])

    const response = await callPush(playlistId)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ added: 2, removed: 0 })

    const put = putCalls.find((call) =>
      call.url.includes(`https://api.spotify.com/v1/playlists/${SPOTIFY_PLAYLIST_ID}/tracks`),
    )
    expect(put).toBeDefined()
    expect(put!.body.uris).toEqual([`spotify:track:${TRACK_ID_A}`, `spotify:track:${TRACK_ID_D}`])
  })

  it('sends the track URI of a link filled in through the song form', async () => {
    const playlistId = await seedPlaylist(`RH-136 Push Playlist Song Form ${suffix}`, [
      versionAId,
      versionEId,
    ])

    const response = await callPush(playlistId)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ added: 2, removed: 0 })

    const put = putCalls.find((call) =>
      call.url.includes(`https://api.spotify.com/v1/playlists/${SPOTIFY_PLAYLIST_ID}/tracks`),
    )
    expect(put).toBeDefined()
    expect(put!.body.uris).toEqual([`spotify:track:${TRACK_ID_A}`, `spotify:track:${TRACK_ID_E}`])
  })
})

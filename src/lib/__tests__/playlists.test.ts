import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { OWNER_SONG_FROM, createTestUser, deleteTestUser, seedOwnerSong } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''
const skip = !RUN_DB_TESTS

/**
 * RH-45 — `query` becomes a pass-through spy over the real implementation, so
 * every statement in this file still runs against Postgres. Only one case needs
 * it: `getPlaylistDetailsWithEntries`' `?? 'Playlist'` fallback fires when the
 * playlist row vanishes between the access check and the name read, which a
 * real database cannot produce.
 */
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>()
  return { ...actual, query: vi.fn(actual.query) }
})

// Import the module under test after vi.mock so the mock is applied
import {
  getUserPlaylists,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  addSongToPlaylist,
  removeSongFromPlaylist,
  getPlaylistWithSongs,
  getPlaylistDetailsWithEntries,
} from '../playlists'
import { createBand } from '../bands'
import { query } from '@/lib/db'

describe.skipIf(skip)('playlists integration tests', () => {
  const suffix = Date.now()
  const USER_A = { email: `test-playlist-a-${suffix}@example.com` }
  const USER_B = { email: `test-playlist-b-${suffix}@example.com` }

  let userAId: string
  let userBId: string

  // Track IDs for clean up
  const createdPlaylists: string[] = []
  const createdSongs: string[] = []
  const createdBands: string[] = []

  beforeAll(async () => {
    userAId = await createTestUser({ email: USER_A.email })
    userBId = await createTestUser({ email: USER_B.email })
  })

  afterAll(async () => {
    // Delete playlist songs + playlists (before user cascade)
    if (createdPlaylists.length > 0) {
      await query('DELETE FROM playlist_songs WHERE playlist_id = ANY($1)', [createdPlaylists])
      await query('DELETE FROM playlists WHERE id = ANY($1)', [createdPlaylists])
    }
    // Delete bands
    if (createdBands.length > 0) {
      await query('DELETE FROM band_members WHERE band_id = ANY($1)', [createdBands])
      await query('DELETE FROM bands WHERE id = ANY($1)', [createdBands])
    }
    // Delete global songs
    if (createdSongs.length > 0) {
      await query('DELETE FROM songs WHERE id = ANY($1)', [createdSongs])
    }
    // Delete users (CASCADE handles repertoire, profiles, etc.)
    if (userAId) await deleteTestUser(userAId)
    if (userBId) await deleteTestUser(userBId)
  })

  it('should successfully create, read, update, and delete a playlist', async () => {
    // 1. Create playlist
    const playlistName = `My Playlist ${suffix}`
    const playlistDesc = `Description for My Playlist`
    const playlist = await createPlaylist(userAId, { name: playlistName, description: playlistDesc })

    expect(playlist).toBeDefined()
    expect(playlist.id).toBeDefined()
    expect(playlist.name).toBe(playlistName)
    expect(playlist.description).toBe(playlistDesc)
    expect(playlist.user_id).toBe(userAId)

    createdPlaylists.push(playlist.id)

    // 2. Get playlist with songs (currently empty)
    const playlistWithSongs = await getPlaylistWithSongs(playlist.id, userAId)
    expect(playlistWithSongs).not.toBeNull()
    expect(playlistWithSongs!.id).toBe(playlist.id)
    expect(playlistWithSongs!.name).toBe(playlistName)
    expect(playlistWithSongs!.songs).toBeDefined()
    expect(playlistWithSongs!.songs!.length).toBe(0)

    // 3. Get user playlists — only User A's playlists returned (explicit userId filter)
    const playlists = await getUserPlaylists(userAId)
    expect(playlists).toBeDefined()
    expect(playlists.length).toBeGreaterThanOrEqual(1)
    const found = playlists.find((p) => p.id === playlist.id)
    expect(found).toBeDefined()
    expect(found!.name).toBe(playlistName)

    // 4. Update playlist
    const newName = `Updated Playlist Name ${suffix}`
    const newDesc = `Updated description`
    await updatePlaylist(playlist.id, userAId, {
      name: newName,
      description: newDesc,
      sync_with_spotify: true,
      tags: ['rock', 'alternative'],
    })

    // Fetch and verify update
    const updatedPlaylist = await getPlaylistWithSongs(playlist.id, userAId)
    expect(updatedPlaylist).not.toBeNull()
    expect(updatedPlaylist!.name).toBe(newName)
    expect(updatedPlaylist!.description).toBe(newDesc)
    expect(updatedPlaylist!.sync_with_spotify).toBe(true)
    expect(updatedPlaylist!.tags).toContain('rock')

    // 5. Delete playlist
    await deletePlaylist(playlist.id, userAId)

    // Verify it is gone
    const deletedPlaylist = await getPlaylistWithSongs(playlist.id, userAId)
    expect(deletedPlaylist).toBeNull()

    const playlistsAfterDelete = await getUserPlaylists(userAId)
    const foundAfterDelete = playlistsAfterDelete.find((p) => p.id === playlist.id)
    expect(foundAfterDelete).toBeUndefined()
  })

  it('should successfully add and remove songs to/from a playlist', async () => {
    // 1. Create a test global song first
    const songTitle = `Playlist Song ${suffix}`
    const songInsert = await query<{ id: string }>(
      `INSERT INTO songs (title, artist, album, duration_seconds, links)
       VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`,
      [songTitle, 'Test Artist', 'Test Album', 240, JSON.stringify([])],
    )
    const songId = songInsert.rows[0].id
    createdSongs.push(songId)

    // 2. Create playlist for User A
    const playlist = await createPlaylist(userAId, { name: `Songs Playlist ${suffix}` })
    createdPlaylists.push(playlist.id)

    // 3. Add song to playlist
    await addSongToPlaylist(playlist.id, userAId, songId)

    // Verify song is added
    const playlistWithSongs = await getPlaylistWithSongs(playlist.id, userAId)
    expect(playlistWithSongs).not.toBeNull()
    expect(playlistWithSongs!.songs).toBeDefined()
    expect(playlistWithSongs!.songs!.length).toBe(1)
    expect(playlistWithSongs!.songs![0].song_id).toBe(songId)
    expect(playlistWithSongs!.songs![0].position).toBe(1)
    expect(playlistWithSongs!.songs![0].song).toBeDefined()
    expect(playlistWithSongs!.songs![0].song!.title).toBe(songTitle)
    expect(playlistWithSongs!.songs![0].song!.duration_seconds).toBe(240)

    // 4. Remove song from playlist
    await removeSongFromPlaylist(playlist.id, userAId, songId)

    // Verify song is removed
    const playlistEmpty = await getPlaylistWithSongs(playlist.id, userAId)
    expect(playlistEmpty).not.toBeNull()
    expect(playlistEmpty!.songs!.length).toBe(0)
  })

  it('should isolate playlists by userId (getUserPlaylists only returns own playlists)', async () => {
    // Create playlists for both users
    const playlistA = await createPlaylist(userAId, { name: `User A Playlist ${suffix}` })
    createdPlaylists.push(playlistA.id)
    const playlistB = await createPlaylist(userBId, { name: `User B Playlist ${suffix}` })
    createdPlaylists.push(playlistB.id)

    // getUserPlaylists(userAId) must NOT return User B's playlist
    const playlistsA = await getUserPlaylists(userAId)
    const foundBinA = playlistsA.find((p) => p.id === playlistB.id)
    expect(foundBinA).toBeUndefined()

    // getUserPlaylists(userBId) must NOT return User A's playlist
    const playlistsB = await getUserPlaylists(userBId)
    const foundAinB = playlistsB.find((p) => p.id === playlistA.id)
    expect(foundAinB).toBeUndefined()
  })

  /**
   * UC3.2, plus RH-124's two additions to it.
   *
   * ER20 — the **dual write is unchanged**: an admin adding a song to a band
   * playlist still produces both the `band_songs` row and the caller's own
   * `user_songs` row. That second write is wrong under *Add a song to a
   * playlist* and deleting it is RH-126's whole deliverable, so it is asserted
   * here as the current, deliberate behaviour rather than removed.
   *
   * ER19 — the band branch now requires band admin. User A administers the
   * band; the member case is the test that follows.
   */
  it('should autogest repertoire and propagate to members when adding song to a band playlist (UC3.2)', async () => {
    // 1. Create a band directly, to set it up easily
    const bandInsert = await query<{ id: string }>(
      'INSERT INTO bands (name, description) VALUES ($1, $2) RETURNING id',
      [`Band Playlists ${suffix}`, 'Test band for playlists autogestion'],
    )
    const bandId = bandInsert.rows[0].id
    createdBands.push(bandId)

    // 2. Add User A (admin) and User B (member) to the band members list
    await query(
      `INSERT INTO band_members (band_id, user_id, role)
       VALUES ($1, $2, 'admin'), ($1, $3, 'member')`,
      [bandId, userAId, userBId],
    )

    // 3. Create a band playlist directly
    const playlistInsert = await query<{ id: string }>(
      'INSERT INTO playlists (band_id, name) VALUES ($1, $2) RETURNING id',
      [bandId, `Band Setlist ${suffix}`],
    )
    const playlistId = playlistInsert.rows[0].id
    createdPlaylists.push(playlistId)

    // 4. Create a global song
    const songTitle = `Autogest Song ${suffix}`
    const songInsert = await query<{ id: string }>(
      'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id',
      [songTitle, 'Band Autogest Artist'],
    )
    const songId = songInsert.rows[0].id
    createdSongs.push(songId)

    // 5. User A adds the song to the band playlist
    await addSongToPlaylist(playlistId, userAId, songId)

    // 6. Verify that:
    // A. The song was added to the band repertoire
    const bandRep = await query<{ id: string }>(
      `SELECT o.id FROM band_songs o
       JOIN song_versions v ON v.id = o.version_id
       WHERE o.band_id = $1 AND v.song_id = $2`,
      [bandId, songId],
    )
    expect(bandRep.rows).toHaveLength(1)

    // B. The song was automatically propagated to User A's personal repertoire
    const userARep = await query<{ id: string }>(
      `SELECT o.id FROM user_songs o
       JOIN song_versions v ON v.id = o.version_id
       WHERE o.user_id = $1 AND v.song_id = $2`,
      [userAId, songId],
    )
    expect(userARep.rows).toHaveLength(1)

    // C. The song was NOT automatically propagated to User B's personal repertoire (correct for client-side RLS)
    const userBRep = await query<{ id: string }>(
      `SELECT o.id FROM user_songs o
       JOIN song_versions v ON v.id = o.version_id
       WHERE o.user_id = $1 AND v.song_id = $2`,
      [userBId, songId],
    )
    expect(userBRep.rows).toHaveLength(0)

    // D. The song is in the playlist songs list
    const playlistWithSongs = await getPlaylistWithSongs(playlistId, userAId)
    expect(playlistWithSongs).not.toBeNull()
    expect(playlistWithSongs!.songs).toBeDefined()
    expect(playlistWithSongs!.songs!.length).toBe(1)
    expect(playlistWithSongs!.songs![0].song_id).toBe(songId)
  })

  /**
   * RH-124 ER19 — adding a song to a **band** playlist is a band write, so it
   * requires band admin. `assertPlaylistAccess` is unchanged: it answers "may
   * this caller see this playlist", which is member-level and is also the
   * Spotify read guard. The role check sits at this call site, with the same
   * message RH-103 uses for reordering, and nothing is written.
   *
   * This is a deliberate behaviour change: before this task any member could
   * add to a band playlist, and the band repertoire row that appeared was the
   * whole point.
   */
  it('refuses a non-admin member adding to a band playlist, writing neither row (RH-124 ER19)', async () => {
    const band = await query<{ id: string }>(
      'INSERT INTO bands (name) VALUES ($1) RETURNING id',
      [`Band Gate ${suffix}`],
    )
    const bandId = band.rows[0].id
    createdBands.push(bandId)
    await query(
      `INSERT INTO band_members (band_id, user_id, role)
       VALUES ($1, $2, 'admin'), ($1, $3, 'member')`,
      [bandId, userAId, userBId],
    )

    const playlist = await query<{ id: string }>(
      'INSERT INTO playlists (band_id, name) VALUES ($1, $2) RETURNING id',
      [bandId, `Band Gate Setlist ${suffix}`],
    )
    const playlistId = playlist.rows[0].id
    createdPlaylists.push(playlistId)

    const song = await query<{ id: string }>(
      'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id',
      [`Gate Song ${suffix}`, 'Gate Artist'],
    )
    const songId = song.rows[0].id
    createdSongs.push(songId)

    await expect(addSongToPlaylist(playlistId, userBId, songId)).rejects.toThrow(
      'Access denied: band admin required',
    )

    const bandRows = await query(
      `SELECT o.id FROM ${OWNER_SONG_FROM.band} WHERE o.band_id = $1 AND v.song_id = $2`,
      [bandId, songId],
    )
    expect(bandRows.rows).toHaveLength(0)
    const entries = await query('SELECT id FROM playlist_songs WHERE playlist_id = $1', [playlistId])
    expect(entries.rows).toHaveLength(0)

    // The same call as the band's admin succeeds, and produces both rows.
    await addSongToPlaylist(playlistId, userAId, songId)
    expect(
      (
        await query(
          `SELECT o.id FROM ${OWNER_SONG_FROM.band} WHERE o.band_id = $1 AND v.song_id = $2`,
          [bandId, songId],
        )
      ).rows,
    ).toHaveLength(1)
    expect(
      (
        await query(
          `SELECT o.id FROM ${OWNER_SONG_FROM.user} WHERE o.user_id = $1 AND v.song_id = $2`,
          [userAId, songId],
        )
      ).rows,
    ).toHaveLength(1)
  })

  // -------------------------------------------------------------------------
  // RH-45 — the playlist detail read moved out of src/app/actions/playlists.ts,
  // together with both of the authorization calls that used to sit above it.
  // -------------------------------------------------------------------------

  describe('getPlaylistDetailsWithEntries', () => {
    let personalPlaylistId: string
    let bandPlaylistId: string
    let bandId: string
    let foreignBandId: string
    let firstSongId: string
    let secondSongId: string

    const insertSong = async (title: string, artist: string): Promise<string> => {
      const res = await query(
        'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id',
        [title, artist],
      )
      const id = res.rows[0].id as string
      createdSongs.push(id)
      return id
    }

    beforeAll(async () => {
      firstSongId = await insertSong(`RH-45 Detail One ${suffix}`, 'Detail Artist')
      secondSongId = await insertSong(`RH-45 Detail Two ${suffix}`, 'Other Artist')

      bandId = await createBand(userAId, `RH-45 Detail Band ${suffix}`, null, null)
      createdBands.push(bandId)
      foreignBandId = await createBand(userBId, `RH-45 Foreign Band ${suffix}`, null, null)
      createdBands.push(foreignBandId)

      const personal = await query(
        'INSERT INTO playlists (user_id, name) VALUES ($1, $2) RETURNING id',
        [userAId, `RH-45 Personal Detail ${suffix}`],
      )
      personalPlaylistId = personal.rows[0].id as string
      createdPlaylists.push(personalPlaylistId)

      const band = await query('INSERT INTO playlists (band_id, name) VALUES ($1, $2) RETURNING id', [
        bandId,
        `RH-45 Band Detail ${suffix}`,
      ])
      bandPlaylistId = band.rows[0].id as string
      createdPlaylists.push(bandPlaylistId)

      // Deliberately inserted out of order: the read must sort by position.
      for (const [playlistId, songId, position] of [
        [personalPlaylistId, secondSongId, 2],
        [personalPlaylistId, firstSongId, 1],
        [bandPlaylistId, firstSongId, 1],
      ] as const) {
        await query(
          'INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES ($1, $2, $3)',
          [playlistId, songId, position],
        )
      }

      // RH-124: the hold is keyed by a version, so each seeded row points at
      // the song's representative version. `ensureSongHasVersion` is what
      // guarantees these hand-inserted catalog rows have one.
      await seedOwnerSong({ userId: userAId }, firstSongId)
      await seedOwnerSong({ userId: userAId }, secondSongId)
      await seedOwnerSong({ bandId }, firstSongId)
    })

    it('returns the playlist name and its entries ordered by position, for a personal owner', async () => {
      const details = await getPlaylistDetailsWithEntries(personalPlaylistId, userAId)

      expect(details.name).toBe(`RH-45 Personal Detail ${suffix}`)
      expect(details.entries.map((e) => e.songId)).toEqual([firstSongId, secondSongId])
      expect(details.entries[0]).toEqual({
        repertoireId: expect.any(String),
        songId: firstSongId,
        title: `RH-45 Detail One ${suffix}`,
        artist: 'Detail Artist',
      })
      expect(details.entries[1].artist).toBe('Other Artist')
    })

    it('resolves the entries against the band repertoire when a bandId is supplied', async () => {
      const details = await getPlaylistDetailsWithEntries(bandPlaylistId, userAId, bandId)

      expect(details.name).toBe(`RH-45 Band Detail ${suffix}`)
      expect(details.entries.map((e) => e.songId)).toEqual([firstSongId])

      // The repertoire id is the *band's* row, not user A's own for that song.
      const bandRow = await query(
        `SELECT o.id FROM band_songs o
         JOIN song_versions v ON v.id = o.version_id
         WHERE o.band_id = $1 AND v.song_id = $2`,
        [bandId, firstSongId],
      )
      expect(details.entries[0].repertoireId).toBe(bandRow.rows[0].id)
    })

    it('refuses a playlist the caller has no claim on, before reading anything', async () => {
      await expect(getPlaylistDetailsWithEntries(personalPlaylistId, userBId)).rejects.toThrow(
        'Access denied: not allowed on this playlist',
      )
    })

    it('refuses a band owner context the caller does not belong to', async () => {
      await expect(
        getPlaylistDetailsWithEntries(personalPlaylistId, userAId, foreignBandId),
      ).rejects.toThrow('Access denied: not a member of this band')
    })

    it('checks the playlist before the band, so an unrelated caller learns nothing about the band', async () => {
      await expect(
        getPlaylistDetailsWithEntries(personalPlaylistId, userBId, foreignBandId),
      ).rejects.toThrow('Access denied: not allowed on this playlist')
    })

    it("falls back to the name 'Playlist' when the row disappears after the access check", async () => {
      const passThrough = vi.mocked(query).getMockImplementation()!
      vi.mocked(query)
        // 1. assertPlaylistAccess — the real read, so authorization is genuine.
        .mockImplementationOnce(passThrough)
        // 2. the name read — the row is gone by the time it runs.
        .mockImplementationOnce(async () => ({ rowCount: 0, rows: [] }) as never)

      const details = await getPlaylistDetailsWithEntries(personalPlaylistId, userAId)

      expect(details.name).toBe('Playlist')
      expect(details.entries.map((e) => e.songId)).toEqual([firstSongId, secondSongId])
    })

    it('wraps a database failure in the L1 prefix', async () => {
      const passThrough = vi.mocked(query).getMockImplementation()!
      vi.mocked(query)
        .mockImplementationOnce(passThrough)
        .mockImplementationOnce(async () => {
          throw new Error('connection lost')
        })

      await expect(getPlaylistDetailsWithEntries(personalPlaylistId, userAId)).rejects.toThrow(
        'Failed to fetch playlist details: connection lost',
      )
    })
  })
})

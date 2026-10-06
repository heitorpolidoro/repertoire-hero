/**
 * RH-125 — the four playlist reads, against a real Postgres.
 *
 * Its own file rather than more cases in `playlists.test.ts`, on the precedent
 * `playlistReorder.db.test.ts` set for RH-103: that file is at 500 lines of a
 * 800-line budget and these cases need a fixture of their own — a catalog song
 * with **two** versions, one of which the owner does not hold.
 *
 * Three of the four reads are SQL strings, so a missed `ps.song_id` type-checks
 * and fails only at runtime; that is the whole reason this file exists rather
 * than a unit test with a mocked pool.
 *
 *  - **ER9** — `getPlaylistWithSongs` re-points its joins and resolves nothing:
 *    `version_id`, the version's `label`, a `duration_seconds` that is the
 *    version's where it has one and the song's otherwise, and **no** owner-table
 *    column at all. The repertoire map the page already loads is the single
 *    resolved source (spec §4).
 *  - **ER10** — an entry whose owner holds no row is **returned**, not dropped.
 *    The inner `JOIN` is gone; a missing row resolves exactly like a row whose
 *    overrides are all null, and dropping the entry used to collapse the whole
 *    setlist, because `computePlaylistNav` answers `null` when the current song
 *    is not in the list.
 *  - **ER16** — the two playlist-card reads still sum a duration after the
 *    re-key, read through `song_versions`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { query } from '@/lib/db'
import { getBandPlaylists } from '@/lib/bands'
import {
  getPlaylistDetailsWithEntries,
  getPlaylistWithSongs,
  getUserPlaylists,
} from '@/lib/playlists'
import type { PlaylistSong } from '@/types/database'
import { createTestUser, deleteTestUser } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

/** The five columns that would betray an owner-table join in the projection. */
const OWNER_ONLY_KEYS = ['status', 'tags', 'last_practiced', 'key', 'tuning'] as const

describe.skipIf(!RUN_DB_TESTS)('the version-keyed playlist reads (RH-125 ER9, ER10, ER16)', () => {
  const sfx = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`

  let userId: string
  let bandId: string
  let playlistId: string
  let bandPlaylistId: string
  let songId: string
  /** The owner holds this one. Its own duration is null — the song's is 240. */
  let heldVersionId: string
  /** The owner holds **no** row for this one. Its duration is 311. */
  let unheldVersionId: string

  const insertId = async (sql: string, params: unknown[]): Promise<string> =>
    (await query<{ id: string }>(sql, params)).rows[0].id

  beforeAll(async () => {
    userId = await createTestUser({ email: `rh125-reads-${sfx}@example.com` })

    // One catalog song, two recordings of it: the studio take, which the owner
    // holds, and a live take, which they do not. Both in one playlist — which
    // is the shape the dropped `uq_playlist_song (playlist_id, song_id)`
    // refused outright.
    songId = await insertId(
      'INSERT INTO songs (title, artist, duration_seconds) VALUES ($1, $2, 240) RETURNING id',
      [`RH-125 Two Takes ${sfx}`, `RH-125 Artist ${sfx}`],
    )
    const albumId = await insertId(
      `INSERT INTO albums (artist, name, album_type, release_date)
       VALUES ($1, $2, 'album', '1990-01-01') RETURNING id`,
      [`RH-125 Artist ${sfx}`, `RH-125 Album ${sfx}`],
    )
    // `duration_seconds` null on purpose: the read has to fall back to the
    // song's 240 rather than leave the mastery summary's total time blank.
    heldVersionId = await insertId(
      `INSERT INTO song_versions (song_id, album_id, label, duration_seconds)
       VALUES ($1, $2, 'Studio Take', NULL) RETURNING id`,
      [songId, albumId],
    )
    unheldVersionId = await insertId(
      `INSERT INTO song_versions (song_id, album_id, label, duration_seconds)
       VALUES ($1, NULL, 'Live at the Bar', 311) RETURNING id`,
      [songId],
    )

    // The owner's hold on the studio take **only**. The live take is the
    // entry ER10 is about.
    await query(
      "INSERT INTO user_songs (user_id, version_id, status, tags) VALUES ($1, $2, 'polishing', $3)",
      [userId, heldVersionId, ['encore']],
    )

    playlistId = await insertId(
      'INSERT INTO playlists (user_id, name) VALUES ($1, $2) RETURNING id',
      [userId, `RH-125 Setlist ${sfx}`],
    )
    await query(
      'INSERT INTO playlist_songs (playlist_id, version_id, position) VALUES ($1, $2, 1), ($1, $3, 2)',
      [playlistId, heldVersionId, unheldVersionId],
    )

    // ER16's band half: a band playlist holding the live take, whose duration
    // only `song_versions` carries.
    bandId = await insertId('INSERT INTO bands (name) VALUES ($1) RETURNING id', [
      `RH-125 Band ${sfx}`,
    ])
    await query("INSERT INTO band_members (band_id, user_id, role) VALUES ($1, $2, 'admin')", [
      bandId,
      userId,
    ])
    bandPlaylistId = await insertId(
      'INSERT INTO playlists (band_id, name) VALUES ($1, $2) RETURNING id',
      [bandId, `RH-125 Band Setlist ${sfx}`],
    )
    await query(
      'INSERT INTO playlist_songs (playlist_id, version_id, position) VALUES ($1, $2, 1)',
      [bandPlaylistId, unheldVersionId],
    )
  })

  afterAll(async () => {
    for (const id of [playlistId, bandPlaylistId]) {
      if (id) await query('DELETE FROM playlists WHERE id = $1', [id])
    }
    if (bandId) await query('DELETE FROM bands WHERE id = $1', [bandId])
    if (userId) await deleteTestUser(userId)
    if (songId) await query('DELETE FROM songs WHERE id = $1', [songId])
  })

  // -------------------------------------------------------------------------
  // ER9 — getPlaylistWithSongs
  // -------------------------------------------------------------------------

  it('returns both versions of one song, in position order, each with its version_id (ER9)', async () => {
    const playlist = await getPlaylistWithSongs(playlistId, userId)
    const songs = playlist?.songs ?? []

    expect(songs.map((ps) => ps.version_id)).toEqual([heldVersionId, unheldVersionId])
    expect(songs.map((ps) => ps.position)).toEqual([1, 2])
  })

  it("carries the version's label, so two takes of one song are distinguishable (ER9)", async () => {
    const songs = (await getPlaylistWithSongs(playlistId, userId))?.songs ?? []

    expect(songs.map((ps) => ps.label)).toEqual(['Studio Take', 'Live at the Bar'])
    // Both rows carry the same catalog song, which is exactly why the label is
    // projected at all.
    expect(songs.map((ps) => ps.song?.id)).toEqual([songId, songId])
  })

  it("reads the version's duration, falling back to the song's (ER9)", async () => {
    const songs = (await getPlaylistWithSongs(playlistId, userId))?.songs ?? []

    // The studio take records no duration of its own, so the song's 240 shows;
    // the live take records 311, which wins over it.
    expect(songs.map((ps) => ps.song?.duration_seconds)).toEqual([240, 311])
    for (const ps of songs) expect(ps.song?.duration_seconds).not.toBeNull()
  })

  it('projects no owner-table column, so the page has one resolved source (ER9)', async () => {
    const songs = (await getPlaylistWithSongs(playlistId, userId))?.songs ?? []

    for (const ps of songs) {
      const keys = Object.keys(ps as unknown as Record<string, unknown>)
      expect(keys.sort()).toEqual(['id', 'label', 'playlist_id', 'position', 'song', 'version_id'])
      // Nor on the nested song: the owner's status, tags, practice date and
      // key/tuning overrides belong to the repertoire map the page already
      // loads, and a second copy here would be a second answer.
      const songKeys = Object.keys((ps.song ?? {}) as Record<string, unknown>)
      for (const ownerOnly of OWNER_ONLY_KEYS) expect(songKeys).not.toContain(ownerOnly)
      expect(songKeys).not.toContain('repertoire_id')
    }
  })

  // -------------------------------------------------------------------------
  // ER10 — getPlaylistDetailsWithEntries
  // -------------------------------------------------------------------------

  it('returns an entry the owner holds no row for, with repertoireId null (ER10)', async () => {
    const details = await getPlaylistDetailsWithEntries(playlistId, userId)

    expect(details.entries).toHaveLength(2)
    const [first, second] = details.entries
    // In position order, with the title and artist drawn from the catalog.
    expect(first).toMatchObject({
      repertoireId: expect.any(String),
      versionId: heldVersionId,
      songId,
      title: `RH-125 Two Takes ${sfx}`,
      artist: `RH-125 Artist ${sfx}`,
    })
    // The live take: no owner row, so no Fast View address yet (RH-109) — and
    // the entry is still there, with its identity and its display columns.
    expect(second.repertoireId).toBeNull()
    expect(second.versionId).toBe(unheldVersionId)
    expect(second.title).toBe(`RH-125 Two Takes ${sfx}`)
    expect(second.artist).toBe(`RH-125 Artist ${sfx}`)
  })

  it('resolves the owner row on (owner, version_id), not on the song (ER10)', async () => {
    const details = await getPlaylistDetailsWithEntries(playlistId, userId)
    const own = await query<{ id: string }>(
      'SELECT id FROM user_songs WHERE user_id = $1 AND version_id = $2',
      [userId, heldVersionId],
    )

    // The hold is on the studio take, so that entry carries that row's id — and
    // the live take's entry does **not** inherit it, which a song-level join
    // would have made it do.
    expect(details.entries[0].repertoireId).toBe(own.rows[0].id)
    expect(details.entries[1].repertoireId).toBeNull()
  })

  it('returns a band playlist entry the band holds no row for, without throwing (ER10)', async () => {
    const details = await getPlaylistDetailsWithEntries(bandPlaylistId, userId, bandId)

    expect(details.entries).toHaveLength(1)
    expect(details.entries[0]).toMatchObject({
      repertoireId: null,
      versionId: unheldVersionId,
      songId,
    })
  })

  // -------------------------------------------------------------------------
  // ER16 — the two card reads
  // -------------------------------------------------------------------------

  /** The entries of one playlist as the card reads project them. */
  const cardEntries = (songs: PlaylistSong[] | undefined) => songs ?? []

  it('getUserPlaylists sums a duration read through song_versions (ER16)', async () => {
    const playlists = await getUserPlaylists(userId)
    const mine = playlists.find((playlist) => playlist.id === playlistId)

    const durations = cardEntries(mine?.songs)
      .map((ps) => ps.song?.duration_seconds)
      .sort((a, b) => Number(a) - Number(b))
    // 240 from the song (the studio take records none) and 311 from the live
    // take's own column: both non-null, and read through `song_versions`.
    expect(durations).toEqual([240, 311])
  })

  it('getBandPlaylists returns the band entry with the version duration (ER16)', async () => {
    const playlists = await getBandPlaylists(bandId, userId)
    const theirs = playlists.find((playlist) => playlist.id === bandPlaylistId)

    expect(cardEntries(theirs?.songs)).toHaveLength(1)
    expect(cardEntries(theirs?.songs)[0].song?.duration_seconds).toBe(311)
  })
})

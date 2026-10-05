/**
 * RH-103 — `reorderPlaylistSongs` against the real database.
 *
 * Every claim here is a claim about Postgres, so none of it can be proved with
 * a mocked `pg`:
 *
 *  1. (ER4) a five-song playlist reversed in **one** `UPDATE` reads back
 *     positions 1..5 in the reversed order. That only works because
 *     `0012_defer_playlist_song_position.sql` re-declared
 *     `uq_playlist_song_position` as `DEFERRABLE INITIALLY IMMEDIATE`: a plain
 *     unique checks row by row and a permutation is briefly invalid midway.
 *     There is no `SET CONSTRAINTS` anywhere — the deferrable declaration alone
 *     moves the check to the end of the statement.
 *  2. (ER5) a submitted list that is not exactly the playlist's row set is
 *     refused *before* the write, so every position survives. A subset would
 *     otherwise renumber part of the list into places other rows still hold,
 *     and the constraint would reject it at a confusing distance from the bug.
 *  3. (ER6) a band playlist is writable by an `admin` and refused to a
 *     `member`, with the message `src/lib/bands.ts` already uses. The refusal
 *     is raised outside the wrapping `try` (convention L1a), so its text
 *     reaches the UI verbatim rather than behind the L1 prefix.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { query } from '@/lib/db'
import { createBand } from '@/lib/bands'
import { addSongToPlaylist, reorderPlaylistSongs } from '@/lib/playlists'
import { createTestUser, deleteTestUser } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

describe.skipIf(!RUN_DB_TESTS)('reorderPlaylistSongs (real database)', () => {
  const suffix = Date.now()

  let ownerId: string
  let memberId: string
  let bandId: string
  let playlistId: string
  let bandPlaylistId: string
  const songIds: string[] = []

  /** `playlist_songs.id`s of a playlist, in position order. */
  const rowIds = async (id: string): Promise<string[]> => {
    const res = await query<{ id: string }>(
      'SELECT id FROM playlist_songs WHERE playlist_id = $1 ORDER BY position',
      [id],
    )
    return res.rows.map((row) => row.id)
  }

  /** `(id, position)` of every row, keyed by id — what ER5 compares. */
  const positions = async (id: string): Promise<Record<string, number>> => {
    const res = await query<{ id: string; position: number }>(
      'SELECT id, position FROM playlist_songs WHERE playlist_id = $1',
      [id],
    )
    return Object.fromEntries(res.rows.map((row) => [row.id, row.position]))
  }

  beforeAll(async () => {
    ownerId = await createTestUser({ email: `rh103-owner-${suffix}@example.com` })
    memberId = await createTestUser({ email: `rh103-member-${suffix}@example.com` })

    // `createBand` makes its caller the admin; the second user joins as a plain
    // member, which is the role ER6 refuses.
    bandId = await createBand(ownerId, `RH-103 Band ${suffix}`, null, null)
    await query("INSERT INTO band_members (band_id, user_id, role) VALUES ($1, $2, 'member')", [
      bandId,
      memberId,
    ])

    for (const label of ['A', 'B', 'C', 'D', 'E']) {
      const res = await query<{ id: string }>(
        'INSERT INTO global_songs (title, artist) VALUES ($1, $2) RETURNING id',
        [`RH-103 Song ${label} ${suffix}`, 'RH-103 Artist'],
      )
      songIds.push(res.rows[0].id)
    }

    const personal = await query<{ id: string }>(
      'INSERT INTO playlists (user_id, name) VALUES ($1, $2) RETURNING id',
      [ownerId, `RH-103 Personal ${suffix}`],
    )
    playlistId = personal.rows[0].id

    const band = await query<{ id: string }>(
      'INSERT INTO playlists (band_id, name) VALUES ($1, $2) RETURNING id',
      [bandId, `RH-103 Band Playlist ${suffix}`],
    )
    bandPlaylistId = band.rows[0].id

    for (const songId of songIds) {
      await addSongToPlaylist(playlistId, ownerId, songId)
    }
    // Two rows are enough for the band cases: they only ever swap.
    for (const songId of songIds.slice(0, 2)) {
      await addSongToPlaylist(bandPlaylistId, ownerId, songId)
    }
  })

  afterAll(async () => {
    for (const id of [playlistId, bandPlaylistId]) {
      if (id) await query('DELETE FROM playlists WHERE id = $1', [id])
    }
    if (bandId) await query('DELETE FROM bands WHERE id = $1', [bandId])
    for (const user of [ownerId, memberId]) {
      if (user) await deleteTestUser(user)
    }
    for (const songId of songIds) {
      await query('DELETE FROM global_songs WHERE id = $1', [songId])
    }
  })

  it('reverses a five-song playlist in one call and reads back 1..5 (ER4)', async () => {
    const original = await rowIds(playlistId)
    expect(original).toHaveLength(5)

    const reversed = [...original].reverse()
    await reorderPlaylistSongs(playlistId, ownerId, reversed)

    expect(await rowIds(playlistId)).toEqual(reversed)

    const res = await query<{ position: number }>(
      'SELECT position FROM playlist_songs WHERE playlist_id = $1 ORDER BY position',
      [playlistId],
    )
    expect(res.rows.map((row) => row.position)).toEqual([1, 2, 3, 4, 5])

    // Put the fixture back so the ER5 cases below read a known order.
    await reorderPlaylistSongs(playlistId, ownerId, original)
    expect(await rowIds(playlistId)).toEqual(original)
  })

  it.each([
    ['a missing row', (ids: string[]) => ids.slice(0, 4)],
    ['an extra id', (ids: string[]) => [...ids, '00000000-0000-0000-0000-000000000001']],
    ['a duplicated id', (ids: string[]) => [...ids.slice(0, 4), ids[0]]],
  ])('refuses a list with %s and leaves every position unchanged (ER5)', async (_label, mangle) => {
    const before = await positions(playlistId)

    await expect(reorderPlaylistSongs(playlistId, ownerId, mangle(Object.keys(before)))).rejects.toThrow(
      /^Failed to reorder playlist songs/,
    )

    expect(await positions(playlistId)).toEqual(before)
  })

  it('refuses a list naming a row from another playlist (ER5)', async () => {
    const before = await positions(playlistId)
    const foreign = await rowIds(bandPlaylistId)

    await expect(
      reorderPlaylistSongs(playlistId, ownerId, [...Object.keys(before).slice(0, 4), foreign[0]]),
    ).rejects.toThrow(/^Failed to reorder playlist songs/)

    expect(await positions(playlistId)).toEqual(before)
  })

  it('refuses a band playlist to a plain member and changes no position (ER6)', async () => {
    const before = await positions(bandPlaylistId)
    const swapped = [...Object.keys(before)].reverse()

    await expect(reorderPlaylistSongs(bandPlaylistId, memberId, swapped)).rejects.toThrow(
      'Access denied: band admin required',
    )

    expect(await positions(bandPlaylistId)).toEqual(before)
  })

  it('accepts the same band playlist from an admin (ER6)', async () => {
    const original = await rowIds(bandPlaylistId)
    const swapped = [...original].reverse()

    await reorderPlaylistSongs(bandPlaylistId, ownerId, swapped)

    expect(await rowIds(bandPlaylistId)).toEqual(swapped)
  })

  it("accepts a personal playlist from its owner (ER6)", async () => {
    const original = await rowIds(playlistId)
    const rotated = [...original.slice(1), original[0]]

    await reorderPlaylistSongs(playlistId, ownerId, rotated)

    expect(await rowIds(playlistId)).toEqual(rotated)
  })
})

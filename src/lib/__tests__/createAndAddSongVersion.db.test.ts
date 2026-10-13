/**
 * RH-144 — which version a manual add holds when the song already exists.
 *
 * The caller's album decides the version (not the representative ordering), an
 * owner may hold several versions of one song, and only the identical version is
 * "already in" the repertoire. Real Postgres.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { query } from '@/lib/db'
import { addSongToRepertoire, createAndAddSong, getPersonalEntryForSong, getRepertoire } from '@/lib/ownerSongs'
import { createTestUser, deleteTestUser } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

describe.skipIf(!RUN_DB_TESTS)('createAndAddSong holds the resolved version (real database)', () => {
  const suffix = Date.now()
  const artist = `RH-144 Artist ${suffix}`
  let userId: string
  let secondUserId: string
  const createdSongIds: string[] = []

  const rowsFor = async (owner: string, songId: string) =>
    (
      await query<{ version_id: string }>(
        `SELECT uo.version_id FROM user_songs uo JOIN song_versions v ON v.id = uo.version_id
         WHERE uo.user_id = $1 AND v.song_id = $2`,
        [owner, songId],
      )
    ).rows.map((r) => r.version_id)

  /** A catalog song whose single, dated album version is the representative one. */
  const seedSong = async (title: string) => {
    const song = await query<{ id: string }>('INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id', [
      title,
      artist,
    ])
    const songId = song.rows[0].id
    createdSongIds.push(songId)
    const album = await query<{ id: string }>(
      `INSERT INTO albums (artist, name, album_type, release_date)
       VALUES ($1, $2, 'album', '1970-01-01') RETURNING id`,
      [artist, `RH-144 Original ${title}`],
    )
    const version = await query<{ id: string }>(
      'INSERT INTO song_versions (song_id, album_id) VALUES ($1, $2) RETURNING id',
      [songId, album.rows[0].id],
    )
    return { songId, representativeId: version.rows[0].id }
  }

  beforeAll(async () => {
    userId = await createTestUser({ email: `rh144-a-${suffix}@example.com` })
    secondUserId = await createTestUser({ email: `rh144-b-${suffix}@example.com` })
  })

  afterAll(async () => {
    for (const id of [userId, secondUserId]) if (id) await deleteTestUser(id)
    for (const id of createdSongIds) await query('DELETE FROM songs WHERE id = $1', [id])
  })

  it('a first add with a new album holds that album version, not the representative one', async () => {
    const title = `First ${suffix}`
    const { songId, representativeId } = await seedSong(title)
    const entry = await createAndAddSong({ userId }, { title, artist, album: `RH-144 Remaster ${suffix}` })
    expect(entry.song_id).toBe(songId)
    expect(entry.version_id).not.toBe(representativeId)
    const albumVersion = await query<{ id: string }>(
      `SELECT v.id FROM song_versions v JOIN albums a ON a.id = v.album_id
       WHERE v.song_id = $1 AND a.name = $2`,
      [songId, `RH-144 Remaster ${suffix}`],
    )
    expect(await rowsFor(userId, songId)).toEqual([albumVersion.rows[0].id])
  })

  it('holds a second version of the same song, lists both, and probes exactly one', async () => {
    const title = `Both ${suffix}`
    const { songId, representativeId } = await seedSong(title)
    const first = await createAndAddSong({ userId: secondUserId }, { title, artist, album: `RH-144 Live ${suffix}` })
    const second = await createAndAddSong({ userId: secondUserId }, { title, artist, album: `RH-144 Deluxe ${suffix}` })
    expect(second.version_id).not.toBe(first.version_id)
    expect((await rowsFor(secondUserId, songId)).sort()).toEqual([first.version_id, second.version_id].sort())

    const listed = (await getRepertoire({ userId: secondUserId })).filter((e) => e.song_id === songId)
    expect(listed.map((e) => e.version_id).sort()).toEqual([first.version_id, second.version_id].sort())
    expect(new Set(listed.map((e) => e.id)).size).toBe(2)

    const probe = await getPersonalEntryForSong(songId, secondUserId)
    expect(probe).not.toBeNull()
    expect([first.version_id, second.version_id]).toContain(probe!.version_id)
    expect(probe!.version_id).not.toBe(representativeId)
  })

  it('refuses the identical add and leaves the row count unchanged', async () => {
    const title = `Dup ${suffix}`
    const { songId } = await seedSong(title)
    const input = { title, artist, album: `RH-144 Dup Album ${suffix}` }
    await createAndAddSong({ userId }, input)
    await expect(createAndAddSong({ userId }, input)).rejects.toThrow('Song already in your repertoire')
    expect(await rowsFor(userId, songId)).toHaveLength(1)
  })

  it('two concurrent identical adds yield exactly one owner row', async () => {
    const title = `Race ${suffix}`
    const { songId } = await seedSong(title)
    const input = { title, artist, album: `RH-144 Race Album ${suffix}` }
    const results = await Promise.allSettled([
      createAndAddSong({ userId }, input),
      createAndAddSong({ userId }, input),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await rowsFor(userId, songId)).toHaveLength(1)
  })

  it('addSongToRepertoire still holds the representative version', async () => {
    const { songId, representativeId } = await seedSong(`Picker ${suffix}`)
    const entry = await addSongToRepertoire({ userId }, songId)
    expect(entry.version_id).toBe(representativeId)
  })
})

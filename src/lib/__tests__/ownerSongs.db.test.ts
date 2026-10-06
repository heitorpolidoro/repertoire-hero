/**
 * RH-124 — the owner-row data access against a real Postgres.
 *
 * What a unit test cannot answer lives here: the two uniques, the independence
 * of a user's hold from a band's, the determinism of the representative-version
 * ordering, and the three reads' contracts — including the one a missing owner
 * row must not break.
 *
 * Fixture: one user, one band they administer, one catalog song with **two**
 * versions (an album take and a single take) plus a second song whose only
 * version has no album row at all.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { query } from '@/lib/db'
import { createBand } from '@/lib/bands'
import {
  createAndAddSong,
  getPersonalEntryForSong,
  getResolvedEntryForVersion,
  getSongEntry,
  updateSongKey,
  updateSongOverrides,
} from '@/lib/ownerSongs'
import { representativeVersionSubquery } from '@/lib/songVersions'
import { createTestUser, deleteTestUser } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''
/** Syntactically valid, matches nothing. */
const MISSING_ID = '00000000-0000-0000-0000-000000000000'

describe.skipIf(!RUN_DB_TESTS)('owner-song reads and writes (real database)', () => {
  const suffix = Date.now()

  let userId: string
  let otherUserId: string
  let bandId: string
  /** The song with two versions. */
  let songId: string
  let albumVersionId: string
  let singleVersionId: string
  /** A song whose only version carries no album row (ER4's shape, at read time). */
  let albumlessSongId: string
  let albumlessVersionId: string
  const createdSongIds: string[] = []

  const insertId = async (sql: string, params: unknown[]): Promise<string> =>
    (await query<{ id: string }>(sql, params)).rows[0].id

  beforeAll(async () => {
    userId = await createTestUser({ email: `rh124-owner-a-${suffix}@example.com` })
    otherUserId = await createTestUser({ email: `rh124-owner-b-${suffix}@example.com` })
    bandId = await createBand(userId, `RH-124 Owner Band ${suffix}`, null, null)

    songId = await insertId(
      'INSERT INTO songs (title, artist, lyrics) VALUES ($1, $2, $3) RETURNING id',
      [`RH-124 Read Song ${suffix}`, `RH-124 Read Artist ${suffix}`, 'the composition words'],
    )
    createdSongIds.push(songId)

    // `album_type = 'album'` sorts first, so the album take is the
    // representative one however the rows were inserted — the single is
    // inserted first on purpose.
    const singleAlbumId = await insertId(
      `INSERT INTO albums (artist, name, album_type, release_date)
       VALUES ($1, $2, 'single', '1980-01-01') RETURNING id`,
      [`RH-124 Read Artist ${suffix}`, `RH-124 Single ${suffix}`],
    )
    const albumAlbumId = await insertId(
      `INSERT INTO albums (artist, name, album_type, release_date)
       VALUES ($1, $2, 'album', '1991-01-01') RETURNING id`,
      [`RH-124 Read Artist ${suffix}`, `RH-124 Album ${suffix}`],
    )
    singleVersionId = await insertId(
      `INSERT INTO song_versions (song_id, album_id, label, key, tuning)
       VALUES ($1, $2, 'Single', 'A', 'Drop D') RETURNING id`,
      [songId, singleAlbumId],
    )
    albumVersionId = await insertId(
      `INSERT INTO song_versions (song_id, album_id, label, key, tuning)
       VALUES ($1, $2, 'Album', 'G', 'Standard') RETURNING id`,
      [songId, albumAlbumId],
    )

    albumlessSongId = await insertId(
      'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id',
      [`RH-124 Albumless ${suffix}`, `RH-124 Read Artist ${suffix}`],
    )
    createdSongIds.push(albumlessSongId)
    albumlessVersionId = await insertId(
      'INSERT INTO song_versions (song_id, album_id, label) VALUES ($1, NULL, $2) RETURNING id',
      [albumlessSongId, 'No Release'],
    )
  })

  afterAll(async () => {
    if (bandId) await query('DELETE FROM bands WHERE id = $1', [bandId])
    for (const id of [userId, otherUserId]) if (id) await deleteTestUser(id)
    for (const id of createdSongIds) await query('DELETE FROM songs WHERE id = $1', [id])
  })

  /**
   * ER7 — each unique refuses a second hold of the same `(owner, version)`.
   * That constraint *is* "adding a version already in that repertoire is
   * refused, not duplicated" (docs/use-cases.md, *Add a song to the
   * repertoire*); nothing in TypeScript enforces it.
   */
  describe('the two uniques refuse a duplicate hold (ER7)', () => {
    it.each([
      ['user_songs', 'user_id', () => userId],
      ['band_songs', 'band_id', () => bandId],
    ])('%s rejects a second insert of the same (%s, version_id)', async (table, column, owner) => {
      const insert = () =>
        query(`INSERT INTO ${table} (${column}, version_id) VALUES ($1, $2) RETURNING id`, [
          owner(),
          albumlessVersionId,
        ])

      const first = await insert()
      try {
        await expect(insert()).rejects.toMatchObject({ code: '23505' })
      } finally {
        await query(`DELETE FROM ${table} WHERE id = $1`, [first.rows[0].id])
      }
    })
  })

  /**
   * ER13 — "cada user com o seu, cada banda com o seu". The two holds on one
   * version share a `version_id` and nothing else: no trigger, no derived
   * column, no propagation in either direction.
   */
  describe('a user\'s and a band\'s holds on one version are independent (ER13)', () => {
    let userRowId: string
    let bandRowId: string

    beforeAll(async () => {
      userRowId = await insertId(
        'INSERT INTO user_songs (user_id, version_id) VALUES ($1, $2) RETURNING id',
        [userId, albumVersionId],
      )
      bandRowId = await insertId(
        'INSERT INTO band_songs (band_id, version_id) VALUES ($1, $2) RETURNING id',
        [bandId, albumVersionId],
      )
    })

    afterAll(async () => {
      await query('DELETE FROM user_songs WHERE id = $1', [userRowId])
      await query('DELETE FROM band_songs WHERE id = $1', [bandRowId])
    })

    it('setting the band\'s key leaves the user\'s resolution on the version\'s', async () => {
      await updateSongKey({ bandId }, bandRowId, 'F#')

      expect((await getResolvedEntryForVersion({ bandId }, albumVersionId)).key).toBe('F#')
      // The user overrides nothing, so they still inherit the version's `G`.
      expect((await getResolvedEntryForVersion({ userId }, albumVersionId)).key).toBe('G')
    })

    it('and the reverse: setting the user\'s key leaves the band\'s where it was', async () => {
      await updateSongKey({ userId }, userRowId, 'Bb')

      expect((await getResolvedEntryForVersion({ userId }, albumVersionId)).key).toBe('Bb')
      expect((await getResolvedEntryForVersion({ bandId }, albumVersionId)).key).toBe('F#')
    })

    it('and clearing one to null sends only that one back up the chain', async () => {
      await updateSongKey({ userId }, userRowId, null)

      expect((await getResolvedEntryForVersion({ userId }, albumVersionId)).key).toBe('G')
      expect((await getResolvedEntryForVersion({ bandId }, albumVersionId)).key).toBe('F#')
    })
  })

  /**
   * ER12 — the read a missing owner row must not break, and the two reads whose
   * `null` is load-bearing.
   */
  describe('getResolvedEntryForVersion resolves an absent owner row (ER12)', () => {
    it('answers with ownerRowId null and the inherited values, neither throwing nor null', async () => {
      // `otherUserId` holds nothing at all: no `user_songs` row for this pair.
      const resolved = await getResolvedEntryForVersion({ userId: otherUserId }, singleVersionId)

      expect(resolved).not.toBeNull()
      expect(resolved.ownerRowId).toBeNull()
      expect(resolved.status).toBeNull()
      expect(resolved.tags).toEqual([])
      expect(resolved.last_practiced).toBeNull()
      // Inherited: key and tuning from the version, lyrics from the song —
      // the two cascade depths, at the database.
      expect(resolved.key).toBe('A')
      expect(resolved.tuning).toBe('Drop D')
      expect(resolved.lyrics).toBe('the composition words')
      expect(resolved.map).toBeNull()
      expect(resolved.version_id).toBe(singleVersionId)
      expect(resolved.song_id).toBe(songId)
    })

    it('throws only for a version that does not exist', async () => {
      await expect(getResolvedEntryForVersion({ userId }, MISSING_ID)).rejects.toThrow(
        'Failed to resolve song version',
      )
    })

    it('getSongEntry answers null for an unknown id — the hooks branch on that null', async () => {
      await expect(getSongEntry({ userId }, MISSING_ID)).resolves.toBeNull()
    })

    it('getPersonalEntryForSong answers null for a song the user holds no version of', async () => {
      await expect(getPersonalEntryForSong(songId, otherUserId)).resolves.toBeNull()
    })
  })

  /**
   * ER16's database half: the Fast View entry read resolves its lyrics through
   * the same helper, so words that exist only on `songs` reach the screen.
   */
  it('getSongEntry inherits lyrics that exist only on songs (ER16)', async () => {
    const rowId = await insertId(
      'INSERT INTO user_songs (user_id, version_id) VALUES ($1, $2) RETURNING id',
      [otherUserId, albumVersionId],
    )
    try {
      const entry = await getSongEntry({ userId: otherUserId }, rowId)

      expect(entry).not.toBeNull()
      // Null on the owner row and null on the version, so the walk reaches the
      // composition.
      expect(entry!.lyrics).toBe('the composition words')
      expect(entry!.key).toBe('G')
    } finally {
      await query('DELETE FROM user_songs WHERE id = $1', [rowId])
    }
  })

  /**
   * ER14's "every override is writable": `tuning` and `map` have no per-field
   * entry point — no screen hosts them yet — so the patch is how they are
   * written, through the same gated single write as `status`, `key`, `tags` and
   * `lyrics`. `map` is jsonb, which is why the write serializes it rather than
   * letting the driver send a record literal.
   */
  describe('updateSongOverrides writes the overrides no screen hosts yet', () => {
    let rowId: string

    beforeAll(async () => {
      rowId = await insertId(
        'INSERT INTO user_songs (user_id, version_id) VALUES ($1, $2) RETURNING id',
        [userId, singleVersionId],
      )
    })

    afterAll(async () => {
      await query('DELETE FROM user_songs WHERE id = $1', [rowId])
    })

    it('writes tuning and map, and the reads resolve them from the owner row', async () => {
      await updateSongOverrides({ userId }, rowId, {
        tuning: 'DADGAD',
        map: { sections: ['intro', 'verse'] },
      })

      const resolved = await getResolvedEntryForVersion({ userId }, singleVersionId)
      expect(resolved.tuning).toBe('DADGAD')
      expect(resolved.map).toEqual({ sections: ['intro', 'verse'] })
      // `key` was not in the patch, so it is untouched and still the version's.
      expect(resolved.key).toBe('A')
    })

    it('clears an override back to null, which sends resolution up the chain', async () => {
      await updateSongOverrides({ userId }, rowId, { tuning: null, map: null })

      const resolved = await getResolvedEntryForVersion({ userId }, singleVersionId)
      // The version carries `Drop D`, so clearing the owner's tuning resolves
      // to it rather than to null — clearing *is* writing null.
      expect(resolved.tuning).toBe('Drop D')
      expect(resolved.map).toBeNull()
    })

    it('refuses a patch with nothing in it, rather than reporting a missing row', async () => {
      await expect(updateSongOverrides({ userId }, rowId, {})).rejects.toThrow(
        'an owner-row write needs at least one field',
      )
    })

    it('fails closed on a row the owner does not hold', async () => {
      await expect(
        updateSongOverrides({ userId: otherUserId }, rowId, { tuning: 'hijacked' }),
      ).rejects.toThrow('Repertoire entry not found or access denied')
    })
  })

  /**
   * The shared representative-version ordering, which both the migration and
   * every song-keyed path rely on. `album_type = 'album'` wins over the single
   * however the rows were inserted, and it is a sort rather than a stored
   * column, so two runs cannot disagree.
   */
  describe('the representative-version ordering', () => {
    it('picks the album take over the single, deterministically', async () => {
      const pick = async () =>
        (
          await query<{ id: string }>(
            `SELECT ${representativeVersionSubquery('$1')} AS id`,
            [songId],
          )
        ).rows[0].id

      expect(await pick()).toBe(albumVersionId)
      expect(await pick()).toBe(albumVersionId)
      expect(albumVersionId).not.toBe(singleVersionId)
    })

    it('still returns a version whose album_id is null (ER4)', async () => {
      const res = await query<{ id: string }>(
        `SELECT ${representativeVersionSubquery('$1')} AS id`,
        [albumlessSongId],
      )
      expect(res.rows[0].id).toBe(albumlessVersionId)
    })
  })

  /**
   * `createAndAddSong` still refuses a version the owner already holds, with
   * the message the UI shows verbatim, and writes no second row.
   */
  it('createAndAddSong refuses an (owner, song) already held and writes no second row', async () => {
    const data = { title: `RH-124 Create ${suffix}`, artist: `RH-124 Create Artist ${suffix}` }
    const first = await createAndAddSong({ userId }, data)
    createdSongIds.push(first.song_id)

    await expect(createAndAddSong({ userId }, data)).rejects.toThrow(
      'Song already in your repertoire',
    )

    const held = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM user_songs o
       JOIN song_versions v ON v.id = o.version_id
       WHERE o.user_id = $1 AND v.song_id = $2`,
      [userId, first.song_id],
    )
    expect(held.rows[0].n).toBe('1')
  })
})

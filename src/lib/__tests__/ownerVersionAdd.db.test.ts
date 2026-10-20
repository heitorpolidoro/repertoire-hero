/**
 * RH-151 — `addVersionToRepertoire` against a real Postgres: it adds exactly the
 * named version (including a non-representative one), is scoped to the owner,
 * and rejects an id that names nothing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { query } from '@/lib/db'
import { createBand } from '@/lib/bands'
import { addVersionToRepertoire } from '@/lib/ownerVersionAdd'
import { createTestUser, deleteTestUser, linkVersionAlbum } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''
const MISSING_ID = '00000000-0000-0000-0000-000000000000'

describe.skipIf(!RUN_DB_TESTS)('addVersionToRepertoire (real database)', () => {
  const suffix = Date.now()
  let userId: string
  let otherUserId: string
  let bandId: string
  let songId: string
  let representativeId: string
  let otherVersionId: string

  const insertId = async (sql: string, params: unknown[]): Promise<string> =>
    (await query<{ id: string }>(sql, params)).rows[0].id

  beforeAll(async () => {
    userId = await createTestUser({ email: `rh151-a-${suffix}@example.com` })
    otherUserId = await createTestUser({ email: `rh151-b-${suffix}@example.com` })
    bandId = await createBand(userId, `RH-151 Band ${suffix}`, null, null)
    songId = await insertId('INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id', [
      `RH-151 Song ${suffix}`,
      `RH-151 Artist ${suffix}`,
    ])
    const single = await insertId(
      `INSERT INTO albums (artist, name, album_type, release_date) VALUES ($1, $2, 'single', '1980-01-01') RETURNING id`,
      [`RH-151 Artist ${suffix}`, `RH-151 Single ${suffix}`],
    )
    const album = await insertId(
      `INSERT INTO albums (artist, name, album_type, release_date) VALUES ($1, $2, 'album', '1991-01-01') RETURNING id`,
      [`RH-151 Artist ${suffix}`, `RH-151 Album ${suffix}`],
    )
    otherVersionId = await linkVersionAlbum(
      await insertId(
        `INSERT INTO song_versions (song_id, label) VALUES ($1, 'Single') RETURNING id`,
        [songId],
      ),
      single,
    )
    representativeId = await linkVersionAlbum(
      await insertId(
        `INSERT INTO song_versions (song_id, label) VALUES ($1, 'Album') RETURNING id`,
        [songId],
      ),
      album,
    )
  })

  afterAll(async () => {
    if (bandId) await query('DELETE FROM bands WHERE id = $1', [bandId])
    for (const id of [userId, otherUserId]) if (id) await deleteTestUser(id)
    if (songId) await query('DELETE FROM songs WHERE id = $1', [songId])
  })

  it('adds exactly the named, non-representative version, born unknown', async () => {
    const entry = await addVersionToRepertoire({ userId }, otherVersionId)
    expect(entry.version_id).toBe(otherVersionId)
    expect(entry.status).toBe('unknown')

    const held = await query<{ version_id: string }>('SELECT version_id FROM user_songs WHERE user_id = $1', [userId])
    expect(held.rows.map((r) => r.version_id)).toEqual([otherVersionId])
    expect(representativeId).not.toBe(otherVersionId)
  })

  it('is scoped to the owner: another user and a band hold nothing', async () => {
    const other = await query('SELECT 1 FROM user_songs WHERE user_id = $1', [otherUserId])
    expect(other.rowCount).toBe(0)
    const band = await query('SELECT 1 FROM band_songs WHERE band_id = $1', [bandId])
    expect(band.rowCount).toBe(0)
  })

  it('writes a band owner to band_songs only', async () => {
    const entry = await addVersionToRepertoire({ bandId }, representativeId)
    expect(entry.version_id).toBe(representativeId)
    const band = await query<{ version_id: string }>('SELECT version_id FROM band_songs WHERE band_id = $1', [bandId])
    expect(band.rows.map((r) => r.version_id)).toEqual([representativeId])
    const mine = await query<{ version_id: string }>('SELECT version_id FROM user_songs WHERE user_id = $1', [userId])
    expect(mine.rows.map((r) => r.version_id)).toEqual([otherVersionId])
  })

  it('rejects an unknown version id and adds nothing', async () => {
    await expect(addVersionToRepertoire({ userId: otherUserId }, MISSING_ID)).rejects.toThrow(
      /Failed to add version to repertoire: Song version not found/,
    )
    const rows = await query('SELECT 1 FROM user_songs WHERE user_id = $1', [otherUserId])
    expect(rows.rowCount).toBe(0)
  })
})

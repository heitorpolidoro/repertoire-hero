/**
 * RH-119 — presence: a present member's own row gets `last_practiced` only,
 * never moved backwards. Fixture: admin A (presser), present members B and C,
 * unticked member D; three versions.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { query } from '@/lib/db'
import { createBand } from '@/lib/bands'
import { recordPractice } from '@/lib/practiceWrite'
import { createTestUser, deleteTestUser } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''
const OLD = '2001-02-03T04:05:06Z'
const FUTURE = '2999-01-01T00:00:00Z'

interface Row {
  status: string
  tags: string[] | null
  last_practiced: Date | null
}

describe.skipIf(!RUN_DB_TESTS)('practice presence (real database)', () => {
  const suffix = Date.now()
  let a: string
  let b: string
  let c: string
  let d: string
  let bandId: string
  let songId: string
  const v: string[] = []

  const row = async (userId: string, versionId: string): Promise<Row | undefined> =>
    (
      await query<Row>('SELECT status, tags, last_practiced FROM user_songs WHERE user_id = $1 AND version_id = $2', [
        userId,
        versionId,
      ])
    ).rows[0]

  beforeAll(async () => {
    ;[a, b, c, d] = await Promise.all(
      ['a', 'b', 'c', 'd'].map(n => createTestUser({ email: `rh119-${n}-${suffix}@example.com` })),
    )
    bandId = await createBand(a, `RH-119 Band ${suffix}`, null, null)
    for (const u of [b, c, d])
      await query("INSERT INTO band_members (band_id, user_id, role) VALUES ($1, $2, 'member')", [bandId, u])
    songId = (
      await query<{ id: string }>('INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id', [
        `RH-119 Song ${suffix}`,
        `RH-119 Artist ${suffix}`,
      ])
    ).rows[0].id
    for (const label of ['v1', 'v2', 'v3'])
      v.push(
        (
          await query<{ id: string }>('INSERT INTO song_versions (song_id, label) VALUES ($1, $2) RETURNING id', [
            songId,
            label,
          ])
        ).rows[0].id,
      )
    await query(
      `INSERT INTO user_songs (user_id, version_id, status, tags, last_practiced) VALUES ($1, $2, 'mastered', ARRAY['x'], $3)`,
      [b, v[0], OLD],
    )
    await query(`INSERT INTO user_songs (user_id, version_id, status, last_practiced) VALUES ($1, $2, 'learning', $3)`, [
      c,
      v[0],
      FUTURE,
    ])
    await query(`INSERT INTO user_songs (user_id, version_id, status, last_practiced) VALUES ($1, $2, 'learning', $3)`, [
      d,
      v[0],
      OLD,
    ])
  })

  afterAll(async () => {
    await query('DELETE FROM songs WHERE id = $1', [songId])
    await query('DELETE FROM bands WHERE id = $1', [bandId])
    for (const u of [a, b, c, d]) await deleteTestUser(u)
  })

  it('advances present members on the ticked songs only and leaves unticked members alone', async () => {
    const beforeD = await row(d, v[0])
    await recordPractice(a, bandId, [{ versionId: v[0] }, { versionId: v[1] }], [b, c])

    const b0 = await row(b, v[0])
    expect(b0!.last_practiced!.getTime()).toBeGreaterThan(new Date(OLD).getTime())
    expect(b0!.status).toBe('mastered')
    expect(b0!.tags).toEqual(['x'])
    expect(await row(d, v[0])).toEqual(beforeD)
    expect(await row(d, v[1])).toBeUndefined()
    expect(await row(b, v[2])).toBeUndefined()
    expect((await row(a, v[0]))!.last_practiced).not.toBeNull()
  })

  it('keeps a later date, and creates a missing row as unknown', async () => {
    expect((await row(c, v[0]))!.last_practiced!.toISOString()).toBe('2999-01-01T00:00:00.000Z')
    expect((await row(c, v[0]))!.status).toBe('learning')
    const created = await row(b, v[1])
    expect(created!.status).toBe('unknown')
    expect(created!.last_practiced).not.toBeNull()
  })

  it('does not apply GREATEST to the presser own row', async () => {
    await query('UPDATE user_songs SET last_practiced = $3 WHERE user_id = $1 AND version_id = $2', [a, v[0], FUTURE])
    await recordPractice(a, bandId, [{ versionId: v[0] }], [b])
    expect((await row(a, v[0]))!.last_practiced!.getTime()).toBeLessThan(new Date(FUTURE).getTime())
  })

  it('rolls back every member when an item fails', async () => {
    const missing = '00000000-0000-0000-0000-000000000000'
    await query('DELETE FROM user_songs WHERE user_id = $1 AND version_id = $2', [c, v[2]])
    await expect(recordPractice(a, bandId, [{ versionId: v[2] }, { versionId: missing }], [b, c])).rejects.toThrow(
      /Failed to record practice/,
    )
    expect(await row(c, v[2])).toBeUndefined()
    expect(await row(b, v[2])).toBeUndefined()
  })

  it('an invalid present id rolls the batch back', async () => {
    await expect(recordPractice(a, bandId, [{ versionId: v[2] }], [b, 'not-a-uuid'])).rejects.toThrow(
      /Failed to record practice/,
    )
    expect(await row(a, v[2])).toBeUndefined()
    expect(await row(b, v[2])).toBeUndefined()
  })

  it('an empty present list writes nobody else', async () => {
    const beforeD = await row(d, v[0])
    await recordPractice(a, bandId, [{ versionId: v[0] }], [])
    expect(await row(d, v[0])).toEqual(beforeD)
  })
})

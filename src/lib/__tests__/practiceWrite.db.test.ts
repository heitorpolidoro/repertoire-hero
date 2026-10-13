/**
 * RH-158 — the practice write against a real Postgres.
 *
 * Fixture: admin A (presser) and member B of one band; the band holds a
 * `band_songs` row for version V1 only. User B also holds a personal row on V1.
 * V2 has no row anywhere, V3 has no band row.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { query } from '@/lib/db'
import { createBand } from '@/lib/bands'
import { recordPractice, recordPracticeStatus } from '@/lib/practiceWrite'
import { createTestUser, deleteTestUser } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''
const OLD = '2001-02-03T04:05:06Z'

interface Row {
  status: string
  last_practiced: Date | null
}

describe.skipIf(!RUN_DB_TESTS)('practice write (real database)', () => {
  const suffix = Date.now()
  let userA: string
  let userB: string
  let bandId: string
  let songId: string
  const versions: string[] = []

  const insertId = async (sql: string, params: unknown[]): Promise<string> =>
    (await query<{ id: string }>(sql, params)).rows[0].id

  const userRow = async (userId: string, versionId: string): Promise<Row | undefined> =>
    (
      await query<Row>('SELECT status, last_practiced FROM user_songs WHERE user_id = $1 AND version_id = $2', [
        userId,
        versionId,
      ])
    ).rows[0]
  const bandRow = async (versionId: string): Promise<Row | undefined> =>
    (
      await query<Row>('SELECT status, last_practiced FROM band_songs WHERE band_id = $1 AND version_id = $2', [
        bandId,
        versionId,
      ])
    ).rows[0]
  const bandCount = async (): Promise<number> =>
    (await query<{ n: number }>('SELECT count(*)::int AS n FROM band_songs WHERE band_id = $1', [bandId])).rows[0].n

  beforeAll(async () => {
    userA = await createTestUser({ email: `rh158-a-${suffix}@example.com` })
    userB = await createTestUser({ email: `rh158-b-${suffix}@example.com` })
    bandId = await createBand(userA, `RH-158 Band ${suffix}`, null, null)
    await query("INSERT INTO band_members (band_id, user_id, role) VALUES ($1, $2, 'member')", [bandId, userB])
    songId = await insertId('INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id', [
      `RH-158 Song ${suffix}`,
      `RH-158 Artist ${suffix}`,
    ])
    for (const label of ['v1', 'v2', 'v3']) {
      versions.push(
        await insertId('INSERT INTO song_versions (song_id, label) VALUES ($1, $2) RETURNING id', [songId, label]),
      )
    }
    await query(
      `INSERT INTO band_songs (band_id, version_id, status, last_practiced) VALUES ($1, $2, 'learning', $3)`,
      [bandId, versions[0], OLD],
    )
    await query(
      `INSERT INTO user_songs (user_id, version_id, status, last_practiced) VALUES ($1, $2, 'mastered', $3)`,
      [userB, versions[0], OLD],
    )
  })

  afterAll(async () => {
    await query('DELETE FROM songs WHERE id = $1', [songId])
    await query('DELETE FROM bands WHERE id = $1', [bandId])
    await deleteTestUser(userA)
    await deleteTestUser(userB)
  })

  it('sets last_practiced to the database now() on the presser row and creates it unknown', async () => {
    const before = (await query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0].now
    await recordPractice(userA, undefined, [{ versionId: versions[1] }])
    const after = (await query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0].now
    const row = await userRow(userA, versions[1])
    expect(row?.status).toBe('unknown')
    expect(row!.last_practiced!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000)
    expect(row!.last_practiced!.getTime()).toBeLessThanOrEqual(after.getTime())
    expect(await bandRow(versions[1])).toBeUndefined()
  })

  it('leaves status untouched on an existing row when no status is given, and sets it when given', async () => {
    await query(`UPDATE user_songs SET status = 'polishing', last_practiced = NULL WHERE user_id = $1 AND version_id = $2`, [userA, versions[1]])
    await recordPractice(userA, undefined, [{ versionId: versions[1] }])
    expect((await userRow(userA, versions[1]))?.status).toBe('polishing')
    expect((await userRow(userA, versions[1]))?.last_practiced).not.toBeNull()
    await recordPractice(userA, undefined, [{ versionId: versions[1], status: 'practicing' }])
    expect((await userRow(userA, versions[1]))?.status).toBe('practicing')
  })

  it('creates a missing row with the given status', async () => {
    await recordPractice(userA, undefined, [{ versionId: versions[2], status: 'learning' }])
    expect((await userRow(userA, versions[2]))?.status).toBe('learning')
  })

  it('a presser without band id leaves the band row untouched and never touches another user row', async () => {
    await recordPractice(userA, undefined, [{ versionId: versions[0] }])
    const band = await bandRow(versions[0])
    expect(band?.last_practiced?.toISOString()).toBe('2001-02-03T04:05:06.000Z')
    expect(band?.status).toBe('learning')
    const other = await userRow(userB, versions[0])
    expect(other?.last_practiced?.toISOString()).toBe('2001-02-03T04:05:06.000Z')
    expect(other?.status).toBe('mastered')
  })

  it('with a band id updates the existing band row and inserts none where absent', async () => {
    const count = await bandCount()
    await recordPractice(userA, bandId, [{ versionId: versions[0] }, { versionId: versions[1] }])
    const band = await bandRow(versions[0])
    expect(band!.last_practiced!.getTime()).toBeGreaterThan(new Date(OLD).getTime())
    expect(band?.status).toBe('learning')
    expect(await bandRow(versions[1])).toBeUndefined()
    expect(await bandCount()).toBe(count)
    expect((await userRow(userB, versions[0]))?.last_practiced?.toISOString()).toBe('2001-02-03T04:05:06.000Z')
  })

  it('an empty list is a no-op', async () => {
    await expect(recordPractice(userA, bandId, [])).resolves.toBeUndefined()
  })

  it('a failing item rolls the whole batch back', async () => {
    const missing = '00000000-0000-0000-0000-000000000000'
    await query('DELETE FROM user_songs WHERE user_id = $1 AND version_id = $2', [userA, versions[2]])
    await expect(
      recordPractice(userA, undefined, [{ versionId: versions[2] }, { versionId: missing }]),
    ).rejects.toThrow(/Failed to record practice/)
    expect(await userRow(userA, versions[2])).toBeUndefined()
  })

  it('the status-only write changes status, never last_practiced, and creates a missing row with a null date', async () => {
    await query('DELETE FROM user_songs WHERE user_id = $1 AND version_id = $2', [userA, versions[2]])
    await recordPracticeStatus(userA, undefined, [{ versionId: versions[2], status: 'mastered' }])
    const created = await userRow(userA, versions[2])
    expect(created?.status).toBe('mastered')
    expect(created?.last_practiced).toBeNull()

    const stamped = (await userRow(userA, versions[1]))!.last_practiced
    await recordPracticeStatus(userA, undefined, [{ versionId: versions[1], status: 'learning' }])
    const row = await userRow(userA, versions[1])
    expect(row?.status).toBe('learning')
    expect(row!.last_practiced!.getTime()).toBe(stamped!.getTime())
  })

  it('the status-only write follows the same band rule', async () => {
    const count = await bandCount()
    await recordPracticeStatus(userA, bandId, [
      { versionId: versions[0], status: 'polishing' },
      { versionId: versions[1], status: 'polishing' },
    ])
    const band = await bandRow(versions[0])
    expect(band?.status).toBe('polishing')
    expect(band?.last_practiced?.getTime()).toBeGreaterThan(new Date(OLD).getTime()) // from the earlier test, unchanged by this one
    expect(await bandCount()).toBe(count)
    expect((await userRow(userB, versions[0]))?.status).toBe('mastered')
  })

  it('a failing status item rolls the batch back and an empty list is a no-op', async () => {
    await expect(recordPracticeStatus(userA, undefined, [])).resolves.toBeUndefined()
    await expect(
      recordPracticeStatus(userA, undefined, [{ versionId: '00000000-0000-0000-0000-000000000000', status: 'learning' }]),
    ).rejects.toThrow(/Failed to record practice status/)
  })
})

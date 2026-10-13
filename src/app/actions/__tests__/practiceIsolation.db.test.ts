/**
 * RH-114 - the practice write reaches exactly one owner. Through the real
 * `recordPracticeAction` (only the session is mocked): a batch by one user
 * leaves another member's `user_songs` row untouched and never inserts a
 * `band_songs` row.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

vi.mock('@/lib/auth-session', () => ({ getRequiredUserId: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { asUser, createTestSong, RUN_DB_TESTS } from './authzFixtures'
import { createTestUser, deleteTestUser, seedOwnerSong } from '@/lib/__tests__/test-helpers'
import { createBand } from '@/lib/bands'
import { query } from '@/lib/db'
import { recordPracticeAction } from '../repertoire'

describe.skipIf(!RUN_DB_TESTS)('RH-114: a practice batch reaches only the presser (real database)', () => {
  const suffix = Date.now()
  let adminId: string
  let memberId: string
  let bandId: string
  const songIds: string[] = []

  beforeAll(async () => {
    adminId = await createTestUser({ email: `rh114-admin-${suffix}@example.com` })
    memberId = await createTestUser({ email: `rh114-member-${suffix}@example.com` })
    bandId = await createBand(adminId, `RH-114 Band ${suffix}`, null, null)
    await query("INSERT INTO band_members (band_id, user_id, role) VALUES ($1, $2, 'member')", [bandId, memberId])
  })

  afterAll(async () => {
    if (bandId) await query('DELETE FROM bands WHERE id = $1', [bandId])
    for (const user of [adminId, memberId]) if (user) await deleteTestUser(user)
    for (const song of songIds) await query('DELETE FROM songs WHERE id = $1', [song])
  })

  it.each([
    ['a plain member', () => memberId, () => adminId],
    ['a band admin', () => adminId, () => memberId],
  ])('a batch by %s leaves the other member row unchanged and inserts no band_songs row', async (who, presser, other) => {
    const songId = await createTestSong(`RH-114 Isolation ${who} ${suffix}`)
    songIds.push(songId)
    const otherRowId = await seedOwnerSong({ userId: other() }, songId, { status: 'learning' })
    const versionId = (
      await query<{ version_id: string }>('SELECT version_id FROM user_songs WHERE id = $1', [otherRowId])
    ).rows[0].version_id
    const otherRow = async () => (await query('SELECT * FROM user_songs WHERE id = $1', [otherRowId])).rows[0]
    const before = await otherRow()

    asUser(presser())
    await recordPracticeAction([{ versionId, status: 'mastered' }], bandId)

    expect(await otherRow()).toEqual(before)
    const bandRows = await query('SELECT 1 FROM band_songs WHERE band_id = $1 AND version_id = $2', [bandId, versionId])
    expect(bandRows.rowCount).toBe(0)
    const own = await query<{ lp: Date | null; status: string }>(
      'SELECT last_practiced AS lp, status FROM user_songs WHERE user_id = $1 AND version_id = $2',
      [presser(), versionId],
    )
    expect(own.rows[0].lp).not.toBeNull()
    expect(own.rows[0].status).toBe('mastered')
  })
})

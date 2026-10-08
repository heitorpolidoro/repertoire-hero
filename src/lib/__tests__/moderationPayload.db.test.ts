/**
 * RH-55 (F17) — moderation payload validation against the real database.
 *
 * Two things only a real database can prove: that an invalid submission never
 * reaches the INSERT, and that a historical queue row whose stored value no
 * longer validates is refused at approval with the catalog row untouched and
 * the suggestion still `pending`.
 *
 * Every fixture carries a `Date.now()` suffix because vitest runs files in
 * parallel workers against these shared tables. No transaction-control literal
 * appears here (see `transactionGuard.test.ts`).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createTestUser, deleteTestUser } from '@/lib/__tests__/test-helpers'
import { query } from '@/lib/db'
import { submitCatalogSuggestion, reviewCatalogSuggestionGroup } from '@/lib/moderation'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''
const BAD_DURATION = 'Invalid catalog suggestion: duration_seconds must be a non-negative integer or null'

describe.skipIf(!RUN_DB_TESTS)('catalog suggestion payload validation (real database)', () => {
  const suffix = Date.now()
  const songTitle = `RH-55 Song ${suffix}`

  let userId: string
  let adminUserId: string
  let songId: string

  const one = async (sql: string, params: unknown[] = []) => {
    const res = await query(sql, params)
    return res.rows[0]
  }

  const countSuggestions = async (): Promise<number> => {
    const row = await one(
      'SELECT count(*)::int AS count FROM catalog_suggestions WHERE target_id = $1',
      [songId],
    )
    return row.count as number
  }

  beforeAll(async () => {
    userId = await createTestUser({ email: `rh55-user-${suffix}@example.com` })
    adminUserId = await createTestUser({ email: `rh55-admin-${suffix}@example.com` })
    await query('UPDATE profiles SET is_system_admin = true WHERE id = $1', [adminUserId])

    const song = await one(
      'INSERT INTO songs (title, artist, duration_seconds) VALUES ($1, $2, 217) RETURNING id',
      [songTitle, 'RH-55 Artist'],
    )
    songId = song.id as string
  })

  afterAll(async () => {
    if (songId) await query('DELETE FROM catalog_suggestions WHERE target_id = $1', [songId])
    for (const user of [userId, adminUserId]) {
      if (user) await deleteTestUser(user)
    }
    if (songId) await query('DELETE FROM songs WHERE id = $1', [songId])
  })

  it('refuses an invalid payload at submission and inserts no suggestion row', async () => {
    const before = await countSuggestions()

    await expect(
      submitCatalogSuggestion(userId, songId, { duration_seconds: 'abc' }),
    ).rejects.toThrowError(new Error(BAD_DURATION))

    expect(await countSuggestions()).toBe(before)
  })

  it('refuses a historical suggestion row whose stored value no longer validates', async () => {
    const groupId = randomUUID()
    await query(
      `INSERT INTO catalog_suggestions
         (group_id, target_table, target_id, target_column, value, requested_by)
       VALUES ($1, 'songs', $2, 'duration_seconds', $3::jsonb, $4)`,
      [groupId, songId, JSON.stringify('abc'), userId],
    )

    await expect(
      reviewCatalogSuggestionGroup(adminUserId, groupId, 'approve'),
    ).rejects.toThrowError(new Error(BAD_DURATION))

    const song = await one('SELECT title, duration_seconds FROM songs WHERE id = $1', [songId])
    expect(song.title).toBe(songTitle)
    expect(song.duration_seconds).toBe(217)

    const after = await one('SELECT status FROM catalog_suggestions WHERE group_id = $1', [groupId])
    expect(after.status).toBe('pending')
  })
})

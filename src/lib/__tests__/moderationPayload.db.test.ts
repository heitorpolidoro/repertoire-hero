/**
 * RH-55 (F17) — moderation payload validation against the real database.
 *
 * Two things only a real database can prove: that an invalid submission never
 * reaches the INSERT, and that a historical `global_song_edits` row whose
 * `proposed_data` no longer validates is refused at approval with the catalog
 * row untouched and the edit still `pending`.
 *
 * Every fixture carries a `Date.now()` suffix because vitest runs files in
 * parallel workers against these shared tables. No transaction-control literal
 * appears here (see `transactionGuard.test.ts`).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminTestClient, createTestUser, deleteTestUser } from '@/lib/__tests__/test-helpers'
import { query } from '@/lib/db'
import { submitGlobalSongEdit, reviewGlobalSongEdit } from '@/lib/moderation'

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const admin = createAdminTestClient()

const BAD_DURATION = 'Invalid global song edit: duration_seconds must be a non-negative integer or null'

describe.skipIf(!SERVICE_ROLE_KEY)('global song edit payload validation (real database)', () => {
  const suffix = Date.now()
  const songTitle = `RH-55 Song ${suffix}`

  let userId: string
  let adminUserId: string
  let songId: string

  const one = async (sql: string, params: unknown[] = []) => {
    const res = await query(sql, params)
    return res.rows[0]
  }

  const countEdits = async (): Promise<number> => {
    const row = await one('SELECT count(*)::int AS count FROM global_song_edits WHERE song_id = $1', [
      songId,
    ])
    return row.count as number
  }

  beforeAll(async () => {
    userId = await createTestUser(admin, { email: `rh55-user-${suffix}@example.com` })
    adminUserId = await createTestUser(admin, { email: `rh55-admin-${suffix}@example.com` })
    await query('UPDATE profiles SET is_system_admin = true WHERE id = $1', [adminUserId])

    const song = await one(
      'INSERT INTO global_songs (title, artist, duration_seconds) VALUES ($1, $2, 217) RETURNING id',
      [songTitle, 'RH-55 Artist'],
    )
    songId = song.id as string
  })

  afterAll(async () => {
    if (songId) await query('DELETE FROM global_song_edits WHERE song_id = $1', [songId])
    for (const user of [userId, adminUserId]) {
      if (user) await deleteTestUser(admin, user)
    }
    if (songId) await query('DELETE FROM global_songs WHERE id = $1', [songId])
  })

  it('refuses an invalid payload at submission and inserts no edit row', async () => {
    const before = await countEdits()

    await expect(submitGlobalSongEdit(userId, songId, { duration_seconds: 'abc' })).rejects.toThrowError(
      new Error(BAD_DURATION),
    )

    expect(await countEdits()).toBe(before)
  })

  it('refuses a historical edit row whose proposed_data no longer validates', async () => {
    const edit = await one(
      `INSERT INTO global_song_edits (song_id, requested_by, proposed_data, status)
       VALUES ($1, $2, $3, 'pending') RETURNING id`,
      [songId, userId, JSON.stringify({ duration_seconds: 'abc' })],
    )
    const editId = edit.id as string

    await expect(reviewGlobalSongEdit(adminUserId, editId, 'approve')).rejects.toThrowError(
      new Error(BAD_DURATION),
    )

    const song = await one('SELECT title, duration_seconds FROM global_songs WHERE id = $1', [songId])
    expect(song.title).toBe(songTitle)
    expect(song.duration_seconds).toBe(217)

    const after = await one('SELECT status FROM global_song_edits WHERE id = $1', [editId])
    expect(after.status).toBe('pending')
  })
})

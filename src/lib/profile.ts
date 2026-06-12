import { query } from '@/lib/db'
import { logger } from '@/lib/logger'
import type { Profile } from '@/types/database'

export async function getProfile(userId: string): Promise<Profile | null> {
  const sql = 'SELECT * FROM profiles WHERE id = $1 LIMIT 1'
  try {
    const res = await query(sql, [userId])
    if (res.rowCount === 0) return null
    return res.rows[0] as Profile
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to fetch profile', err)
    throw new Error(`Failed to fetch profile: ${err.message}`)
  }
}

export async function updateProfile(
  userId: string,
  data: {
    full_name?: string | null
    avatar_url?: string | null
    instruments?: string[]
    primary_instrument?: string | null
  }
): Promise<void> {
  try {
    const setClauses: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const values: any[] = []
    let paramIndex = 1

    if (data.full_name !== undefined) {
      setClauses.push(`full_name = $${paramIndex++}`)
      values.push(data.full_name)
    }
    if (data.avatar_url !== undefined) {
      setClauses.push(`avatar_url = $${paramIndex++}`)
      values.push(data.avatar_url)
    }
    if (data.instruments !== undefined) {
      setClauses.push(`instruments = $${paramIndex++}`)
      values.push(data.instruments)
    }
    if (data.primary_instrument !== undefined) {
      setClauses.push(`primary_instrument = $${paramIndex++}`)
      values.push(data.primary_instrument)
    }

    if (setClauses.length === 0) return

    const sql = `
      UPDATE profiles
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
    `
    values.push(userId)

    const res = await query(sql, values)
    if (res.rowCount === 0) throw new Error('Profile not found')
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to update profile', err)
    throw new Error(`Failed to update profile: ${err.message}`)
  }
}

// Email changes are applied directly to both the Better Auth "user" table
// and the app profiles table. Better Auth's own changeEmail route requires
// email verification; this server-side function bypasses that for admin use.
export async function updateEmail(userId: string, newEmail: string): Promise<void> {
  try {
    await query('BEGIN')
    await query('UPDATE "user" SET email = $1, "updatedAt" = now() WHERE id = $2::uuid', [newEmail, userId])
    await query('UPDATE profiles SET email = $1 WHERE id = $2::uuid', [newEmail, userId])
    await query('COMMIT')
  } catch (err) {
    await query('ROLLBACK')
    const message = err instanceof Error ? err.message : String(err)
    logger.error('Failed to update email', new Error(message))
    throw new Error(`Failed to update email: ${message}`)
  }
}

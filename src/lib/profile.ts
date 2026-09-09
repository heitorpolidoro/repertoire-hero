// No email write lives here (RH-42) - see `src/lib/emailChange.ts`.
import { query } from '@/lib/db'
import { logger } from '@/lib/logger'
import type { Profile } from '@/types/database'

export async function getProfile(userId: string): Promise<Profile | null> {
  const sql = 'SELECT * FROM profiles WHERE id = $1 LIMIT 1'
  try {
    const res = await query<Profile>(sql, [userId])
    if (res.rowCount === 0) return null
    return res.rows[0]
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

    const res = await query<never>(sql, values)
    if (res.rowCount === 0) throw new Error('Profile not found')
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to update profile', err)
    throw new Error(`Failed to update profile: ${err.message}`)
  }
}

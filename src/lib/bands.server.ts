import { query } from '@/lib/db'
import { logger } from '@/lib/logger'

export async function getBandByInviteCodeServer(inviteCode: string): Promise<{
  id: string
  name: string
  description: string | null
  cover_url: string | null
  member_count: number
} | null> {
  try {
    const res = await query('SELECT * FROM get_band_by_invite_code($1)', [inviteCode])

    if (res.rowCount === 0) return null

    const row = res.rows[0]
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      cover_url: row.cover_url,
      member_count: Number(row.member_count),
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to fetch band by invite code', err)
    return null
  }
}

export async function joinBandByInviteServer(
  userId: string,
  inviteCode: string,
): Promise<string | null> {
  try {
    const res = await query('SELECT join_band_by_invite($1, $2) as band_id', [inviteCode, userId])
    return res.rows[0].band_id as string | null
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to join band by invite', err)
    return null
  }
}

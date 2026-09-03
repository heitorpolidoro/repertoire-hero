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
    throw new Error(`Failed to fetch band by invite code: ${err.message}`)
  }
}

export interface JoinBandResult {
  bandId: string
  alreadyMember: boolean
}

export async function joinBandByInviteServer(
  userId: string,
  inviteCode: string,
): Promise<JoinBandResult | null> {
  try {
    const res = await query('SELECT * FROM join_band_by_invite($1, $2)', [inviteCode, userId])
    const row = res.rows[0]
    if (!row || row.band_id === null) return null
    return { bandId: row.band_id as string, alreadyMember: Boolean(row.already_member) }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to join band by invite', err)
    throw new Error(`Failed to join band by invite: ${err.message}`)
  }
}

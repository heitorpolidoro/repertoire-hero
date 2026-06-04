import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

export async function getBandByInviteCodeServer(inviteCode: string): Promise<{
  id: string
  name: string
  description: string | null
  cover_url: string | null
  member_count: number
} | null> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .rpc('get_band_by_invite_code', { p_invite_code: inviteCode })

  if (error) {
    logger.error('Failed to fetch band by invite code', new Error(error.message))
    return null
  }

  if (!data || data.length === 0) return null

  const row = data[0]
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    cover_url: row.cover_url,
    member_count: Number(row.member_count),
  }
}

export async function joinBandByInviteServer(
  userId: string,
  inviteCode: string,
): Promise<string | null> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .rpc('join_band_by_invite', { p_user_id: userId, p_invite_code: inviteCode })

  if (error) {
    logger.error('Failed to join band by invite', new Error(error.message))
    return null
  }

  return data as string | null
}

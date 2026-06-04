import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRequiredUserId } from '@/lib/auth-session'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// POST /api/auth/spotify/disconnect
// Removes the user's Spotify token row, effectively disconnecting their account.
// ---------------------------------------------------------------------------
export async function POST(): Promise<NextResponse> {
  let userId: string
  try {
    userId = await getRequiredUserId()
  } catch {
    return NextResponse.json({ error: 'Unauthorized', code: 401 }, { status: 401 })
  }

  const supabase = createAdminClient()

  const { error } = await supabase
    .from('spotify_tokens')
    .delete()
    .eq('user_id', userId)

  if (error) {
    logger.error('Failed to disconnect Spotify', new Error(error.message))
    return NextResponse.json({ error: 'Failed to disconnect Spotify', code: 500 }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

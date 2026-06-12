import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
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

  try {
    await query('DELETE FROM spotify_tokens WHERE user_id = $1', [userId])
  } catch (error) {
    logger.error('Failed to disconnect Spotify', error as Error)
    return NextResponse.json({ error: 'Failed to disconnect Spotify', code: 500 }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

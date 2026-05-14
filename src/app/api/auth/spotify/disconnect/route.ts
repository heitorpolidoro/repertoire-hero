import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// POST /api/auth/spotify/disconnect
// Removes the user's Spotify token row, effectively disconnecting their account.
// ---------------------------------------------------------------------------
export async function POST(): Promise<NextResponse> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized', code: 401 }, { status: 401 })
  }

  const { error } = await supabase
    .from('spotify_tokens')
    .delete()
    .eq('user_id', user.id)

  if (error) {
    logger.error('Failed to disconnect Spotify', new Error(error.message))
    return NextResponse.json({ error: 'Failed to disconnect Spotify', code: 500 }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

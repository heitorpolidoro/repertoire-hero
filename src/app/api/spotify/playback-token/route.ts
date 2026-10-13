import { NextResponse } from 'next/server'
import { getRequiredUserId } from '@/lib/auth-session'
import { getSpotifyAccessToken, getSpotifyGrantedScope } from '@/lib/spotifyAuth'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// GET /api/spotify/playback-token (RH-164)
// A short-lived access token for the Web Playback SDK plus the facts the
// Fast View player decides on: connection, granted scope, Premium status.
// Never cached; the token is fetched by client code only, never rendered.
// ---------------------------------------------------------------------------
const NO_STORE = { 'Cache-Control': 'no-store' }

async function isPremium(token: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return false
    const profile = (await res.json()) as { product?: string }
    return profile.product === 'premium'
  } catch (error) {
    logger.error('[spotify/playback-token]', error instanceof Error ? error : undefined)
    return false
  }
}

export async function GET(): Promise<NextResponse> {
  let userId: string
  try {
    userId = await getRequiredUserId()
  } catch {
    return NextResponse.json({ error: 'User is not authenticated', code: 401 }, { status: 401, headers: NO_STORE })
  }

  const token = await getSpotifyAccessToken(userId)
  if (!token) {
    return NextResponse.json({ connected: false, scope: null, premium: false, token: null }, { headers: NO_STORE })
  }

  const [scope, premium] = await Promise.all([getSpotifyGrantedScope(userId), isPremium(token)])
  return NextResponse.json({ connected: true, scope, premium, token }, { headers: NO_STORE })
}

/**
 * Shared prologue for the `/api/spotify/playlists/[id]/*` route handlers:
 * resolve the session, then the Spotify access token, answering the same two
 * 401s the routes used to write out themselves.
 *
 * `/api/spotify/playlists/route.ts` is deliberately NOT a caller: it answers
 * `{ connected: false }` instead of a 401.
 */

import { NextResponse } from 'next/server'
import { getRequiredUserId } from '@/lib/auth-session'
import { getSpotifyAccessToken } from '@/lib/spotifyAuth'

export type SpotifyRouteAccess =
  | { ok: true; userId: string; accessToken: string }
  | { ok: false; response: NextResponse }

export async function resolveSpotifyRouteAccess(): Promise<SpotifyRouteAccess> {
  let userId: string
  try {
    userId = await getRequiredUserId()
  } catch {
    // No session — the caller has nothing to log; the 401 is the whole answer.
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized', code: 401 }, { status: 401 }),
    }
  }

  const accessToken = await getSpotifyAccessToken(userId)

  if (!accessToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Spotify not connected', code: 401 },
        { status: 401 }
      ),
    }
  }

  return { ok: true, userId, accessToken }
}

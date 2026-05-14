import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// Returns a valid Spotify access token for the currently authenticated user,
// automatically refreshing the token when it is within 60 seconds of expiry.
// Returns null when the user has not connected their Spotify account.
// ---------------------------------------------------------------------------
export async function getSpotifyAccessToken(supabase: SupabaseClient): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: tokenRow, error } = await supabase
    .from('spotify_tokens')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (error || !tokenRow) return null

  const expiresAt = new Date(tokenRow.expires_at).getTime()
  const nowWithBuffer = Date.now() + 60_000

  // Token is still valid — return it directly.
  if (expiresAt > nowWithBuffer) {
    return tokenRow.access_token as string
  }

  // Token has expired (or is about to) — refresh it.
  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    logger.error('Spotify credentials missing during token refresh')
    return null
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const refreshResponse = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokenRow.refresh_token as string,
    }).toString(),
  })

  if (!refreshResponse.ok) {
    logger.error('Spotify token refresh failed', undefined, { status: refreshResponse.status })
    return null
  }

  const refreshJson = (await refreshResponse.json()) as {
    access_token: string
    expires_in: number
    refresh_token?: string
  }

  const newExpiresAt = new Date(Date.now() + refreshJson.expires_in * 1000).toISOString()

  const { error: updateError } = await supabase
    .from('spotify_tokens')
    .update({
      access_token: refreshJson.access_token,
      // Spotify may issue a new refresh token on each refresh — persist it when present.
      refresh_token: refreshJson.refresh_token ?? tokenRow.refresh_token,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)

  if (updateError) {
    logger.error('Failed to persist refreshed Spotify token', new Error(updateError.message))
  }

  return refreshJson.access_token
}

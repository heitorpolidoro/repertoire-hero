import { query } from '@/lib/db'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// Returns a valid Spotify access token for the given user,
// automatically refreshing the token when it is within 60 seconds of expiry.
// Returns null when the user has not connected their Spotify account.
// ---------------------------------------------------------------------------
export async function getSpotifyAccessToken(userId: string): Promise<string | null> {
  let tokenRow: {
    access_token: string
    refresh_token: string
    expires_at: string
  } | null = null

  try {
    const res = await query('SELECT access_token, refresh_token, expires_at FROM spotify_tokens WHERE user_id = $1 LIMIT 1', [userId])
    if (res.rowCount === 0) return null
    tokenRow = res.rows[0]
  } catch (error) {
    logger.error('Failed to query Spotify tokens', error as Error)
    return null
  }

  const expiresAt = new Date(tokenRow.expires_at).getTime()
  const nowWithBuffer = Date.now() + 60_000

  // Token is still valid — return it directly.
  if (expiresAt > nowWithBuffer) {
    return tokenRow.access_token
  }

  // Token has expired (or is about to) — refresh it.
  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    logger.error('Spotify credentials missing during token refresh')
    return null
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  try {
    const refreshResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokenRow.refresh_token,
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

    const updateSql = `
      UPDATE spotify_tokens
      SET access_token = $1,
          refresh_token = $2,
          expires_at = $3,
          updated_at = now()
      WHERE user_id = $4
    `
    await query(updateSql, [
      refreshJson.access_token,
      refreshJson.refresh_token ?? tokenRow.refresh_token,
      newExpiresAt,
      userId,
    ])

    return refreshJson.access_token
  } catch (error) {
    logger.error('Failed to refresh Spotify token', error as Error)
    return null
  }
}

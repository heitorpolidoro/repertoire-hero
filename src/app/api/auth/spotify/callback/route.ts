import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { query } from '@/lib/db'
import { getRequiredUserId } from '@/lib/auth-session'
import { logger } from '@/lib/logger'

// Build a redirect URL using the real host from the request headers,
// not request.url (which can be 0.0.0.0 internally in Next.js dev).
function redirectTo(request: NextRequest, path: string): NextResponse {
  const host = request.headers.get('host') ?? '127.0.0.1:3000'
  const protocol = request.headers.get('x-forwarded-proto') ?? 'http'
  return NextResponse.redirect(`${protocol}://${host}${path}`)
}

// ---------------------------------------------------------------------------
// GET /api/auth/spotify/callback
// Handles the redirect from Spotify after the user grants (or denies) access.
// Verifies the CSRF state cookie, exchanges the authorization code for tokens,
// fetches the Spotify user profile, and upserts the token row in Supabase.
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const errorParam = searchParams.get('error')

  // User denied access on Spotify's consent screen.
  if (errorParam) {
    logger.warn('Spotify OAuth denied by user', { error: errorParam })
    return redirectTo(request, '/playlists?spotify=denied')
  }

  if (!code || !state) {
    return NextResponse.json(
      { error: 'Missing code or state parameter', code: 400 },
      { status: 400 }
    )
  }

  // --- CSRF state verification ---
  const cookieStore = await cookies()
  const storedState = cookieStore.get('spotify_oauth_state')?.value

  if (!storedState || storedState !== state) {
    logger.error('Spotify OAuth state mismatch — possible CSRF attack')
    return NextResponse.json(
      { error: 'Invalid state parameter', code: 403 },
      { status: 403 }
    )
  }

  // Clear the state cookie immediately to prevent replay.
  cookieStore.delete('spotify_oauth_state')

  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      { error: 'Spotify OAuth is not configured', code: 500 },
      { status: 500 }
    )
  }

  // --- Exchange authorization code for tokens ---
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }).toString(),
  })

  if (!tokenResponse.ok) {
    logger.error('Spotify token exchange failed', undefined, { status: tokenResponse.status })
    return NextResponse.json(
      { error: 'Failed to exchange authorization code', code: 502 },
      { status: 502 }
    )
  }

  const tokenJson = (await tokenResponse.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
  }

  // --- Fetch Spotify user profile to get the stable spotify_user_id ---
  const profileResponse = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  })

  let spotifyUserId: string | null = null
  if (profileResponse.ok) {
    const profile = (await profileResponse.json()) as { id: string }
    spotifyUserId = profile.id
  } else {
    logger.warn('Could not fetch Spotify user profile', { status: profileResponse.status })
  }

  // --- Verify authenticated user ---
  let userId: string
  try {
    userId = await getRequiredUserId()
  } catch {
    return NextResponse.json({ error: 'User is not authenticated', code: 401 }, { status: 401 })
  }

  // --- Persist tokens in Database ---
  const expiresAt = new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
  const now = new Date().toISOString()

  try {
    const upsertSql = `
      INSERT INTO spotify_tokens (user_id, access_token, refresh_token, expires_at, spotify_user_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id) DO UPDATE
      SET access_token = EXCLUDED.access_token,
          refresh_token = EXCLUDED.refresh_token,
          expires_at = EXCLUDED.expires_at,
          spotify_user_id = EXCLUDED.spotify_user_id,
          updated_at = EXCLUDED.updated_at
    `
    await query(upsertSql, [
      userId,
      tokenJson.access_token,
      tokenJson.refresh_token,
      expiresAt,
      spotifyUserId,
      now,
      now,
    ])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('Failed to save Spotify tokens', new Error(message))
    return NextResponse.json(
      { error: 'Failed to save Spotify connection', code: 500 },
      { status: 500 }
    )
  }

  return redirectTo(request, '/playlists')
}

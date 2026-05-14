import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

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
    return NextResponse.redirect(new URL('/playlists?spotify=denied', request.url))
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

  // --- Persist tokens in Supabase ---
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      { error: 'User is not authenticated', code: 401 },
      { status: 401 }
    )
  }

  const expiresAt = new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
  const now = new Date().toISOString()

  const { error: upsertError } = await supabase.from('spotify_tokens').upsert(
    {
      user_id: user.id,
      access_token: tokenJson.access_token,
      refresh_token: tokenJson.refresh_token,
      expires_at: expiresAt,
      spotify_user_id: spotifyUserId,
      created_at: now,
      updated_at: now,
    },
    { onConflict: 'user_id' }
  )

  if (upsertError) {
    logger.error('Failed to save Spotify tokens', new Error(upsertError.message))
    return NextResponse.json(
      { error: 'Failed to save Spotify connection', code: 500 },
      { status: 500 }
    )
  }

  return NextResponse.redirect(new URL('/playlists', request.url))
}

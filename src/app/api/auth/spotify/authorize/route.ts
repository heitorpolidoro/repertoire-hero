import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import crypto from 'crypto'

// ---------------------------------------------------------------------------
// GET /api/auth/spotify/authorize
// Builds the Spotify authorization URL, stores a CSRF state token in a
// short-lived cookie, and redirects the user to Spotify's consent screen.
// ---------------------------------------------------------------------------
export async function GET(): Promise<NextResponse> {
  const clientId = process.env.SPOTIFY_CLIENT_ID
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: 'Spotify OAuth is not configured', code: 500 },
      { status: 500 }
    )
  }

  // Generate a cryptographically random state value to prevent CSRF attacks.
  const state = crypto.randomBytes(16).toString('hex')

  const cookieStore = await cookies()
  cookieStore.set('spotify_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10, // 10 minutes — enough time to complete the OAuth flow
    path: '/',
  })

  const scopes = [
    'playlist-read-private',
    'playlist-modify-public',
    'playlist-modify-private',
    'user-read-private',
  ].join(' ')

  const authUrl = new URL('https://accounts.spotify.com/authorize')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', scopes)
  authUrl.searchParams.set('state', state)

  return NextResponse.redirect(authUrl.toString())
}

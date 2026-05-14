import { NextRequest, NextResponse } from 'next/server'

export interface SpotifyTrack {
  id: string
  title: string
  artist: string
  album: string | null
  spotifyUrl: string
  previewUrl: string | null
  albumArt: string | null
}

// ---------------------------------------------------------------------------
// In-memory token cache — avoids fetching a new token on every request.
// Client Credentials tokens are valid for 3600 s; we refresh 60 s early.
// ---------------------------------------------------------------------------
interface TokenCache {
  accessToken: string
  expiresAt: number // Date.now() ms
}

let tokenCache: TokenCache | null = null

async function getAccessToken(): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Spotify credentials are not configured')
  }

  // Return cached token if it is still valid (with a 60-second buffer)
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.accessToken
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  if (!response.ok) {
    throw new Error(`Spotify token request failed: ${response.status} ${response.statusText}`)
  }

  const json = (await response.json()) as { access_token: string; expires_in: number }

  tokenCache = {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  }

  return tokenCache.accessToken
}

// ---------------------------------------------------------------------------
// GET /api/spotify/search?q=<query>
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest): Promise<NextResponse> {
  // Graceful degradation — if Spotify is not configured, return an empty list
  if (!process.env.SPOTIFY_CLIENT_ID) {
    return NextResponse.json([])
  }

  const { searchParams } = request.nextUrl
  const q = searchParams.get('q')?.trim() ?? ''

  if (!q) {
    return NextResponse.json(
      { error: 'Missing required query parameter: q', code: 400 },
      { status: 400 }
    )
  }

  try {
    const accessToken = await getAccessToken()

    const searchUrl = new URL('https://api.spotify.com/v1/search')
    searchUrl.searchParams.set('q', q)
    searchUrl.searchParams.set('type', 'track')
    searchUrl.searchParams.set('limit', '8')

    const response = await fetch(searchUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      // Invalidate the cached token on auth errors so the next request retries
      if (response.status === 401) {
        tokenCache = null
      }
      throw new Error(`Spotify search failed: ${response.status} ${response.statusText}`)
    }

    const json = await response.json() as {
      tracks: {
        items: Array<{
          id: string
          name: string
          artists: Array<{ name: string }>
          external_urls: { spotify: string }
          preview_url: string | null
          album: {
            name: string
            images: Array<{ url: string; width: number; height: number }>
          }
        }>
      }
    }

    const tracks: SpotifyTrack[] = json.tracks.items.map((item) => ({
      id: item.id,
      title: item.name,
      artist: item.artists.map((a) => a.name).join(', '),
      album: item.album?.name ?? null,
      spotifyUrl: item.external_urls.spotify,
      previewUrl: item.preview_url,
      // Use the smallest image available as the thumbnail (last in Spotify's array)
      albumArt: item.album.images.at(-1)?.url ?? null,
    }))

    return NextResponse.json(tracks)
  } catch (error) {
    // Fail safely — Spotify is optional, so we log and return an empty list
    console.error('[spotify/search]', error instanceof Error ? error.message : error)
    return NextResponse.json([])
  }
}

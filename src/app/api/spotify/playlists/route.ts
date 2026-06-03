import { NextResponse } from 'next/server'
import { getRequiredUserId } from '@/lib/auth-session'
import { getSpotifyAccessToken } from '@/lib/spotifyAuth'
import { logger } from '@/lib/logger'
import type { SpotifyPlaylist } from '@/types/database'

// ---------------------------------------------------------------------------
// GET /api/spotify/playlists
// Returns the current user's Spotify playlists (up to 50).
// Returns { connected: false } when the user has not linked Spotify.
// ---------------------------------------------------------------------------
export async function GET(): Promise<NextResponse> {
  let userId: string
  try {
    userId = await getRequiredUserId()
  } catch {
    return NextResponse.json({ connected: false })
  }

  const accessToken = await getSpotifyAccessToken(userId)

  if (!accessToken) {
    return NextResponse.json({ connected: false })
  }

  try {
    const response = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      logger.error('Spotify playlists fetch failed', undefined, { status: response.status })
      return NextResponse.json(
        { error: 'Failed to fetch Spotify playlists', code: response.status },
        { status: response.status }
      )
    }

    const json = (await response.json()) as {
      items: Array<{
        id: string
        name: string
        description: string | null
        images: Array<{ url: string }>
        tracks: { total: number }
        owner: { display_name: string }
      }>
    }

    const playlists: SpotifyPlaylist[] = json.items.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description || null,
      cover_url: item.images?.[0]?.url ?? null,
      total_tracks: item.tracks.total,
      owner: item.owner.display_name,
    }))

    return NextResponse.json(playlists)
  } catch (error) {
    logger.error('[spotify/playlists]', error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Unexpected error fetching Spotify playlists', code: 500 },
      { status: 500 }
    )
  }
}

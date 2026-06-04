import { NextRequest, NextResponse } from 'next/server'
import { getRequiredUserId } from '@/lib/auth-session'
import { getSpotifyAccessToken } from '@/lib/spotifyAuth'
import { logger } from '@/lib/logger'

export interface SpotifyTrackItem {
  title: string
  artist: string
  album: string | null
  spotifyUrl: string
  albumArt: string | null
  spotifyTrackId: string
}

interface SpotifyTracksPage {
  items: Array<{
    track: {
      id: string
      name: string
      artists: Array<{ name: string }>
      album: { name: string; images: Array<{ url: string }> }
      external_urls: { spotify: string }
    } | null
  }>
  next: string | null
}

// ---------------------------------------------------------------------------
// Fetches all pages of tracks for a Spotify playlist, handling pagination.
// ---------------------------------------------------------------------------
async function fetchAllTracks(
  playlistId: string,
  accessToken: string
): Promise<SpotifyTrackItem[]> {
  const tracks: SpotifyTrackItem[] = []
  let url: string | null =
    `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`

  while (url) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      throw new Error(`Spotify tracks fetch failed: ${response.status} ${response.statusText}`)
    }

    const page = (await response.json()) as SpotifyTracksPage

    for (const item of page.items) {
      // Local tracks and podcast episodes have a null track field — skip them.
      if (!item.track) continue

      tracks.push({
        spotifyTrackId: item.track.id,
        title: item.track.name,
        artist: item.track.artists.map((a) => a.name).join(', '),
        album: item.track.album?.name ?? null,
        albumArt: item.track.album?.images?.[0]?.url ?? null,
        spotifyUrl: item.track.external_urls.spotify,
      })
    }

    url = page.next
  }

  return tracks
}

// ---------------------------------------------------------------------------
// GET /api/spotify/playlists/[id]/tracks
// Returns all tracks for a Spotify playlist (handles pagination internally).
// ---------------------------------------------------------------------------
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params

  let userId: string
  try {
    userId = await getRequiredUserId()
  } catch {
    return NextResponse.json({ error: 'Unauthorized', code: 401 }, { status: 401 })
  }

  const accessToken = await getSpotifyAccessToken(userId)

  if (!accessToken) {
    return NextResponse.json({ error: 'Spotify not connected', code: 401 }, { status: 401 })
  }

  try {
    const tracks = await fetchAllTracks(id, accessToken)
    return NextResponse.json({ tracks })
  } catch (error) {
    logger.error('[spotify/playlists/tracks]', error instanceof Error ? error : undefined, { id })
    return NextResponse.json(
      { error: 'Failed to fetch playlist tracks', code: 500 },
      { status: 500 }
    )
  }
}

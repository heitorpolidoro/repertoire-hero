import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { resolveSpotifyRouteAccess } from '@/lib/spotifyRouteAuth'
import { fetchAllSpotifyTracks } from '@/lib/spotifyPlaylistSync'

export interface SpotifyTrackItem {
  title: string
  artist: string
  album: string | null
  spotifyUrl: string
  albumArt: string | null
  spotifyTrackId: string
}

// ---------------------------------------------------------------------------
// GET /api/spotify/playlists/[id]/tracks
// Returns all tracks for a Spotify playlist (handles pagination internally).
//
// [id] here is a SPOTIFY playlist id, not a local playlists.id. Authorization is
// Spotify's: the id is forwarded with the caller's own access token, so this route
// grants nothing the caller could not obtain by calling api.spotify.com directly.
// There is therefore no local row to authorize — and this handler must stay that way.
// If it ever starts resolving a local playlist row by this id, the guard to add first
// is resolveOwnedPlaylist() in src/lib/spotifyRouteAuth.ts.
// ---------------------------------------------------------------------------
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params

  const access = await resolveSpotifyRouteAccess()
  if (!access.ok) return access.response

  try {
    const raw = await fetchAllSpotifyTracks(id, access.accessToken)
    // The shared helper also carries a track duration; this endpoint's payload
    // deliberately stays exactly the six fields it has always returned.
    const tracks: SpotifyTrackItem[] = raw.map(
      ({ spotifyTrackId, title, artist, album, albumArt, spotifyUrl }) => ({
        spotifyTrackId,
        title,
        artist,
        album,
        albumArt,
        spotifyUrl,
      })
    )
    return NextResponse.json({ tracks })
  } catch (error) {
    logger.error('[spotify/playlists/tracks]', error instanceof Error ? error : undefined, { id })
    return NextResponse.json(
      { error: 'Failed to fetch playlist tracks', code: 500 },
      { status: 500 }
    )
  }
}

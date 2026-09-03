import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { logger } from '@/lib/logger'
import { resolveSpotifyRouteAccess } from '@/lib/spotifyRouteAuth'
import {
  fetchAllSpotifyTracks,
  findOrCreateGlobalSong,
  ensureInRepertoire,
  buildPlaylistSongsInsert,
} from '@/lib/spotifyPlaylistSync'
import type { Playlist } from '@/types/database'

// ---------------------------------------------------------------------------
// POST /api/spotify/playlists/[id]/import
// Body: { sync_with_spotify: boolean, band_id?: string }
//
// Flow:
//  1. Fetch all Spotify tracks
//  2. Find-or-create each in global_songs
//  3. Find-or-create each in repertoire
//  4. Create a local playlist with spotify_playlist_id set
//  5. Add all songs to playlist_songs
//  6. Optionally mark sync_with_spotify and last_synced_at
// ---------------------------------------------------------------------------
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: spotifyPlaylistId } = await params

  const access = await resolveSpotifyRouteAccess()
  if (!access.ok) return access.response
  const { userId, accessToken } = access

  let syncWithSpotify = false
  let bandId: string | null = null
  try {
    const body = (await request.json()) as { sync_with_spotify?: boolean; band_id?: string }
    syncWithSpotify = body.sync_with_spotify ?? false
    bandId = body.band_id ?? null
  } catch {
    // Body is optional — default to no sync
  }

  try {
    // --- Step 1: fetch playlist metadata + tracks from Spotify ---
    const metaResponse = await fetch(
      `https://api.spotify.com/v1/playlists/${spotifyPlaylistId}?fields=name,description,images`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )

    let playlistName = 'Imported Playlist'
    let playlistDescription: string | null = null
    let coverUrl: string | null = null

    if (metaResponse.ok) {
      const meta = (await metaResponse.json()) as {
        name: string
        description: string | null
        images: Array<{ url: string }>
      }
      playlistName = meta.name
      playlistDescription = meta.description || null
      coverUrl = meta.images?.[0]?.url ?? null
    }

    const tracks = await fetchAllSpotifyTracks(spotifyPlaylistId, accessToken)

    // --- Steps 2 & 3: find-or-create songs and repertoire entries ---
    const songIds: string[] = []
    const owner = bandId ? { bandId } : { userId: userId }

    for (const track of tracks) {
      const songId = await findOrCreateGlobalSong(track)
      await ensureInRepertoire(songId, owner)
      songIds.push(songId)
    }

    // --- Step 4: create the local playlist ---
    const now = new Date().toISOString()
    const insertPlaylistSql = `
      INSERT INTO playlists (user_id, band_id, name, description, cover_url, spotify_playlist_id, sync_with_spotify, last_synced_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `
    const playlistRes = await query(insertPlaylistSql, [
      bandId ? null : userId,
      bandId ?? null,
      playlistName,
      playlistDescription,
      coverUrl,
      spotifyPlaylistId,
      syncWithSpotify,
      syncWithSpotify ? now : null,
    ])
    const playlist = playlistRes.rows[0] as Playlist

    // --- Step 5: add songs to playlist_songs ---
    if (songIds.length > 0) {
      const { sql, values } = buildPlaylistSongsInsert(playlist.id, songIds)
      await query(sql, values)
    }

    return NextResponse.json(playlist, { status: 201 })
  } catch (error) {
    logger.error(
      '[spotify/playlists/import]',
      error instanceof Error ? error : undefined,
      { spotifyPlaylistId }
    )
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Import failed', code: 500 },
      { status: 500 }
    )
  }
}

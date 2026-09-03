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

// ---------------------------------------------------------------------------
// POST /api/spotify/playlists/[id]/sync
// Body: { direction: 'pull' | 'push' }
//
// pull — fetch current Spotify tracks → add missing songs to local playlist
// push — read local playlist songs → replace Spotify playlist track list
// ---------------------------------------------------------------------------
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: localPlaylistId } = await params

  const access = await resolveSpotifyRouteAccess()
  if (!access.ok) return access.response
  const { userId, accessToken } = access

  let direction: 'pull' | 'push' = 'pull'
  try {
    const body = (await request.json()) as { direction?: 'pull' | 'push' }
    if (body.direction === 'push') direction = 'push'
  } catch {
    // Default to pull
  }

  try {
    // Fetch local playlist metadata
    const playlistRes = await query('SELECT * FROM playlists WHERE id = $1', [localPlaylistId])
    if (playlistRes.rowCount === 0) {
      return NextResponse.json({ error: 'Playlist not found', code: 404 }, { status: 404 })
    }
    const playlist = playlistRes.rows[0]

    // Fetch existing songs in the playlist
    const songsRes = await query('SELECT song_id FROM playlist_songs WHERE playlist_id = $1', [localPlaylistId])
    const localEntries = songsRes.rows

    if (!playlist.spotify_playlist_id) {
      return NextResponse.json(
        { error: 'Playlist is not linked to a Spotify playlist', code: 400 },
        { status: 400 }
      )
    }

    const spotifyPlaylistId = playlist.spotify_playlist_id as string
    let added = 0
    let removed = 0

    if (direction === 'pull') {
      const spotifyTracks = await fetchAllSpotifyTracks(spotifyPlaylistId, accessToken)

      const owner = playlist.band_id
        ? { bandId: playlist.band_id as string }
        : { userId: userId }

      const existingSongIds = new Set(localEntries.map((e) => e.song_id as string))
      const spotifySongIdsInOrder: string[] = []
      const seenSpotifySongs = new Set<string>()

      for (const track of spotifyTracks) {
        const songId = await findOrCreateGlobalSong(track)
        await ensureInRepertoire(songId, owner)
        if (!seenSpotifySongs.has(songId)) {
          seenSpotifySongs.add(songId)
          spotifySongIdsInOrder.push(songId)
        }
      }

      // Count added and removed for response summary
      for (const songId of spotifySongIdsInOrder) {
        if (!existingSongIds.has(songId)) {
          added++
        }
      }
      for (const entry of localEntries) {
        if (!seenSpotifySongs.has(entry.song_id)) {
          removed++
        }
      }

      // Re-order and sync local playlist song entries to match Spotify track order exactly
      await query('DELETE FROM playlist_songs WHERE playlist_id = $1', [localPlaylistId])

      if (spotifySongIdsInOrder.length > 0) {
        const { sql, values } = buildPlaylistSongsInsert(localPlaylistId, spotifySongIdsInOrder)
        await query(sql, values)
      }
    } else {
      // Push local playlist to Spotify
      const playlistSongsRes = await query(`
        SELECT ps.song_id, ps.position, s.links
        FROM playlist_songs ps
        JOIN global_songs s ON ps.song_id = s.id
        WHERE ps.playlist_id = $1
        ORDER BY ps.position ASC
      `, [localPlaylistId])
      const playlistSongs = playlistSongsRes.rows

      const uris: string[] = []

      for (const ps of playlistSongs) {
        const links = ps.links
        const spotifyLink = links?.find((l: { label: string; url: string }) => l.label === 'spotify')
        if (spotifyLink?.url) {
          const match = spotifyLink.url.match(/track\/([A-Za-z0-9]+)/)
          if (match) {
            uris.push(`spotify:track:${match[1]}`)
          }
        }
      }

      if (uris.length > 0) {
        const firstBatch = uris.slice(0, 100)
        const putResponse = await fetch(
          `https://api.spotify.com/v1/playlists/${spotifyPlaylistId}/tracks`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ uris: firstBatch }),
          }
        )

        if (!putResponse.ok) {
          throw new Error(`Spotify push failed: ${putResponse.status}`)
        }

        added += firstBatch.length

        for (let offset = 100; offset < uris.length; offset += 100) {
          const batch = uris.slice(offset, offset + 100)
          const postResponse = await fetch(
            `https://api.spotify.com/v1/playlists/${spotifyPlaylistId}/tracks`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ uris: batch }),
            }
          )

          if (!postResponse.ok) {
            throw new Error(`Spotify push (append batch) failed: ${postResponse.status}`)
          }

          added += batch.length
        }
      }
    }

    // Update last synced
    await query('UPDATE playlists SET last_synced_at = now(), updated_at = now() WHERE id = $1', [localPlaylistId])

    return NextResponse.json({ added, removed })
  } catch (error) {
    logger.error(
      '[spotify/playlists/sync]',
      error instanceof Error ? error : undefined,
      { localPlaylistId, direction }
    )
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed', code: 500 },
      { status: 500 }
    )
  }
}

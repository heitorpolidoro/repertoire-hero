import { NextRequest, NextResponse } from 'next/server'
import { query, withTransaction } from '@/lib/db'
import type { PlaylistSongIdRow, PlaylistSongLinksRow } from '@/lib/dbRows'
import { logger } from '@/lib/logger'
import { resolveSpotifyRouteAccess, resolveOwnedPlaylist } from '@/lib/spotifyRouteAuth'
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
//
// [id] is a LOCAL playlists.id, and both directions are destructive to it, so
// resolveOwnedPlaylist() runs before any read, write or outbound call: a pull
// replaces the whole track list and seeds every band member's repertoire, a
// push exfiltrates the local setlist into a Spotify playlist the caller picked.
// ---------------------------------------------------------------------------
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: localPlaylistId } = await params

  const access = await resolveSpotifyRouteAccess()
  if (!access.ok) return access.response
  const { userId, accessToken } = access

  const playlistAccess = await resolveOwnedPlaylist(localPlaylistId, userId)
  if (!playlistAccess.ok) return playlistAccess.response
  const { playlist } = playlistAccess

  let direction: 'pull' | 'push' = 'pull'
  try {
    const body = (await request.json()) as { direction?: 'pull' | 'push' }
    if (body.direction === 'push') direction = 'push'
  } catch {
    // Default to pull
  }

  try {
    // The row itself came from the guard; only the Spotify link is still needed.
    const linkRes = await query<{ spotify_playlist_id: string | null }>('SELECT spotify_playlist_id FROM playlists WHERE id = $1', [localPlaylistId])

    // Fetch existing songs in the playlist
    const songsRes = await query<PlaylistSongIdRow>('SELECT song_id FROM playlist_songs WHERE playlist_id = $1', [localPlaylistId])
    const localEntries = songsRes.rows

    if (!linkRes.rows[0].spotify_playlist_id) {
      return NextResponse.json(
        { error: 'Playlist is not linked to a Spotify playlist', code: 400 },
        { status: 400 }
      )
    }

    const spotifyPlaylistId = linkRes.rows[0].spotify_playlist_id
    let added = 0
    let removed = 0

    if (direction === 'pull') {
      const spotifyTracks = await fetchAllSpotifyTracks(spotifyPlaylistId, accessToken)

      const owner = playlist.band_id ? { bandId: playlist.band_id } : { userId: userId }

      const existingSongIds = new Set(localEntries.map((e) => e.song_id))
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

      // Re-order and sync local playlist song entries to match Spotify track
      // order exactly. Both statements share one transaction (RH-36, finding
      // F9): a failing re-insert used to leave the playlist permanently empty,
      // with no record of what it held. Deletes precede inserts inside the
      // transaction, so `uq_playlist_song_position` is never transiently
      // violated and does not need to be deferrable.
      await withTransaction(async (client) => {
        await client.query<never>('DELETE FROM playlist_songs WHERE playlist_id = $1', [localPlaylistId])

        if (spotifySongIdsInOrder.length > 0) {
          const { sql, values } = buildPlaylistSongsInsert(localPlaylistId, spotifySongIdsInOrder)
          await client.query<never>(sql, values)
        }
      })
    } else {
      // Push local playlist to Spotify
      const playlistSongsRes = await query<PlaylistSongLinksRow>(`
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
        const spotifyLink = links?.find((l) => l.label === 'spotify')
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
    await query<never>('UPDATE playlists SET last_synced_at = now(), updated_at = now() WHERE id = $1', [localPlaylistId])

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

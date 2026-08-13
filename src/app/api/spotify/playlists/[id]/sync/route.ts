import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getRequiredUserId } from '@/lib/auth-session'
import { getSpotifyAccessToken } from '@/lib/spotifyAuth'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface RawTrack {
  spotifyTrackId: string
  title: string
  artist: string
  album: string | null
  albumArt: string | null
  spotifyUrl: string
  durationSeconds: number | null
}

interface SpotifyTracksPage {
  items: Array<{
    track: {
      id: string
      name: string
      duration_ms: number
      artists: Array<{ name: string }>
      album: { name: string; images: Array<{ url: string }> }
      external_urls: { spotify: string }
    } | null
  }>
  next: string | null
}

// ---------------------------------------------------------------------------
// Pagination helper
// ---------------------------------------------------------------------------
async function fetchAllSpotifyTracks(
  spotifyPlaylistId: string,
  accessToken: string
): Promise<RawTrack[]> {
  const tracks: RawTrack[] = []
  let url: string | null =
    `https://api.spotify.com/v1/playlists/${spotifyPlaylistId}/tracks?limit=100`

  while (url) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      throw new Error(`Spotify tracks fetch failed: ${response.status}`)
    }

    const page = (await response.json()) as SpotifyTracksPage

    for (const item of page.items) {
      if (!item.track) continue
      tracks.push({
        spotifyTrackId: item.track.id,
        title: item.track.name,
        artist: item.track.artists.map((a) => a.name).join(', '),
        album: item.track.album?.name ?? null,
        albumArt: item.track.album?.images?.[0]?.url ?? null,
        spotifyUrl: item.track.external_urls.spotify,
        durationSeconds: item.track.duration_ms ? Math.round(item.track.duration_ms / 1000) : null,
      })
    }

    url = page.next
  }

  return tracks
}

import { sanitizeSongTitle } from '@/lib/songSanitizer'

async function findOrCreateGlobalSong(track: RawTrack): Promise<string> {
  const cleanTitle = sanitizeSongTitle(track.title)
  const albumValue = track.album?.trim() ?? ''
  const spotifyLink = { label: 'spotify', url: track.spotifyUrl }

  const lookupSql = `
    SELECT id, links FROM global_songs 
    WHERE LOWER(title) = LOWER($1) AND LOWER(artist) = LOWER($2)
    LIMIT 1
  `
  const { rows } = await query(lookupSql, [cleanTitle, track.artist.trim()])

  if (rows.length > 0) {
    const existingSongId = rows[0].id as string
    const existingLinks = (rows[0].links as Array<{ label: string; url: string }>) ?? []

    if (!existingLinks.some((l) => l.url === track.spotifyUrl)) {
      const updatedLinks = [...existingLinks, spotifyLink]
      await query('UPDATE global_songs SET links = $1 WHERE id = $2', [
        JSON.stringify(updatedLinks),
        existingSongId,
      ])
    }
    return existingSongId
  }

  const insertSql = `
    INSERT INTO global_songs (title, artist, album, cover_url, duration_seconds, links)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
  `
  const insertRes = await query(insertSql, [
    cleanTitle,
    track.artist.trim(),
    albumValue || null,
    track.albumArt ?? null,
    track.durationSeconds,
    JSON.stringify([spotifyLink]),
  ])
  return insertRes.rows[0].id as string
}

async function ensureInRepertoire(songId: string, owner: { userId?: string; bandId?: string }): Promise<void> {
  if (owner.bandId) {
    // 1. Ensure in Band Repertoire
    const bandRep = await query('SELECT id FROM repertoire WHERE band_id = $1 AND song_id = $2', [owner.bandId, songId])
    if (bandRep.rowCount === 0) {
      try {
        await query('INSERT INTO repertoire (band_id, song_id, status) VALUES ($1, $2, \'unknown\')', [owner.bandId, songId])
      } catch (err: any) {
        if (err.code !== '23505') throw err
      }
    }

    // 2. Fetch all members of the band
    const membersRes = await query('SELECT user_id FROM band_members WHERE band_id = $1', [owner.bandId])
    const members = membersRes.rows

    // 3. Ensure for each member of the band
    for (const member of members) {
      const memberRep = await query('SELECT id FROM repertoire WHERE user_id = $1 AND song_id = $2', [member.user_id, songId])
      if (memberRep.rowCount === 0) {
        try {
          await query('INSERT INTO repertoire (user_id, song_id, status) VALUES ($1, $2, \'unknown\')', [member.user_id, songId])
        } catch (err: any) {
          if (err.code !== '23505') throw err
        }
      }
    }
  } else if (owner.userId) {
    // Personal Repertoire
    const userRep = await query('SELECT id FROM repertoire WHERE user_id = $1 AND song_id = $2', [owner.userId, songId])
    if (userRep.rowCount === 0) {
      try {
        await query('INSERT INTO repertoire (user_id, song_id, status) VALUES ($1, $2, \'unknown\')', [owner.userId, songId])
      } catch (err: any) {
        if (err.code !== '23505') throw err
      }
    }
  }
}

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
        const valueClauses: string[] = []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const values: any[] = []
        let index = 1
        for (let i = 0; i < spotifySongIdsInOrder.length; i++) {
          valueClauses.push(`($${index++}, $${index++}, $${index++})`)
          values.push(localPlaylistId, spotifySongIdsInOrder[i], i + 1)
        }
        await query(
          `INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES ${valueClauses.join(', ')}`,
          values
        )
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

import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getRequiredUserId } from '@/lib/auth-session'
import { getSpotifyAccessToken } from '@/lib/spotifyAuth'
import { logger } from '@/lib/logger'
import type { Playlist } from '@/types/database'

// ---------------------------------------------------------------------------
// Shared helper: paginate through all tracks for a Spotify playlist.
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

async function fetchAllSpotifyTracks(
  playlistId: string,
  accessToken: string
): Promise<RawTrack[]> {
  const tracks: RawTrack[] = []
  let url: string | null =
    `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`

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

import { sanitizeSongTitle, sanitizeAlbumName } from '@/lib/songSanitizer'

// ---------------------------------------------------------------------------
// Internal helper: find existing global_song by title+artist (sanitized) or create it.
// Uses title + artist dedup.
// Returns the song id.
// ---------------------------------------------------------------------------
async function findOrCreateGlobalSong(track: RawTrack): Promise<string> {
  const cleanTitle = sanitizeSongTitle(track.title)
  const cleanAlbum = sanitizeAlbumName(track.album)
  const fullTrackLabel = track.title.trim()
  const spotifyLink = { label: fullTrackLabel, url: track.spotifyUrl }

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
    cleanAlbum || null,
    track.albumArt ?? null,
    track.durationSeconds,
    JSON.stringify([spotifyLink]),
  ])
  return insertRes.rows[0].id as string
}

// ---------------------------------------------------------------------------
// Ensures the song is in the user's repertoire. Safe to call multiple times.
// ---------------------------------------------------------------------------
async function ensureInRepertoire(songId: string, owner: { userId?: string; bandId?: string }): Promise<void> {
  if (owner.bandId) {
    // 1. Ensure in Band Repertoire
    const bandRep = await query('SELECT id FROM repertoire WHERE band_id = $1 AND song_id = $2', [owner.bandId, songId])
    if (bandRep.rowCount === 0) {
      try {
        await query('INSERT INTO repertoire (band_id, song_id, status) VALUES ($1, $2, \'unknown\')', [owner.bandId, songId])
      } catch (err) {
        // 23505 = unique_violation: the row is already there, which is not an error here.
        if ((err as { code?: string }).code !== '23505') throw err
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
        } catch (err) {
          // 23505 = unique_violation: the row is already there, which is not an error here.
          if ((err as { code?: string }).code !== '23505') throw err
        }
      }
    }
  } else if (owner.userId) {
    // Personal Repertoire
    const userRep = await query('SELECT id FROM repertoire WHERE user_id = $1 AND song_id = $2', [owner.userId, songId])
    if (userRep.rowCount === 0) {
      try {
        await query('INSERT INTO repertoire (user_id, song_id, status) VALUES ($1, $2, \'unknown\')', [owner.userId, songId])
      } catch (err) {
        // 23505 = unique_violation: the row is already there, which is not an error here.
        if ((err as { code?: string }).code !== '23505') throw err
      }
    }
  }
}

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
      const valueClauses: string[] = []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const values: any[] = []
      let index = 1
      for (let i = 0; i < songIds.length; i++) {
        valueClauses.push(`($${index++}, $${index++}, $${index++})`)
        values.push(playlist.id, songIds[i], i + 1)
      }
      const insertSongsSql = `
        INSERT INTO playlist_songs (playlist_id, song_id, position)
        VALUES ${valueClauses.join(', ')}
      `
      await query(insertSongsSql, values)
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

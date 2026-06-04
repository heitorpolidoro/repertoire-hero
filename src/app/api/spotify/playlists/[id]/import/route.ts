import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
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

// ---------------------------------------------------------------------------
// Resolves a global_songs row for the given track, creating it if absent.
// Uses title + album dedup (same logic as createAndAddSong in songs.ts).
// Returns the song id.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findOrCreateGlobalSong(supabase: any, track: RawTrack): Promise<string> {
  const albumValue = track.album?.trim() ?? ''

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lookupQuery: any = supabase
    .from('global_songs')
    .select('id')
    .ilike('title', track.title)

  if (albumValue) {
    lookupQuery = lookupQuery.ilike('album', albumValue)
  }

  const { data: existing, error: lookupError } = await lookupQuery.maybeSingle()

  if (lookupError) throw new Error(`Song lookup failed: ${lookupError.message}`)
  if (existing) {
    return existing.id as string
  }

  const { data: created, error: createError } = await supabase
    .from('global_songs')
    .insert({
      title: track.title,
      artist: track.artist,
      album: albumValue || null,
      cover_url: track.albumArt ?? null,
      duration_seconds: track.durationSeconds,
      links: [],
    })
    .select('id')
    .single()

  if (createError) throw new Error(`Song creation failed: ${createError.message}`)
  return created.id as string
}

// ---------------------------------------------------------------------------
// Ensures the song is in the user's repertoire. Safe to call multiple times.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureInRepertoire(supabase: any, songId: string, owner: { userId?: string; bandId?: string }): Promise<void> {
  if (owner.bandId) {
    // 1. Ensure in Band Repertoire
    const { data: existingBandRep } = await supabase
      .from('repertoire')
      .select('id')
      .eq('band_id', owner.bandId)
      .eq('song_id', songId)
      .maybeSingle()

    if (!existingBandRep) {
      const { error: bandError } = await supabase
        .from('repertoire')
        .insert({ song_id: songId, band_id: owner.bandId, status: 'unknown' })

      if (bandError && bandError.code !== '23505') {
        throw new Error(`Failed to add song to band repertoire: ${bandError.message}`)
      }
    }

    // 2. Fetch all members of the band
    const { data: members, error: membersError } = await supabase
      .from('band_members')
      .select('user_id')
      .eq('band_id', owner.bandId)

    if (membersError) {
      throw new Error(`Failed to fetch band members: ${membersError.message}`)
    }

    // 3. Ensure for each member of the band
    if (members) {
      for (const member of members) {
        const { data: existingMemberRep } = await supabase
          .from('repertoire')
          .select('id')
          .eq('user_id', member.user_id)
          .eq('song_id', songId)
          .maybeSingle()

        if (!existingMemberRep) {
          const { error: memberError } = await supabase
            .from('repertoire')
            .insert({ song_id: songId, user_id: member.user_id, status: 'unknown' })

          if (memberError && memberError.code !== '23505') {
            throw new Error(`Failed to add song to member repertoire: ${memberError.message}`)
          }
        }
      }
    }
  } else if (owner.userId) {
    // Personal Repertoire
    const { data: existingUserRep } = await supabase
      .from('repertoire')
      .select('id')
      .eq('user_id', owner.userId)
      .eq('song_id', songId)
      .maybeSingle()

    if (existingUserRep) return

    const { error } = await supabase
      .from('repertoire')
      .insert({ song_id: songId, user_id: owner.userId, status: 'unknown' })

    if (error && error.code !== '23505') {
      throw new Error(`Failed to add song to personal repertoire: ${error.message}`)
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

  const supabase = createAdminClient()
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
      const songId = await findOrCreateGlobalSong(supabase, track)
      await ensureInRepertoire(supabase, songId, owner)
      songIds.push(songId)
    }

    // --- Step 4: create the local playlist ---
    const now = new Date().toISOString()
    const { data: playlist, error: playlistError } = await supabase
      .from('playlists')
      .insert({
        user_id: bandId ? null : userId,
        band_id: bandId ?? null,
        name: playlistName,
        description: playlistDescription,
        cover_url: coverUrl,
        spotify_playlist_id: spotifyPlaylistId,
        sync_with_spotify: syncWithSpotify,
        last_synced_at: syncWithSpotify ? now : null,
      })
      .select('*')
      .single()

    if (playlistError) {
      throw new Error(`Failed to create playlist: ${playlistError.message}`)
    }

    // --- Step 5: add songs to playlist_songs ---
    if (songIds.length > 0) {
      const rows = songIds.map((songId, index) => ({
        playlist_id: (playlist as Playlist).id,
        song_id: songId,
        position: index + 1,
      }))

      const { error: songsError } = await supabase.from('playlist_songs').insert(rows)

      if (songsError) {
        throw new Error(`Failed to add songs to playlist: ${songsError.message}`)
      }
    }

    return NextResponse.json(playlist as Playlist, { status: 201 })
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

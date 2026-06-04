import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findOrCreateGlobalSong(supabase: any, track: RawTrack): Promise<string> {
  const albumValue = track.album?.trim() ?? ''

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lookupQuery: any = supabase.from('global_songs').select('id').ilike('title', track.title)
  if (albumValue) lookupQuery = lookupQuery.ilike('album', albumValue)

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
  // [id] here is the LOCAL playlist id (not the Spotify playlist id)
  const { id: localPlaylistId } = await params

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

  let direction: 'pull' | 'push' = 'pull'
  try {
    const body = (await request.json()) as { direction?: 'pull' | 'push' }
    if (body.direction === 'push') direction = 'push'
  } catch {
    // Default to pull
  }

  try {
    // Fetch the local playlist row to get the linked Spotify playlist id.
    const { data: playlist, error: playlistError } = await supabase
      .from('playlists')
      .select('*, songs:playlist_songs(song_id)')
      .eq('id', localPlaylistId)
      .single()

    if (playlistError || !playlist) {
      return NextResponse.json({ error: 'Playlist not found', code: 404 }, { status: 404 })
    }

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
      // -----------------------------------------------------------------------
      // Pull: mirror the Spotify playlist locally.
      //   - Add tracks present in Spotify but missing from local.
      //   - Remove local playlist entries whose song is no longer in Spotify.
      //     (Songs are only removed from the playlist, never from the repertoire.)
      // -----------------------------------------------------------------------
      const spotifyTracks = await fetchAllSpotifyTracks(spotifyPlaylistId, accessToken)

      // Resolve (or create) a local song id for every Spotify track.
      const spotifySongIds = new Set<string>()
      const owner = playlist.band_id
        ? { bandId: playlist.band_id as string }
        : { userId: userId }

      for (const track of spotifyTracks) {
        const songId = await findOrCreateGlobalSong(supabase, track)
        await ensureInRepertoire(supabase, songId, owner)
        spotifySongIds.add(songId)
      }

      // Current local playlist entries.
      const localEntries = (playlist.songs as Array<{ song_id: string }>)

      // Remove songs that are no longer in the Spotify playlist.
      for (const entry of localEntries) {
        if (!spotifySongIds.has(entry.song_id)) {
          const { error } = await supabase
            .from('playlist_songs')
            .delete()
            .eq('playlist_id', localPlaylistId)
            .eq('song_id', entry.song_id)

          if (error) throw new Error(`Failed to remove song from playlist: ${error.message}`)
          removed++
        }
      }

      // Add songs present in Spotify but missing from local.
      const existingSongIds = new Set(localEntries.map((e) => e.song_id))
      let nextPosition = existingSongIds.size + 1

      for (const track of spotifyTracks) {
        const songId = await findOrCreateGlobalSong(supabase, track)

        if (!existingSongIds.has(songId)) {
          const { error } = await supabase.from('playlist_songs').insert({
            playlist_id: localPlaylistId,
            song_id: songId,
            position: nextPosition,
          })

          if (error && error.code !== '23505') {
            throw new Error(`Failed to add song to playlist: ${error.message}`)
          }

          existingSongIds.add(songId)
          nextPosition++
          added++
        }
      }
    } else {
      // -----------------------------------------------------------------------
      // Push: replace the Spotify playlist's track list with local songs.
      // Reads spotify_track_id from global_songs or uses the Spotify search
      // to resolve a Spotify URI for each local song.
      // Strategy: we store spotifyTrackId in global_songs.links as a
      // {label: 'spotify', url: 'spotify:track:<id>'} link when importing.
      // As a fallback we skip songs without a resolvable URI.
      // -----------------------------------------------------------------------

      // Fetch full song details including links.
      const { data: playlistSongs, error: songsError } = await supabase
        .from('playlist_songs')
        .select('song_id, position, song:global_songs(links)')
        .eq('playlist_id', localPlaylistId)
        .order('position', { ascending: true })

      if (songsError) throw new Error(`Failed to fetch playlist songs: ${songsError.message}`)

      const uris: string[] = []

      type PlaylistSongRow = {
        song_id: string
        position: number
        song: { links: Array<{ label: string; url: string }> } | null
      }

      for (const ps of (playlistSongs ?? []) as unknown as PlaylistSongRow[]) {
        const spotifyLink = ps.song?.links?.find((l) => l.label === 'spotify')
        if (spotifyLink?.url) {
          // Convert https://open.spotify.com/track/<id> → spotify:track:<id>
          const match = spotifyLink.url.match(/track\/([A-Za-z0-9]+)/)
          if (match) {
            uris.push(`spotify:track:${match[1]}`)
          }
        }
      }

      if (uris.length > 0) {
        // Spotify's PUT endpoint replaces the entire playlist — send in batches of 100.
        // First batch uses PUT, subsequent batches use POST (append).
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

        // Append remaining batches.
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

    // --- Update last_synced_at ---
    await supabase
      .from('playlists')
      .update({ last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', localPlaylistId)

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

import { createClient } from '@/lib/supabase/client'
import { logger } from '@/lib/logger'
import type { Playlist } from '@/types/database'

// ---------------------------------------------------------------------------
// All functions use the browser (client-side) Supabase client.
// RLS policies on the database enforce that users can only access their own
// playlists and playlist_songs rows.
// ---------------------------------------------------------------------------

export async function getUserPlaylists(): Promise<Playlist[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('playlists')
    .select('*, songs:playlist_songs(id, song:global_songs(duration_seconds)), band:bands(id, name)')
    .order('created_at', { ascending: false })

  if (error) {
    logger.error('Failed to fetch playlists', new Error(error.message), { code: error.code })
    throw new Error(`Failed to fetch playlists: ${error.message}`)
  }

  return data as Playlist[]
}

export async function createPlaylist(data: {
  name: string
  description?: string
}): Promise<Playlist> {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Cannot create playlist: user is not authenticated')

  const { data: playlist, error } = await supabase
    .from('playlists')
    .insert({
      user_id: user.id,
      name: data.name,
      description: data.description ?? null,
    })
    .select('*')
    .single()

  if (error) {
    logger.error('Failed to create playlist', new Error(error.message), { code: error.code })
    throw new Error(`Failed to create playlist: ${error.message}`)
  }

  return playlist as Playlist
}

export async function updatePlaylist(
  id: string,
  data: {
    name?: string
    description?: string
    sync_with_spotify?: boolean
    tags?: string[]
  }
): Promise<void> {
  const supabase = createClient()

  const { error } = await supabase
    .from('playlists')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    logger.error('Failed to update playlist', new Error(error.message), { code: error.code, id })
    throw new Error(`Failed to update playlist: ${error.message}`)
  }
}

export async function deletePlaylist(id: string): Promise<void> {
  const supabase = createClient()

  const { error } = await supabase.from('playlists').delete().eq('id', id)

  if (error) {
    logger.error('Failed to delete playlist', new Error(error.message), { code: error.code, id })
    throw new Error(`Failed to delete playlist: ${error.message}`)
  }
}

export async function addSongToPlaylist(playlistId: string, songId: string): Promise<void> {
  const supabase = createClient()

  // Determine the next position by counting existing songs.
  const { count, error: countError } = await supabase
    .from('playlist_songs')
    .select('id', { count: 'exact', head: true })
    .eq('playlist_id', playlistId)

  if (countError) {
    logger.error('Failed to count playlist songs', new Error(countError.message), {
      code: countError.code,
      playlistId,
    })
    throw new Error(`Failed to count playlist songs: ${countError.message}`)
  }

  const position = (count ?? 0) + 1

  const { error } = await supabase.from('playlist_songs').insert({
    playlist_id: playlistId,
    song_id: songId,
    position,
  })

  if (error) {
    logger.error('Failed to add song to playlist', new Error(error.message), {
      code: error.code,
      playlistId,
      songId,
    })
    throw new Error(`Failed to add song to playlist: ${error.message}`)
  }
}

export async function removeSongFromPlaylist(playlistId: string, songId: string): Promise<void> {
  const supabase = createClient()

  const { error } = await supabase
    .from('playlist_songs')
    .delete()
    .eq('playlist_id', playlistId)
    .eq('song_id', songId)

  if (error) {
    logger.error('Failed to remove song from playlist', new Error(error.message), {
      code: error.code,
      playlistId,
      songId,
    })
    throw new Error(`Failed to remove song from playlist: ${error.message}`)
  }
}

export async function getPlaylistWithSongs(id: string): Promise<Playlist | null> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('playlists')
    .select('*, songs:playlist_songs(*, song:global_songs(*))')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // row not found
    logger.error('Failed to fetch playlist with songs', new Error(error.message), {
      code: error.code,
      id,
    })
    throw new Error(`Failed to fetch playlist with songs: ${error.message}`)
  }

  return data as Playlist
}

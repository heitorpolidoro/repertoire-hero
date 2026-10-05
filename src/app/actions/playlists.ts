'use server'

import { getRequiredUserId } from '@/lib/auth-session'
import {
  getUserPlaylists,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  addSongToPlaylist,
  removeSongFromPlaylist,
  reorderPlaylistSongs,
  getPlaylistWithSongs,
  getPlaylistDetailsWithEntries,
  type PlaylistEntrySummary,
} from '@/lib/playlists'
import type { Playlist } from '@/types/database'

export async function getUserPlaylistsAction(): Promise<Playlist[]> {
  const userId = await getRequiredUserId()
  return getUserPlaylists(userId)
}

export async function createPlaylistAction(data: {
  name: string
  description?: string
}): Promise<Playlist> {
  const userId = await getRequiredUserId()
  return createPlaylist(userId, data)
}

export async function updatePlaylistAction(
  id: string,
  data: {
    name?: string
    description?: string
    sync_with_spotify?: boolean
    tags?: string[]
  }
): Promise<void> {
  const userId = await getRequiredUserId()
  return updatePlaylist(id, userId, data)
}

export async function deletePlaylistAction(id: string): Promise<void> {
  const userId = await getRequiredUserId()
  return deletePlaylist(id, userId)
}

export async function addSongToPlaylistAction(playlistId: string, songId: string): Promise<void> {
  const userId = await getRequiredUserId()
  return addSongToPlaylist(playlistId, userId, songId)
}

export async function removeSongFromPlaylistAction(playlistId: string, songId: string): Promise<void> {
  const userId = await getRequiredUserId()
  return removeSongFromPlaylist(playlistId, userId, songId)
}

/**
 * RH-103 — rewrites the playlist's order. `orderedIds` are `playlist_songs.id`s
 * in their intended order; the lib function refuses anything that is not
 * exactly the playlist's row set, and refuses a band playlist to a non-admin.
 */
export async function reorderPlaylistSongsAction(
  playlistId: string,
  orderedIds: string[]
): Promise<void> {
  const userId = await getRequiredUserId()
  return reorderPlaylistSongs(playlistId, userId, orderedIds)
}

export async function getPlaylistWithSongsAction(id: string) {
  const userId = await getRequiredUserId()
  return getPlaylistWithSongs(id, userId)
}

export async function getPlaylistDetailsWithEntriesAction(
  playlistId: string,
  bandId?: string | null
): Promise<{ name: string; entries: PlaylistEntrySummary[] }> {
  const userId = await getRequiredUserId()
  // Both client-supplied ids are authorized inside the lib function, in the
  // same order: the playlist first, then the band owner context.
  return getPlaylistDetailsWithEntries(playlistId, userId, bandId)
}

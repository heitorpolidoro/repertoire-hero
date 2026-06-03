'use server'

import { getRequiredUserId } from '@/lib/auth-session'
import {
  getUserPlaylists,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  addSongToPlaylist,
  removeSongFromPlaylist,
  getPlaylistWithSongs,
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
  return updatePlaylist(id, data)
}

export async function deletePlaylistAction(id: string): Promise<void> {
  return deletePlaylist(id)
}

export async function addSongToPlaylistAction(playlistId: string, songId: string): Promise<void> {
  const userId = await getRequiredUserId()
  return addSongToPlaylist(userId, playlistId, songId)
}

export async function removeSongFromPlaylistAction(playlistId: string, songId: string): Promise<void> {
  return removeSongFromPlaylist(playlistId, songId)
}

export async function getPlaylistWithSongsAction(id: string) {
  return getPlaylistWithSongs(id)
}

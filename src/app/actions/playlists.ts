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

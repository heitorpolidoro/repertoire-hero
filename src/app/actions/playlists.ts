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
  assertPlaylistAccess,
} from '@/lib/playlists'
import { assertBandMember } from '@/lib/bands'
import { query } from '@/lib/db'
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
): Promise<{
  name: string
  entries: Array<{ repertoireId: string; songId: string; title: string; artist: string | null }>
}> {
  const userId = await getRequiredUserId()
  // Both ids are client-supplied: the playlist must be one the caller may read,
  // and the owner context it is read under must be a band they belong to.
  await assertPlaylistAccess(playlistId, userId)
  if (bandId) await assertBandMember(bandId, userId)

  const playlistRes = await query('SELECT name FROM playlists WHERE id = $1', [playlistId])
  const name = (playlistRes.rows[0]?.name as string) ?? 'Playlist'

  const sql = `
    SELECT ps.position, r.id AS repertoire_id, ps.song_id, s.title, s.artist
    FROM playlist_songs ps
    JOIN global_songs s ON s.id = ps.song_id
    JOIN repertoire r ON r.song_id = ps.song_id
      AND (
        ($1::uuid IS NOT NULL AND r.band_id = $1::uuid)
        OR
        ($1::uuid IS NULL AND r.user_id = $2::uuid)
      )
    WHERE ps.playlist_id = $3
    ORDER BY ps.position ASC
  `
  const res = await query(sql, [bandId ?? null, userId, playlistId])
  const entries = res.rows.map((row) => ({
    repertoireId: row.repertoire_id as string,
    songId: row.song_id as string,
    title: row.title as string,
    artist: row.artist as string | null,
  }))

  return { name, entries }
}

/**
 * Returns an ordered list of repertoire entry IDs for a playlist,
 * matched against the given owner context (bandId or the current user).
 */
export async function getPlaylistEntryIdsAction(
  playlistId: string,
  bandId?: string | null
): Promise<Array<{ repertoireId: string; songId: string; title: string; artist: string | null }>> {
  const details = await getPlaylistDetailsWithEntriesAction(playlistId, bandId)
  return details.entries
}

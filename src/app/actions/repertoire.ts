'use server'

import { getRequiredUserId } from '@/lib/auth-session'
import {
  getRepertoire,
  addSongToRepertoire,
  updateSongStatus,
  updateSongTags,
  updatePersonalKey,
  removeSongFromRepertoire,
  searchGlobalSongs,
  getSongEntry,
  updateSong,
  createAndAddSong,
} from '@/lib/songs'
import type { Repertoire, SongLink, SongStatus } from '@/types/database'

export async function getRepertoireAction() {
  const userId = await getRequiredUserId()
  return getRepertoire(userId)
}

export async function addSongAction(songId: string) {
  const userId = await getRequiredUserId()
  return addSongToRepertoire(userId, songId)
}

export async function updateSongStatusAction(repertoireId: string, status: SongStatus) {
  const userId = await getRequiredUserId()
  return updateSongStatus(userId, repertoireId, status)
}

export async function updateSongTagsAction(repertoireId: string, tags: string[]) {
  const userId = await getRequiredUserId()
  return updateSongTags(userId, repertoireId, tags)
}

export async function updatePersonalKeyAction(repertoireId: string, personalKey: string) {
  const userId = await getRequiredUserId()
  return updatePersonalKey(userId, repertoireId, personalKey)
}

export async function removeSongAction(repertoireId: string) {
  const userId = await getRequiredUserId()
  return removeSongFromRepertoire(userId, repertoireId)
}

export async function searchGlobalSongsAction(query: string) {
  return searchGlobalSongs(query)
}

export async function getSongEntryAction(repertoireId: string) {
  const userId = await getRequiredUserId()
  return getSongEntry(userId, repertoireId)
}

export async function updateSongAction(
  entry: Repertoire,
  data: {
    title: string
    artist: string
    album?: string | null
    key: string | null
    status: SongStatus
    tags: string[]
    links: SongLink[]
    cover_url?: string | null
    duration_seconds?: number | null
  }
) {
  const userId = await getRequiredUserId()
  return updateSong(userId, entry, data)
}

export async function createAndAddSongAction(data: {
  title: string
  artist: string
  album?: string
  standard_key?: string
  cover_url?: string
  duration_seconds?: number
  links?: SongLink[]
}) {
  const userId = await getRequiredUserId()
  return createAndAddSong(userId, data)
}

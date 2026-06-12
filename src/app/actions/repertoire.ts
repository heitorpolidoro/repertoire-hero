'use server'

import { getRequiredUserId } from '@/lib/auth-session'
import { query } from '@/lib/db'
import { STATUS_ORDER } from '@/lib/statusConfig'
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
  type RepertoireOwner,
} from '@/lib/songs'
import type { Repertoire, SongLink, SongStatus } from '@/types/database'

async function resolveOwner(bandId?: string | null): Promise<RepertoireOwner> {
  const userId = await getRequiredUserId()
  return bandId ? { bandId } : { userId }
}

export async function getRepertoireAction(bandId?: string | null) {
  const owner = await resolveOwner(bandId)
  return getRepertoire(owner)
}

export async function addSongAction(songId: string, bandId?: string | null) {
  const owner = await resolveOwner(bandId)
  return addSongToRepertoire(owner, songId)
}

export async function updateSongStatusAction(repertoireId: string, status: SongStatus, bandId?: string | null) {
  const owner = await resolveOwner(bandId)
  return updateSongStatus(owner, repertoireId, status)
}

export async function updateSongTagsAction(repertoireId: string, tags: string[], bandId?: string | null) {
  const owner = await resolveOwner(bandId)
  return updateSongTags(owner, repertoireId, tags)
}

export async function updatePersonalKeyAction(repertoireId: string, personalKey: string, bandId?: string | null) {
  const owner = await resolveOwner(bandId)
  return updatePersonalKey(owner, repertoireId, personalKey)
}

export async function removeSongAction(repertoireId: string, bandId?: string | null) {
  const owner = await resolveOwner(bandId)
  return removeSongFromRepertoire(owner, repertoireId)
}

export async function searchGlobalSongsAction(queryStr: string) {
  return searchGlobalSongs(queryStr)
}

export async function getSongEntryAction(repertoireId: string, bandId?: string | null) {
  const owner = await resolveOwner(bandId)
  return getSongEntry(owner, repertoireId)
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
  },
  bandId?: string | null
) {
  const owner = await resolveOwner(bandId)
  return updateSong(owner, entry, data)
}

export async function createAndAddSongAction(
  data: {
    title: string
    artist: string
    album?: string
    standard_key?: string
    cover_url?: string
    duration_seconds?: number
    links?: SongLink[]
  },
  bandId?: string | null
) {
  const owner = await resolveOwner(bandId)
  return createAndAddSong(owner, data)
}

/**
 * For a band playlist: returns a map of song_id → weakest status across all
 * band members who have that song in their personal repertoire.
 * Members who haven't added the song are ignored (not treated as "unknown").
 */
export async function getBandWeakestStatusAction(
  bandId: string,
  songIds: string[],
): Promise<Record<string, SongStatus>> {
  if (!songIds.length) return {}

  try {
    const sql = `
      SELECT song_id, status, user_id
      FROM repertoire
      WHERE song_id = ANY($1::uuid[])
        AND user_id IS NOT NULL
        AND user_id IN (
          SELECT user_id FROM band_members WHERE band_id = $2
        )
    `
    const { rows } = await query(sql, [songIds, bandId])

    const result: Record<string, SongStatus> = {}
    for (const row of rows) {
      const current = result[row.song_id]
      if (!current) {
        result[row.song_id] = row.status as SongStatus
      } else {
        const currentIdx = STATUS_ORDER.indexOf(current)
        const newIdx = STATUS_ORDER.indexOf(row.status as SongStatus)
        if (newIdx < currentIdx) result[row.song_id] = row.status as SongStatus
      }
    }
    return result
  } catch {
    return {}
  }
}

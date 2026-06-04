'use server'

import { getRequiredUserId } from '@/lib/auth-session'
import { createAdminClient } from '@/lib/supabase/admin'
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

export async function searchGlobalSongsAction(query: string) {
  return searchGlobalSongs(query)
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

  const supabase = createAdminClient()

  // Fetch all personal repertoire rows for band members matching the song list
  const { data, error } = await supabase
    .from('repertoire')
    .select('song_id, status, user_id')
    .in('song_id', songIds)
    .not('user_id', 'is', null)
    .in(
      'user_id',
      // subquery-style: fetch band member user_ids first
      (
        await supabase
          .from('band_members')
          .select('user_id')
          .eq('band_id', bandId)
      ).data?.map((m) => m.user_id) ?? [],
    )

  if (error || !data) return {}

  // For each song, pick the minimum status across all members
  const result: Record<string, SongStatus> = {}
  for (const row of data) {
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
}

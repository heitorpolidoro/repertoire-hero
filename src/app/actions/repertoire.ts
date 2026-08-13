'use server'

import { revalidatePath } from 'next/cache'
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
  const result = await addSongToRepertoire(owner, songId)
  revalidatePath('/')
  return result
}

export async function updateSongStatusAction(repertoireId: string, status: SongStatus, bandId?: string | null) {
  const owner = await resolveOwner(bandId)
  const result = await updateSongStatus(owner, repertoireId, status)
  revalidatePath('/')
  return result
}

export async function updateSongTagsAction(repertoireId: string, tags: string[], bandId?: string | null) {
  const owner = await resolveOwner(bandId)
  const result = await updateSongTags(owner, repertoireId, tags)
  revalidatePath('/')
  return result
}

export async function updatePersonalKeyAction(repertoireId: string, personalKey: string, bandId?: string | null) {
  const owner = await resolveOwner(bandId)
  const result = await updatePersonalKey(owner, repertoireId, personalKey)
  revalidatePath('/')
  return result
}

export async function removeSongAction(repertoireId: string, bandId?: string | null) {
  const owner = await resolveOwner(bandId)
  const result = await removeSongFromRepertoire(owner, repertoireId)
  revalidatePath('/')
  return result
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
  const result = await updateSong(owner, entry, data)
  revalidatePath('/')
  return result
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
  const result = await createAndAddSong(owner, data)
  revalidatePath('/')
  return result
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

export async function updateLyricsAction(repertoireId: string, lyrics: string, bandId?: string | null) {
  const owner = await resolveOwner(bandId)
  if ('bandId' in owner) {
    await query(
      'UPDATE repertoire SET lyrics = $1 WHERE id = $2 AND band_id = $3',
      [lyrics, repertoireId, owner.bandId]
    )
  } else {
    await query(
      'UPDATE repertoire SET lyrics = $1 WHERE id = $2 AND user_id = $3',
      [lyrics, repertoireId, owner.userId]
    )
  }
  revalidatePath('/')
}

export async function fetchLyricsAction(artist: string, title: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
      { signal: AbortSignal.timeout(5000) }
    )
    if (!res.ok) return null
    const data = await res.json()
    return data.lyrics || null
  } catch {
    return null
  }
}

export async function updateSongLinksAction(repertoireIdOrSongId: string, links: SongLink[]): Promise<{ success: boolean }> {
  let songId: string | null = null

  const repRes = await query(`SELECT song_id FROM repertoire WHERE id = $1`, [repertoireIdOrSongId])
  if (repRes.rowCount && repRes.rowCount > 0) {
    songId = repRes.rows[0].song_id
  } else {
    const songRes = await query(`SELECT id FROM global_songs WHERE id = $1`, [repertoireIdOrSongId])
    if (songRes.rowCount && songRes.rowCount > 0) {
      songId = songRes.rows[0].id
    }
  }

  if (!songId) {
    throw new Error('Song entry not found')
  }

  await query(
    `UPDATE global_songs SET links = $1 WHERE id = $2`,
    [JSON.stringify(links), songId]
  )

  revalidatePath('/')
  return { success: true }
}

export async function getPersonalEntryForSongAction(songId: string): Promise<Repertoire | null> {
  try {
    const userId = await getRequiredUserId()
    const res = await query(
      `SELECT r.*,
              json_build_object(
                'id', s.id,
                'contributor_id', s.contributor_id,
                'title', s.title,
                'artist', s.artist,
                'album', s.album,
                'standard_key', s.standard_key,
                'cover_url', s.cover_url,
                'duration_seconds', s.duration_seconds,
                'links', s.links,
                'created_at', s.created_at
              ) as song
       FROM repertoire r
       JOIN global_songs s ON r.song_id = s.id
       WHERE r.song_id = $1 AND r.user_id = $2`,
      [songId, userId]
    )
    if (res.rowCount === 0) return null
    return res.rows[0] as Repertoire
  } catch {
    return null
  }
}

'use server'

import { revalidatePath } from 'next/cache'
import { getRequiredUserId } from '@/lib/auth-session'
import { query } from '@/lib/db'
import {
  getRepertoire,
  addSongToRepertoire,
  updateSongStatus,
  updateSongTags,
  removeSongFromRepertoire,
  searchGlobalSongs,
  getSongEntry,
  updateSong,
  createAndAddSong,
  assertRepertoireAccess,
  type RepertoireOwner,
  type SongUpdateInput,
} from '@/lib/songs'
import { assertBandMember } from '@/lib/bands'
import { submitGlobalSongEdit } from '@/lib/moderation'
import type { Repertoire, SongLink, SongStatus } from '@/types/database'

async function resolveOwner(bandId?: string | null): Promise<RepertoireOwner> {
  const userId = await getRequiredUserId()
  if (!bandId) return { userId }
  // `bandId` comes from the caller's own band-context store, so a mismatch is
  // never a legitimate navigation: throw rather than silently return nothing.
  await assertBandMember(bandId, userId)
  return { bandId }
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

export async function removeSongAction(repertoireId: string, bandId?: string | null) {
  const owner = await resolveOwner(bandId)
  const result = await removeSongFromRepertoire(owner, repertoireId)
  revalidatePath('/')
  return result
}

export async function searchGlobalSongsAction(queryStr: string) {
  await getRequiredUserId()
  return searchGlobalSongs(queryStr)
}

export async function getSongEntryAction(repertoireId: string, bandId?: string | null) {
  const owner = await resolveOwner(bandId)
  return getSongEntry(owner, repertoireId)
}

export async function updateSongAction(
  entry: Repertoire,
  data: SongUpdateInput,
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
  // Outside the try on purpose: the `catch { return null }` below would turn a
  // missing session into a silent null, which is not failing closed.
  await getRequiredUserId()

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

/**
 * Writes to the shared `global_songs.links` catalog on behalf of a repertoire
 * owner. Additive changes land directly (a musician adding a chords link
 * mid-rehearsal needs to see it now); removing or rewriting an existing link is
 * a correction to data everyone else sees, so it goes to the RH-15/RH-27
 * moderation queue and returns `pending` instead of writing.
 */
export async function updateSongLinksAction(
  repertoireId: string,
  links: SongLink[],
): Promise<{ success: boolean; pending?: boolean }> {
  const userId = await getRequiredUserId()
  const { song_id: songId } = await assertRepertoireAccess(repertoireId, userId)

  const songRes = await query(`SELECT links FROM global_songs WHERE id = $1`, [songId])
  if (songRes.rowCount === 0) {
    throw new Error('Song entry not found')
  }

  const { fetchUrlTitle } = await import('@/lib/linkFetcher')

  const processedLinks = await Promise.all(
    links.map(async (l) => {
      if (!l.label || !l.label.trim()) {
        const fetchedTitle = await fetchUrlTitle(l.url)
        return { label: fetchedTitle || l.url, url: l.url }
      }
      return l
    })
  )

  const currentLinks = (songRes.rows[0].links ?? []) as SongLink[]
  const submittedUrls = new Set(processedLinks.map((l) => l.url))
  const isAdditive = currentLinks.every((l) => submittedUrls.has(l.url))

  if (!isAdditive) {
    await submitGlobalSongEdit(userId, songId, { links: processedLinks })
    return { success: true, pending: true }
  }

  await query(
    `UPDATE global_songs SET links = $1 WHERE id = $2`,
    [JSON.stringify(processedLinks), songId]
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

export async function fetchUrlTitleAction(url: string): Promise<string> {
  await getRequiredUserId()
  const { fetchUrlTitle } = await import('@/lib/linkFetcher')
  return fetchUrlTitle(url)
}

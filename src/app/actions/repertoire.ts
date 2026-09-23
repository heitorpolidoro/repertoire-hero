'use server'

import { revalidatePath } from 'next/cache'
import { getRequiredUserId } from '@/lib/auth-session'
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
  updateLyrics,
  applySongLinkUpdate,
  getPersonalEntryForSong,
  type RepertoireOwner,
  type SongUpdateInput,
} from '@/lib/songs'
import { assertBandMember } from '@/lib/bands'
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

/**
 * `seedStatusFromBandId` selects a band row to *read a status from*, so it is
 * authorized exactly like an owner would be: it arrives from the client, and a
 * band the caller is not a member of throws before any INSERT (RH-83 ER16).
 */
export async function addSongAction(
  songId: string,
  bandId?: string | null,
  seedStatusFromBandId?: string | null,
) {
  const owner = await resolveOwner(bandId)
  if (seedStatusFromBandId) await assertBandMember(seedStatusFromBandId, await getRequiredUserId())
  const result = await addSongToRepertoire(owner, songId, seedStatusFromBandId ?? null)
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
  await updateLyrics(owner, repertoireId, lyrics)
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
 * owner. The entry is what resolves the song id and what authorizes the caller,
 * so `assertRepertoireAccess` stays here; the additive-vs-moderated decision
 * and both statements live in `applySongLinkUpdate`.
 */
export async function updateSongLinksAction(
  repertoireId: string,
  links: SongLink[],
): Promise<{ success: boolean; pending?: boolean }> {
  const userId = await getRequiredUserId()
  const { song_id: songId } = await assertRepertoireAccess(repertoireId, userId)

  const result = await applySongLinkUpdate(userId, songId, links)
  // A queued edit changes nothing anyone can see yet, so nothing to revalidate.
  if (!result.pending) revalidatePath('/')
  return result
}

export async function getPersonalEntryForSongAction(songId: string): Promise<Repertoire | null> {
  try {
    const userId = await getRequiredUserId()
    return await getPersonalEntryForSong(songId, userId)
  } catch {
    return null
  }
}

export async function fetchUrlTitleAction(url: string): Promise<string> {
  await getRequiredUserId()
  const { fetchUrlTitle } = await import('@/lib/linkFetcher')
  return fetchUrlTitle(url)
}

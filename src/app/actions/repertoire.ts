'use server'

import { revalidatePath } from 'next/cache'
import { getRequiredUserId } from '@/lib/auth-session'
import {
  getRepertoire,
  addSongToRepertoire,
  updateSongStatus,
  updateSongTags,
  removeSongFromRepertoire,
  getResolvedEntryForVersion,
  updateSong,
  createAndAddSong,
  assertRepertoireAccess,
  updateLyrics,
  getPersonalEntryForSong,
  type RepertoireOwner,
} from '@/lib/ownerSongs'
import { applySongLinkUpdate, searchSongs, type SongUpdateInput } from '@/lib/songs'
import { assertBandAdmin, assertBandMember } from '@/lib/bands'
import type { Repertoire, ResolvedSongEntry, SongLink, SongStatus } from '@/types/database'

async function resolveOwner(bandId?: string | null): Promise<RepertoireOwner> {
  const userId = await getRequiredUserId()
  if (!bandId) return { userId }
  // `bandId` comes from the caller's own band-context store, so a mismatch is
  // never a legitimate navigation: throw rather than silently return nothing.
  await assertBandMember(bandId, userId)
  return { bandId }
}

/**
 * The owner resolution for **every** action that writes a band's row (RH-124).
 *
 * `docs/use-cases.md`, *Writing a band's rows*, is unqualified: adding,
 * removing, status, key, tuning, lyrics, map and tags all require band admin. A
 * member who is not an admin reads the band's repertoire and cannot change it.
 * RH-96 applied that to status alone; this is the rest of it, and
 * `assertBandAdmin` is the only admin check any of the seven makes. It throws
 * `Access denied: band admin required` before any statement runs, and outside
 * any wrapping `try`, so the text reaches the UI verbatim (convention L1a).
 *
 * The read path still resolves through {@link resolveOwner}: reading is
 * member-level, and so is editing a song's shared links.
 *
 * Four consequences are accepted, not overlooked: a non-admin member can no
 * longer edit a band row's tags inline, can no longer create a new song onto
 * the band, can no longer remove one from it, and gets the existing Toast when
 * saving lyrics onto the band's row in band context. Their own row is untouched
 * by the gate — that is the point.
 */
async function resolveWriteOwner(bandId?: string | null): Promise<RepertoireOwner> {
  const userId = await getRequiredUserId()
  if (!bandId) return { userId }
  await assertBandAdmin(bandId, userId)
  return { bandId }
}

export async function getRepertoireAction(bandId?: string | null) {
  const owner = await resolveOwner(bandId)
  return getRepertoire(owner)
}

export async function addSongAction(songId: string, bandId?: string | null) {
  const owner = await resolveWriteOwner(bandId)
  const result = await addSongToRepertoire(owner, songId)
  revalidatePath('/')
  return result
}

export async function updateSongStatusAction(repertoireId: string, status: SongStatus, bandId?: string | null) {
  const owner = await resolveWriteOwner(bandId)
  const result = await updateSongStatus(owner, repertoireId, status)
  revalidatePath('/')
  return result
}

export async function updateSongTagsAction(repertoireId: string, tags: string[], bandId?: string | null) {
  const owner = await resolveWriteOwner(bandId)
  const result = await updateSongTags(owner, repertoireId, tags)
  revalidatePath('/')
  return result
}

export async function removeSongAction(repertoireId: string, bandId?: string | null) {
  const owner = await resolveWriteOwner(bandId)
  const result = await removeSongFromRepertoire(owner, repertoireId)
  revalidatePath('/')
  return result
}

export async function searchSongsAction(queryStr: string) {
  await getRequiredUserId()
  return searchSongs(queryStr)
}

/**
 * Fast View's entry read, version-addressed (RH-132).
 *
 * The route carries a `song_versions.id` and the owner comes from the page's
 * `?bandId=`, resolved through {@link resolveOwner} — which is member-level and
 * already calls `assertBandMember`, because reading a band's row is not an
 * admin act.
 *
 * It never answers `null`: an owner holding no row at this version resolves to
 * `ownerRowId: null` with `status: null`, `tags: []` and the inherited
 * key/tuning/lyrics/map. It throws for a `versionId` that does not exist, and
 * that throw is what drives the not-found screen.
 */
export async function getResolvedEntryForVersionAction(
  versionId: string,
  bandId?: string | null,
): Promise<ResolvedSongEntry> {
  const owner = await resolveOwner(bandId)
  return getResolvedEntryForVersion(owner, versionId)
}

export async function updateSongAction(
  entry: Repertoire,
  data: SongUpdateInput,
  bandId?: string | null
) {
  // `updateSong`'s owner-row write covers `status`, `tags` and `key`, so this
  // action is gated on band admin like every other band write (RH-96, RH-124).
  const owner = await resolveWriteOwner(bandId)
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
  // The seventh mutating action, and gated for the same reason as the other
  // six: creating a song in band context produces a `band_songs` row, and
  // creating one *is* a band write. Nothing in the UI reaches this branch —
  // all three client call sites pass a single argument and therefore no
  // `bandId` — so the band branch is reachable only by calling the Server
  // Action directly, which is exactly the caller an authz gate exists for.
  const owner = await resolveWriteOwner(bandId)
  const result = await createAndAddSong(owner, data)
  revalidatePath('/')
  return result
}

export async function updateLyricsAction(repertoireId: string, lyrics: string, bandId?: string | null) {
  const owner = await resolveWriteOwner(bandId)
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
 * Writes to the shared `songs.links` catalog on behalf of a repertoire owner.
 * The entry is what resolves the song id and what authorizes the caller, so
 * `assertRepertoireAccess` stays here; the additive-vs-moderated decision and
 * both statements live in `applySongLinkUpdate`.
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
